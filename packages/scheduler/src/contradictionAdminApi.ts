import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CompanyMemoryStore } from '@glyphor/company-memory';

function json(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body || '{}'));
    req.on('error', reject);
  });
}

export function createContradictionAdminApi(memory: CompanyMemoryStore) {
  return async function handleContradictionAdminApi(
    req: IncomingMessage,
    res: ServerResponse,
    url: string,
    queryString: string,
    method: string,
  ): Promise<boolean> {
    if (!url.startsWith('/admin/contradictions')) return false;

    const ci = memory.getCollectiveIntelligence();
    const params = new URLSearchParams(queryString);

    try {
      if (method === 'GET' && url === '/admin/contradictions') {
        const result = await ci.listContradictions({
          status: params.get('status') ?? undefined,
          entityType: params.get('entityType') ?? params.get('entity_type') ?? undefined,
          dateFrom: params.get('dateFrom') ?? params.get('from') ?? undefined,
          dateTo: params.get('dateTo') ?? params.get('to') ?? undefined,
          page: Number(params.get('page') ?? '1'),
          pageSize: Number(params.get('pageSize') ?? '50'),
        });
        json(res, 200, result);
        return true;
      }

      const detailMatch = url.match(/^\/admin\/contradictions\/([^/]+)$/);
      if (method === 'GET' && detailMatch) {
        const contradiction = await ci.getContradictionDetail(decodeURIComponent(detailMatch[1]));
        if (!contradiction) {
          json(res, 404, { error: 'Contradiction not found' });
          return true;
        }
        json(res, 200, contradiction);
        return true;
      }

      const resolveMatch = url.match(/^\/admin\/contradictions\/([^/]+)\/resolve$/);
      if (method === 'POST' && resolveMatch) {
        const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
        const winnerFactId = typeof body.winnerFactId === 'string' ? body.winnerFactId.trim() : '';
        const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
        const resolvedBy = typeof body.resolvedBy === 'string'
          ? body.resolvedBy.trim()
          : typeof body.humanId === 'string'
            ? body.humanId.trim()
            : 'human_admin';
        if (!winnerFactId || !reason) {
          throw new Error('winnerFactId and reason are required');
        }
        await ci.resolveContradictionByHuman(decodeURIComponent(resolveMatch[1]), winnerFactId, reason, resolvedBy);
        json(res, 200, { success: true });
        return true;
      }

      const dismissMatch = url.match(/^\/admin\/contradictions\/([^/]+)\/dismiss$/);
      if (method === 'POST' && dismissMatch) {
        const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
        const reason = typeof body.reason === 'string' ? body.reason.trim() : 'Dismissed by human reviewer.';
        const resolvedBy = typeof body.resolvedBy === 'string'
          ? body.resolvedBy.trim()
          : typeof body.humanId === 'string'
            ? body.humanId.trim()
            : 'human_admin';
        await ci.dismissContradiction(decodeURIComponent(dismissMatch[1]), reason, resolvedBy);
        json(res, 200, { success: true });
        return true;
      }

      return false;
    } catch (err) {
      json(res, 500, { error: err instanceof Error ? err.message : String(err) });
      return true;
    }
  };
}