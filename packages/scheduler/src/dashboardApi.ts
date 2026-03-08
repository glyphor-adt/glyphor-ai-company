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
  'company-agents': 'company_agents',
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
  'agent-skills': 'agent_skills',
  'agent_world_model': 'agent_world_model',
  'agent-world-model': 'agent_world_model',
  'agent_messages': 'agent_messages',
  'agent_reasoning_config': 'agent_reasoning_config',
  'agent-runs': 'agent_runs',
  'role_rubrics': 'role_rubrics',
  'role-rubrics': 'role_rubrics',
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
  'skills': 'skills',
  'work-assignments': 'work_assignments',
  'agent-tool-grants': 'agent_tool_grants',
  'tool-registry': 'tool_registry',
  'data_sync_status': 'data_sync_status',
  'data-sync-status': 'data_sync_status',
  'platform-iam-state': 'platform_iam_state',
  'platform-audit-log': 'platform_audit_log',
  'platform-secret-rotation': 'platform_secret_rotation',
  'gcp-billing': 'gcp_billing',
  'financials': 'financials',
  'api-billing': 'api_billing',
  'proposed_initiatives': 'proposed_initiatives',
  'proposed-initiatives': 'proposed_initiatives',
  'initiatives': 'initiatives',
  'deliverables': 'deliverables',
  'task_run_outcomes': 'task_run_outcomes',
  'task-run-outcomes': 'task_run_outcomes',
  'memory_lifecycle': 'memory_lifecycle',
  'memory-lifecycle': 'memory_lifecycle',
  'memory_archive': 'memory_archive',
  'memory-archive': 'memory_archive',
  'policy_versions': 'policy_versions',
  'policy-versions': 'policy_versions',
  'plan_verifications': 'plan_verifications',
  'plan-verifications': 'plan_verifications',
  'tool_reputation': 'tool_reputation',
  'tool-reputation': 'tool_reputation',
  'constitutional_gate_events': 'constitutional_gate_events',
  'constitutional-gate-events': 'constitutional_gate_events',
  'executive_orchestration_config': 'executive_orchestration_config',
  'executive-orchestration-config': 'executive_orchestration_config',
  'workflows': 'workflows',
  'workflow_steps': 'workflow_steps',
  'workflow-steps': 'workflow_steps',
  'delegation_performance': 'delegation_performance',
  'delegation-performance': 'delegation_performance',
  'ora_sessions': 'ora_sessions',
  'ora-sessions': 'ora_sessions',
};

// ─── Helpers ────────────────────────────────────────────────────

/** Cascade-delete all child rows for a founder_directive. Each step is
 *  wrapped in try/catch so missing tables don't block deletion. */
export async function cascadeDeleteDirective(id: string): Promise<void> {
  const stmts: string[] = [
    'DELETE FROM agent_tool_grants WHERE directive_id = $1',
    'DELETE FROM deliverables WHERE directive_id = $1 OR assignment_id IN (SELECT id FROM work_assignments WHERE directive_id = $1)',
    'DELETE FROM work_assignments WHERE directive_id = $1',
    'DELETE FROM tool_requests WHERE directive_id = $1',
    'DELETE FROM decision_chains WHERE directive_id = $1',
    'DELETE FROM handoffs WHERE directive_id = $1',
    'DELETE FROM proposed_initiatives WHERE directive_id = $1',
    'DELETE FROM plan_verifications WHERE directive_id = $1',
    'DELETE FROM task_run_outcomes WHERE directive_id = $1',
    'DELETE FROM workflows WHERE directive_id = $1',
    'UPDATE founder_directives SET source_directive_id = NULL WHERE source_directive_id = $1',
    'UPDATE founder_directives SET parent_directive_id = NULL WHERE parent_directive_id = $1',
  ];
  for (const sql of stmts) {
    try { await systemQuery(sql, [id]); } catch { /* table may not exist yet */ }
  }
  await systemQuery('DELETE FROM founder_directives WHERE id = $1', [id]);
}

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

    // `since` — shorthand for date range filter on the appropriate column
    if (key === 'since') {
      continue; // handled externally per-table
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

      // Handle `since` date range filter
      const sinceVal = params.get('since');
      let extraWhere = '';
      if (sinceVal) {
        const DATE_COL_MAP: Record<string, string> = {
          financials: 'date', gcp_billing: 'recorded_at', api_billing: 'recorded_at',
          activity_log: 'created_at', agent_runs: 'started_at', decisions: 'created_at',
        };
        const dateCol = DATE_COL_MAP[tableName] ?? 'created_at';
        const idx = values.length + 1;
        extraWhere = `${where ? ' AND' : ' WHERE'} ${dateCol} >= $${idx}`;
        values.push(sinceVal);
      }

      if (countOnly) {
        const rows = await systemQuery<{ count: number }>(`SELECT COUNT(*)::int AS count FROM ${tableName}${where}${extraWhere}`, values);
        jsonResponse(res, 200, { count: rows[0]?.count ?? 0 });
      } else {
        // Default to newest-first for tables with timestamp columns when no order specified
        const DEFAULT_ORDER: Record<string, string> = {
          agent_runs: ' ORDER BY started_at DESC',
          activity_log: ' ORDER BY created_at DESC',
          agent_messages: ' ORDER BY created_at DESC',
          decisions: ' ORDER BY created_at DESC',
          founder_directives: ' ORDER BY created_at DESC',
          plan_verifications: ' ORDER BY created_at DESC',
        };
        const effectiveOrder = order || DEFAULT_ORDER[tableName] || '';
        const sql = `SELECT ${select} FROM ${tableName}${where}${extraWhere}${effectiveOrder}${limit || ' LIMIT 200'}`;
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
      // Bulk delete: DELETE /api/founder-directives/bulk  body: { ids: [...] }
      if (tableName === 'founder_directives' && resourceId === 'bulk') {
        const body = JSON.parse(await readBody(req));
        const ids: string[] = body.ids;
        if (!Array.isArray(ids) || ids.length === 0) {
          jsonResponse(res, 400, { error: 'ids array required' });
          return true;
        }
        for (const id of ids) {
          await cascadeDeleteDirective(id);
        }
        jsonResponse(res, 200, { success: true, deleted: ids.length });
        return true;
      }

      if (resourceId) {
        if (tableName === 'founder_directives') {
          await cascadeDeleteDirective(resourceId);
        } else {
          await systemQuery(`DELETE FROM ${tableName} WHERE id = $1`, [resourceId]);
        }
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
    if (tableName === 'chat_messages') {
      console.error(`[DashboardAPI] chat_messages failure details — method: ${method}, table: ${tableName}, query: ${queryString ?? ''}`);
    }
    jsonResponse(res, 500, { error: message });
    return true;
  }
}
