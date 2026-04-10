import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { buildTriangulationContext, triangulate } from '@glyphor/agent-runtime';
import type { ModelClient } from '@glyphor/agent-runtime';
import type { RedisCache } from '@glyphor/agent-runtime';
import { detectProvider, estimateModelCost, normalizeReasoningLevel, resolveModel } from '@glyphor/shared';
import type { TriangulationModelSelection } from '@glyphor/shared';
import type { ReasoningLevel } from '@glyphor/shared';
import { systemQuery } from '@glyphor/shared/db';
import { buildGitHubRepoContext, searchWeb, searchResultsToContext } from '@glyphor/integrations';
import mammoth from 'mammoth';

const DEFAULT_DASHBOARD_ORIGIN = (process.env.DASHBOARD_URL?.trim() || 'https://dashboard.glyphor.com').replace(/\/$/, '');
const ORA_TRUSTED_ORIGINS = new Set<string>(
  [
    ...((process.env.CORS_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0)),
    process.env.DASHBOARD_URL?.trim(),
    DEFAULT_DASHBOARD_ORIGIN,
    'http://localhost:5173',
    'http://localhost:3000',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:3000',
  ].filter((origin): origin is string => Boolean(origin && origin.length > 0))
    .map((origin) => origin.replace(/\/$/, '')),
);

function sendSSE(res: ServerResponse, event: Record<string, unknown>) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function resolveOraCorsOrigin(req: IncomingMessage): string {
  const rawOrigin = req.headers.origin;
  const origin = (Array.isArray(rawOrigin) ? rawOrigin[0] : rawOrigin)?.trim();
  if (!origin) return DEFAULT_DASHBOARD_ORIGIN;
  const normalized = origin.replace(/\/$/, '');
  return ORA_TRUSTED_ORIGINS.has(normalized) ? normalized : DEFAULT_DASHBOARD_ORIGIN;
}

/** Convert a .docx base64 attachment to a plain-text attachment the models can read. */
async function extractDocxText(
  att: { name: string; mimeType: string; base64: string },
): Promise<{ name: string; mimeType: string; base64: string }> {
  const buf = Buffer.from(att.base64, 'base64');
  const { value: text } = await mammoth.extractRawText({ buffer: buf });
  return { name: att.name, mimeType: 'text/plain', base64: Buffer.from(text, 'utf-8').toString('base64') };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

const INTELLIGENCE_SYSTEM_PROMPT = `You are Eaton Strategic Intelligence, an AI research and analysis assistant for Glyphor.
You have access to internal company knowledge, financial data, competitive intelligence,
and strategic analysis. Provide accurate, well-sourced responses. When using internal
knowledge, cite sources by number. Be direct and actionable.`;

type OraMode = 'triangulated' | 'single-model';

interface SingleModelRun {
  mode: 'single-model';
  model: string;
  provider: 'gemini' | 'openai' | 'anthropic';
  durationMs: number;
  thinkingEnabled: boolean;
  reasoningLevel: ReasoningLevel;
  webSearch: boolean;
  knowledgeBase: boolean;
  deepResearch: boolean;
}

export async function handleTriangulatedChat(
  req: IncomingMessage,
  res: ServerResponse,
  deps: {
    modelClient: ModelClient;
    embeddingClient: { embed(text: string): Promise<number[]> };
    redisCache?: RedisCache;
  },
): Promise<void> {
  const corsOrigin = resolveOraCorsOrigin(req);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': corsOrigin,
    'Vary': 'Origin',
  });

  try {
    const body = JSON.parse(await readBody(req));
    const { message, features = {}, attachments = [], conversationId, userId, mode = 'triangulated', selectedModel, githubRepos = [], triangulationModels, sessionId, history = [] } = body as {
      message: string;
      features?: Record<string, boolean | string>;
      attachments?: Array<Record<string, string>>;
      conversationId?: string;
      userId?: string;
      mode?: OraMode;
      selectedModel?: string;
      githubRepos?: string[];
      triangulationModels?: Partial<TriangulationModelSelection>;
      sessionId?: string;
      history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    };
    const convId = conversationId || randomUUID();
    const effectiveSessionId = sessionId || null;

    // Build conversation history turns for multi-turn context
    const historyTurns = history.map((h) => ({
      role: h.role === 'assistant' ? 'assistant' as const : 'user' as const,
      content: h.content,
      timestamp: Date.now(),
    }));

    const requestedReasoningLevel = typeof features.reasoningLevel === 'string'
      ? features.reasoningLevel as ReasoningLevel
      : (features.deepThinking ? 'deep' : undefined);
    const deepResearchEnabled = features.deepResearch === true;
    const effectiveReasoningLevel = deepResearchEnabled ? 'deep' : requestedReasoningLevel;
    const webSearchEnabled = features.webSearch === true;
    const knowledgeBaseEnabled = features.knowledgeBase === false
      ? false
      : (features.internalSearch === false ? false : true);
    const normalizedAttachments = await Promise.all(attachments.map(async (a: Record<string, string>) => {
      const mapped = {
        name: a.name,
        mimeType: a.mimeType ?? a.type ?? 'application/octet-stream',
        base64: a.base64 ?? a.data ?? '',
      };
      if (mapped.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        || mapped.name?.endsWith('.docx')) {
        try { return await extractDocxText(mapped); } catch (e) {
          console.warn('[triangulatedChat] Failed to extract .docx text:', e);
        }
      }
      return mapped;
    }));

    // Run web search if enabled and inject results into system prompt
    let systemPrompt = INTELLIGENCE_SYSTEM_PROMPT;
    if (webSearchEnabled || deepResearchEnabled) {
      try {
        const searchResults = await searchWeb(message, { num: deepResearchEnabled ? 12 : 8 });
        if (searchResults.length > 0) {
          const ctx = searchResultsToContext([{ query: message, results: searchResults }]);
          systemPrompt += `\n\n## Web Search Results\n${ctx}\nUse these sources to ground your response. Cite URLs when referencing specific information.`;
        }
      } catch (err) {
        console.warn('[triangulatedChat] Web search failed, continuing without:', err);
      }
    }

    if (deepResearchEnabled) {
      systemPrompt += '\n\n## Deep Research Mode\nPerform broad, multi-step research and synthesis. Explicitly compare competing claims, cite supporting evidence, and call out uncertainty when evidence is weak or conflicting.';
    }

    if (Array.isArray(githubRepos) && githubRepos.length > 0) {
      try {
        const githubContext = await buildGitHubRepoContext(githubRepos, message);
        if (githubContext.context) {
          systemPrompt += `\n\n## GitHub Repository Context\nSelected repositories: ${githubContext.repos.join(', ')}\n${githubContext.context}\nUse only this repository context when making claims about code or repository state.`;
        }
      } catch (err) {
        console.warn('[triangulatedChat] GitHub repo context failed, continuing without:', err);
      }
    }

    if (mode === 'single-model') {
      const model = resolveModel(selectedModel ?? 'gemini-3.1-flash-lite-preview');
      const provider = detectProvider(model);
      const reasoningLevel = normalizeReasoningLevel(model, effectiveReasoningLevel);
      const effectiveWebSearch = webSearchEnabled || deepResearchEnabled;
      let fullSystemPrompt = systemPrompt;

      if (features.knowledgeBase ?? features.internalSearch ?? true) {
        const ctx = await buildTriangulationContext(
          message,
          deps.embeddingClient,
          deps.modelClient,
          deps.redisCache,
        );
        if (ctx.contextBlock) {
          fullSystemPrompt = `${systemPrompt}\n\n${ctx.contextBlock}`;
        }
      }

      const startedAt = Date.now();
      const response = await deps.modelClient.generate({
        model,
        systemInstruction: fullSystemPrompt,
        contents: [
          ...historyTurns,
          {
            role: 'user' as const,
            content: message,
            timestamp: Date.now(),
            attachments: normalizedAttachments.map((att) => ({ name: att.name, mimeType: att.mimeType, data: att.base64 })),
          },
        ],
        maxTokens: 8192,
        thinkingEnabled: reasoningLevel !== 'none',
        reasoningLevel,
        metadata: deepResearchEnabled && provider === 'openai'
          ? {
              modelConfig: {
                model,
                routingRule: 'ora.deep_research',
                capabilities: ['tool_search'],
                enableToolSearch: true,
                enableWebSearch: true,
              },
            }
          : undefined,
      });

      const modelRun: SingleModelRun = {
        mode: 'single-model',
        model,
        provider,
        durationMs: Date.now() - startedAt,
        thinkingEnabled: reasoningLevel !== 'none',
        reasoningLevel,
        webSearch: effectiveWebSearch,
        knowledgeBase: knowledgeBaseEnabled,
        deepResearch: deepResearchEnabled,
      };

      sendSSE(res, {
        type: 'single_result',
        data: {
          responseText: response.text ?? '',
          modelRun,
        },
      });

      await systemQuery(
        `INSERT INTO chat_messages (agent_role, role, content, user_id, conversation_id, session_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        ['ora', 'user', message, userId ?? null, convId, effectiveSessionId],
      );

      await systemQuery(
        `INSERT INTO chat_messages (agent_role, role, content, user_id, conversation_id, session_id, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [
          'ora',
          'agent',
          response.text ?? '',
          userId ?? null,
          convId,
          effectiveSessionId,
          JSON.stringify({
            mode: 'single-model',
            modelRun,
            runtimeBoundary: 'ora-legacy-isolated',
            runtimeSpine: false,
          }),
        ],
      );

      await systemQuery(
        `INSERT INTO agent_runs (agent_id, task, status, cost_usd, duration_ms, tokens_used, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          'ora',
          'ora_chat',
          'completed',
          estimateModelCost(
            model,
            response.usageMetadata.inputTokens,
            response.usageMetadata.outputTokens,
            response.usageMetadata.thinkingTokens ?? 0,
            response.usageMetadata.cachedInputTokens ?? 0,
          ),
          modelRun.durationMs,
          response.usageMetadata.totalTokens,
        ],
      );

      return;
    }

    const result = await triangulate(
      message,
      {
        systemPrompt,
        enableWebSearch: webSearchEnabled || deepResearchEnabled,
        enableDeepThinking: effectiveReasoningLevel === 'deep',
        enableInternalSearch: knowledgeBaseEnabled,
        attachments: normalizedAttachments,
        reasoningLevel: effectiveReasoningLevel,
        history: historyTurns,
        triangulationModels: triangulationModels
          ? {
              claude: triangulationModels.claude ? resolveModel(triangulationModels.claude) : undefined,
              gemini: triangulationModels.gemini ? resolveModel(triangulationModels.gemini) : undefined,
              openai: triangulationModels.openai ? resolveModel(triangulationModels.openai) : undefined,
            }
          : undefined,
      },
      deps,
    );

    // Send tier event
    sendSSE(res, { type: 'tier', tier: result.tier });

    // Send provider_complete events
    for (const provider of Object.keys(result.allResponses)) {
      sendSSE(res, { type: 'provider_complete', provider });
    }

    // Send judge_start + result
    if (result.tier !== 'SIMPLE') {
      sendSSE(res, { type: 'judge_start' });
    }
    sendSSE(res, { type: 'result', data: { ...result, reasoningLevel: effectiveReasoningLevel ?? 'standard', deepResearch: deepResearchEnabled } });

    // ─── Persist messages ─────────────────────────────────────────
    // Save user message
    await systemQuery(
      `INSERT INTO chat_messages (agent_role, role, content, user_id, conversation_id, session_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      ['ora', 'user', message, userId ?? null, convId, effectiveSessionId],
    );

    // Save agent response with metadata
    await systemQuery(
      `INSERT INTO chat_messages (agent_role, role, content, user_id, conversation_id, session_id, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [
        'ora',
        'agent',
        result.selectedResponse,
        userId ?? null,
        convId,
        effectiveSessionId,
        JSON.stringify({
          ...result,
          reasoningLevel: effectiveReasoningLevel ?? 'standard',
          deepResearch: deepResearchEnabled,
          runtimeBoundary: 'ora-legacy-isolated',
          runtimeSpine: false,
        }),
      ],
    );

    // Log to agent_runs
    await systemQuery(
      `INSERT INTO agent_runs (agent_id, task, status, cost_usd, duration_ms, tokens_used, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [
        'ora',
        'ora_chat',
        'completed',
        result.cost.total,
        Math.max(...Object.values(result.latencyMs), 0),
        Object.values(result.allResponses).length,
      ],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[triangulatedChat] Error:', msg);
    sendSSE(res, { type: 'error', message: msg });
  } finally {
    res.end();
  }
}
