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

export interface AuthenticatedDashboardUser {
  uid: string;
  email: string;
  role: 'admin' | 'viewer';
  tenantId: string | null;
}

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

type DashboardMode = 'smb' | 'internal';

type DashboardUserRow = {
  id: string;
  email: string;
  name: string;
  role: string;
  tenant_id?: string | null;
};

type TenantRow = {
  id: string;
  name: string;
  slug: string;
  website: string | null;
  industry: string | null;
  brand_voice: string | null;
  product: string;
  status: string;
  settings: unknown;
  created_at: string;
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  return typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeDashboardMode(value: unknown): DashboardMode {
  return value === 'smb' ? 'smb' : 'internal';
}

function mergeObjects<T extends Record<string, unknown>>(base: T, patch: Record<string, unknown>): T {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (
      value
      && typeof value === 'object'
      && !Array.isArray(value)
      && merged[key]
      && typeof merged[key] === 'object'
      && !Array.isArray(merged[key])
    ) {
      merged[key] = mergeObjects(
        merged[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      merged[key] = value;
    }
  }
  return merged as T;
}

function firstSentence(value: string): string {
  const match = value.match(/(.+?[.!?])(?:\s|$)/);
  return (match?.[1] ?? value).trim();
}

function sanitizeSmbText(input: unknown): string {
  const raw = typeof input === 'string' ? input : '';
  if (!raw.trim()) return '';

  const lines = raw
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '')
    .replace(/\b(?:gpt|claude|gemini|o[134]|4o(?:-mini)?)(?:[-._a-z0-9]+)?\b/gi, 'the team')
    .replace(/\b\d+[\d,]*(?:\.\d+)?\s*(?:tokens?|ms|milliseconds?|seconds?|usd|dollars?)\b/gi, '')
    .replace(/\b(?:authority tier|authority-tier|governance policy|approval rate|confidence score|confidence)\b/gi, 'review')
    .replace(/\b(?:run|task|assignment|directive|request)\s*#?\s*[a-z0-9_-]{6,}\b/gi, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^at\s.+\(.+\)$/.test(line))
    .filter((line) => !/^(error|trace|stack|sqlstate|postgres|database)\b/i.test(line));

  const joined = lines.join(' ').replace(/\s+/g, ' ').trim();
  if (!joined) return 'Ran into an issue while working on this.';
  if (/(failed|exception|timeout|timed out|error)/i.test(joined)) {
    return 'Ran into an issue while working on this.';
  }
  return joined;
}

function buildPreviewText(input: unknown): string {
  const sanitized = sanitizeSmbText(input);
  if (!sanitized) return 'Work is still in progress.';
  const sentence = firstSentence(sanitized);
  return sentence.length > 180 ? `${sentence.slice(0, 177).trim()}...` : sentence;
}

function getIsoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

async function getDashboardUserColumns(): Promise<Set<string>> {
  return getTableColumns('dashboard_users');
}

async function resolveDashboardContext(email: string | null) {
  const dashboardUserColumns = await getDashboardUserColumns();
  const hasTenantId = dashboardUserColumns.has('tenant_id');
  const loweredEmail = email?.trim().toLowerCase() ?? null;

  let user: DashboardUserRow | null = null;
  if (loweredEmail) {
    const userSql = hasTenantId
      ? `SELECT id, email, name, role, tenant_id
           FROM dashboard_users
          WHERE LOWER(email) = $1
          LIMIT 1`
      : `SELECT id, email, name, role
           FROM dashboard_users
          WHERE LOWER(email) = $1
          LIMIT 1`;
    const rows = await systemQuery<DashboardUserRow>(userSql, [loweredEmail]);
    user = rows[0] ?? null;
  }

  const preferredTenantId = hasTenantId ? user?.tenant_id ?? null : null;
  const tenantRows = preferredTenantId
    ? await systemQuery<TenantRow>(
      `SELECT id, name, slug, website, industry, brand_voice, product, status, settings, created_at
         FROM tenants
        WHERE id = $1
        LIMIT 1`,
      [preferredTenantId],
    )
    : [];

  const fallbackTenantRows = tenantRows.length > 0
    ? tenantRows
    : await systemQuery<TenantRow>(
      `SELECT id, name, slug, website, industry, brand_voice, product, status, settings, created_at
         FROM tenants
        ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, created_at ASC
        LIMIT 1`,
    );

  const tenant = fallbackTenantRows[0] ?? null;
  const tenantSettings = asObject(tenant?.settings);
  const smbSettings = asObject(tenantSettings.smb);
  const dashboardMode = normalizeDashboardMode(
    smbSettings.dashboard_mode ?? tenantSettings.dashboard_mode,
  );

  const approvalRows = await systemQuery<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM decisions
      WHERE status = 'pending'`,
  );

  return {
    user: user ?? {
      id: 'session-user',
      email: loweredEmail ?? 'unknown',
      name: loweredEmail?.split('@')[0] ?? 'User',
      role: 'viewer',
      tenant_id: tenant?.id ?? null,
    },
    organization: tenant
      ? {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        website: tenant.website,
        industry: tenant.industry,
        brand_voice: tenant.brand_voice,
        product: tenant.product,
        status: tenant.status,
        created_at: tenant.created_at,
        settings: tenantSettings,
        smb_settings: smbSettings,
        dashboard_mode: dashboardMode,
      }
      : null,
    pending_approvals: Number(approvalRows[0]?.count ?? 0),
  };
}

async function getTenantWorkspaceMap(tenantId: string): Promise<Record<string, boolean>> {
  const rows = await systemQuery<{ platform: string; is_active: boolean }>(
    `SELECT platform, is_active
       FROM tenant_workspaces
      WHERE tenant_id = $1`,
    [tenantId],
  );
  return rows.reduce<Record<string, boolean>>((acc, row) => {
    acc[row.platform] = row.is_active === true;
    return acc;
  }, {});
}

async function buildSmbSettings(email: string | null) {
  const context = await resolveDashboardContext(email);
  const organization = context.organization;
  if (!organization) {
    return {
      user: context.user,
      organization: null,
      team: { active_departments: [], available_departments: [], roster: [], authorized_users: [] },
      work: {},
      integrations: {},
      brand_context: {},
    };
  }

  const workspaceMap = await getTenantWorkspaceMap(organization.id);
  const allAgents = await systemQuery<{
    role: string;
    display_name: string | null;
    title: string | null;
    department: string | null;
    avatar_url: string | null;
    personality_summary: string | null;
    working_style: string | null;
    working_voice: string | null;
  }>(
    `SELECT
        ca.role,
        ca.display_name,
        ca.title,
        ca.department,
        ap.avatar_url,
        ap.personality_summary,
        ap.working_style,
        ap.working_voice
       FROM company_agents ca
       LEFT JOIN agent_profiles ap ON ap.agent_id = ca.role
      WHERE ca.tenant_id = $1
      ORDER BY COALESCE(ca.department, 'General'), COALESCE(ca.display_name, ca.role)`,
    [organization.id],
  );

  const authorizedUsers = await (async () => {
    const columns = await getDashboardUserColumns();
    if (columns.has('tenant_id')) {
      return systemQuery<{ email: string; name: string; role: string }>(
        `SELECT email, name, role
           FROM dashboard_users
          WHERE tenant_id = $1 OR tenant_id IS NULL
          ORDER BY role DESC, email ASC`,
        [organization.id],
      );
    }
    return systemQuery<{ email: string; name: string; role: string }>(
      `SELECT email, name, role
         FROM dashboard_users
        ORDER BY role DESC, email ASC`,
    );
  })();

  const smbSettings = asObject(organization.smb_settings);
  const teamSettings = asObject(smbSettings.team);
  const workSettings = asObject(smbSettings.work);
  const integrationSettings = asObject(smbSettings.integrations);
  const brandContext = asObject(smbSettings.brand_context);

  const availableDepartments = [...new Set(
    allAgents
      .map((agent) => agent.department?.trim())
      .filter((department): department is string => Boolean(department)),
  )].sort((a, b) => a.localeCompare(b));

  const activeDepartments = Array.isArray(teamSettings.active_departments)
    ? teamSettings.active_departments.filter((value): value is string => typeof value === 'string')
    : availableDepartments;

  return {
    user: context.user,
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      website: organization.website,
      industry: organization.industry,
      brand_voice: organization.brand_voice,
      dashboard_mode: organization.dashboard_mode,
      created_at: organization.created_at,
    },
    team: {
      active_departments: activeDepartments,
      available_departments: availableDepartments,
      roster: allAgents.map((agent) => ({
        role: agent.role,
        display_name: agent.display_name ?? agent.role,
        title: agent.title,
        department: agent.department,
        avatar_url: agent.avatar_url,
        personality_summary: sanitizeSmbText(agent.personality_summary),
        working_style: sanitizeSmbText(agent.working_style),
        working_voice: sanitizeSmbText(agent.working_voice),
      })),
      authorized_users: authorizedUsers,
    },
    work: {
      communication_style: sanitizeSmbText(workSettings.communication_style ?? ''),
      approval_preference: sanitizeSmbText(workSettings.approval_preference ?? ''),
      focus_areas: Array.isArray(workSettings.focus_areas)
        ? workSettings.focus_areas.filter((value): value is string => typeof value === 'string')
        : [],
    },
    integrations: {
      slack: Boolean(workspaceMap.slack || integrationSettings.slack === true || asObject(integrationSettings.slack).connected === true),
      teams: Boolean(workspaceMap.teams || integrationSettings.teams === true || asObject(integrationSettings.teams).connected === true),
      google_workspace: Boolean(asObject(integrationSettings.google_workspace).connected === true),
      hubspot: Boolean(asObject(integrationSettings.hubspot).connected === true),
    },
    brand_context: {
      website: organization.website ?? '',
      brand_voice: sanitizeSmbText(organization.brand_voice ?? ''),
      target_audience: sanitizeSmbText(brandContext.target_audience ?? ''),
      differentiators: sanitizeSmbText(brandContext.differentiators ?? ''),
      notes: sanitizeSmbText(brandContext.notes ?? ''),
    },
  };
}

async function buildSmbSummary(email: string | null) {
  const context = await resolveDashboardContext(email);
  const organization = context.organization;
  if (!organization) {
    return {
      organization: null,
      greeting_name: context.user.name || 'there',
      tasks_completed_this_week: 0,
      active_agents: [],
      dormant_departments: [],
      recent_activity: [],
      pending_approvals: [],
      metrics: [],
      work_delivered_this_week: [],
      weekly_work: [],
      directives: [],
    };
  }

  const smbSettings = asObject(organization.smb_settings);
  const teamSettings = asObject(smbSettings.team);
  const activeDepartmentSetting = Array.isArray(teamSettings.active_departments)
    ? teamSettings.active_departments.filter((value): value is string => typeof value === 'string')
    : [];

  const [agents, activity, decisions, directives, weeklyCompleted, weeklySeries] = await Promise.all([
    systemQuery<{
      role: string;
      display_name: string | null;
      title: string | null;
      department: string | null;
      status: string | null;
      last_run_at: string | null;
      avatar_url: string | null;
      personality_summary: string | null;
    }>(
      `SELECT
          ca.role,
          ca.display_name,
          ca.title,
          ca.department,
          ca.status,
          ca.last_run_at,
          ap.avatar_url,
          ap.personality_summary
         FROM company_agents ca
         LEFT JOIN agent_profiles ap ON ap.agent_id = ca.role
        WHERE ca.tenant_id = $1
        ORDER BY COALESCE(ca.department, 'General'), COALESCE(ca.display_name, ca.role)`,
      [organization.id],
    ),
    systemQuery<{
      agent_role: string;
      summary: string;
      action: string;
      created_at: string;
    }>(
      `SELECT agent_role, summary, action, created_at
         FROM activity_log
        ORDER BY created_at DESC
        LIMIT 12`,
    ),
    systemQuery<{
      id: string;
      title: string;
      summary: string;
      reasoning: string;
      proposed_by: string;
      assigned_to: string[] | null;
      created_at: string;
    }>(
      `SELECT id, title, summary, reasoning, proposed_by, assigned_to, created_at
         FROM decisions
        WHERE status = 'pending'
        ORDER BY created_at DESC
        LIMIT 12`,
    ),
    systemQuery<{
      id: string;
      title: string;
      description: string;
      status: string;
      priority: string;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT id, title, description, status, priority, created_at, updated_at
         FROM founder_directives
        WHERE tenant_id = $1
        ORDER BY created_at DESC
        LIMIT 20`,
      [organization.id],
    ),
    systemQuery<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM work_assignments
        WHERE tenant_id = $1
          AND status = 'completed'
          AND completed_at >= $2`,
      [organization.id, getIsoDaysAgo(7)],
    ),
    systemQuery<{ week_label: string; completed_count: string }>(
      `WITH weeks AS (
          SELECT generate_series(0, 7) AS offset
       )
       SELECT
         TO_CHAR(date_trunc('week', NOW()) - (offset * INTERVAL '1 week'), 'Mon DD') AS week_label,
         COALESCE((
           SELECT COUNT(*)::int
             FROM work_assignments wa
            WHERE wa.tenant_id = $1
              AND wa.status = 'completed'
              AND wa.completed_at >= date_trunc('week', NOW()) - (offset * INTERVAL '1 week')
              AND wa.completed_at < date_trunc('week', NOW()) - ((offset - 1) * INTERVAL '1 week')
         ), 0)::text AS completed_count
       FROM weeks
       ORDER BY offset DESC`,
      [organization.id],
    ),
  ]);

  const directiveIds = directives.map((directive) => directive.id);
  const assignments = directiveIds.length > 0
    ? await systemQuery<{
      id: string;
      directive_id: string;
      assigned_to: string;
      task_description: string;
      status: string;
      created_at: string;
      completed_at: string | null;
      agent_output: string | null;
      evaluation: string | null;
      blocker_reason: string | null;
      need_type: string | null;
    }>(
      `SELECT id, directive_id, assigned_to, task_description, status, created_at, completed_at, agent_output, evaluation, blocker_reason, need_type
         FROM work_assignments
        WHERE directive_id = ANY($1::uuid[])
        ORDER BY created_at DESC`,
      [directiveIds],
    )
    : [];

  const assignmentsByDirective = new Map<string, typeof assignments>();
  for (const assignment of assignments) {
    const group = assignmentsByDirective.get(assignment.directive_id) ?? [];
    group.push(assignment);
    assignmentsByDirective.set(assignment.directive_id, group);
  }

  const departments = [...new Set(
    agents
      .map((agent) => agent.department?.trim())
      .filter((department): department is string => Boolean(department)),
  )].sort((a, b) => a.localeCompare(b));

  const activeDepartments = activeDepartmentSetting.length > 0
    ? activeDepartmentSetting
    : [...new Set(
      agents
        .filter((agent) => agent.status === 'active' || Boolean(agent.last_run_at && agent.last_run_at >= getIsoDaysAgo(21)))
        .map((agent) => agent.department?.trim())
        .filter((department): department is string => Boolean(department)),
    )];

  const activeAgents = agents
    .filter((agent) => {
      if (!agent.department) return true;
      return activeDepartments.includes(agent.department);
    })
    .slice(0, 12)
    .map((agent) => ({
      role: agent.role,
      display_name: agent.display_name ?? agent.role,
      title: agent.title,
      department: agent.department,
      avatar_url: agent.avatar_url,
      summary: sanitizeSmbText(agent.personality_summary) || 'Ready to take on work for this area.',
      status: agent.status === 'active' ? 'Working now' : 'Available',
      last_run_at: agent.last_run_at,
    }));

  const dormantDepartments = departments
    .filter((department) => !activeDepartments.includes(department))
    .map((department) => {
      const departmentAgents = agents.filter((agent) => agent.department === department);
      return {
        department,
        count: departmentAgents.length,
        sample_roles: departmentAgents.slice(0, 3).map((agent) => agent.display_name ?? agent.role),
      };
    });

  const pendingApprovals = decisions.map((decision) => ({
    id: decision.id,
    title: sanitizeSmbText(decision.title) || 'Needs your input',
    summary: sanitizeSmbText(decision.summary) || buildPreviewText(decision.reasoning),
    requested_by: decision.proposed_by,
    assigned_to: decision.assigned_to ?? [],
    created_at: decision.created_at,
  }));

  const directiveCards = directives.map((directive) => {
    const directiveAssignments = assignmentsByDirective.get(directive.id) ?? [];
    const completed = directiveAssignments.filter((assignment) => assignment.status === 'completed').length;
    const total = directiveAssignments.length;
    const latestOutput = directiveAssignments.find((assignment) => assignment.agent_output?.trim());
    const blocked = directiveAssignments.find((assignment) => assignment.status === 'blocked' || assignment.need_type || assignment.blocker_reason);
    return {
      id: directive.id,
      title: sanitizeSmbText(directive.title) || 'New directive',
      description: sanitizeSmbText(directive.description),
      status: directive.status,
      priority: directive.priority,
      created_at: directive.created_at,
      updated_at: directive.updated_at,
      progress_label: total > 0 ? `${completed} of ${total} tasks finished` : 'Queued for the team',
      output_preview: buildPreviewText(latestOutput?.agent_output ?? latestOutput?.evaluation ?? directive.description),
      output_full: sanitizeSmbText(latestOutput?.agent_output ?? latestOutput?.evaluation ?? directive.description),
      needs_input: blocked
        ? sanitizeSmbText(blocked.blocker_reason ?? blocked.need_type) || 'Needs input before it can continue.'
        : '',
      assignments: directiveAssignments.slice(0, 8).map((assignment) => ({
        id: assignment.id,
        assigned_to: assignment.assigned_to,
        task_description: sanitizeSmbText(assignment.task_description),
        status: assignment.status,
        created_at: assignment.created_at,
        completed_at: assignment.completed_at,
        preview: buildPreviewText(assignment.agent_output ?? assignment.evaluation ?? assignment.task_description),
        full_output: sanitizeSmbText(assignment.agent_output ?? assignment.evaluation),
        needs_input: sanitizeSmbText(assignment.blocker_reason ?? assignment.need_type),
      })),
    };
  });

  const workDeliveredThisWeek = assignments
    .filter((assignment) => assignment.status === 'completed' && assignment.completed_at && assignment.completed_at >= getIsoDaysAgo(7))
    .slice(0, 8)
    .map((assignment) => ({
      id: assignment.id,
      title: sanitizeSmbText(assignment.task_description) || 'Work delivered',
      by: assignment.assigned_to,
      delivered_at: assignment.completed_at,
      preview: buildPreviewText(assignment.agent_output ?? assignment.evaluation ?? assignment.task_description),
    }));

  return {
    organization: {
      id: organization.id,
      name: organization.name,
      website: organization.website,
      dashboard_mode: organization.dashboard_mode,
      created_at: organization.created_at,
    },
    greeting_name: context.user.name?.split(' ')[0] ?? 'there',
    tasks_completed_this_week: Number(weeklyCompleted[0]?.count ?? 0),
    active_agents: activeAgents,
    dormant_departments: dormantDepartments,
    recent_activity: activity.map((entry) => ({
      agent_role: entry.agent_role,
      summary: sanitizeSmbText(entry.summary) || 'The team finished a new update.',
      created_at: entry.created_at,
    })),
    pending_approvals: pendingApprovals,
    metrics: [
      {
        label: 'Tasks completed this week',
        value: Number(weeklyCompleted[0]?.count ?? 0),
        detail: 'Finished and ready to review',
      },
      {
        label: 'Open directives',
        value: directiveCards.filter((directive) => directive.status !== 'completed').length,
        detail: 'Current work moving through the team',
      },
      {
        label: 'Pending approvals',
        value: pendingApprovals.length,
        detail: pendingApprovals.length > 0 ? 'Waiting on your input' : 'Nothing waiting right now',
      },
    ],
    work_delivered_this_week: workDeliveredThisWeek,
    weekly_work: weeklySeries.map((row) => ({
      week_label: row.week_label,
      completed_count: Number(row.completed_count ?? 0),
    })),
    directives: directiveCards,
  };
}

async function updateSmbSettings(email: string | null, payload: Record<string, unknown>) {
  const context = await resolveDashboardContext(email);
  const organization = context.organization;
  if (!organization) {
    throw new Error('No organization found for current dashboard user.');
  }

  const currentSettings = asObject(organization.settings);
  const currentSmb = asObject(currentSettings.smb);
  const teamPatch = asObject(payload.team);
  const workPatch = asObject(payload.work);
  const integrationsPatch = asObject(payload.integrations);
  const brandContextPatch = asObject(payload.brand_context);

  const smbPatch: Record<string, unknown> = {
    team: teamPatch,
    work: workPatch,
    integrations: integrationsPatch,
    brand_context: brandContextPatch,
  };
  if (Object.prototype.hasOwnProperty.call(payload, 'dashboard_mode')) {
    smbPatch.dashboard_mode = normalizeDashboardMode(payload.dashboard_mode);
  }

  const nextSmb = mergeObjects(currentSmb, smbPatch);

  const updates: string[] = ['settings = $1', 'updated_at = NOW()'];
  const values: unknown[] = [JSON.stringify(mergeObjects(currentSettings, { smb: nextSmb }))];

  if (typeof payload.website === 'string') {
    values.push(payload.website.trim() || null);
    updates.push(`website = $${values.length}`);
  }

  if (typeof payload.brand_voice === 'string') {
    values.push(payload.brand_voice.trim() || null);
    updates.push(`brand_voice = $${values.length}`);
  }

  values.push(organization.id);
  await systemQuery(
    `UPDATE tenants
        SET ${updates.join(', ')}
      WHERE id = $${values.length}`,
    values,
  );

  return buildSmbSettings(email);
}

/** GET /api/ops/agent-work-signals — assignment completion + external eval quality per roster agent */
async function handleAgentWorkSignals(
  res: ServerResponse,
  queryString: string,
): Promise<void> {
  const params = new URLSearchParams(queryString ?? '');
  const assignmentDays = Math.min(366, Math.max(1, parseInt(params.get('assignments_days') ?? '60', 10) || 60));
  const evalDays = Math.min(366, Math.max(1, parseInt(params.get('eval_days') ?? '14', 10) || 14));

  const rows = await systemQuery<{
    agent_role: string;
    total_assignments: string | number;
    completed_assignments: string | number;
    completion_rate: string | number | null;
    avg_external_quality: string | number | null;
  }>(
    `
    WITH roles AS (
      SELECT role FROM company_agents
      WHERE COALESCE(NULLIF(TRIM(LOWER(status)), ''), 'active') NOT IN ('retired', 'inactive', 'deleted')
    ),
    wa_agg AS (
      SELECT
        assigned_to,
        COUNT(DISTINCT id)::int AS total_assignments,
        COUNT(DISTINCT id) FILTER (WHERE status = 'completed')::int AS completed_assignments,
        ROUND(
          COUNT(DISTINCT id) FILTER (WHERE status = 'completed')::numeric / NULLIF(COUNT(DISTINCT id), 0),
          4
        ) AS completion_rate
      FROM work_assignments
      WHERE created_at > NOW() - ($1::int * INTERVAL '1 day')
      GROUP BY assigned_to
    ),
    ae_agg AS (
      SELECT
        wa.assigned_to,
        ROUND((AVG(ae.score_normalized) * 100)::numeric, 2) AS avg_external_quality
      FROM assignment_evaluations ae
      INNER JOIN work_assignments wa ON wa.id = ae.assignment_id
      WHERE ae.evaluator_type IN ('executive', 'team', 'cos')
        AND ae.evaluated_at > NOW() - ($2::int * INTERVAL '1 day')
      GROUP BY wa.assigned_to
    )
    SELECT
      r.role AS agent_role,
      COALESCE(w.total_assignments, 0) AS total_assignments,
      COALESCE(w.completed_assignments, 0) AS completed_assignments,
      w.completion_rate,
      a.avg_external_quality
    FROM roles r
    LEFT JOIN wa_agg w ON w.assigned_to = r.role
    LEFT JOIN ae_agg a ON a.assigned_to = r.role
    ORDER BY r.role
    `,
    [assignmentDays, evalDays],
  );

  const normalized = rows.map((row) => ({
    agent_role: row.agent_role,
    total_assignments: Number(row.total_assignments ?? 0),
    completed_assignments: Number(row.completed_assignments ?? 0),
    completion_rate: row.completion_rate != null ? Number(row.completion_rate) : null,
    avg_external_quality: row.avg_external_quality != null ? Number(row.avg_external_quality) : null,
  }));

  jsonResponse(res, 200, normalized);
}

/** GET /api/ops/assignment-flow-metrics — work_assignments summary for Operations when orchestrator workflows table is empty */
async function handleAssignmentFlowMetrics(
  res: ServerResponse,
  queryString: string,
): Promise<void> {
  const params = new URLSearchParams(queryString ?? '');
  const days = Math.min(366, Math.max(1, parseInt(params.get('days') ?? '30', 10) || 30));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const [summary] = await systemQuery<{
    total_started: string | number;
    total_completed: string | number;
    total_failed: string | number;
    avg_completion_time_ms: string | number | null;
  }>(
    `SELECT
      COUNT(*)::int AS total_started,
      COUNT(*) FILTER (WHERE status = 'completed')::int AS total_completed,
      COUNT(*) FILTER (WHERE status = 'failed')::int AS total_failed,
      COALESCE(
        AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) * 1000)
          FILTER (WHERE status = 'completed' AND completed_at IS NOT NULL),
        0
      ) AS avg_completion_time_ms
     FROM work_assignments
     WHERE created_at >= $1`,
    [since],
  );

  const recent = await systemQuery<{
    id: string;
    status: string;
    assigned_to: string;
    task_preview: string;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT id,
            status,
            assigned_to,
            LEFT(task_description, 100) AS task_preview,
            created_at,
            updated_at
       FROM work_assignments
      WHERE created_at >= $1 OR updated_at >= $1
      ORDER BY updated_at DESC
      LIMIT 25`,
    [since],
  );

  jsonResponse(res, 200, {
    window_days: days,
    total_started: Number(summary?.total_started ?? 0),
    total_completed: Number(summary?.total_completed ?? 0),
    total_failed: Number(summary?.total_failed ?? 0),
    avg_completion_time_ms: Math.round(Number(summary?.avg_completion_time_ms ?? 0)),
    recent,
  });
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
  authenticatedUser: AuthenticatedDashboardUser | null,
): Promise<boolean> {
  if (!url.startsWith('/api/')) return false;
  if (!authenticatedUser) {
    jsonResponse(res, 401, { error: 'Unauthorized' });
    return true;
  }

  // Parse: /api/company_agents or /api/decisions/123 or /api/company-pulse/current
  const apiPath = url.slice(5); // remove "/api/"
  if (method === 'GET' && apiPath === 'ops/agent-work-signals') {
    try {
      await handleAgentWorkSignals(res, queryString);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      jsonResponse(res, 500, { error: message });
    }
    return true;
  }

  if (method === 'GET' && apiPath === 'ops/assignment-flow-metrics') {
    try {
      await handleAssignmentFlowMetrics(res, queryString);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      jsonResponse(res, 500, { error: message });
    }
    return true;
  }

  if (apiPath === 'dashboard-profile/current' && method === 'GET') {
    try {
      const profile = await resolveDashboardContext(authenticatedUser.email);
      jsonResponse(res, 200, profile);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      jsonResponse(res, 500, { error: message });
    }
    return true;
  }

  if (apiPath === 'smb/summary' && method === 'GET') {
    try {
      const summary = await buildSmbSummary(authenticatedUser.email);
      jsonResponse(res, 200, summary);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      jsonResponse(res, 500, { error: message });
    }
    return true;
  }

  if (apiPath === 'smb/settings' && method === 'GET') {
    try {
      const settings = await buildSmbSettings(authenticatedUser.email);
      jsonResponse(res, 200, settings);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      jsonResponse(res, 500, { error: message });
    }
    return true;
  }

  if (apiPath === 'smb/settings' && method === 'PATCH') {
    try {
      const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
      const settings = await updateSmbSettings(authenticatedUser.email, body ?? {});
      jsonResponse(res, 200, settings);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      jsonResponse(res, 500, { error: message });
    }
    return true;
  }

  const segments = apiPath.split('/');
  const tableSlug = segments[0];
  const resourceId = segments[1]; // may be undefined
  if (tableSlug === 'dashboard-users' && authenticatedUser.role !== 'admin') {
    jsonResponse(res, 403, { error: 'Forbidden' });
    return true;
  }

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
          `INSERT INTO activity_log (agent_role, action, summary)
           VALUES ($1, $2, $3)`,
          [
            'dashboard',
            'skills.sync_from_file',
            `Synced skill ${parsed.slug} from ${body.fileName ?? 'uploaded markdown'} (holders +${syncResult.holders.inserted}/-${syncResult.holders.deleted}, mappings +${syncResult.task_mappings.inserted}/-${syncResult.task_mappings.deleted})`,
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
          incidents: ' ORDER BY created_at DESC',
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
