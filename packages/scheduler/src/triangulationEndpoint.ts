import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { buildTriangulationContext, triangulate } from '@glyphor/agent-runtime';
import type { ModelClient } from '@glyphor/agent-runtime';
import type { RedisCache } from '@glyphor/agent-runtime';
import { detectProvider, estimateModelCost, resolveModel } from '@glyphor/shared';
import { systemQuery } from '@glyphor/shared/db';
import { buildGitHubRepoContext, searchWeb, searchResultsToContext } from '@glyphor/integrations';
import mammoth from 'mammoth';

function sendSSE(res: ServerResponse, event: Record<string, unknown>) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
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
  webSearch: boolean;
  knowledgeBase: boolean;
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
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  try {
    const body = JSON.parse(await readBody(req));
    const { message, features = {}, attachments = [], conversationId, userId, mode = 'triangulated', selectedModel, githubRepos = [] } = body as {
      message: string;
      features?: Record<string, boolean>;
      attachments?: Array<Record<string, string>>;
      conversationId?: string;
      userId?: string;
      mode?: OraMode;
      selectedModel?: string;
      githubRepos?: string[];
    };
    const convId = conversationId || randomUUID();
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
    if (features.webSearch) {
      try {
        const searchResults = await searchWeb(message, { num: 8 });
        if (searchResults.length > 0) {
          const ctx = searchResultsToContext([{ query: message, results: searchResults }]);
          systemPrompt += `\n\n## Web Search Results\n${ctx}\nUse these sources to ground your response. Cite URLs when referencing specific information.`;
        }
      } catch (err) {
        console.warn('[triangulatedChat] Web search failed, continuing without:', err);
      }
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
      const model = resolveModel(selectedModel ?? 'gpt-5.4');
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
        contents: [{
          role: 'user' as const,
          content: message,
          timestamp: Date.now(),
          attachments: normalizedAttachments.map((att) => ({ name: att.name, mimeType: att.mimeType, data: att.base64 })),
        }],
        maxTokens: 8192,
        thinkingEnabled: features.deepThinking ?? false,
      });

      const modelRun: SingleModelRun = {
        mode: 'single-model',
        model,
        provider: detectProvider(model),
        durationMs: Date.now() - startedAt,
        thinkingEnabled: features.deepThinking ?? false,
        webSearch: features.webSearch ?? false,
        knowledgeBase: features.knowledgeBase ?? features.internalSearch ?? true,
      };

      sendSSE(res, {
        type: 'single_result',
        data: {
          responseText: response.text ?? '',
          modelRun,
        },
      });

      await systemQuery(
        `INSERT INTO chat_messages (agent_role, role, content, user_id, conversation_id, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        ['ora', 'user', message, userId ?? null, convId],
      );

      await systemQuery(
        `INSERT INTO chat_messages (agent_role, role, content, user_id, conversation_id, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        ['ora', 'agent', response.text ?? '', userId ?? null, convId, JSON.stringify({ mode: 'single-model', modelRun })],
      );

      await systemQuery(
        `INSERT INTO agent_runs (agent_role, task, status, cost_usd, duration_ms, tokens_used, created_at)
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
        enableWebSearch: features.webSearch ?? false,
        enableDeepThinking: features.deepThinking ?? false,
        enableInternalSearch: features.knowledgeBase ?? features.internalSearch ?? true,
        attachments: normalizedAttachments,
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
    sendSSE(res, { type: 'result', data: result });

    // ─── Persist messages ─────────────────────────────────────────
    // Save user message
    await systemQuery(
      `INSERT INTO chat_messages (agent_role, role, content, user_id, conversation_id, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      ['ora', 'user', message, userId ?? null, convId],
    );

    // Save agent response with metadata
    await systemQuery(
      `INSERT INTO chat_messages (agent_role, role, content, user_id, conversation_id, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      ['ora', 'agent', result.selectedResponse, userId ?? null, convId, JSON.stringify(result)],
    );

    // Log to agent_runs
    await systemQuery(
      `INSERT INTO agent_runs (agent_role, task, status, cost_usd, duration_ms, tokens_used, created_at)
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
