/**
 * MCP Email Server — HTTP JSON-RPC Entry Point
 *
 * Exposes email tools (send_email, read_inbox, reply_to_email)
 * via JSON-RPC on /mcp, following the same pattern as glyphor-mcp-data-server.
 *
 * Agent identity is passed via the X-Agent-Role header on each request.
 * The server uses this to determine which shared mailbox to use.
 *
 * Env vars:
 *   PORT                     — HTTP port (default: 8080)
 *   AZURE_TENANT_ID          — Entra tenant ID
 *   AZURE_MAIL_CLIENT_ID     — Mail app registration client ID
 *   AZURE_MAIL_CLIENT_SECRET — Mail app registration client secret
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tools } from './tools.js';

// ── Helpers ────────────────────────────────────────────────────

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

// ── JSON-RPC helpers ───────────────────────────────────────────

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

// ── Tool registry ──────────────────────────────────────────────

const toolMap = new Map(tools.map((t) => [t.name, t]));

function handleToolsList() {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}

async function handleToolsCall(params: Record<string, unknown>, agentRole: string) {
  const name = params.name as string | undefined;
  const args = (params.arguments ?? {}) as Record<string, unknown>;

  if (!name) throw Object.assign(new Error('Missing tool name'), { code: -32602 });
  const tool = toolMap.get(name);
  if (!tool) throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
  if (!agentRole) throw Object.assign(new Error('Missing X-Agent-Role header'), { code: -32602 });

  const result = await tool.handler(args, agentRole);
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
}

// ── HTTP server ────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    json(res, 200, { status: 'ok' });
    return;
  }

  // MCP endpoint
  if (req.method === 'POST' && req.url === '/mcp') {
    let body: JsonRpcRequest;
    try {
      body = JSON.parse(await readBody(req)) as JsonRpcRequest;
    } catch {
      json(res, 400, rpcError(null, -32700, 'Parse error'));
      return;
    }

    // Extract agent role from header (set by glyphorMcpTools bridge)
    const agentRole = (req.headers['x-agent-role'] as string) ?? '';

    try {
      let result: unknown;
      switch (body.method) {
        case 'initialize':
          result = {
            protocolVersion: '2024-11-05',
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'glyphor-mcp-email-server', version: '0.0.1' },
          };
          break;
        case 'tools/list':
          result = { tools: handleToolsList() };
          break;
        case 'tools/call':
          result = await handleToolsCall(body.params ?? {}, agentRole);
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

  // 404
  json(res, 404, { error: 'Not found' });
});

const PORT = Number(process.env.PORT ?? 8080);
server.listen(PORT, () => {
  console.log(`MCP email server listening on :${PORT}`);
});
