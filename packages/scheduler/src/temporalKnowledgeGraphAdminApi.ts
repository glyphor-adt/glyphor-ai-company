import type { IncomingMessage, ServerResponse } from 'node:http';
import { TemporalKnowledgeGraph } from '@glyphor/agent-runtime';
import { EmbeddingClient } from '@glyphor/company-memory';
import { writeJson } from './httpJson.js';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body || '{}'));
    req.on('error', reject);
  });
}

let graphClientSingleton: TemporalKnowledgeGraph | null = null;

function getGraphClient(): TemporalKnowledgeGraph {
  if (graphClientSingleton) return graphClientSingleton;
  if (!process.env.GOOGLE_AI_API_KEY) {
    throw new Error('GOOGLE_AI_API_KEY is required for temporal knowledge graph embeddings');
  }
  graphClientSingleton = new TemporalKnowledgeGraph(new EmbeddingClient(process.env.GOOGLE_AI_API_KEY));
  return graphClientSingleton;
}

function parseLimit(value: string | null, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(200, parsed));
}

function parseCsv(value: string | null): string[] {
  if (!value) return [];
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

export async function handleTemporalKnowledgeGraphAdminApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  queryString: string,
  method: string,
): Promise<boolean> {
  if (!url.startsWith('/admin/kg')) return false;

  const params = new URLSearchParams(queryString);
  const send = (status: number, data: unknown) => writeJson(res, status, data, req);

  try {
    const graph = getGraphClient();

    if (method === 'GET' && url === '/admin/kg/entities') {
      const entities = await graph.listEntities({
        entityType: params.get('type') ?? undefined,
        nameSearch: params.get('name') ?? params.get('q') ?? undefined,
        limit: parseLimit(params.get('limit'), 50),
      }, 'system');
      send( 200, { total: entities.length, entities });
      return true;
    }

    if (method === 'POST' && url === '/admin/kg/entities') {
      const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
      const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : '';
      if (!agentId) {
        send( 400, { error: 'agentId is required' });
        return true;
      }

      const entity = await graph.upsertEntity(
        String(body.entityType ?? body.entity_type ?? ''),
        String(body.entityId ?? body.entity_id ?? ''),
        String(body.name ?? ''),
        body.properties && typeof body.properties === 'object' && !Array.isArray(body.properties)
          ? body.properties as Record<string, unknown>
          : {},
        agentId,
      );
      send( 201, entity);
      return true;
    }

    if (method === 'GET' && url === '/admin/kg/stats') {
      const stats = await graph.getStats('system');
      send( 200, stats);
      return true;
    }

    if (method === 'GET' && url === '/admin/kg/search') {
      const query = params.get('q');
      if (!query) {
        send( 400, { error: 'q is required' });
        return true;
      }
      const entityTypes = parseCsv(params.get('types'));
      const results = await graph.semanticSearch(query, entityTypes.length > 0 ? entityTypes : undefined, parseLimit(params.get('limit'), 10), 'system');
      send( 200, { total: results.length, results });
      return true;
    }

    const historyMatch = url.match(/^\/admin\/kg\/entities\/([^/]+)\/history$/);
    if (method === 'GET' && historyMatch) {
      const entityId = decodeURIComponent(historyMatch[1]);
      const entity = await graph.getEntityById(entityId);
      const history = await graph.getEntityHistory(entityId);
      send( 200, { entity, history });
      return true;
    }

    const graphMatch = url.match(/^\/admin\/kg\/entities\/([^/]+)\/graph$/);
    if (method === 'GET' && graphMatch) {
      const entityId = decodeURIComponent(graphMatch[1]);
      const edgeTypes = parseCsv(params.get('edgeTypes'));
      const traversal = await graph.traverseGraph(entityId, edgeTypes, Math.max(1, Math.min(3, Number(params.get('maxDepth') ?? '3'))), 'system');
      send( 200, traversal);
      return true;
    }

    const detailMatch = url.match(/^\/admin\/kg\/entities\/([^/]+)$/);
    if (method === 'GET' && detailMatch) {
      const entityId = decodeURIComponent(detailMatch[1]);
      const detail = await graph.getEntityDetail(entityId, 'system');
      send( 200, detail);
      return true;
    }

    return false;
  } catch (err) {
    send( 500, { error: err instanceof Error ? err.message : String(err) });
    return true;
  }
}