/**
 * Dashboard CRUD API — replaces auto-generated PostgREST endpoints.
 *
 * Provides /api/{table} routes for the dashboard to read/write data.
 * Only whitelisted tables are accessible. Query parameters follow a
 * simplified PostgREST-compatible syntax:
 *
 *   GET /api/company_agents?role=cto&order=created_at.desc&limit=10
 *   POST /api/chat-messages   { ... }
 *   PATCH /api/decisions/:id  { status: 'approved' }
 *   DELETE /api/chat-messages?agent_role=cto&user_id=x
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { systemQuery } from '@glyphor/shared/db';

// ─── Table whitelist (prevents arbitrary SQL access) ────────────

/** Maps URL slug to actual PostgreSQL table name. */
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
  'company_knowledge': 'company_knowledge',
  'company-pulse': 'company_pulse',
  'kg-nodes': 'kg_nodes',
  'kg-edges': 'kg_edges',
  'incidents': 'incidents',
  'skills': 'agent_skills',
  'work-assignments': 'work_assignments',
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

/**
 * Parse PostgREST-style query parameters into SQL clauses.
 *
 * Supports:
 *   ?role=cto                          → WHERE role = $1
 *   ?date=gte.2026-01-01               → WHERE date >= $1
 *   ?attendees=cs.["cto"]              → WHERE attendees @> $1
 *   ?or=(from_agent.eq.cto,to_agent.eq.cto) → WHERE (from_agent = $1 OR to_agent = $2)
 *   ?order=created_at.desc             → ORDER BY created_at DESC
 *   ?limit=10                          → LIMIT 10
 *   ?fields=node_type                  → SELECT node_type (instead of *)
 *   ?count=true                        → SELECT COUNT(*)
 *   ?include=...                       → ignored (join hint — handled below)
 */
function parseQueryParams(
  params: URLSearchParams,
  startIdx: number = 1,
): { where: string; values: unknown[]; order: string; limit: string; select: string; countOnly: boolean } {
  const clauses: string[] = [];
  const values: unknown[] = [];
  let paramIdx = startIdx;
  let order = '';
  let limit = '';
  let select = '*';
  let countOnly = false;

  for (const [key, value] of params.entries()) {
    if (key === 'order') {
      const parts = value.split('.');
      const col = sanitizeIdentifier(parts[0]);
      const dir = parts[1]?.toLowerCase() === 'desc' ? 'DESC' : 'ASC';
      order = ` ORDER BY ${col} ${dir}`;
      continue;
    }
    if (key === 'limit') {
      limit = ` LIMIT ${parseInt(value, 10) || 100}`;
      continue;
    }
    if (key === 'fields') {
      select = value.split(',').map(sanitizeIdentifier).join(', ');
      continue;
    }
    if (key === 'count') {
      countOnly = true;
      continue;
    }
    if (key === 'include' || key === 'select') {
      continue; // join hints — handled separately
    }

    // Custom filter: min_quality → quality_score >= $N
    if (key === 'min_quality') {
      clauses.push(`quality_score >= $${paramIdx++}`);
      values.push(parseInt(value, 10));
      continue;
    }

    // OR clause: ?or=(from_agent.eq.cto,to_agent.eq.cto)
    if (key === 'or') {
      const inner = value.replace(/^\(/, '').replace(/\)$/, '');
      const orParts = inner.split(',');
      const orClauses: string[] = [];
      for (const part of orParts) {
        const dotIdx = part.indexOf('.eq.');
        if (dotIdx > 0) {
          const col = sanitizeIdentifier(part.substring(0, dotIdx));
          const val = part.substring(dotIdx + 4);
          orClauses.push(`${col} = $${paramIdx++}`);
          values.push(val);
        }
      }
      if (orClauses.length > 0) {
        clauses.push(`(${orClauses.join(' OR ')})`);
      }
      continue;
    }

    const col = sanitizeIdentifier(key);

    // Operator-prefixed values: gte., gt., lte., lt., eq., neq., cs.
    if (value.startsWith('gte.')) {
      clauses.push(`${col} >= $${paramIdx++}`);
      values.push(value.slice(4));
    } else if (value.startsWith('gt.')) {
      clauses.push(`${col} > $${paramIdx++}`);
      values.push(value.slice(3));
    } else if (value.startsWith('lte.')) {
      clauses.push(`${col} <= $${paramIdx++}`);
      values.push(value.slice(4));
    } else if (value.startsWith('lt.')) {
      clauses.push(`${col} < $${paramIdx++}`);
      values.push(value.slice(3));
    } else if (value.startsWith('eq.')) {
      clauses.push(`${col} = $${paramIdx++}`);
      values.push(value.slice(3));
    } else if (value.startsWith('neq.')) {
      clauses.push(`${col} != $${paramIdx++}`);
      values.push(value.slice(4));
    } else if (value.startsWith('cs.')) {
      // Contains — for JSONB array containment
      clauses.push(`${col} @> $${paramIdx++}::jsonb`);
      values.push(value.slice(3));
    } else if (value === 'true') {
      clauses.push(`${col} = true`);
    } else if (value === 'false') {
      clauses.push(`${col} = false`);
    } else if (value === 'null') {
      clauses.push(`${col} IS NULL`);
    } else {
      clauses.push(`${col} = $${paramIdx++}`);
      values.push(value);
    }
  }

  const where = clauses.length > 0 ? ' WHERE ' + clauses.join(' AND ') : '';
  return { where, values, order, limit, select, countOnly };
}

/** Prevent SQL injection in identifier names — allow only [a-zA-Z0-9_] */
function sanitizeIdentifier(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '');
}

// ─── Main handler ───────────────────────────────────────────────

/**
 * Handle /api/* requests. Returns true if the request was handled,
 * false if the URL doesn't match the /api/ prefix.
 */
export async function handleDashboardApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  queryString: string,
  method: string,
): Promise<boolean> {
  if (!url.startsWith('/api/')) return false;

  // Parse: /api/company_agents or /api/decisions/123 or /api/company-pulse/current
  const apiPath = url.slice(5); // remove "/api/"
  const segments = apiPath.split('/');
  const tableSlug = segments[0];
  const resourceId = segments[1]; // may be undefined

  const tableName = TABLE_MAP[tableSlug];
  if (!tableName) {
    jsonResponse(res, 404, { error: `Unknown API resource: ${tableSlug}` });
    return true;
  }

  const params = new URLSearchParams(queryString ?? '');

  try {
    // ── Special endpoints ───────────────────────────────────────

    // GET /api/company-pulse → return latest single row (not array)
    if (tableName === 'company_pulse' && method === 'GET' && !resourceId) {
      const rows = await systemQuery('SELECT * FROM company_pulse ORDER BY updated_at DESC LIMIT 1');
      jsonResponse(res, 200, rows[0] ?? null);
      return true;
    }

    if (tableSlug === 'company-pulse' && resourceId === 'current') {
      if (method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const existing = await systemQuery<{ id: string }>(
          'SELECT id FROM company_pulse ORDER BY updated_at DESC LIMIT 1',
        );
        if (existing.length > 0) {
          await systemQuery(
            'UPDATE company_pulse SET summary = $1, highlights = $2, updated_at = NOW() WHERE id = $3',
            [body.summary, JSON.stringify(body.highlights), existing[0].id],
          );
        } else {
          await systemQuery(
            'INSERT INTO company_pulse (summary, highlights) VALUES ($1, $2)',
            [body.summary, JSON.stringify(body.highlights)],
          );
        }
        jsonResponse(res, 200, { success: true });
        return true;
      }
    }

    // GET /api/directives/active → active directives with work_assignments
    if (tableName === 'founder_directives' && method === 'GET' && resourceId === 'active') {
      const directives = await systemQuery<Record<string, unknown>>(
        `SELECT * FROM founder_directives WHERE status = 'active' ORDER BY created_at DESC`,
      );
      if (directives.length > 0) {
        const ids = directives.map(d => d.id);
        const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
        const assignments = await systemQuery<Record<string, unknown>>(
          `SELECT * FROM work_assignments WHERE directive_id IN (${placeholders})`,
          ids,
        );
        const byDirective = new Map<string, Record<string, unknown>[]>();
        for (const a of assignments) {
          const did = a.directive_id as string;
          if (!byDirective.has(did)) byDirective.set(did, []);
          byDirective.get(did)!.push(a);
        }
        for (const d of directives) {
          (d as any).assignments = byDirective.get(d.id as string) ?? [];
        }
      }
      jsonResponse(res, 200, directives);
      return true;
    }

    // Handle directives include=work_assignments,source_directive
    if ((tableSlug === 'founder-directives' || tableSlug === 'directives') && method === 'GET' && !resourceId) {
      const include = params.get('include');
      params.delete('include');
      const { where, values, order, limit } = parseQueryParams(params);
      const sql = `SELECT * FROM founder_directives${where}${order || ' ORDER BY created_at DESC'}${limit}`;
      const directives = await systemQuery<Record<string, unknown>>(sql, values);

      if (include?.includes('work_assignments') && directives.length > 0) {
        const ids = directives.map(d => d.id);
        const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
        const assignments = await systemQuery<Record<string, unknown>>(
          `SELECT * FROM work_assignments WHERE directive_id IN (${placeholders})`,
          ids,
        );
        const byDirective = new Map<string, Record<string, unknown>[]>();
        for (const a of assignments) {
          const did = a.directive_id as string;
          if (!byDirective.has(did)) byDirective.set(did, []);
          byDirective.get(did)!.push(a);
        }
        for (const d of directives) {
          (d as any).work_assignments = byDirective.get(d.id as string) ?? [];
        }
      }

      if (include?.includes('source_directive') && directives.length > 0) {
        const srcIds = directives
          .map(d => d.source_directive_id)
          .filter((id): id is string => typeof id === 'string');
        if (srcIds.length > 0) {
          const uniqueIds = [...new Set(srcIds)];
          const ph = uniqueIds.map((_, i) => `$${i + 1}`).join(',');
          const sources = await systemQuery<Record<string, unknown>>(
            `SELECT id, title FROM founder_directives WHERE id IN (${ph})`,
            uniqueIds,
          );
          const srcMap = new Map(sources.map(s => [s.id as string, s]));
          for (const d of directives) {
            (d as any).source_directive = d.source_directive_id
              ? srcMap.get(d.source_directive_id as string) ?? null
              : null;
          }
        }
      }

      jsonResponse(res, 200, directives);
      return true;
    }

    // ── GET ─────────────────────────────────────────────────────
    if (method === 'GET') {
      if (resourceId) {
        // GET /api/table/:id
        const rows = await systemQuery(`SELECT * FROM ${tableName} WHERE id = $1`, [resourceId]);
        if (rows.length === 0) {
          jsonResponse(res, 404, { error: 'Not found' });
        } else {
          jsonResponse(res, 200, rows[0]);
        }
        return true;
      }

      const { where, values, order, limit, select, countOnly } = parseQueryParams(params);
      if (countOnly) {
        const rows = await systemQuery<{ count: number }>(`SELECT COUNT(*)::int AS count FROM ${tableName}${where}`, values);
        jsonResponse(res, 200, { count: rows[0]?.count ?? 0 });
      } else {
        const sql = `SELECT ${select} FROM ${tableName}${where}${order}${limit || ' LIMIT 200'}`;
        const rows = await systemQuery(sql, values);
        jsonResponse(res, 200, rows);
      }
      return true;
    }

    // ── POST ────────────────────────────────────────────────────
    if (method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const keys = Object.keys(body);
      const cols = keys.map(sanitizeIdentifier);
      const placeholders = keys.map((_, i) => `$${i + 1}`);
      const vals = keys.map(k => {
        const v = body[k];
        return typeof v === 'object' && v !== null ? JSON.stringify(v) : v;
      });

      const sql = `INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`;
      const rows = await systemQuery(sql, vals);
      jsonResponse(res, 201, rows[0] ?? { success: true });
      return true;
    }

    // ── PATCH / PUT ─────────────────────────────────────────────
    if (method === 'PATCH' || method === 'PUT') {
      const body = JSON.parse(await readBody(req));
      const keys = Object.keys(body);
      if (keys.length === 0) {
        jsonResponse(res, 400, { error: 'No fields to update' });
        return true;
      }

      const setClauses = keys.map((k, i) => `${sanitizeIdentifier(k)} = $${i + 1}`);
      const vals: unknown[] = keys.map(k => {
        const v = body[k];
        return typeof v === 'object' && v !== null ? JSON.stringify(v) : v;
      });

      if (resourceId) {
        // PATCH /api/table/:id
        vals.push(resourceId);
        const sql = `UPDATE ${tableName} SET ${setClauses.join(', ')} WHERE id = $${vals.length} RETURNING *`;
        const rows = await systemQuery(sql, vals);
        jsonResponse(res, 200, rows[0] ?? { success: true });
      } else {
        // PATCH /api/table?filters...
        const { where, values: filterVals } = parseQueryParams(params, vals.length + 1);
        vals.push(...filterVals);
        const sql = `UPDATE ${tableName} SET ${setClauses.join(', ')}${where} RETURNING *`;
        const rows = await systemQuery(sql, vals);
        jsonResponse(res, 200, rows);
      }
      return true;
    }

    // ── DELETE ──────────────────────────────────────────────────
    if (method === 'DELETE') {
      if (resourceId) {
        await systemQuery(`DELETE FROM ${tableName} WHERE id = $1`, [resourceId]);
        jsonResponse(res, 200, { success: true });
      } else {
        const { where, values } = parseQueryParams(params);
        if (!where) {
          jsonResponse(res, 400, { error: 'DELETE requires filters or an id' });
          return true;
        }
        await systemQuery(`DELETE FROM ${tableName}${where}`, values);
        jsonResponse(res, 200, { success: true });
      }
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
