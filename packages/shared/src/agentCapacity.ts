import { systemQuery, systemTransaction } from './db.js';

export type CapacityTier = 'observe' | 'draft' | 'execute' | 'commit';
export type CommitmentRegistryStatus = 'pending_approval' | 'approved' | 'rejected' | 'executed' | 'reversed';

export interface CapacityConfigRecord {
  id: string;
  agent_id: string;
  capacity_tier: CapacityTier;
  requires_human_approval_for: unknown;
  override_by_roles: unknown;
  updated_at: string;
  updated_by: string;
  metadata: Record<string, unknown> | null;
}

export interface AgentCapacityConfig {
  id: string;
  agentId: string;
  capacityTier: CapacityTier;
  requiresHumanApprovalFor: string[];
  overrideByRoles: string[];
  updatedAt: string;
  updatedBy: string;
  metadata: Record<string, unknown>;
}

export interface CommitmentRegistryRecord {
  id: string;
  agent_id: string;
  agent_name: string;
  action_type: string;
  action_description: string;
  external_counterparty: string | null;
  commitment_value: string | null;
  tool_called: string;
  tool_input: unknown;
  approved_by_human_id: string | null;
  approved_at: string | null;
  auto_approved: boolean;
  status: CommitmentRegistryStatus;
  created_at: string;
  executed_at: string | null;
  metadata: Record<string, unknown> | null;
}

export interface CommitmentRegistryEntry {
  id: string;
  agentId: string;
  agentName: string;
  actionType: string;
  actionDescription: string;
  externalCounterparty: string | null;
  commitmentValue: string | null;
  toolCalled: string;
  toolInput: Record<string, unknown>;
  approvedByHumanId: string | null;
  approvedAt: string | null;
  autoApproved: boolean;
  status: CommitmentRegistryStatus;
  createdAt: string;
  executedAt: string | null;
  metadata: Record<string, unknown>;
}

export interface CapacityEnforcementAction {
  type: string;
  toolCall: string | { name: string; input?: Record<string, unknown> };
  externalCounterparty?: string | null;
  estimatedValue?: string | number | null;
  requiresExternalCommitment?: boolean;
  actionDescription?: string;
  metadata?: Record<string, unknown>;
}

export interface CapacityEnforcementResult {
  proceed: boolean;
  requiresApproval: boolean;
  reason: string;
  registryEntryId: string | null;
}

export interface CommitmentApprovalContext {
  approvedByHumanId?: string | null;
  autoApproved?: boolean;
  status?: CommitmentRegistryStatus;
  metadata?: Record<string, unknown>;
}

export interface CommitmentListFilters {
  agentId?: string;
  status?: CommitmentRegistryStatus;
  dateFrom?: string;
  dateTo?: string;
  counterparty?: string;
  page?: number;
  pageSize?: number;
}

export interface CommitmentListResult {
  page: number;
  pageSize: number;
  total: number;
  items: CommitmentRegistryEntry[];
}

export interface UpsertAgentCapacityInput {
  capacityTier: CapacityTier;
  requiresHumanApprovalFor?: string[];
  overrideByRoles?: string[];
  updatedBy: string;
  metadata?: Record<string, unknown>;
}

const DEFAULT_COMMIT_THRESHOLD_USD_RAW = Number.parseFloat(process.env.AGENT_COMMIT_APPROVAL_THRESHOLD_USD ?? '5000');
const DEFAULT_COMMIT_THRESHOLD_USD = Number.isFinite(DEFAULT_COMMIT_THRESHOLD_USD_RAW)
  ? DEFAULT_COMMIT_THRESHOLD_USD_RAW
  : 5000;

const READ_ONLY_PREFIXES = ['get_', 'read_', 'list_', 'search_', 'fetch_', 'query_', 'check_', 'discover_', 'inspect_', 'monitor_', 'analyze_', 'calculate_', 'summarize_', 'draft_', 'plan_', 'review_', 'recall_'];
const EXTERNAL_SEND_PREFIXES = ['send_', 'post_', 'publish_', 'announce_', 'share_', 'notify_', 'schedule_'];
const API_COMMIT_PREFIXES = ['deploy_', 'merge_', 'delete_', 'remove_', 'pause_', 'resume_', 'run_migration', 'invoke_web_'];
const PAYMENT_PREFIXES = ['pay_', 'charge_', 'invoice_', 'purchase_'];

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    try {
      return normalizeStringList(JSON.parse(value));
    } catch {
      return value.split(',').map((item) => item.trim()).filter(Boolean);
    }
  }

  return [];
}

function normalizeObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function normalizeCapacityConfig(row: CapacityConfigRecord): AgentCapacityConfig {
  return {
    id: row.id,
    agentId: row.agent_id,
    capacityTier: row.capacity_tier,
    requiresHumanApprovalFor: normalizeStringList(row.requires_human_approval_for),
    overrideByRoles: normalizeStringList(row.override_by_roles),
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    metadata: normalizeObject(row.metadata),
  };
}

function normalizeCommitmentEntry(row: CommitmentRegistryRecord): CommitmentRegistryEntry {
  return {
    id: row.id,
    agentId: row.agent_id,
    agentName: row.agent_name,
    actionType: row.action_type,
    actionDescription: row.action_description,
    externalCounterparty: row.external_counterparty,
    commitmentValue: row.commitment_value,
    toolCalled: row.tool_called,
    toolInput: normalizeObject(row.tool_input),
    approvedByHumanId: row.approved_by_human_id,
    approvedAt: row.approved_at,
    autoApproved: row.auto_approved,
    status: row.status,
    createdAt: row.created_at,
    executedAt: row.executed_at,
    metadata: normalizeObject(row.metadata),
  };
}

function matchesPrefix(value: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => value.startsWith(prefix));
}

function extractToolName(action: CapacityEnforcementAction): string {
  return typeof action.toolCall === 'string' ? action.toolCall : action.toolCall.name;
}

function extractToolInput(action: CapacityEnforcementAction): Record<string, unknown> {
  if (typeof action.toolCall === 'string') return {};
  return action.toolCall.input ?? {};
}

function parseCommitValue(value: string | number | null | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const normalized = value.replace(/[^0-9.-]/g, '');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function deriveActionTraits(action: CapacityEnforcementAction): {
  toolName: string;
  toolInput: Record<string, unknown>;
  readOnly: boolean;
  externalSend: boolean;
  apiCommit: boolean;
  paymentCall: boolean;
  externalCommitment: boolean;
  shouldLogCommitment: boolean;
} {
  const toolName = extractToolName(action).toLowerCase();
  const toolInput = extractToolInput(action);
  const readOnly = matchesPrefix(toolName, READ_ONLY_PREFIXES);
  const externalSend = matchesPrefix(toolName, EXTERNAL_SEND_PREFIXES);
  const apiCommit = matchesPrefix(toolName, API_COMMIT_PREFIXES)
    || ['create_branch', 'create_github_pr', 'merge_github_pr', 'create_github_issue', 'apply_patch_call'].includes(toolName);
  const paymentCall = matchesPrefix(toolName, PAYMENT_PREFIXES)
    || ['vendor_payment', 'record_payment', 'send_invoice'].includes(toolName);
  const externalCommitment = Boolean(action.requiresExternalCommitment)
    || Boolean(action.externalCounterparty)
    || paymentCall
    || externalSend
    || apiCommit;
  const shouldLogCommitment = externalCommitment || paymentCall || apiCommit;

  return {
    toolName,
    toolInput,
    readOnly,
    externalSend,
    apiCommit,
    paymentCall,
    externalCommitment,
    shouldLogCommitment,
  };
}

async function resolveAgentName(agentId: string): Promise<string> {
  const rows = await systemQuery<{ agent_name: string }>(
    `SELECT COALESCE(NULLIF(TRIM(display_name), ''), NULLIF(TRIM(name), ''), role) AS agent_name
     FROM company_agents
     WHERE role = $1 OR id::text = $1
     LIMIT 1`,
    [agentId],
  );
  return rows[0]?.agent_name ?? agentId;
}

async function ensureAgentCapacityConfig(agentId: string): Promise<void> {
  const existing = await systemQuery<{ id: string }>('SELECT id FROM agent_capacity_config WHERE agent_id = $1 LIMIT 1', [agentId]);
  if (existing.length > 0) return;

  const inserted = await systemQuery(
    `INSERT INTO agent_capacity_config (
       agent_id,
       capacity_tier,
       requires_human_approval_for,
       override_by_roles,
       updated_at,
       updated_by,
       metadata
     )
     SELECT
       a.role,
       COALESCE(d.capacity_tier, 'execute'::agent_capacity_tier),
       COALESCE(d.requires_human_approval_for, '[]'::jsonb),
       COALESCE(d.override_by_roles, '[]'::jsonb),
       NOW(),
       COALESCE(a.created_by, 'system'),
       jsonb_strip_nulls(jsonb_build_object(
         'role_category', d.role_category,
         'commit_value_threshold', d.commit_value_threshold,
         'commit_requires_dual_approval', d.commit_requires_dual_approval
       ))
     FROM company_agents a
     LEFT JOIN LATERAL match_agent_capacity_role_default(a.role, a.department, a.title) d ON TRUE
     WHERE (a.role = $1 OR a.id::text = $1)
     ON CONFLICT (agent_id) DO NOTHING
     RETURNING id`,
    [agentId],
  );

  if (inserted.length > 0) return;

  await systemQuery(
    `INSERT INTO agent_capacity_config (
       agent_id,
       capacity_tier,
       requires_human_approval_for,
       override_by_roles,
       updated_at,
       updated_by,
       metadata
     )
     VALUES ($1, 'execute', '[]'::jsonb, '[]'::jsonb, NOW(), 'system', '{}'::jsonb)
     ON CONFLICT (agent_id) DO NOTHING`,
    [agentId],
  );
}

export async function getAgentCapacityConfig(agentId: string): Promise<AgentCapacityConfig | null> {
  await ensureAgentCapacityConfig(agentId);

  const rows = await systemQuery<CapacityConfigRecord>(
    `SELECT id, agent_id, capacity_tier, requires_human_approval_for, override_by_roles, updated_at, updated_by, metadata
     FROM agent_capacity_config
     WHERE agent_id = $1
     LIMIT 1`,
    [agentId],
  );

  return rows[0] ? normalizeCapacityConfig(rows[0]) : null;
}

export async function upsertAgentCapacityConfig(agentId: string, input: UpsertAgentCapacityInput): Promise<AgentCapacityConfig> {
  const rows = await systemQuery<CapacityConfigRecord>(
    `INSERT INTO agent_capacity_config (
       agent_id,
       capacity_tier,
       requires_human_approval_for,
       override_by_roles,
       updated_at,
       updated_by,
       metadata
     )
     VALUES ($1, $2, $3::jsonb, $4::jsonb, NOW(), $5, $6::jsonb)
     ON CONFLICT (agent_id) DO UPDATE SET
       capacity_tier = EXCLUDED.capacity_tier,
       requires_human_approval_for = EXCLUDED.requires_human_approval_for,
       override_by_roles = EXCLUDED.override_by_roles,
       updated_at = NOW(),
       updated_by = EXCLUDED.updated_by,
       metadata = COALESCE(agent_capacity_config.metadata, '{}'::jsonb) || EXCLUDED.metadata
     RETURNING id, agent_id, capacity_tier, requires_human_approval_for, override_by_roles, updated_at, updated_by, metadata`,
    [
      agentId,
      input.capacityTier,
      JSON.stringify(input.requiresHumanApprovalFor ?? []),
      JSON.stringify(input.overrideByRoles ?? []),
      input.updatedBy,
      JSON.stringify(input.metadata ?? {}),
    ],
  );

  return normalizeCapacityConfig(rows[0]);
}

export async function logCommitment(
  agentId: string,
  action: CapacityEnforcementAction,
  approvalContext: CommitmentApprovalContext = {},
): Promise<CommitmentRegistryEntry> {
  const agentName = await resolveAgentName(agentId);
  const toolName = extractToolName(action);
  const toolInput = extractToolInput(action);
  const metadata = {
    ...(action.metadata ?? {}),
    ...(approvalContext.metadata ?? {}),
  };

  const rows = await systemQuery<CommitmentRegistryRecord>(
    `INSERT INTO commitment_registry (
       agent_id,
       agent_name,
       action_type,
       action_description,
       external_counterparty,
       commitment_value,
       tool_called,
       tool_input,
       approved_by_human_id,
       approved_at,
       auto_approved,
       status,
       metadata
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::text, CASE WHEN $9::text IS NULL THEN NULL ELSE NOW() END,
       $10, $11, $12::jsonb
     )
     RETURNING *`,
    [
      agentId,
      agentName,
      action.type,
      action.actionDescription ?? `Agent ${agentId} requested ${toolName}`,
      action.externalCounterparty ?? null,
      action.estimatedValue == null ? null : String(action.estimatedValue),
      toolName,
      JSON.stringify(toolInput),
      approvalContext.approvedByHumanId ?? null,
      approvalContext.autoApproved ?? false,
      approvalContext.status ?? ((approvalContext.autoApproved ?? false) ? 'approved' : 'pending_approval'),
      JSON.stringify(metadata),
    ],
  );

  return normalizeCommitmentEntry(rows[0]);
}

export async function approveCommitment(registryId: string, approverHumanId: string): Promise<CommitmentRegistryEntry> {
  return systemTransaction(async (client) => {
    const result = await client.query<CommitmentRegistryRecord>('SELECT * FROM commitment_registry WHERE id = $1 FOR UPDATE', [registryId]);
    const row = result.rows[0];
    if (!row) {
      throw new Error(`Commitment ${registryId} not found`);
    }
    if (row.status === 'rejected' || row.status === 'reversed' || row.status === 'executed') {
      throw new Error(`Commitment ${registryId} cannot be approved from status ${row.status}`);
    }

    const metadata = normalizeObject(row.metadata);
    const approvals = Array.isArray(metadata.approvals) ? [...metadata.approvals] : [];
    if (!approvals.some((entry) => normalizeObject(entry).approverHumanId === approverHumanId)) {
      approvals.push({ approverHumanId, approvedAt: new Date().toISOString() });
    }

    const requiredApprovalCount = Number(metadata.requiredApprovalCount ?? 1);
    const fullyApproved = approvals.length >= Math.max(1, requiredApprovalCount);
    metadata.approvals = approvals;
    metadata.requiredApprovalCount = Math.max(1, requiredApprovalCount);

    const update = await client.query<CommitmentRegistryRecord>(
      `UPDATE commitment_registry
       SET approved_by_human_id = CASE WHEN $2 THEN $1 ELSE approved_by_human_id END,
           approved_at = CASE WHEN $2 THEN NOW() ELSE approved_at END,
           status = CASE WHEN $2 THEN 'approved'::commitment_registry_status ELSE status END,
           metadata = $3::jsonb
       WHERE id = $4
       RETURNING *`,
      [approverHumanId, fullyApproved, JSON.stringify(metadata), registryId],
    );

    return normalizeCommitmentEntry(update.rows[0]);
  });
}

export async function rejectCommitment(registryId: string, approverHumanId: string, reason: string): Promise<CommitmentRegistryEntry> {
  const rows = await systemQuery<CommitmentRegistryRecord>(
    `UPDATE commitment_registry
     SET status = 'rejected',
         metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
     WHERE id = $1
     RETURNING *`,
    [
      registryId,
      JSON.stringify({
        rejection: {
          approverHumanId,
          reason,
          rejectedAt: new Date().toISOString(),
        },
      }),
    ],
  );

  if (!rows[0]) {
    throw new Error(`Commitment ${registryId} not found`);
  }

  return normalizeCommitmentEntry(rows[0]);
}

export async function executeCommitment(registryId: string): Promise<CommitmentRegistryEntry> {
  const rows = await systemQuery<CommitmentRegistryRecord>(
    `UPDATE commitment_registry
     SET status = 'executed', executed_at = NOW()
     WHERE id = $1
       AND status IN ('approved', 'executed')
     RETURNING *`,
    [registryId],
  );

  if (!rows[0]) {
    throw new Error(`Commitment ${registryId} is not approved for execution`);
  }

  return normalizeCommitmentEntry(rows[0]);
}

export async function reverseCommitment(registryId: string, reason: string): Promise<CommitmentRegistryEntry> {
  const rows = await systemQuery<CommitmentRegistryRecord>(
    `UPDATE commitment_registry
     SET status = 'reversed',
         metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
     WHERE id = $1
     RETURNING *`,
    [
      registryId,
      JSON.stringify({
        reversal: {
          reason,
          reversedAt: new Date().toISOString(),
        },
      }),
    ],
  );

  if (!rows[0]) {
    throw new Error(`Commitment ${registryId} not found`);
  }

  return normalizeCommitmentEntry(rows[0]);
}

export async function listCommitments(filters: CommitmentListFilters = {}): Promise<CommitmentListResult> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? 50));
  const offset = (page - 1) * pageSize;

  const conditions: string[] = [];
  const values: unknown[] = [];

  if (filters.agentId) {
    values.push(filters.agentId);
    conditions.push(`agent_id = $${values.length}`);
  }
  if (filters.status) {
    values.push(filters.status);
    conditions.push(`status = $${values.length}`);
  }
  if (filters.dateFrom) {
    values.push(filters.dateFrom);
    conditions.push(`created_at >= $${values.length}`);
  }
  if (filters.dateTo) {
    values.push(filters.dateTo);
    conditions.push(`created_at <= $${values.length}`);
  }
  if (filters.counterparty) {
    values.push(`%${filters.counterparty}%`);
    conditions.push(`COALESCE(external_counterparty, '') ILIKE $${values.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const totalRows = await systemQuery<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM commitment_registry ${where}`,
    values,
  );

  const itemValues = [...values, pageSize, offset];
  const items = await systemQuery<CommitmentRegistryRecord>(
    `SELECT *
     FROM commitment_registry
     ${where}
     ORDER BY created_at DESC
     LIMIT $${itemValues.length - 1} OFFSET $${itemValues.length}`,
    itemValues,
  );

  return {
    page,
    pageSize,
    total: totalRows[0]?.count ?? 0,
    items: items.map(normalizeCommitmentEntry),
  };
}

export async function getPendingCommitments(page = 1, pageSize = 100): Promise<CommitmentListResult> {
  return listCommitments({ status: 'pending_approval', page, pageSize });
}

export async function enforceCapacityTier(agentId: string, action: CapacityEnforcementAction): Promise<CapacityEnforcementResult> {
  const config = await getAgentCapacityConfig(agentId);
  if (!config) {
    return {
      proceed: false,
      requiresApproval: true,
      reason: `No capacity config exists for agent ${agentId}`,
      registryEntryId: null,
    };
  }

  const traits = deriveActionTraits(action);
  const metadata = config.metadata ?? {};
  const thresholdRaw = Number(metadata.commit_value_threshold ?? DEFAULT_COMMIT_THRESHOLD_USD);
  const threshold = Number.isFinite(thresholdRaw) ? thresholdRaw : DEFAULT_COMMIT_THRESHOLD_USD;
  const requiredApprovalCount = metadata.commit_requires_dual_approval ? 2 : 1;
  const estimatedValue = parseCommitValue(action.estimatedValue);
  const actionNeedsApprovalByConfig = config.requiresHumanApprovalFor.includes(action.type) || config.requiresHumanApprovalFor.includes(traits.toolName);
  const commitThresholdExceeded = traits.externalCommitment && estimatedValue != null && Number.isFinite(threshold) && estimatedValue >= threshold;

  let proceed = true;
  let requiresApproval = false;
  let reason = `Action ${action.type} is permitted for ${agentId} at ${config.capacityTier} tier.`;

  switch (config.capacityTier) {
    case 'observe':
      if (!traits.readOnly) {
        proceed = false;
        requiresApproval = true;
        reason = `Observe tier only permits read-only tools. ${traits.toolName} requires human elevation.`;
      }
      break;
    case 'draft':
      if (!traits.readOnly && (traits.externalSend || traits.apiCommit || traits.paymentCall || traits.externalCommitment)) {
        proceed = false;
        requiresApproval = true;
        reason = `Draft tier allows internal generation and internal writes only. ${traits.toolName} creates an external or binding action.`;
      }
      break;
    case 'execute':
      if (actionNeedsApprovalByConfig) {
        proceed = false;
        requiresApproval = true;
        reason = `Execute tier requires human approval for action ${action.type} under this agent's policy.`;
      }
      break;
    case 'commit':
      if (commitThresholdExceeded) {
        proceed = false;
        requiresApproval = true;
        reason = `Commit tier permits this action, but the estimated value exceeds the approval threshold of $${threshold.toFixed(2)}.`;
      }
      break;
    default:
      proceed = false;
      requiresApproval = true;
      reason = `Unknown capacity tier for agent ${agentId}`;
      break;
  }

  let registryEntryId: string | null = null;
  const shouldLog = traits.shouldLogCommitment || config.capacityTier === 'commit' || requiresApproval;

  if (shouldLog) {
    const entry = await logCommitment(agentId, action, {
      autoApproved: proceed && !requiresApproval,
      status: proceed && !requiresApproval ? 'approved' : 'pending_approval',
      metadata: {
        requiredApprovalCount,
        capacityTier: config.capacityTier,
        overrideByRoles: config.overrideByRoles,
        commitValueThreshold: Number.isFinite(threshold) ? threshold : DEFAULT_COMMIT_THRESHOLD_USD,
        derivedTraits: {
          readOnly: traits.readOnly,
          externalSend: traits.externalSend,
          apiCommit: traits.apiCommit,
          paymentCall: traits.paymentCall,
          externalCommitment: traits.externalCommitment,
        },
      },
    });
    registryEntryId = entry.id;
  }

  return {
    proceed,
    requiresApproval,
    reason,
    registryEntryId,
  };
}