/**
 * MCP Slack Server — JSON-RPC 2.0 server exposing Slack routing and approval
 * tools to internal agents.
 *
 * Protocol:  MCP 2024-11-05 (JSON-RPC 2.0 over HTTP POST /mcp)
 * Port:      PORT env var (default 8097)
 * Health:    GET /health
 *
 * Tools exposed:
 *   list_pending_content  — List inbound customer content awaiting routing
 *   get_routing_stats     — Aggregate stats on routing and approvals
 *   list_approvals        — List slack_approvals rows (filter by status)
 *   approve_item          — Approve a pending approval
 *   reject_item           — Reject a pending approval
 *   route_content         — Manually route a content item to a destination
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import pg from 'pg';
import { tools } from './tools.js';

const { Pool } = pg;

// ── Postgres connection ────────────────────────────────────────────────────────
const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.DB_HOST ?? 'localhost',
        database: process.env.DB_NAME ?? 'glyphor',
        user: process.env.DB_USER ?? 'postgres',
        password: process.env.DB_PASSWORD ?? '',
      },
);

// ── Helpers ───────────────────────────────────────────────────────────────────
function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

// ── JSON-RPC helpers ──────────────────────────────────────────────────────────
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

function rpcOk(id: string | number | null | undefined, result: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function rpcError(id: string | number | null | undefined, code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

// ── MCP tool registry ─────────────────────────────────────────────────────────
const toolMap = new Map(tools.map((t) => [t.name, t]));

function handleToolsList() {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}

async function handleToolsCall(params: Record<string, unknown>) {
  const name = params.name as string | undefined;
  const args = (params.arguments ?? {}) as Record<string, unknown>;

  if (!name) throw Object.assign(new Error('Missing tool name'), { code: -32602 });
  const tool = toolMap.get(name);
  if (!tool) throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });

  const result = await tool.handler(pool, args);
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
}

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    try {
      await pool.query('SELECT 1');
      json(res, 200, { status: 'ok', service: 'mcp-slack-server' });
    } catch {
      json(res, 200, { status: 'degraded', service: 'mcp-slack-server' });
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/mcp') {
    let body: JsonRpcRequest;
    try {
      body = JSON.parse(await readBody(req)) as JsonRpcRequest;
    } catch {
      json(res, 400, rpcError(null, -32700, 'Parse error'));
      return;
    }

    try {
      let result: unknown;
      switch (body.method) {
        case 'initialize':
          result = {
            protocolVersion: '2024-11-05',
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'glyphor-mcp-slack-server', version: '0.0.1' },
          };
          break;
        case 'tools/list':
          result = { tools: handleToolsList() };
          break;
        case 'tools/call':
          result = await handleToolsCall(body.params ?? {});
          break;
        default:
          json(res, 200, rpcError(body.id, -32601, `Method not found: ${body.method}`));
          return;
      }
      json(res, 200, rpcOk(body.id, result));
    } catch (err: unknown) {
      const e = err as Error & { code?: number };
      json(res, 200, rpcError(body.id, e.code ?? -32603, e.message));
    }
    return;
  }

  json(res, 404, { error: 'Not found' });
});

const PORT = Number(process.env.PORT ?? 8097);
server.listen(PORT, () => {
  console.log(`MCP Slack server listening on :${PORT}`);
  console.log(`Tools: ${tools.map((t) => t.name).join(', ')}`);
});
