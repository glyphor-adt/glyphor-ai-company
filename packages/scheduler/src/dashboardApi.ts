/**
 * Dashboard CRUD API — proxies /api/{table} to Supabase PostgREST.
 *
 * The dashboard sends requests to the scheduler's /api/* routes.
 * This handler translates them into PostgREST calls to the existing
 * Supabase database using SUPABASE_URL + SUPABASE_SERVICE_KEY.
 *
 * Only whitelisted tables are accessible.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY ?? '';

// ─── Table whitelist (prevents arbitrary access) ────────────────

/** Maps URL slug to actual PostgREST table name. */
const TABLE_MAP: Record<string, string> = {
  'company_agents': 'company_agents',
  'agents': 'company_agents',
  'agent_profiles': 'agent_profiles',
  'agent_briefs': 'agent_briefs',
  'activity_log': 'activity_log',
  'activity': 'activity_log',
  'agent_performance': 'agent_performance',
  'agent_growth': 'agent_growth',
  'agent_milestones': 'agent_milestones',
  'agent_peer_feedback': 'agent_peer_feedback',
  'agent_reflections': 'agent_reflections',
  'agent-reflections': 'agent_reflections',
  'agent_memory': 'agent_memory',
  'agent_meetings': 'agent_meetings',
  'agent_skills': 'agent_skills',
  'agent_world_model': 'agent_world_model',
  'agent_messages': 'agent_messages',
  'agent_reasoning_config': 'agent_reasoning_config',
  'role_rubrics': 'role_rubrics',
  'chat-messages': 'chat_messages',
  'chat_messages': 'chat_messages',
  'decisions': 'decisions',
  'founder-directives': 'founder_directives',
  'directives': 'founder_directives',
  'founder-bulletins': 'founder_bulletins',
  'dashboard-change-requests': 'dashboard_change_requests',
  'dashboard-users': 'dashboard_users',
  'company-knowledge-base': 'company_knowledge_base',
  'company-pulse': 'company_pulse',
  'kg-nodes': 'kg_nodes',
  'kg-edges': 'kg_edges',
  'incidents': 'incidents',
  'skills': 'agent_skills',
  'work-assignments': 'work_assignments',
  'work_assignments': 'work_assignments',
  'agent-tool-grants': 'agent_tool_grants',
  'data_sync_status': 'data_sync_status',
};

// ─── Helpers ────────────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function jsonResponse(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

/** Build PostgREST query string from dashboard query params. */
function buildPostgrestQuery(params: URLSearchParams): string {
  const pgParams = new URLSearchParams();

  for (const [key, value] of params.entries()) {
    // Pass through PostgREST-native params
    if (key === 'order') {
      pgParams.set('order', value);
      continue;
    }
    if (key === 'limit') {
      pgParams.set('limit', value);
      continue;
    }
    if (key === 'offset') {
      pgParams.set('offset', value);
      continue;
    }
    if (key === 'select') {
      pgParams.set('select', value);
      continue;
    }
    if (key === 'fields') {
      // Our custom param → PostgREST select
      pgParams.set('select', value);
      continue;
    }
    if (key === 'count') {
      // Handled via Prefer header, skip
      continue;
    }
    if (key === 'include') {
      // Join hint — handled separately
      continue;
    }
    if (key === 'or') {
      pgParams.set('or', value);
      continue;
    }

    // min_quality → quality_score=gte.{value}
    if (key === 'min_quality') {
      pgParams.set('quality_score', `gte.${value}`);
      continue;
    }

    // Operator-prefixed values pass through directly
    if (value.startsWith('gte.') || value.startsWith('gt.') ||
        value.startsWith('lte.') || value.startsWith('lt.') ||
        value.startsWith('eq.') || value.startsWith('neq.') ||
        value.startsWith('cs.') || value.startsWith('in.') ||
        value.startsWith('is.') || value.startsWith('like.') ||
        value.startsWith('ilike.') || value.startsWith('not.')) {
      pgParams.set(key, value);
      continue;
    }

    // Plain value → eq filter
    pgParams.set(key, `eq.${value}`);
  }

  const qs = pgParams.toString();
  return qs ? `?${qs}` : '';
}

/** Make a request to Supabase PostgREST */
async function supabaseRequest(
  table: string,
  method: string,
  queryString: string,
  body?: string,
  headers?: Record<string, string>,
): Promise<{ status: number; data: unknown }> {
  const url = `${SUPABASE_URL}/rest/v1/${table}${queryString}`;
  const fetchHeaders: Record<string, string> = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    ...headers,
  };

  const res = await fetch(url, {
    method,
    headers: fetchHeaders,
    body: body && method !== 'GET' ? body : undefined,
  });

  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

// ─── Main handler ───────────────────────────────────────────────

export async function handleDashboardApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  queryString: string,
  method: string,
): Promise<boolean> {
  if (!url.startsWith('/api/')) return false;

  const apiPath = url.slice(5);
  const segments = apiPath.split('/');
  const tableSlug = segments[0];
  const resourceId = segments[1];

  const tableName = TABLE_MAP[tableSlug];
  if (!tableName) {
    jsonResponse(res, 404, { error: `Unknown API resource: ${tableSlug}` });
    return true;
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    jsonResponse(res, 503, { error: 'Database not configured' });
    return true;
  }

  const params = new URLSearchParams(queryString ?? '');

  try {
    // ── Special: GET /api/company-pulse → single latest row ─────
    if (tableName === 'company_pulse' && method === 'GET' && !resourceId) {
      const { data } = await supabaseRequest(
        'company_pulse', 'GET', '?order=created_at.desc&limit=1',
        undefined, { 'Accept': 'application/vnd.pgrst.object+json' },
      );
      jsonResponse(res, 200, data ?? null);
      return true;
    }

    // ── Special: POST /api/company-pulse/current → upsert ───────
    if (tableName === 'company_pulse' && resourceId === 'current' && method === 'POST') {
      const body = await readBody(req);
      // Get existing row
      const { data: existing } = await supabaseRequest(
        'company_pulse', 'GET', '?order=created_at.desc&limit=1',
      );
      const rows = existing as Record<string, unknown>[];
      if (rows?.length > 0) {
        await supabaseRequest(
          'company_pulse', 'PATCH', `?id=eq.${rows[0].id}`, body,
        );
      } else {
        await supabaseRequest('company_pulse', 'POST', '', body);
      }
      jsonResponse(res, 200, { success: true });
      return true;
    }

    // ── Special: GET /api/directives/active ──────────────────────
    if (tableName === 'founder_directives' && method === 'GET' && resourceId === 'active') {
      const { data: directives } = await supabaseRequest(
        'founder_directives', 'GET',
        '?status=eq.active&order=created_at.desc&select=*,work_assignments(*)',
      );
      // Reshape: PostgREST returns work_assignments as nested, rename to assignments
      const rows = (directives as Record<string, unknown>[]) ?? [];
      for (const d of rows) {
        (d as any).assignments = (d as any).work_assignments ?? [];
        delete (d as any).work_assignments;
      }
      jsonResponse(res, 200, rows);
      return true;
    }

    // ── Special: GET /api/founder-directives?include=work_assignments,source_directive
    if ((tableSlug === 'founder-directives' || tableSlug === 'directives') && method === 'GET' && !resourceId) {
      const include = params.get('include');
      params.delete('include');

      // Build select with embedded resources
      let select = '*';
      if (include?.includes('work_assignments')) {
        select += ',work_assignments(*)';
      }
      if (include?.includes('source_directive')) {
        select += ',source_directive:founder_directives!source_directive_id(id,title)';
      }
      params.set('select', select);
      if (!params.has('order')) params.set('order', 'created_at.desc');

      const pgQuery = buildPostgrestQuery(params);
      const { data } = await supabaseRequest('founder_directives', 'GET', pgQuery);
      jsonResponse(res, 200, data ?? []);
      return true;
    }

    // ── GET ──────────────────────────────────────────────────────
    if (method === 'GET') {
      if (resourceId) {
        const { status, data } = await supabaseRequest(
          tableName, 'GET', `?id=eq.${encodeURIComponent(resourceId)}`,
          undefined, { 'Accept': 'application/vnd.pgrst.object+json' },
        );
        if (status === 406) {
          jsonResponse(res, 404, { error: 'Not found' });
        } else {
          jsonResponse(res, 200, data);
        }
        return true;
      }

      const wantCount = params.get('count') === 'true';
      params.delete('count');
      const pgQuery = buildPostgrestQuery(params);
      const headers: Record<string, string> = {};
      if (wantCount) {
        headers['Prefer'] = 'count=exact';
        headers['Range-Unit'] = 'items';
      }
      const { data } = await supabaseRequest(tableName, 'GET', pgQuery, undefined, headers);
      jsonResponse(res, 200, data ?? []);
      return true;
    }

    // ── POST ─────────────────────────────────────────────────────
    if (method === 'POST') {
      const body = await readBody(req);
      const { data } = await supabaseRequest(
        tableName, 'POST', '', body,
        { 'Prefer': 'return=representation' },
      );
      const rows = data as unknown[];
      jsonResponse(res, 201, Array.isArray(rows) ? rows[0] ?? { success: true } : data);
      return true;
    }

    // ── PATCH / PUT ──────────────────────────────────────────────
    if (method === 'PATCH' || method === 'PUT') {
      const body = await readBody(req);
      let pgQuery: string;
      if (resourceId) {
        pgQuery = `?id=eq.${encodeURIComponent(resourceId)}`;
      } else {
        pgQuery = buildPostgrestQuery(params);
      }
      const { data } = await supabaseRequest(
        tableName, 'PATCH', pgQuery, body,
        { 'Prefer': 'return=representation' },
      );
      const rows = data as unknown[];
      jsonResponse(res, 200, resourceId
        ? (Array.isArray(rows) ? rows[0] : data) ?? { success: true }
        : data);
      return true;
    }

    // ── DELETE ───────────────────────────────────────────────────
    if (method === 'DELETE') {
      let pgQuery: string;
      if (resourceId) {
        pgQuery = `?id=eq.${encodeURIComponent(resourceId)}`;
      } else {
        pgQuery = buildPostgrestQuery(params);
        if (!pgQuery) {
          jsonResponse(res, 400, { error: 'DELETE requires filters or an id' });
          return true;
        }
      }
      await supabaseRequest(tableName, 'DELETE', pgQuery);
      jsonResponse(res, 200, { success: true });
      return true;
    }

    jsonResponse(res, 405, { error: `Method ${method} not allowed` });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[DashboardAPI] Error on ${method} /api/${tableSlug}:`, message);
    jsonResponse(res, 500, { error: message });
    return true;
  }
}
