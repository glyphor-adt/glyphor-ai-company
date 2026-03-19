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
import { systemQuery, systemTransaction } from '@glyphor/shared/db';

interface SkillUploadTaskMapping {
  task_regex: string;
  priority?: number;
}

interface SkillUploadPayload {
  fileName?: string;
  content: string;
  reconcile_holders?: boolean;
  default_proficiency?: 'learning' | 'competent' | 'expert' | 'master';
  replace_task_mappings?: boolean;
  task_mappings?: SkillUploadTaskMapping[];
}

interface ParsedSkillMarkdown {
  slug: string;
  name: string;
  category: string;
  description: string;
  methodology: string;
  tools_granted: string[];
  holders: string[];
  version: number;
}

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
  'agent-eval-scenarios': 'agent_eval_scenarios',
  'agent_eval_scenarios': 'agent_eval_scenarios',
  'agent-eval-results': 'agent_eval_results',
  'agent_eval_results': 'agent_eval_results',
  'agent-readiness': 'agent_readiness',
  'agent_readiness': 'agent_readiness',
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
  'knowledge': 'company_knowledge_base',
  'company-vitals': 'company_vitals',
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
  'model-registry': 'model_registry',
  'model_registry': 'model_registry',
  'routing-config': 'routing_config',
  'routing_config': 'routing_config',
};

// ─── Helpers ────────────────────────────────────────────────────

/** Cascade-delete all child rows for a founder_directive. Each step is
 *  wrapped in try/catch so missing tables don't block deletion. */
export async function cascadeDeleteDirective(id: string): Promise<void> {
  const assignmentRows = await systemQuery<{ id: string }>(
    `WITH RECURSIVE assignment_tree AS (
       SELECT id
       FROM work_assignments
       WHERE directive_id = $1
      UNION
       SELECT wa.id
       FROM work_assignments wa
       INNER JOIN assignment_tree at ON wa.parent_assignment_id = at.id
     )
     SELECT id FROM assignment_tree`,
    [id],
  );
  const assignmentIds = assignmentRows.map((row) => row.id);

  const stmts: Array<{ sql: string; withAssignments?: boolean; assignmentsOnly?: boolean }> = [
    { sql: 'DELETE FROM agent_tool_grants WHERE directive_id = $1' },
    { sql: 'DELETE FROM a2a_tasks WHERE directive_id = $1' },
    {
      sql:
        'DELETE FROM social_publish_audit_log WHERE draft_id IN (SELECT id FROM content_drafts WHERE directive_id = $1 OR assignment_id = ANY($2::uuid[])) OR scheduled_post_id IN (SELECT id FROM scheduled_posts WHERE directive_id = $1 OR assignment_id = ANY($2::uuid[])) OR deliverable_id IN (SELECT id FROM deliverables WHERE directive_id = $1 OR assignment_id = ANY($2::uuid[]))',
      withAssignments: true,
    },
    {
      sql:
        'DELETE FROM social_metrics WHERE post_id IN (SELECT id FROM scheduled_posts WHERE directive_id = $1 OR assignment_id = ANY($2::uuid[]))',
      withAssignments: true,
    },
    { sql: 'DELETE FROM scheduled_posts WHERE directive_id = $1 OR assignment_id = ANY($2::uuid[])', withAssignments: true },
    { sql: 'DELETE FROM content_drafts WHERE directive_id = $1 OR assignment_id = ANY($2::uuid[])', withAssignments: true },
    {
      sql:
        'DELETE FROM deliverables WHERE directive_id = $1 OR assignment_id = ANY($2::uuid[])',
      withAssignments: true,
    },
    { sql: 'DELETE FROM task_run_outcomes WHERE directive_id = $1 OR assignment_id = ANY($2::uuid[])', withAssignments: true },
    {
      sql:
        'UPDATE work_assignments SET parent_assignment_id = NULL WHERE parent_assignment_id = ANY($1::uuid[]) AND NOT (id = ANY($1::uuid[]))',
      assignmentsOnly: true,
    },
    { sql: 'DELETE FROM work_assignments WHERE id = ANY($1::uuid[])', assignmentsOnly: true },
    { sql: 'DELETE FROM tool_requests WHERE directive_id = $1' },
    { sql: 'DELETE FROM decision_chains WHERE directive_id = $1' },
    { sql: 'DELETE FROM handoffs WHERE directive_id = $1' },
    { sql: 'DELETE FROM proposed_initiatives WHERE directive_id = $1' },
    { sql: 'DELETE FROM plan_verifications WHERE directive_id = $1' },
    { sql: 'DELETE FROM workflows WHERE directive_id = $1' },
    { sql: 'UPDATE founder_directives SET source_directive_id = NULL WHERE source_directive_id = $1' },
    { sql: 'UPDATE founder_directives SET parent_directive_id = NULL WHERE parent_directive_id = $1' },
  ];

  for (const stmt of stmts) {
    try {
      const params = stmt.assignmentsOnly ? [assignmentIds] : stmt.withAssignments ? [id, assignmentIds] : [id];
      await systemQuery(stmt.sql, params);
    } catch (err) {
      const message = (err as Error).message.toLowerCase();
      const ignorable = message.includes('does not exist') || message.includes('column') && message.includes('does not exist');
      if (!ignorable) throw err;
    }
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

function parseFrontmatterValue(frontmatter: Record<string, string>, key: string): string {
  const value = (frontmatter[key] ?? '').trim();
  if (!value) {
    throw new Error(`Skill file frontmatter is missing required field: ${key}`);
  }
  return value;
}

function parseCommaList(value: string | undefined): string[] {
  if (!value) return [];
  const trimmed = value.trim();
  const noBrackets = trimmed.startsWith('[') && trimmed.endsWith(']')
    ? trimmed.slice(1, -1)
    : trimmed;
  return noBrackets
    .split(',')
    .map((entry) => entry.trim().replace(/^['\"]|['\"]$/g, ''))
    .filter(Boolean);
}

function parseSkillMarkdown(content: string): ParsedSkillMarkdown {
  const normalized = content.replace(/^\uFEFF/, '');
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    throw new Error('Invalid skill markdown format. Expected YAML frontmatter delimited by --- at the top of the file.');
  }

  const frontmatterText = match[1];
  const methodology = match[2].trim();
  if (!methodology) {
    throw new Error('Skill methodology body is empty.');
  }

  const frontmatter: Record<string, string> = {};
  for (const line of frontmatterText.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!key) continue;
    frontmatter[key] = value;
  }

  const slug = parseFrontmatterValue(frontmatter, 'slug');
  const name = parseFrontmatterValue(frontmatter, 'name');
  const category = parseFrontmatterValue(frontmatter, 'category');
  const description = parseFrontmatterValue(frontmatter, 'description');

  const versionRaw = (frontmatter.version ?? '1').trim();
  const version = Number.parseInt(versionRaw, 10);
  if (!Number.isFinite(version) || version <= 0) {
    throw new Error(`Invalid version in skill frontmatter: ${versionRaw}`);
  }

  return {
    slug,
    name,
    category,
    description,
    methodology,
    tools_granted: parseCommaList(frontmatter.tools_granted),
    holders: parseCommaList(frontmatter.holders),
    version,
  };
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
      // Support multi-column: order=tier,slug or order=priority.desc
      const columns = value.split(',');
      const orderParts = columns.map((col) => {
        const dotParts = col.split('.');
        const name = sanitizeIdentifier(dotParts[0]);
        const dir = dotParts[1]?.toLowerCase() === 'desc' ? 'DESC' : 'ASC';
        return `${name} ${dir}`;
      });
      order = ` ORDER BY ${orderParts.join(', ')}`;
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

const tenantIdColumnCache = new Map<string, boolean>();
const tableColumnsCache = new Map<string, Set<string>>();

async function tableHasTenantIdColumn(tableName: string): Promise<boolean> {
  const cached = tenantIdColumnCache.get(tableName);
  if (cached !== undefined) return cached;

  const rows = await systemQuery<{ has_tenant_id: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = $1
         AND column_name = 'tenant_id'
     ) AS has_tenant_id`,
    [tableName],
  );

  const hasTenantId = rows[0]?.has_tenant_id === true;
  tenantIdColumnCache.set(tableName, hasTenantId);
  return hasTenantId;
}

async function getTableColumns(tableName: string): Promise<Set<string>> {
  const cached = tableColumnsCache.get(tableName);
  if (cached) return cached;

  const rows = await systemQuery<{ column_name: string }>(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1`,
    [tableName],
  );

  const columns = new Set(rows.map((row) => row.column_name));
  tableColumnsCache.set(tableName, columns);
  return columns;
}

function filterOrParamByColumns(orValue: string, columns: Set<string>): string | null {
  const inner = orValue.replace(/^\(/, '').replace(/\)$/, '');
  const kept: string[] = [];
  for (const part of inner.split(',')) {
    const match = part.match(/^([a-zA-Z0-9_]+)\.eq\.(.+)$/);
    if (!match) continue;
    const column = sanitizeIdentifier(match[1]);
    if (columns.has(column)) kept.push(part);
  }
  if (kept.length === 0) return null;
  return `(${kept.join(',')})`;
}

function filterQueryParamsByColumns(params: URLSearchParams, columns: Set<string>) {
  const passthrough = new Set(['order', 'limit', 'fields', 'count', 'include', 'select', 'since']);
  const entries = Array.from(params.entries());
  for (const [key, value] of entries) {
    if (passthrough.has(key)) continue;
    if (key === 'or') {
      const filtered = filterOrParamByColumns(value, columns);
      if (!filtered) {
        params.delete('or');
      } else {
        params.set('or', filtered);
      }
      continue;
    }
    if (!columns.has(sanitizeIdentifier(key))) {
      params.delete(key);
    }
  }
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

    // GET /api/company-vitals → return latest row with live-computed fields
    if ((tableName === 'company_vitals' || tableName === 'company_pulse') && method === 'GET' && !resourceId) {
      const [storedRows, incidentRows, decisionRows, statusRows] = await Promise.all([
        systemQuery('SELECT * FROM company_vitals ORDER BY updated_at DESC LIMIT 1'),
        systemQuery<{ count: string }>("SELECT COUNT(*)::text as count FROM incidents WHERE resolved_at IS NULL"),
        systemQuery<{ count: string }>("SELECT COUNT(*)::text as count FROM decisions WHERE status = 'pending'"),
        systemQuery<{ status: string }>("SELECT status FROM system_status ORDER BY created_at DESC LIMIT 1"),
      ]);
      const stored = storedRows[0] ?? null;
      if (stored) {
        (stored as any).platform_status = (statusRows[0]?.status as string) ?? 'healthy';
        (stored as any).active_incidents = Number(incidentRows[0]?.count ?? 0);
        (stored as any).decisions_pending = Number(decisionRows[0]?.count ?? 0);
      }
      jsonResponse(res, 200, stored);
      return true;
    }

    if ((tableSlug === 'company-vitals' || tableSlug === 'company-pulse') && resourceId === 'current') {
      if (method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const existing = await systemQuery<{ id: string }>(
          'SELECT id FROM company_vitals ORDER BY updated_at DESC LIMIT 1',
        );
        if (existing.length > 0) {
          await systemQuery(
            'UPDATE company_vitals SET highlights = $1, updated_at = NOW() WHERE id = $2',
            [JSON.stringify(body.highlights), existing[0].id],
          );
        } else {
          await systemQuery(
            'INSERT INTO company_vitals (highlights) VALUES ($1)',
            [JSON.stringify(body.highlights)],
          );
        }
        jsonResponse(res, 200, { success: true });
        return true;
      }
    }

    if (tableName === 'skills' && method === 'POST' && resourceId === 'sync-from-file') {
      const body = JSON.parse(await readBody(req)) as SkillUploadPayload;
      if (!body || typeof body.content !== 'string' || !body.content.trim()) {
        jsonResponse(res, 400, { error: 'content is required and must be a markdown string.' });
        return true;
      }

      const parsed = parseSkillMarkdown(body.content);
      const reconcileHolders = body.reconcile_holders !== false;
      const defaultProficiency = body.default_proficiency ?? 'learning';
      const replaceTaskMappings = body.replace_task_mappings === true;
      const taskMappings = (body.task_mappings ?? [])
        .filter((mapping) => typeof mapping?.task_regex === 'string' && mapping.task_regex.trim().length > 0)
        .map((mapping) => ({
          task_regex: mapping.task_regex.trim(),
          priority: Number.isFinite(mapping.priority) ? Number(mapping.priority) : 10,
        }));

      const syncResult = await systemTransaction(async (client) => {
        const upserted = await client.query<{
          id: string;
          slug: string;
          name: string;
          category: string;
          description: string;
          version: number;
          tools_granted: string[];
          updated_at: string;
        }>(
          `INSERT INTO skills (slug, name, category, description, methodology, tools_granted, version)
           VALUES ($1, $2, $3, $4, $5, $6::text[], $7)
           ON CONFLICT (slug) DO UPDATE SET
             name = EXCLUDED.name,
             category = EXCLUDED.category,
             description = EXCLUDED.description,
             methodology = EXCLUDED.methodology,
             tools_granted = EXCLUDED.tools_granted,
             version = EXCLUDED.version,
             updated_at = NOW()
           RETURNING id, slug, name, category, description, version, tools_granted, updated_at`,
          [
            parsed.slug,
            parsed.name,
            parsed.category,
            parsed.description,
            parsed.methodology,
            parsed.tools_granted,
            parsed.version,
          ],
        );

        const skill = upserted.rows[0];
        let deletedHolders = 0;
        let insertedHolders = 0;

        if (reconcileHolders) {
          if (parsed.holders.length > 0) {
            const deleted = await client.query(
              `DELETE FROM agent_skills
               WHERE skill_id = $1
                 AND NOT (agent_role = ANY($2::text[]))`,
              [skill.id, parsed.holders],
            );
            deletedHolders = deleted.rowCount ?? 0;

            const inserted = await client.query(
              `INSERT INTO agent_skills (agent_role, skill_id, proficiency)
               SELECT ca.role, $1, $2
               FROM company_agents ca
               WHERE ca.role = ANY($3::text[])
               ON CONFLICT (agent_role, skill_id) DO NOTHING`,
              [skill.id, defaultProficiency, parsed.holders],
            );
            insertedHolders = inserted.rowCount ?? 0;
          } else {
            const deleted = await client.query('DELETE FROM agent_skills WHERE skill_id = $1', [skill.id]);
            deletedHolders = deleted.rowCount ?? 0;
          }
        }

        let deletedMappings = 0;
        let insertedMappings = 0;
        if (replaceTaskMappings) {
          const deleted = await client.query('DELETE FROM task_skill_map WHERE skill_slug = $1', [parsed.slug]);
          deletedMappings = deleted.rowCount ?? 0;

          if (taskMappings.length > 0) {
            const values: unknown[] = [];
            const rowsSql: string[] = [];
            for (const mapping of taskMappings) {
              values.push(mapping.task_regex, parsed.slug, mapping.priority ?? 10);
              const offset = values.length - 2;
              rowsSql.push(`($${offset}, $${offset + 1}, $${offset + 2})`);
            }
            const inserted = await client.query(
              `INSERT INTO task_skill_map (task_regex, skill_slug, priority)
               VALUES ${rowsSql.join(', ')}`,
              values,
            );
            insertedMappings = inserted.rowCount ?? 0;
          }
        }

        return {
          skill,
          holders: {
            reconcile: reconcileHolders,
            requested: parsed.holders,
            deleted: deletedHolders,
            inserted: insertedHolders,
          },
          task_mappings: {
            replaced: replaceTaskMappings,
            requested: taskMappings.length,
            deleted: deletedMappings,
            inserted: insertedMappings,
          },
        };
      });

      // Write sync history outside the transaction so optional logging failures
      // never poison the main skill sync transaction state.
      try {
        await systemQuery(
          `INSERT INTO activity_log (agent_role, agent_id, action, detail, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            'dashboard',
            'dashboard',
            'skills.sync_from_file',
            `Synced skill ${parsed.slug} from ${body.fileName ?? 'uploaded markdown'} (holders +${syncResult.holders.inserted}/-${syncResult.holders.deleted}, mappings +${syncResult.task_mappings.inserted}/-${syncResult.task_mappings.deleted})`,
            new Date().toISOString(),
          ],
        );
      } catch (err) {
        console.warn('[dashboardApi] skills.sync_from_file activity_log insert failed:', (err as Error).message);
      }

      jsonResponse(res, 200, {
        success: true,
        file_name: body.fileName ?? null,
        parsed: {
          slug: parsed.slug,
          name: parsed.name,
          category: parsed.category,
          version: parsed.version,
          holders: parsed.holders,
          tools_granted_count: parsed.tools_granted.length,
        },
        sync: syncResult,
      });
      return true;
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

    // GET /api/knowledge/status — layered KB overview with staleness info
    if (tableSlug === 'knowledge' && resourceId === 'status' && method === 'GET') {
      const sections = await systemQuery(
        `SELECT section, title, layer, audience, owner_agent_id, review_cadence,
                last_verified_at, is_stale, auto_expire, version, is_active,
                LENGTH(content) AS chars,
                EXTRACT(EPOCH FROM (NOW() - COALESCE(last_verified_at, created_at)))/86400 AS days_since_verified
         FROM company_knowledge_base
         ORDER BY layer ASC, section ASC`,
      );
      jsonResponse(res, 200, sections);
      return true;
    }

    // GET /api/knowledge/changelog — recent KB changes
    if (tableSlug === 'knowledge' && resourceId === 'changelog' && method === 'GET') {
      const limit = Math.min(parseInt(params.get('limit') ?? '20', 10) || 20, 100);
      const changes = await systemQuery(
        `SELECT section_key, version, change_summary, changed_by, changed_at
         FROM knowledge_change_log
         ORDER BY changed_at DESC
         LIMIT $1`,
        [limit],
      );
      jsonResponse(res, 200, changes);
      return true;
    }

    // POST /api/knowledge/:section_key/verify — founder verification from Cockpit
    if (tableSlug === 'knowledge' && resourceId && method === 'POST' && url?.includes('/verify')) {
      const body = JSON.parse(await readBody(req));
      const sectionKey = resourceId.replace('/verify', '');
      const [section] = await systemQuery<{ section: string; content: string; version: number }>(
        `SELECT section, content, version FROM company_knowledge_base WHERE section = $1`,
        [sectionKey],
      );
      if (!section) {
        jsonResponse(res, 404, { error: `Section '${sectionKey}' not found` });
        return true;
      }
      const newContent = typeof body.content === 'string' ? body.content : null;
      const changeSummary = body.change_summary ?? 'Verified from Cockpit';
      // Log the change
      await systemQuery(
        `INSERT INTO knowledge_change_log (section_key, version, previous_content, new_content, change_summary, changed_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [section.section, section.version, section.content, newContent ?? section.content, changeSummary, 'founder:kristina'],
      );
      if (newContent) {
        await systemQuery(
          `UPDATE company_knowledge_base SET content = $2, is_stale = FALSE, last_verified_at = NOW(), verified_by = 'founder:kristina', version = version + 1, change_summary = $3 WHERE section = $1`,
          [sectionKey, newContent, changeSummary],
        );
      } else {
        await systemQuery(
          `UPDATE company_knowledge_base SET is_stale = FALSE, last_verified_at = NOW(), verified_by = 'founder:kristina', version = version + 1, change_summary = $2 WHERE section = $1`,
          [sectionKey, changeSummary],
        );
      }
      jsonResponse(res, 200, { success: true, section: sectionKey });
      return true;
    }

    // ── GET ─────────────────────────────────────────────────────
    if (method === 'GET') {
      if (tableName === 'chat_messages') {
        const chatColumns = await getTableColumns(tableName);
        filterQueryParamsByColumns(params, chatColumns);
      }

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

      const includeInactiveProposers = params.get('include_inactive_proposers') === 'true';
      if (tableName === 'decisions') {
        // By default, hide pending tickets from removed/inactive proposers.
        // Pass include_inactive_proposers=true to include legacy orphaned rows.
        params.delete('include_inactive_proposers');
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

      let decisionProposerFilter = '';
      if (tableName === 'decisions' && !includeInactiveProposers) {
        const idx1 = values.length + 1;
        const idx2 = values.length + 2;
        decisionProposerFilter = `${where || extraWhere ? ' AND' : ' WHERE'} NOT (
          status = $${idx1}
          AND proposed_by NOT IN (
            SELECT role FROM company_agents WHERE status = $${idx2}
          )
          AND proposed_by NOT IN ('founder', 'scheduler', 'system', 'kristina', 'andrew')
        )`;
        values.push('pending', 'active');
      }

      if (countOnly) {
        const rows = await systemQuery<{ count: number }>(`SELECT COUNT(*)::int AS count FROM ${tableName}${where}${extraWhere}${decisionProposerFilter}`, values);
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
        const sql = `SELECT ${select} FROM ${tableName}${where}${extraWhere}${decisionProposerFilter}${effectiveOrder}${limit || ' LIMIT 200'}`;
        const rows = await systemQuery(sql, values);
        jsonResponse(res, 200, rows);
      }
      return true;
    }

    // ── POST ────────────────────────────────────────────────────
    if (method === 'POST') {
      const body = JSON.parse(await readBody(req));

      if (tableName === 'chat_messages') {
        const chatColumns = await getTableColumns(tableName);
        for (const key of Object.keys(body)) {
          if (!chatColumns.has(sanitizeIdentifier(key))) {
            delete body[key];
          }
        }
      }

      if (tableName === 'decisions') {
        const proposedBy = typeof body.proposed_by === 'string' ? body.proposed_by : null;
        const SYSTEM_PROPOSERS = new Set(['founder', 'scheduler', 'system', 'kristina', 'andrew']);

        if (!proposedBy) {
          jsonResponse(res, 400, { error: 'decisions.proposed_by is required' });
          return true;
        }

        if (!SYSTEM_PROPOSERS.has(proposedBy)) {
          const activeAgent = await systemQuery<{ role: string }>(
            'SELECT role FROM company_agents WHERE role = $1 AND status = $2 LIMIT 1',
            [proposedBy, 'active'],
          );
          if (activeAgent.length === 0) {
            jsonResponse(res, 400, { error: `Decision proposer is not active: ${proposedBy}` });
            return true;
          }
        }
      }

      // Auto-inject tenant_id only for tables that actually have the column.
      if (!body.tenant_id && await tableHasTenantIdColumn(tableName)) {
        body.tenant_id = '00000000-0000-0000-0000-000000000000';
      }

      const keys = Object.keys(body);
      const cols = keys.map(sanitizeIdentifier);
      const placeholders = keys.map((_, i) => `$${i + 1}`);
      const vals = keys.map(k => {
        const v = body[k];
        // Pass arrays directly so node-pg serializes them for TEXT[] columns;
        // only JSON.stringify plain objects.
        if (Array.isArray(v)) return v;
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
        if (Array.isArray(v)) return v;
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
