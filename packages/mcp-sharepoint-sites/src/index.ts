import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tools } from './tools/index.js';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

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

function rpcOk(id: string | number | null | undefined, result: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function rpcError(id: string | number | null | undefined, code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function roleFromRequest(req: IncomingMessage): string | undefined {
  const raw = req.headers['x-agent-role'];
  if (!raw) return undefined;
  return Array.isArray(raw) ? raw[0] : raw;
}

const toolMap = new Map(tools.map((tool) => [tool.name, tool]));

function handleToolsList() {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}

async function handleToolsCall(params: Record<string, unknown>, agentRole?: string) {
  const name = params.name as string | undefined;
  const args = (params.arguments ?? {}) as Record<string, unknown>;

  if (!name) {
    throw Object.assign(new Error('Missing tool name'), { code: -32602 });
  }

  const tool = toolMap.get(name);
  if (!tool) {
    throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
  }

  if (tool.allowedRoles && tool.allowedRoles.length > 0) {
    if (!agentRole || !tool.allowedRoles.includes(agentRole)) {
      throw Object.assign(
        new Error(`Agent role ${agentRole ?? 'unknown'} is not allowed to call ${name}`),
        { code: -32603 },
      );
    }
  }

  const result = await tool.handler(args);
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
}

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    json(res, 200, { status: 'ok' });
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
            serverInfo: { name: 'glyphor-mcp-sharepoint-sites', version: '0.0.1' },
          };
          break;
        case 'tools/list':
          result = { tools: handleToolsList() };
          break;
        case 'tools/call':
          result = await handleToolsCall(body.params ?? {}, roleFromRequest(req));
          break;
        default:
          json(res, 200, rpcError(body.id, -32601, `Method not found: ${body.method}`));
          return;
      }

      json(res, 200, rpcOk(body.id, result));
    } catch (err) {
      const error = err as Error & { code?: number };
      json(res, 200, rpcError(body.id, error.code ?? -32603, error.message));
    }
    return;
  }

  json(res, 404, { error: 'Not found' });
});

const PORT = Number(process.env.PORT ?? 8089);
server.listen(PORT, () => {
  console.log(`MCP SharePoint sites server listening on :${PORT}`);
});
