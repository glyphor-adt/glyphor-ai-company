import { createHash } from 'node:crypto';

import { EXECUTIVE_ROLES } from '@glyphor/agent-runtime';
import type { CompanyAgentRole } from '@glyphor/agent-runtime';
import { getTierModel } from '@glyphor/shared';
import { systemQuery, systemTransaction } from '@glyphor/shared/db';

const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000000';
const MAX_CLIENT_AGENTS_PER_TENANT = 10;
const MAX_CLIENT_TTL_DAYS = 365;

export interface AuthenticatedSdkClient {
  id: string;
  name: string;
  tenantId: string;
  trustLevel: 'untrusted' | 'basic' | 'trusted';
  rateLimitPerHour: number;
}

export interface ClientSdkToolConfig {
  name: string;
  description?: string;
  type?: 'api' | 'custom' | 'integration' | 'query';
  config?: Record<string, unknown>;
}

export interface ClientSdkCreateAgentRequest {
  name: string;
  role?: string;
  title?: string;
  department: string;
  reportsTo: CompanyAgentRole;
  brief: string;
  schedule?: string | null;
  authorityScope?: 'green' | 'yellow' | 'red';
  ttlDays?: number | null;
  model?: string;
  tools?: ClientSdkToolConfig[];
  personality?: {
    tone?: string;
    expertise?: string[];
    communicationStyle?: string;
    workingStyle?: string;
  };
}

export interface ClientSdkRetireAgentRequest {
  reason: string;
}

export interface ClientSdkAgentRecord {
  role: string;
  displayName: string;
  title: string;
  department: string;
  reportsTo: string | null;
  status: string;
  tenantId: string;
  createdVia: string;
  authorityScope: string;
  model: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  brief: string | null;
  schedule: string | null;
  tools: ClientSdkToolConfig[];
}

interface ClientRow {
  id: string;
  name: string;
  trust_level: 'untrusted' | 'basic' | 'trusted';
  rate_limit_per_hour: number;
  tenant_id: string;
}

interface AgentRow {
  role: string;
  display_name: string;
  title: string | null;
  department: string | null;
  reports_to: string | null;
  status: string;
  tenant_id: string;
  created_via: string;
  authority_scope: string;
  model: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
}

export async function authenticateSdkClient(
  authorizationHeader?: string,
): Promise<AuthenticatedSdkClient | null> {
  if (!authorizationHeader?.startsWith('Bearer ')) return null;
  const token = authorizationHeader.slice('Bearer '.length).trim();
  if (!token) return null;

  const tokenHash = createHash('sha256').update(token).digest('hex');
  const [client] = await systemQuery<ClientRow>(
    `SELECT id, name, trust_level, rate_limit_per_hour, tenant_id
     FROM a2a_clients
     WHERE api_key_hash = $1
       AND is_active = true
     LIMIT 1`,
    [tokenHash],
  );

  if (!client) return null;

  return {
    id: client.id,
    name: client.name,
    tenantId: client.tenant_id ?? DEFAULT_TENANT_ID,
    trustLevel: client.trust_level,
    rateLimitPerHour: client.rate_limit_per_hour,
  };
}

export async function listClientSdkAgents(
  client: AuthenticatedSdkClient,
): Promise<ClientSdkAgentRecord[]> {
  const rows = await systemQuery<AgentRow>(
    `SELECT role, display_name, title, department, reports_to, status,
            tenant_id, created_via, authority_scope, model,
            created_at, updated_at, expires_at
     FROM company_agents
     WHERE tenant_id = $1
       AND created_via = 'client_sdk'
     ORDER BY created_at DESC`,
    [client.tenantId],
  );

  if (rows.length === 0) return [];
  return hydrateClientSdkAgents(client.tenantId, rows);
}

export async function getClientSdkAgent(
  client: AuthenticatedSdkClient,
  role: string,
): Promise<ClientSdkAgentRecord | null> {
  const [row] = await systemQuery<AgentRow>(
    `SELECT role, display_name, title, department, reports_to, status,
            tenant_id, created_via, authority_scope, model,
            created_at, updated_at, expires_at
     FROM company_agents
     WHERE tenant_id = $1
       AND created_via = 'client_sdk'
       AND role = $2
     LIMIT 1`,
    [client.tenantId, role],
  );

  if (!row) return null;
  const [record] = await hydrateClientSdkAgents(client.tenantId, [row]);
  return record ?? null;
}

export async function createClientSdkAgent(
  client: AuthenticatedSdkClient,
  request: ClientSdkCreateAgentRequest,
): Promise<ClientSdkAgentRecord> {
  validateCreateRequest(request);

  const authorityScope = request.authorityScope ?? 'green';
  if (authorityScope !== 'green') {
    throw new Error('Client SDK agents currently support green authority only.');
  }

  const activeLimitRow = await systemQuery<{ count: number }>(
    `SELECT COUNT(*)::int AS count
     FROM company_agents
     WHERE tenant_id = $1
       AND created_via = 'client_sdk'
       AND status = 'active'`,
    [client.tenantId],
  );

  if ((activeLimitRow[0]?.count ?? 0) >= MAX_CLIENT_AGENTS_PER_TENANT) {
    throw new Error(`Tenant already has ${MAX_CLIENT_AGENTS_PER_TENANT} active SDK agents.`);
  }

  const role = slugify(request.role ?? request.name);
  const [existing] = await systemQuery<{ role: string }>(
    'SELECT role FROM company_agents WHERE role = $1 LIMIT 1',
    [role],
  );
  if (existing) {
    throw new Error(`Agent role "${role}" already exists.`);
  }

  const ttlDays = normalizeTtlDays(request.ttlDays);
  const now = new Date().toISOString();
  const expiresAt = ttlDays == null
    ? null
    : new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
  const model = request.model ?? getTierModel('default');
  const title = request.title?.trim() || request.name.trim();
  const avatarUrl = buildGeneratedAvatarUrl(request.name);
  const systemPrompt = buildSdkSystemPrompt(request, role);

  await systemTransaction(async (db) => {
    await db.query(
      `INSERT INTO company_agents (
         role, display_name, name, title, department, reports_to, status, model,
         temperature, max_turns, budget_per_run, budget_daily, budget_monthly,
         is_temporary, is_core, created_by, expires_at, created_at, updated_at,
         tenant_id, created_via, created_by_client_id, authority_scope
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, 'active', $7,
         0.3, 10, 0.10, 1.00, 20.00,
         $8, false, $9, $10, $11, $11,
         $12, 'client_sdk', $13, $14
       )`,
      [
        role,
        request.name.trim(),
        request.name.trim(),
        title,
        request.department.trim(),
        request.reportsTo,
        model,
        expiresAt != null,
        `client:${client.name}`,
        expiresAt,
        now,
        client.tenantId,
        client.id,
        authorityScope,
      ],
    );

    await db.query(
      `INSERT INTO agent_briefs (agent_id, system_prompt, skills, tools, updated_at, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (agent_id) DO UPDATE SET
         system_prompt = EXCLUDED.system_prompt,
         skills = EXCLUDED.skills,
         tools = EXCLUDED.tools,
         updated_at = EXCLUDED.updated_at,
         tenant_id = EXCLUDED.tenant_id`,
      [role, systemPrompt, JSON.stringify([]), JSON.stringify(request.tools ?? []), now, client.tenantId],
    );

    await db.query(
      `INSERT INTO agent_profiles (
         agent_id, personality_summary, backstory, communication_traits, quirks,
         tone_formality, emoji_usage, verbosity, working_style, avatar_url,
         updated_at, tenant_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (agent_id) DO UPDATE SET
         personality_summary = EXCLUDED.personality_summary,
         backstory = EXCLUDED.backstory,
         communication_traits = EXCLUDED.communication_traits,
         quirks = EXCLUDED.quirks,
         tone_formality = EXCLUDED.tone_formality,
         emoji_usage = EXCLUDED.emoji_usage,
         verbosity = EXCLUDED.verbosity,
         working_style = EXCLUDED.working_style,
         avatar_url = COALESCE(agent_profiles.avatar_url, EXCLUDED.avatar_url),
         updated_at = EXCLUDED.updated_at,
         tenant_id = EXCLUDED.tenant_id`,
      [
        role,
        buildPersonalitySummary(request),
        `Provisioned via the client SDK for tenant ${client.name}.`,
        JSON.stringify([request.personality?.communicationStyle ?? 'clear', 'structured', 'action-oriented']),
        JSON.stringify(['Summarizes next steps before execution']),
        0.6,
        0.05,
        0.45,
        request.personality?.workingStyle ?? 'outcome-driven',
        avatarUrl,
        now,
        client.tenantId,
      ],
    );

    if (request.schedule?.trim()) {
      await db.query(
        `INSERT INTO agent_schedules (agent_id, cron_expression, task, enabled, payload, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [role, request.schedule.trim(), 'scheduled_run', true, JSON.stringify({ source: 'client_sdk' }), client.tenantId],
      );
    }

    await db.query(
      `INSERT INTO activity_log (agent_role, action, summary, tenant_id)
       VALUES ($1, $2, $3, $4)`,
      [
        request.reportsTo,
        'agent.created',
        `Client SDK agent created by ${client.name}: ${request.name.trim()} (${role})`,
        client.tenantId,
      ],
    );
  });

  const created = await getClientSdkAgent(client, role);
  if (!created) {
    throw new Error(`Agent "${role}" was created but could not be reloaded.`);
  }
  return created;
}

export async function retireClientSdkAgent(
  client: AuthenticatedSdkClient,
  role: string,
  request: ClientSdkRetireAgentRequest,
): Promise<ClientSdkAgentRecord> {
  const reason = request.reason?.trim();
  if (!reason) {
    throw new Error('reason is required.');
  }

  const [existing] = await systemQuery<{ role: string; status: string }>(
    `SELECT role, status
     FROM company_agents
     WHERE tenant_id = $1
       AND created_via = 'client_sdk'
       AND role = $2
     LIMIT 1`,
    [client.tenantId, role],
  );
  if (!existing) {
    throw new Error(`Client SDK agent "${role}" not found.`);
  }

  await systemTransaction(async (db) => {
    await db.query(
      `UPDATE company_agents
       SET status = 'retired', updated_at = $1
       WHERE tenant_id = $2
         AND created_via = 'client_sdk'
         AND role = $3`,
      [new Date().toISOString(), client.tenantId, role],
    );

    await db.query(
      `INSERT INTO activity_log (agent_role, action, summary, tenant_id)
       VALUES ($1, $2, $3, $4)`,
      ['chief-of-staff', 'agent.retired', `Client SDK retirement by ${client.name}: ${reason}`, client.tenantId],
    );
  });

  const retired = await getClientSdkAgent(client, role);
  if (!retired) {
    throw new Error(`Client SDK agent "${role}" was retired but could not be reloaded.`);
  }
  return retired;
}

async function hydrateClientSdkAgents(
  tenantId: string,
  rows: AgentRow[],
): Promise<ClientSdkAgentRecord[]> {
  const roles = rows.map((row) => row.role);

  const briefRows = await systemQuery<{
    agent_id: string;
    system_prompt: string | null;
    tools: ClientSdkToolConfig[] | null;
  }>(
    `SELECT agent_id, system_prompt, tools
     FROM agent_briefs
     WHERE tenant_id = $1
       AND agent_id = ANY($2::text[])`,
    [tenantId, roles],
  );

  const scheduleRows = await systemQuery<{
    agent_id: string;
    cron_expression: string | null;
    enabled: boolean;
  }>(
    `SELECT agent_id, cron_expression, enabled
     FROM agent_schedules
     WHERE tenant_id = $1
       AND agent_id = ANY($2::text[])
       AND enabled = true
     ORDER BY agent_id, created_at DESC`,
    [tenantId, roles],
  );

  const briefMap = new Map(briefRows.map((row) => [row.agent_id, row]));
  const scheduleMap = new Map<string, string>();
  for (const row of scheduleRows) {
    if (row.cron_expression && !scheduleMap.has(row.agent_id)) {
      scheduleMap.set(row.agent_id, row.cron_expression);
    }
  }

  return rows.map((row) => {
    const brief = briefMap.get(row.role);
    return {
      role: row.role,
      displayName: row.display_name,
      title: row.title ?? '',
      department: row.department ?? '',
      reportsTo: row.reports_to,
      status: row.status,
      tenantId: row.tenant_id,
      createdVia: row.created_via,
      authorityScope: row.authority_scope,
      model: row.model,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
      brief: brief?.system_prompt ?? null,
      schedule: scheduleMap.get(row.role) ?? null,
      tools: Array.isArray(brief?.tools) ? brief!.tools : [],
    };
  });
}

function validateCreateRequest(request: ClientSdkCreateAgentRequest): void {
  if (!request.name?.trim()) throw new Error('name is required.');
  if (!request.department?.trim()) throw new Error('department is required.');
  if (!request.brief?.trim()) throw new Error('brief is required.');
  if (!EXECUTIVE_ROLES.includes(request.reportsTo)) {
    throw new Error(`reportsTo must be an executive role. Received "${request.reportsTo}".`);
  }
}

function normalizeTtlDays(ttlDays: number | null | undefined): number | null {
  if (ttlDays == null) return null;
  if (!Number.isFinite(ttlDays) || ttlDays <= 0) {
    throw new Error('ttlDays must be a positive number or null.');
  }
  return Math.min(Math.round(ttlDays), MAX_CLIENT_TTL_DAYS);
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function buildGeneratedAvatarUrl(name: string): string {
  const seed = encodeURIComponent(name.trim() || 'Agent');
  return `https://api.dicebear.com/9.x/initials/svg?seed=${seed}&radius=50&bold=true`;
}

function buildPersonalitySummary(request: ClientSdkCreateAgentRequest): string {
  const tone = request.personality?.tone ? `${request.personality.tone} tone` : 'clear tone';
  const expertise = request.personality?.expertise?.length
    ? ` Focused on ${request.personality.expertise.join(', ')}.`
    : '';
  return `${request.name.trim()} is a ${tone} specialist supporting ${request.department.trim()}.${expertise}`;
}

function buildSdkSystemPrompt(request: ClientSdkCreateAgentRequest, role: string): string {
  const expertise = request.personality?.expertise?.length
    ? `\nExpertise areas: ${request.personality.expertise.join(', ')}.`
    : '';
  const toolNote = request.tools?.length
    ? `\nRegistered client SDK tool metadata: ${request.tools.map((tool) => tool.name).join(', ')}.`
    : '';
  const communication = request.personality?.communicationStyle
    ? `\nCommunication style: ${request.personality.communicationStyle}.`
    : '';
  const workingStyle = request.personality?.workingStyle
    ? `\nWorking style: ${request.personality.workingStyle}.`
    : '';

  return [
    `You are ${request.name.trim()} (${role}), a client-defined specialist agent in ${request.department.trim()}.`,
    `You report to ${request.reportsTo} and operate with ${request.authorityScope ?? 'green'} authority.`,
    `Primary brief: ${request.brief.trim()}`,
    expertise,
    communication,
    workingStyle,
    toolNote,
    '\nStay within your role, provide concrete outputs, and escalate any work that exceeds green authority.',
  ].join('').trim();
}
