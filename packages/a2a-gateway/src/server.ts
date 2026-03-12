import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { getAgentCard, getGatewayCard, listAgentCards } from './agentCards.js';
import { authenticateClient, createA2ATask, getA2ATaskSnapshot } from './taskHandler.js';

const PORT = parseInt(process.env.PORT || '8091', 10);
const BASE_URL = process.env.A2A_BASE_URL ?? `http://localhost:${PORT}`;
const SCHEDULER_URL = process.env.SCHEDULER_URL;

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(JSON.stringify(data));
}

function sseHeaders(res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
}

function cors(res: ServerResponse): void {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end();
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

async function requireClient(req: IncomingMessage, res: ServerResponse) {
  try {
    const client = await authenticateClient(req.headers.authorization);
    if (!client) {
      json(res, 401, { error: 'Bearer token required' });
      return null;
    }
    return client;
  } catch (err) {
    json(res, 429, { error: (err as Error).message });
    return null;
  }
}

async function handleSubscribe(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const client = await requireClient(req, res);
  if (!client) return;
  const body = JSON.parse(await readBody(req));
  const taskId = body.taskId as string | undefined;
  if (!taskId) {
    json(res, 400, { error: 'taskId is required' });
    return;
  }

  sseHeaders(res);
  const pushSnapshot = async () => {
    const snapshot = await getA2ATaskSnapshot(taskId);
    res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
    if (!snapshot || snapshot.status === 'completed' || snapshot.status === 'failed') {
      clearInterval(interval);
      res.end();
    }
  };

  const interval = setInterval(() => {
    void pushSnapshot().catch((err) => {
      res.write(`event: error\ndata: ${JSON.stringify({ error: (err as Error).message })}\n\n`);
      clearInterval(interval);
      res.end();
    });
  }, 3000);

  req.on('close', () => clearInterval(interval));
  await pushSnapshot();
}

const server = createServer(async (req, res) => {
  const method = req.method ?? 'GET';
  const rawUrl = req.url ?? '/';
  const url = new URL(rawUrl, BASE_URL);

  if (method === 'OPTIONS') {
    cors(res);
    return;
  }

  try {
    if (method === 'GET' && url.pathname === '/health') {
      json(res, 200, { status: 'ok', service: 'a2a-gateway' });
      return;
    }

    if (method === 'GET' && url.pathname === '/.well-known/agent.json') {
      json(res, 200, await getGatewayCard(BASE_URL));
      return;
    }

    if (method === 'GET' && url.pathname === '/agents') {
      json(res, 200, await listAgentCards(BASE_URL));
      return;
    }

    const agentMatch = url.pathname.match(/^\/agents\/([^/]+)$/);
    if (method === 'GET' && agentMatch) {
      const agentId = decodeURIComponent(agentMatch[1]);
      const card = await getAgentCard(BASE_URL, agentId);
      if (!card) {
        json(res, 404, { error: 'Agent not found' });
        return;
      }
      json(res, 200, card);
      return;
    }

    if (method === 'POST' && url.pathname === '/tasks/send') {
      const client = await requireClient(req, res);
      if (!client) return;
      const body = JSON.parse(await readBody(req));
      if (!body.title || !body.description) {
        json(res, 400, { error: 'title and description are required' });
        return;
      }
      const task = await createA2ATask(client, body, SCHEDULER_URL);
      json(res, 202, task);
      return;
    }

    const taskMatch = url.pathname.match(/^\/tasks\/([^/]+)$/);
    if (method === 'GET' && taskMatch) {
      const client = await requireClient(req, res);
      if (!client) return;
      const snapshot = await getA2ATaskSnapshot(decodeURIComponent(taskMatch[1]));
      if (!snapshot) {
        json(res, 404, { error: 'Task not found' });
        return;
      }
      json(res, 200, snapshot);
      return;
    }

    if (method === 'POST' && url.pathname === '/tasks/sendSubscribe') {
      await handleSubscribe(req, res);
      return;
    }

    json(res, 404, { error: 'Not found' });
  } catch (err) {
    json(res, 500, { error: (err as Error).message });
  }
});

server.listen(PORT, () => {
  console.log(`[A2A] Gateway listening on :${PORT}`);
});
