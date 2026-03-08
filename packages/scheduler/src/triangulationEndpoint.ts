import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { triangulate } from '@glyphor/agent-runtime';
import type { ModelClient } from '@glyphor/agent-runtime';
import type { RedisCache } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

function sendSSE(res: ServerResponse, event: Record<string, unknown>) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
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
    const { message, features = {}, attachments = [], conversationId, userId } = body;
    const convId = conversationId || randomUUID();

    const result = await triangulate(
      message,
      {
        systemPrompt: INTELLIGENCE_SYSTEM_PROMPT,
        enableWebSearch: features.webSearch ?? false,
        enableDeepThinking: features.deepThinking ?? false,
        enableInternalSearch: features.knowledgeBase ?? features.internalSearch ?? true,
        attachments: attachments.map((a: Record<string, string>) => ({
          name: a.name,
          mimeType: a.mimeType ?? a.type ?? 'application/octet-stream',
          base64: a.base64 ?? a.data ?? '',
        })),
      },
      deps,
    );

    // Send tier event
    sendSSE(res, { type: 'tier', tier: result.tier });

    // Send the full response as a single chunk
    if (result.selectedResponse) {
      sendSSE(res, { type: 'chunk', text: result.selectedResponse });
    }

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
      ['intelligence', 'user', message, userId ?? null, convId],
    );

    // Save agent response with metadata
    await systemQuery(
      `INSERT INTO chat_messages (agent_role, role, content, user_id, conversation_id, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      ['intelligence', 'agent', result.selectedResponse, userId ?? null, convId, JSON.stringify(result)],
    );

    // Log to agent_runs
    await systemQuery(
      `INSERT INTO agent_runs (agent_role, task, status, cost_usd, duration_ms, tokens_used, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [
        'intelligence',
        'triangulated_chat',
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
