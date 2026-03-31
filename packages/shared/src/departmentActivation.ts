import type { PoolClient } from 'pg';
import { systemQuery, systemTransaction } from './db.js';
import { getTierModel } from './models.config.js';
import type { CapacityTier } from './agentCapacity.js';

const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000000';
const DEFAULT_MODEL = getTierModel('default');

type DepartmentActivationStatus = 'available' | 'configuring' | 'active' | 'paused';
type DisclosureLevel = 'off' | 'internal_only' | 'all_communications';
type AbacPermission = 'allow' | 'deny';
type AbacClassificationLevel = 'public' | 'internal' | 'confidential' | 'restricted';

interface DepartmentRow {
  id: string;
  name: string;
  description: string | null;
  icon_key: string | null;
  default_agent_roles: unknown;
  required_mcp_domains: unknown;
  recommended_mcp_domains: unknown;
  activation_order_hint: number;
  created_at: string;
}

interface DepartmentActivationRow {
  id: string;
  tenant_id: string;
  department_id: string;
  status: DepartmentActivationStatus;
  activated_at: string | null;
  activated_by_human_id: string | null;
  agent_count: number;
  config_snapshot: unknown;
}

interface AgentCatalogTemplateRow {
  id: string;
  department_id: string;
  template_name: string;
  default_role: string;
  default_capacity_tier: CapacityTier;
  default_disclosure_level: DisclosureLevel;
  default_autonomy_max_level: number;
  default_mcp_domains: unknown;
  default_abac_policies: unknown;
  system_prompt_template: string;
  created_at: string;
}

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  settings: unknown;
}

interface CompanyAgentRow {
  role: string;
  display_name: string | null;
  name: string | null;
  title: string | null;
  department: string | null;
  status: string | null;
}

interface AgentRunMetricRow {
  total_runs: number;
  completed_runs: number;
}

interface AutonomyMetricRow {
  avg_level: number | null;
}

interface AgentPolicyTemplate {
  mcpDomain: string;
  resourceType: string | null;
  classificationLevel: AbacClassificationLevel;
  permission: AbacPermission;
  priority: number;
}

export interface DepartmentRecord {
  id: string;
  name: string;
  description: string;
  iconKey: string;
  defaultAgentRoles: string[];
  requiredMcpDomains: string[];
  recommendedMcpDomains: string[];
  activationOrderHint: number;
  createdAt: string;
}

export interface AgentCatalogTemplate {
  id: string;
  departmentId: string;
  templateName: string;
  defaultRole: string;
  defaultCapacityTier: CapacityTier;
  defaultDisclosureLevel: DisclosureLevel;
  defaultAutonomyMaxLevel: number;
  defaultMcpDomains: string[];
  defaultAbacPolicies: AgentPolicyTemplate[];
  systemPromptTemplate: string;
  createdAt: string;
}

export interface DepartmentStats {
  completionRate: number;
  autonomyAverage: number;
}

export interface DepartmentSummary extends DepartmentRecord {
  status: DepartmentActivationStatus;
  activationId: string | null;
  activatedAt: string | null;
  activatedByHumanId: string | null;
  agentCount: number;
  estimatedSetupMinutes: number;
  requiredIntegrationsNotYetConnected: string[];
  agentsThatWillCollaborateWithExisting: string[];
  templatesCount: number;
  completionRate: number;
  autonomyAverage: number;
}

export interface DepartmentDetail extends DepartmentSummary {
  templates: AgentCatalogTemplate[];
  connectedMcpDomains: string[];
}

export interface ActivatedAgentRecord {
  role: string;
  displayName: string;
  title: string;
  templateId: string;
  templateName: string;
  capacityTier: CapacityTier;
  disclosureLevel: DisclosureLevel;
  autonomyLevel: number;
  mcpDomains: string[];
}

export interface ConnectedDepartmentRecord {
  departmentId: string;
  departmentName: string;
  coordinatorAgentRole: string | null;
  coordinatorAgentName: string | null;
}

export interface ExpansionRecommendation {
  departmentId: string;
  departmentName: string;
  whyRecommended: string;
  estimatedSetupMinutes: number;
  agentsThatWillCollaborateWithExisting: string[];
  requiredIntegrationsNotYetConnected: string[];
}

export interface ActivateDepartmentConfig {
  companyName: string;
  departmentLead: string;
  customAgentNames?: Record<string, string>;
  selectedMcpDomains: string[];
  activatedByHumanId?: string;
}

export interface ActivateDepartmentResult {
  activatedAgents: ActivatedAgentRecord[];
  connectedDepartments: ConnectedDepartmentRecord[];
  nextRecommendedDepartment: ExpansionRecommendation | null;
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return {};
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      return asStringArray(JSON.parse(value));
    } catch {
      return value.split(',').map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function asPolicyArray(value: unknown): AgentPolicyTemplate[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asObject(item))
    .map((item) => ({
      mcpDomain: typeof item.mcp_domain === 'string' ? item.mcp_domain : typeof item.mcpDomain === 'string' ? item.mcpDomain : '',
      resourceType: typeof item.resource_type === 'string' ? item.resource_type : typeof item.resourceType === 'string' ? item.resourceType : null,
      classificationLevel: normalizeClassificationLevel(item.classification_level ?? item.classificationLevel),
      permission: normalizePermission(item.permission),
      priority: typeof item.priority === 'number' ? item.priority : Number(item.priority ?? 100) || 100,
    }))
    .filter((item) => item.mcpDomain.length > 0);
}

function normalizePermission(value: unknown): AbacPermission {
  return value === 'deny' ? 'deny' : 'allow';
}

function normalizeClassificationLevel(value: unknown): AbacClassificationLevel {
  switch (value) {
    case 'public':
    case 'confidential':
    case 'restricted':
      return value;
    default:
      return 'internal';
  }
}

function toDepartmentRecord(row: DepartmentRow): DepartmentRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    iconKey: row.icon_key ?? 'department',
    defaultAgentRoles: asStringArray(row.default_agent_roles),
    requiredMcpDomains: asStringArray(row.required_mcp_domains),
    recommendedMcpDomains: asStringArray(row.recommended_mcp_domains),
    activationOrderHint: row.activation_order_hint,
    createdAt: row.created_at,
  };
}

function toTemplateRecord(row: AgentCatalogTemplateRow): AgentCatalogTemplate {
  return {
    id: row.id,
    departmentId: row.department_id,
    templateName: row.template_name,
    defaultRole: row.default_role,
    defaultCapacityTier: row.default_capacity_tier,
    defaultDisclosureLevel: row.default_disclosure_level,
    defaultAutonomyMaxLevel: row.default_autonomy_max_level,
    defaultMcpDomains: asStringArray(row.default_mcp_domains),
    defaultAbacPolicies: asPolicyArray(row.default_abac_policies),
    systemPromptTemplate: row.system_prompt_template,
    createdAt: row.created_at,
  };
}

function normalizeActivationStatus(status: string | null | undefined): DepartmentActivationStatus {
  if (status === 'configuring' || status === 'active' || status === 'paused' || status === 'available') return status;
  return 'available';
}

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function humanizeRole(role: string): string {
  return role
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function renderPromptTemplate(template: string, values: { companyName: string; department: string; agentName: string }): string {
  return template
    .replace(/\{\{company_name\}\}/g, values.companyName)
    .replace(/\{\{department\}\}/g, values.department)
    .replace(/\{\{agent_name\}\}/g, values.agentName);
}

function buildAvatarUrl(name: string): string {
  return `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(name)}&radius=50&bold=true`;
}

function estimateSetupMinutes(templatesCount: number, missingIntegrationsCount: number): number {
  return Math.max(12, templatesCount * 6 + missingIntegrationsCount * 5 + 6);
}

function pickCoordinatorTemplate(templates: AgentCatalogTemplate[]): AgentCatalogTemplate {
  const weighted = [...templates].sort((left, right) => scoreCoordinatorCandidate(right) - scoreCoordinatorCandidate(left));
  return weighted[0] ?? templates[0];
}

function scoreCoordinatorCandidate(template: AgentCatalogTemplate): number {
  const text = `${template.defaultRole} ${template.templateName}`.toLowerCase();
  if (/(chief|head|vp|director|lead|admin|officer)/.test(text)) return 100;
  if (/(manager|architect|engineer|analyst)/.test(text)) return 50;
  return 10;
}

function getActivationRoles(snapshot: unknown): string[] {
  const object = asObject(snapshot);
  return asStringArray(object.activatedAgentRoles);
}

function getActivationCoordinatorRole(snapshot: unknown): string | null {
  const object = asObject(snapshot);
  const value = object.coordinatorRole;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function getTenant(tenantId: string): Promise<TenantRow> {
  const [tenant] = await systemQuery<TenantRow>(
    'SELECT id, name, slug, settings FROM tenants WHERE id = $1 LIMIT 1',
    [tenantId],
  );
  if (!tenant) {
    throw new Error(`Tenant ${tenantId} not found.`);
  }
  return tenant;
}

async function getDepartmentRow(departmentId: string): Promise<DepartmentRow> {
  const [department] = await systemQuery<DepartmentRow>(
    `SELECT id, name, description, icon_key, default_agent_roles, required_mcp_domains,
            recommended_mcp_domains, activation_order_hint, created_at
     FROM departments
     WHERE id = $1
     LIMIT 1`,
    [departmentId],
  );
  if (!department) {
    throw new Error(`Department ${departmentId} not found.`);
  }
  return department;
}

async function getDepartmentTemplatesRaw(departmentId: string): Promise<AgentCatalogTemplateRow[]> {
  return systemQuery<AgentCatalogTemplateRow>(
    `SELECT id, department_id, template_name, default_role, default_capacity_tier,
            default_disclosure_level, default_autonomy_max_level, default_mcp_domains,
            default_abac_policies, system_prompt_template, created_at
     FROM agent_catalog_templates
     WHERE department_id = $1
     ORDER BY template_name ASC`,
    [departmentId],
  );
}

async function getConnectedMcpDomains(tenantId: string): Promise<string[]> {
  const tenant = await getTenant(tenantId);
  const settings = asObject(tenant.settings);
  const fromSettings = asStringArray(settings.connected_mcp_domains);
  return [...new Set(fromSettings.map((item) => item.toLowerCase()))];
}

async function listActivationRows(tenantId: string): Promise<DepartmentActivationRow[]> {
  return systemQuery<DepartmentActivationRow>(
    `SELECT id, tenant_id, department_id, status, activated_at, activated_by_human_id, agent_count, config_snapshot
     FROM department_activations
     WHERE tenant_id = $1`,
    [tenantId],
  );
}

async function getActivationRow(tenantId: string, departmentId: string): Promise<DepartmentActivationRow | null> {
  const [row] = await systemQuery<DepartmentActivationRow>(
    `SELECT id, tenant_id, department_id, status, activated_at, activated_by_human_id, agent_count, config_snapshot
     FROM department_activations
     WHERE tenant_id = $1 AND department_id = $2
     LIMIT 1`,
    [tenantId, departmentId],
  );
  return row ?? null;
}

async function getAgentNames(agentRoles: string[]): Promise<Map<string, string>> {
  if (agentRoles.length === 0) return new Map();
  const rows = await systemQuery<{ role: string; display_name: string | null; name: string | null }>(
    `SELECT role, display_name, name
     FROM company_agents
     WHERE role = ANY($1::text[])`,
    [agentRoles],
  );
  return new Map(rows.map((row) => [row.role, row.display_name?.trim() || row.name?.trim() || row.role]));
}

async function computeDepartmentStats(agentRoles: string[]): Promise<DepartmentStats> {
  if (agentRoles.length === 0) {
    return { completionRate: 0, autonomyAverage: 0 };
  }

  const [runMetrics] = await systemQuery<AgentRunMetricRow>(
    `SELECT COUNT(*)::int AS total_runs,
            COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_runs
     FROM agent_runs
     WHERE tenant_id = $1
       AND agent_id = ANY($2::text[])
       AND started_at >= NOW() - INTERVAL '30 days'`,
    [DEFAULT_TENANT_ID, agentRoles],
  );

  const [autonomyMetrics] = await systemQuery<AutonomyMetricRow>(
    `SELECT AVG(current_level)::float AS avg_level
     FROM agent_autonomy_config
     WHERE agent_id = ANY($1::text[])`,
    [agentRoles],
  );

  const totalRuns = runMetrics?.total_runs ?? 0;
  const completedRuns = runMetrics?.completed_runs ?? 0;

  return {
    completionRate: totalRuns > 0 ? Number((completedRuns / totalRuns).toFixed(4)) : 0,
    autonomyAverage: Number((autonomyMetrics?.avg_level ?? 0).toFixed(2)),
  };
}

async function buildConnectedDepartmentRecords(tenantId: string, excludeDepartmentId?: string): Promise<ConnectedDepartmentRecord[]> {
  const rows = await systemQuery<DepartmentActivationRow & { department_name: string }>(
    `SELECT da.id, da.tenant_id, da.department_id, da.status, da.activated_at, da.activated_by_human_id,
            da.agent_count, da.config_snapshot, d.name AS department_name
     FROM department_activations da
     JOIN departments d ON d.id = da.department_id
     WHERE da.tenant_id = $1
       AND da.status = 'active'
       AND ($2::uuid IS NULL OR da.department_id <> $2)
     ORDER BY d.activation_order_hint ASC, d.name ASC`,
    [tenantId, excludeDepartmentId ?? null],
  );

  const coordinatorRoles = rows.map((row) => getActivationCoordinatorRole(row.config_snapshot)).filter((value): value is string => Boolean(value));
  const names = await getAgentNames(coordinatorRoles);

  return rows.map((row) => {
    const coordinatorAgentRole = getActivationCoordinatorRole(row.config_snapshot);
    return {
      departmentId: row.department_id,
      departmentName: row.department_name,
      coordinatorAgentRole,
      coordinatorAgentName: coordinatorAgentRole ? names.get(coordinatorAgentRole) ?? coordinatorAgentRole : null,
    };
  });
}

async function allocateUniqueRole(db: PoolClient, tenantSlug: string, departmentName: string, logicalRole: string, ordinal: number): Promise<string> {
  const base = [tenantSlug, departmentName, logicalRole, ordinal > 1 ? String(ordinal) : '']
    .map((part) => slugify(part))
    .filter(Boolean)
    .join('--');

  let candidate = base;
  let suffix = 2;
  while (true) {
    const existing = await db.query<{ role: string }>('SELECT role FROM company_agents WHERE role = $1 LIMIT 1', [candidate]);
    if ((existing.rowCount ?? 0) === 0) return candidate;
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
}

async function ensureAgentRoleRecord(db: PoolClient, roleName: string, description: string): Promise<string> {
  await db.query(
    `INSERT INTO agent_roles (name, description)
     VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description`,
    [roleName, description],
  );
  const result = await db.query<{ id: string }>('SELECT id FROM agent_roles WHERE name = $1 LIMIT 1', [roleName]);
  const id = result.rows[0]?.id;
  if (!id) throw new Error(`Failed to resolve agent role record for ${roleName}`);
  return id;
}

async function upsertCapacityConfig(db: PoolClient, agentId: string, capacityTier: CapacityTier, updatedBy: string, metadata: Record<string, unknown>): Promise<void> {
  await db.query(
    `INSERT INTO agent_capacity_config (agent_id, capacity_tier, requires_human_approval_for, override_by_roles, updated_at, updated_by, metadata)
     VALUES ($1, $2, '[]'::jsonb, '[]'::jsonb, NOW(), $3, $4::jsonb)
     ON CONFLICT (agent_id) DO UPDATE SET
       capacity_tier = EXCLUDED.capacity_tier,
       updated_at = NOW(),
       updated_by = EXCLUDED.updated_by,
       metadata = EXCLUDED.metadata`,
    [agentId, capacityTier, updatedBy, JSON.stringify(metadata)],
  );
}

async function upsertDisclosureConfig(db: PoolClient, agentId: string, disclosureLevel: DisclosureLevel): Promise<void> {
  await db.query(
    `INSERT INTO agent_disclosure_config (agent_id, disclosure_level, email_signature_template, display_name_suffix, external_commitment_gate, updated_at)
     VALUES ($1, $2, $3, ' (AI)', true, NOW())
     ON CONFLICT (agent_id) DO UPDATE SET
       disclosure_level = EXCLUDED.disclosure_level,
       updated_at = NOW()`,
    [
      agentId,
      disclosureLevel,
      'This message was composed by {{agent_name}} ({{agent_role}}), an AI assistant operating on behalf of {{company_name}} using Glyphor\'s Autonomous Development Teams platform.',
    ],
  );
}

async function upsertAutonomyConfig(db: PoolClient, tenantId: string, agentId: string, maxAllowedLevel: number): Promise<void> {
  const bounded = Math.max(0, Math.min(4, Math.trunc(maxAllowedLevel)));
  await db.query(
    `INSERT INTO agent_autonomy_config (
       agent_id, current_level, max_allowed_level, auto_promote, auto_demote,
       promoted_at, last_level_change_at, last_level_change_reason, metadata, tenant_id, created_at, updated_at
     )
     VALUES ($1, 0, $2, true, true, NULL, NOW(), 'Department activation defaulted to level 0', '{}'::jsonb, $3, NOW(), NOW())
     ON CONFLICT (agent_id) DO UPDATE SET
       current_level = 0,
       max_allowed_level = EXCLUDED.max_allowed_level,
       auto_promote = true,
       auto_demote = true,
       last_level_change_at = NOW(),
       last_level_change_reason = EXCLUDED.last_level_change_reason,
       tenant_id = EXCLUDED.tenant_id,
       updated_at = NOW()`,
    [agentId, bounded, tenantId],
  );
}

function buildFallbackPolicies(domains: string[]): AgentPolicyTemplate[] {
  return domains.map((domain, index) => ({
    mcpDomain: domain,
    resourceType: null,
    classificationLevel: 'internal',
    permission: 'allow',
    priority: 100 - index,
  }));
}

async function replaceAbacPolicies(db: PoolClient, agentRoleId: string, policies: AgentPolicyTemplate[]): Promise<void> {
  await db.query('DELETE FROM abac_policies WHERE agent_role_id = $1', [agentRoleId]);

  for (const policy of policies) {
    await db.query(
      `INSERT INTO abac_policies (agent_role_id, mcp_domain, resource_type, classification_level, permission, priority, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
      [
        agentRoleId,
        policy.mcpDomain,
        policy.resourceType,
        policy.classificationLevel,
        policy.permission,
        policy.priority,
      ],
    );
  }
}

async function insertHandoffContract(
  db: PoolClient,
  sourceRole: string,
  sourceName: string,
  targetRole: string,
  targetName: string,
  taskId: string,
  taskDescription: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const existing = await db.query<{ id: string }>(
    `SELECT id
     FROM agent_handoff_contracts
     WHERE task_id = $1 AND requesting_agent_id = $2 AND receiving_agent_id = $3
     LIMIT 1`,
    [taskId, sourceRole, targetRole],
  );
  if ((existing.rowCount ?? 0) > 0) return;

  await db.query(
    `INSERT INTO agent_handoff_contracts (
       requesting_agent_id, requesting_agent_name, receiving_agent_id, receiving_agent_name,
       task_id, task_description, required_inputs, expected_output_schema,
       confidence_threshold, escalation_policy, status, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, 0.7, 'return_to_issuer', 'accepted', NOW())`,
    [
      sourceRole,
      sourceName,
      targetRole,
      targetName,
      taskId,
      taskDescription,
      JSON.stringify([
        { key: 'activation_context', type: 'object', provided: true, metadata },
        { key: 'department_goal', type: 'string', provided: true },
      ]),
      JSON.stringify({
        type: 'object',
        template: true,
        metadata,
        required: ['summary'],
        properties: {
          summary: { type: 'string' },
          next_steps: { type: 'array', items: { type: 'string' } },
        },
      }),
    ],
  );
}

async function createDepartmentHandoffs(
  db: PoolClient,
  tenantId: string,
  department: DepartmentRecord,
  coordinator: ActivatedAgentRecord,
  agents: ActivatedAgentRecord[],
  connectedDepartments: ConnectedDepartmentRecord[],
): Promise<void> {
  for (const agent of agents) {
    if (agent.role === coordinator.role) continue;
    await insertHandoffContract(
      db,
      coordinator.role,
      coordinator.displayName,
      agent.role,
      agent.displayName,
      `department-activation:${tenantId}:${department.id}:internal:${coordinator.role}:${agent.role}`,
      `Default ${department.name} department collaboration path from ${coordinator.displayName} to ${agent.displayName}.`,
      { tenantId, departmentId: department.id, type: 'intra_department', sourceDepartment: department.name },
    );

    await insertHandoffContract(
      db,
      agent.role,
      agent.displayName,
      coordinator.role,
      coordinator.displayName,
      `department-activation:${tenantId}:${department.id}:internal:${agent.role}:${coordinator.role}`,
      `Default ${department.name} department escalation path from ${agent.displayName} to ${coordinator.displayName}.`,
      { tenantId, departmentId: department.id, type: 'intra_department', sourceDepartment: department.name },
    );
  }

  for (const connectedDepartment of connectedDepartments) {
    if (!connectedDepartment.coordinatorAgentRole || !connectedDepartment.coordinatorAgentName) continue;
    await insertHandoffContract(
      db,
      coordinator.role,
      coordinator.displayName,
      connectedDepartment.coordinatorAgentRole,
      connectedDepartment.coordinatorAgentName,
      `department-activation:${tenantId}:${department.id}:cross:${coordinator.role}:${connectedDepartment.coordinatorAgentRole}`,
      `Cross-department collaboration path from ${department.name} to ${connectedDepartment.departmentName}.`,
      {
        tenantId,
        departmentId: department.id,
        connectedDepartmentId: connectedDepartment.departmentId,
        type: 'cross_department',
      },
    );

    await insertHandoffContract(
      db,
      connectedDepartment.coordinatorAgentRole,
      connectedDepartment.coordinatorAgentName,
      coordinator.role,
      coordinator.displayName,
      `department-activation:${tenantId}:${department.id}:cross:${connectedDepartment.coordinatorAgentRole}:${coordinator.role}`,
      `Cross-department collaboration path from ${connectedDepartment.departmentName} to ${department.name}.`,
      {
        tenantId,
        departmentId: department.id,
        connectedDepartmentId: connectedDepartment.departmentId,
        type: 'cross_department',
      },
    );
  }
}

async function mergeConnectedDomains(db: PoolClient, tenantId: string, selectedMcpDomains: string[]): Promise<void> {
  const current = await db.query<{ settings: unknown }>('SELECT settings FROM tenants WHERE id = $1 LIMIT 1', [tenantId]);
  const settings = asObject(current.rows[0]?.settings);
  const merged = [...new Set([...asStringArray(settings.connected_mcp_domains), ...selectedMcpDomains].map((item) => item.toLowerCase()))];
  settings.connected_mcp_domains = merged;
  settings.last_department_activation_at = new Date().toISOString();
  await db.query('UPDATE tenants SET settings = $2::jsonb, updated_at = NOW() WHERE id = $1', [tenantId, JSON.stringify(settings)]);
}

function getAgentNameOverride(config: ActivateDepartmentConfig, template: AgentCatalogTemplate): string | null {
  const candidates = [template.id, template.defaultRole, template.templateName];
  for (const key of candidates) {
    const value = config.customAgentNames?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function buildActivationWhyRecommended(activeDepartmentNames: string[], averageCompletion: number, department: DepartmentRecord): string {
  if (activeDepartmentNames.length === 0) {
    return `${department.name} is the strongest starting point because it sits earliest in the recommended onboarding sequence.`;
  }
  if (averageCompletion >= 0.8) {
    return `${activeDepartmentNames.join(', ')} are operating cleanly, so ${department.name} is the next expansion step in the onboarding sequence.`;
  }
  return `${department.name} is recommended next because your active departments still need tighter operational support while you expand in sequence.`;
}

export async function listDepartmentTemplates(departmentId: string): Promise<AgentCatalogTemplate[]> {
  const rows = await getDepartmentTemplatesRaw(departmentId);
  return rows.map(toTemplateRecord);
}

export async function listDepartmentsWithStatus(tenantId: string): Promise<DepartmentSummary[]> {
  const [departmentRows, activationRows, connectedDomains, recommendations, activeConnections] = await Promise.all([
    systemQuery<DepartmentRow>(
      `SELECT id, name, description, icon_key, default_agent_roles, required_mcp_domains,
              recommended_mcp_domains, activation_order_hint, created_at
       FROM departments
       ORDER BY activation_order_hint ASC, name ASC`,
    ),
    listActivationRows(tenantId),
    getConnectedMcpDomains(tenantId),
    getExpansionRecommendations(tenantId),
    buildConnectedDepartmentRecords(tenantId),
  ]);

  const activationByDepartment = new Map(activationRows.map((row) => [row.department_id, row]));
  const recommendedSet = new Set(recommendations.map((item) => item.departmentId));

  const summaries: DepartmentSummary[] = [];
  for (const row of departmentRows) {
    const department = toDepartmentRecord(row);
    const activation = activationByDepartment.get(row.id);
    const templates = await listDepartmentTemplates(row.id);
    const stats = await computeDepartmentStats(getActivationRoles(activation?.config_snapshot));
    const requiredIntegrationsNotYetConnected = department.requiredMcpDomains.filter((domain) => !connectedDomains.includes(domain.toLowerCase()));
    const collaborationAgents = recommendedSet.has(department.id)
      ? activeConnections.map((item) => item.coordinatorAgentName).filter((value): value is string => Boolean(value)).slice(0, 4)
      : [];

    summaries.push({
      ...department,
      status: normalizeActivationStatus(activation?.status),
      activationId: activation?.id ?? null,
      activatedAt: activation?.activated_at ?? null,
      activatedByHumanId: activation?.activated_by_human_id ?? null,
      agentCount: activation?.agent_count ?? templates.length,
      estimatedSetupMinutes: estimateSetupMinutes(templates.length, requiredIntegrationsNotYetConnected.length),
      requiredIntegrationsNotYetConnected,
      agentsThatWillCollaborateWithExisting: collaborationAgents,
      templatesCount: templates.length,
      completionRate: stats.completionRate,
      autonomyAverage: stats.autonomyAverage,
    });
  }

  return summaries;
}

export async function getDepartmentDetail(tenantId: string, departmentId: string): Promise<DepartmentDetail> {
  const [departmentRow, activation, templates, connectedDomains, activeConnections] = await Promise.all([
    getDepartmentRow(departmentId),
    getActivationRow(tenantId, departmentId),
    listDepartmentTemplates(departmentId),
    getConnectedMcpDomains(tenantId),
    buildConnectedDepartmentRecords(tenantId, departmentId),
  ]);

  const department = toDepartmentRecord(departmentRow);
  const requiredIntegrationsNotYetConnected = department.requiredMcpDomains.filter((domain) => !connectedDomains.includes(domain.toLowerCase()));
  const stats = await computeDepartmentStats(getActivationRoles(activation?.config_snapshot));

  return {
    ...department,
    status: normalizeActivationStatus(activation?.status),
    activationId: activation?.id ?? null,
    activatedAt: activation?.activated_at ?? null,
    activatedByHumanId: activation?.activated_by_human_id ?? null,
    agentCount: activation?.agent_count ?? templates.length,
    estimatedSetupMinutes: estimateSetupMinutes(templates.length, requiredIntegrationsNotYetConnected.length),
    requiredIntegrationsNotYetConnected,
    agentsThatWillCollaborateWithExisting: activeConnections.map((item) => item.coordinatorAgentName).filter((value): value is string => Boolean(value)).slice(0, 5),
    templatesCount: templates.length,
    completionRate: stats.completionRate,
    autonomyAverage: stats.autonomyAverage,
    templates,
    connectedMcpDomains: connectedDomains,
  };
}

export async function listActiveDepartments(tenantId: string): Promise<DepartmentSummary[]> {
  const rows = await listDepartmentsWithStatus(tenantId);
  return rows.filter((row) => row.status === 'active');
}

export async function pauseDepartment(tenantId: string, departmentId: string, updatedBy = 'admin'): Promise<DepartmentDetail> {
  const activation = await getActivationRow(tenantId, departmentId);
  if (!activation || activation.status !== 'active') {
    throw new Error('Department is not active for this tenant.');
  }

  const roles = getActivationRoles(activation.config_snapshot);

  await systemTransaction(async (db) => {
    for (const role of roles) {
      await upsertCapacityConfig(db, role, 'observe', updatedBy, {
        pausedFromDepartmentActivation: true,
        departmentId,
      });
    }

    await db.query(
      `UPDATE tenant_agents
       SET is_active = false
       WHERE tenant_id = $1 AND agent_role = ANY($2::text[])`,
      [tenantId, roles],
    );

    await db.query(
      `UPDATE company_agents
       SET status = 'paused', updated_at = NOW()
       WHERE tenant_id = $1 AND role = ANY($2::text[])`,
      [tenantId, roles],
    );

    await db.query(
      `UPDATE department_activations
       SET status = 'paused', activated_by_human_id = COALESCE(activated_by_human_id, $3)
       WHERE tenant_id = $1 AND department_id = $2`,
      [tenantId, departmentId, updatedBy],
    );
  });

  return getDepartmentDetail(tenantId, departmentId);
}

export async function getExpansionRecommendations(tenantId: string): Promise<ExpansionRecommendation[]> {
  const [allDepartments, activeDepartments, connectedDomains] = await Promise.all([
    listDepartmentsWithStatus(tenantId),
    listActiveDepartments(tenantId),
    getConnectedMcpDomains(tenantId),
  ]);

  const availableDepartments = allDepartments.filter((item) => item.status !== 'active');
  if (availableDepartments.length === 0) return [];

  const activeOrderMax = activeDepartments.reduce((max, item) => Math.max(max, item.activationOrderHint), 0);
  const activeDepartmentNames = activeDepartments.map((item) => item.name);
  const averageCompletion = activeDepartments.length > 0
    ? activeDepartments.reduce((sum, item) => sum + item.completionRate, 0) / activeDepartments.length
    : 0;
  const collaborationAgents = activeDepartments.flatMap((item) => item.agentsThatWillCollaborateWithExisting);

  const scored = availableDepartments.map((department) => {
    const orderDistance = activeOrderMax > 0
      ? Math.max(0, department.activationOrderHint - activeOrderMax)
      : department.activationOrderHint;
    const missingCount = department.requiredMcpDomains.filter((domain) => !connectedDomains.includes(domain.toLowerCase())).length;
    const score = (1000 - orderDistance * 10) - missingCount * 8 + Math.round(averageCompletion * 20);
    return {
      department,
      missingCount,
      score,
    };
  }).sort((left, right) => right.score - left.score || left.department.activationOrderHint - right.department.activationOrderHint);

  return scored.slice(0, 2).map(({ department }) => ({
    departmentId: department.id,
    departmentName: department.name,
    whyRecommended: buildActivationWhyRecommended(activeDepartmentNames, averageCompletion, department),
    estimatedSetupMinutes: department.estimatedSetupMinutes,
    agentsThatWillCollaborateWithExisting: department.agentsThatWillCollaborateWithExisting.length > 0
      ? department.agentsThatWillCollaborateWithExisting
      : collaborationAgents.slice(0, 4),
    requiredIntegrationsNotYetConnected: department.requiredMcpDomains.filter((domain) => !connectedDomains.includes(domain.toLowerCase())),
  }));
}

export async function activateDepartment(orgId: string, departmentId: string, config: ActivateDepartmentConfig): Promise<ActivateDepartmentResult> {
  const tenant = await getTenant(orgId);
  const department = toDepartmentRecord(await getDepartmentRow(departmentId));
  const templates = await listDepartmentTemplates(departmentId);
  if (templates.length === 0) {
    throw new Error(`Department ${department.name} has no agent catalog templates.`);
  }

  const existingActivation = await getActivationRow(orgId, departmentId);
  if (existingActivation?.status === 'active') {
    throw new Error(`${department.name} is already active for this tenant.`);
  }

  const selectedMcpDomains = [...new Set(config.selectedMcpDomains.map((item) => item.trim().toLowerCase()).filter(Boolean))];
  const missingRequiredDomains = department.requiredMcpDomains.filter((domain) => !selectedMcpDomains.includes(domain.toLowerCase()));
  if (missingRequiredDomains.length > 0) {
    throw new Error(`Missing required MCP domains: ${missingRequiredDomains.join(', ')}`);
  }

  const connectedDepartments = await buildConnectedDepartmentRecords(orgId, departmentId);
  const coordinatorTemplate = pickCoordinatorTemplate(templates);
  const now = new Date().toISOString();
  const activatedAgents: ActivatedAgentRecord[] = [];

  await systemTransaction(async (db) => {
    await db.query(
      `INSERT INTO department_activations (tenant_id, department_id, status, activated_at, activated_by_human_id, agent_count, config_snapshot)
       VALUES ($1, $2, 'configuring', NULL, $3, 0, $4::jsonb)
       ON CONFLICT (tenant_id, department_id) DO UPDATE SET
         status = 'configuring',
         activated_by_human_id = EXCLUDED.activated_by_human_id,
         config_snapshot = EXCLUDED.config_snapshot`,
      [
        orgId,
        departmentId,
        config.activatedByHumanId ?? config.departmentLead,
        JSON.stringify({
          companyName: config.companyName,
          departmentLead: config.departmentLead,
          selectedMcpDomains,
          startedAt: now,
        }),
      ],
    );

    const roleOrdinals = new Map<string, number>();

    for (const template of templates) {
      const currentOrdinal = (roleOrdinals.get(template.defaultRole) ?? 0) + 1;
      roleOrdinals.set(template.defaultRole, currentOrdinal);

      const displayName = getAgentNameOverride(config, template) ?? `${config.companyName} ${template.templateName}`;
      const agentRole = await allocateUniqueRole(db, tenant.slug, department.name, template.defaultRole, currentOrdinal);
      const title = template.templateName;
      const prompt = renderPromptTemplate(template.systemPromptTemplate, {
        companyName: config.companyName,
        department: department.name,
        agentName: displayName,
      });
      const mcpDomains = [...new Set([...template.defaultMcpDomains.map((item) => item.toLowerCase()), ...selectedMcpDomains])];

      await db.query(
        `INSERT INTO company_agents (
           role, display_name, name, title, department, reports_to, status, model,
           temperature, max_turns, budget_per_run, budget_daily, budget_monthly,
           is_temporary, is_core, created_by, created_at, updated_at, tenant_id,
           created_via, authority_scope
         )
         VALUES (
           $1, $2, $2, $3, $4, NULL, 'active', $5,
           0.3, 10, 0.10, 1.00, 20.00,
           false, false, $6, NOW(), NOW(), $7,
           'internal', 'green'
         )`,
        [agentRole, displayName, title, department.name, DEFAULT_MODEL, `department_activation:${department.id}`, orgId],
      );

      await db.query(
        `INSERT INTO agent_briefs (agent_id, system_prompt, skills, tools, updated_at, tenant_id)
         VALUES ($1, $2, $3, $4, NOW(), $5)
         ON CONFLICT (agent_id) DO UPDATE SET
           system_prompt = EXCLUDED.system_prompt,
           skills = EXCLUDED.skills,
           tools = EXCLUDED.tools,
           updated_at = EXCLUDED.updated_at,
           tenant_id = EXCLUDED.tenant_id`,
        [agentRole, prompt, JSON.stringify([]), JSON.stringify([]), orgId],
      );

      await db.query(
        `INSERT INTO agent_profiles (
           agent_id, personality_summary, backstory, communication_traits, quirks,
           tone_formality, emoji_usage, verbosity, working_style, avatar_url,
           updated_at, tenant_id
         )
         VALUES ($1, $2, $3, $4, $5, 0.6, 0.05, 0.45, $6, $7, NOW(), $8)
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
          agentRole,
          `${displayName} is Glyphor's ${title} for ${config.companyName}, focused on ${department.name} execution with clear communication and explicit escalation when uncertain.`,
          `Provisioned during ${department.name} activation for ${config.companyName}. ${displayName} collaborates with ${config.departmentLead} and other active Glyphor departments.`,
          JSON.stringify(['clear', 'structured', 'collaborative']),
          JSON.stringify(['summarizes key decisions before details']),
          department.name.toLowerCase().includes('operations') ? 'operationally precise' : 'outcome-driven',
          buildAvatarUrl(displayName),
          orgId,
        ],
      );

      await db.query(
        `INSERT INTO tenant_agents (
           tenant_id, agent_role, display_name, title, model_tier, brief_template,
           brief_compiled, is_active, config, created_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8::jsonb, NOW())
         ON CONFLICT (tenant_id, agent_role) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           title = EXCLUDED.title,
           model_tier = EXCLUDED.model_tier,
           brief_template = EXCLUDED.brief_template,
           brief_compiled = EXCLUDED.brief_compiled,
           is_active = EXCLUDED.is_active,
           config = EXCLUDED.config`,
        [
          orgId,
          agentRole,
          displayName,
          title,
          'default',
          template.systemPromptTemplate,
          prompt,
          JSON.stringify({
            departmentId,
            departmentName: department.name,
            templateId: template.id,
            templateName: template.templateName,
            logicalRole: template.defaultRole,
            mcpDomains,
          }),
        ],
      );

      const agentRoleId = await ensureAgentRoleRecord(db, agentRole, `${title} role for tenant ${tenant.name}`);
      const policies = template.defaultAbacPolicies.length > 0 ? template.defaultAbacPolicies : buildFallbackPolicies(mcpDomains);
      await replaceAbacPolicies(db, agentRoleId, policies);
      await upsertCapacityConfig(db, agentRole, template.defaultCapacityTier, config.activatedByHumanId ?? config.departmentLead, {
        templateId: template.id,
        departmentId,
      });
      await upsertDisclosureConfig(db, agentRole, template.defaultDisclosureLevel);
      await upsertAutonomyConfig(db, orgId, agentRole, template.defaultAutonomyMaxLevel);

      activatedAgents.push({
        role: agentRole,
        displayName,
        title,
        templateId: template.id,
        templateName: template.templateName,
        capacityTier: template.defaultCapacityTier,
        disclosureLevel: template.defaultDisclosureLevel,
        autonomyLevel: 0,
        mcpDomains,
      });
    }

    const coordinator = activatedAgents.find((item) => item.templateId === coordinatorTemplate.id) ?? activatedAgents[0];

    await createDepartmentHandoffs(db, orgId, department, coordinator, activatedAgents, connectedDepartments);
    await mergeConnectedDomains(db, orgId, selectedMcpDomains);

    await db.query(
      `UPDATE department_activations
       SET status = 'active',
           activated_at = NOW(),
           activated_by_human_id = $3,
           agent_count = $4,
           config_snapshot = $5::jsonb
       WHERE tenant_id = $1 AND department_id = $2`,
      [
        orgId,
        departmentId,
        config.activatedByHumanId ?? config.departmentLead,
        activatedAgents.length,
        JSON.stringify({
          companyName: config.companyName,
          departmentLead: config.departmentLead,
          selectedMcpDomains,
          activatedAt: now,
          activatedAgentRoles: activatedAgents.map((item) => item.role),
          coordinatorRole: coordinator.role,
          templateIds: activatedAgents.map((item) => item.templateId),
          connectedDepartmentIds: connectedDepartments.map((item) => item.departmentId),
          customAgentNames: config.customAgentNames ?? {},
        }),
      ],
    );
  });

  const recommendations = await getExpansionRecommendations(orgId);

  return {
    activatedAgents,
    connectedDepartments,
    nextRecommendedDepartment: recommendations.find((item) => item.departmentId !== departmentId) ?? recommendations[0] ?? null,
  };
}