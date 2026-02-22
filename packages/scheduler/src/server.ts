/**
 * Scheduler HTTP Server — Cloud Run entry point
 *
 * Listens for:
 * - POST /pubsub — Pub/Sub push messages (from Cloud Scheduler)
 * - POST /run    — Direct task invocation
 * - GET  /health — Health check
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { EventRouter } from './eventRouter.js';
import { DecisionQueue } from './decisionQueue.js';
import { runChiefOfStaff } from '@glyphor/agents';
import type { CompanyAgentRole } from '@glyphor/agent-runtime';

const PORT = parseInt(process.env.PORT || '8080', 10);

// ─── Bootstrap ──────────────────────────────────────────────────

const memory = new CompanyMemoryStore({
  supabaseUrl: process.env.SUPABASE_URL!,
  supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY!,
  gcsBucket: process.env.GCS_BUCKET || 'glyphor-company',
  gcpProjectId: process.env.GCP_PROJECT_ID,
});

const decisionQueue = new DecisionQueue(memory, {});

const agentExecutor = async (
  agentRole: CompanyAgentRole,
  task: string,
  payload: Record<string, unknown>,
): Promise<void> => {
  if (agentRole === 'chief-of-staff') {
    const taskMap: Record<string, 'generate_briefing' | 'check_escalations' | 'on_demand'> = {
      morning_briefing: 'generate_briefing',
      check_escalations: 'check_escalations',
      eod_summary: 'generate_briefing',
    };
    await runChiefOfStaff({
      task: taskMap[task] ?? 'on_demand',
      recipient: payload.founder as 'kristina' | 'andrew' | undefined,
    });
  } else {
    console.log(`[Scheduler] Agent ${agentRole} not yet implemented, skipping task: ${task}`);
  }
};

const router = new EventRouter(agentExecutor, decisionQueue);

// ─── HTTP Helpers ───────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// ─── Server ─────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = req.url ?? '/';
  const method = req.method ?? 'GET';

  try {
    // Health check
    if (url === '/health' || url === '/') {
      json(res, 200, { status: 'ok', service: 'glyphor-scheduler' });
      return;
    }

    // Pub/Sub push endpoint
    if (method === 'POST' && url === '/pubsub') {
      const body = JSON.parse(await readBody(req));
      // Pub/Sub wraps the message in { message: { data: base64 } }
      const messageData = Buffer.from(body.message.data, 'base64').toString('utf-8');
      console.log(`[Scheduler] Pub/Sub message: ${messageData}`);

      const result = await router.handleSchedulerMessage(messageData);
      json(res, 200, result);
      return;
    }

    // Direct task invocation
    if (method === 'POST' && url === '/run') {
      const body = JSON.parse(await readBody(req));
      const result = await router.route({
        source: 'manual',
        agentRole: body.agentRole,
        task: body.task,
        payload: body.payload ?? {},
      });
      json(res, 200, result);
      return;
    }

    json(res, 404, { error: 'Not found' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Scheduler] Error handling ${method} ${url}:`, message);
    json(res, 500, { error: message });
  }
});

server.listen(PORT, () => {
  console.log(`[Scheduler] Listening on port ${PORT}`);
});
