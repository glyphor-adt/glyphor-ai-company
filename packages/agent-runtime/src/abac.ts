import { systemQuery } from '@glyphor/shared/db';
import type {
  AbacPermission,
  AbacToolMetadata,
  CompanyAgentRole,
  DataClassificationLevel,
  ToolDefinition,
  ToolResult,
} from './types.js';

export interface AbacPermissionResult {
  allowed: boolean;
  policyId: string | null;
  reason: string;
  agentRole: string;
}

export interface AbacToolCall {
  tool: Pick<ToolDefinition, 'abac'>;
  toolName: string;
  params: Record<string, unknown>;
  taskId?: string;
  agentRole?: CompanyAgentRole | string;
  auditAgentId?: string;
}

export class AgentPermissionError extends Error {
  readonly policyId: string | null;

  constructor(message: string, policyId: string | null = null) {
    super(message);
    this.name = 'AgentPermissionError';
    this.policyId = policyId;
  }
}

interface ClassificationLookup {
  classificationLevel: DataClassificationLevel;
  configured: boolean;
  reason: string;
}

export function isClassificationLevel(value: unknown): value is DataClassificationLevel {
  return value === 'public' || value === 'internal' || value === 'confidential' || value === 'restricted';
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function inferResourceTypeFromToolName(toolName: string): string {
  return normalizeKey(
    toolName
      .replace(/^(query|get|create|update|delete|flag|track|list|read)_/, '')
      .replace(/^mcp_[^_]+_/, ''),
  );
}

function getStringParam(params: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function extractAbacTarget(toolCall: AbacToolCall): { mcpDomain: string; resourceType: string } | null {
  const metadata: AbacToolMetadata | undefined = toolCall.tool.abac;
  const mcpDomain = metadata?.mcpDomain ?? getStringParam(toolCall.params, ['mcp_domain', 'domain']);
  if (!mcpDomain) return null;

  const resourceType = metadata?.resourceType
    ?? (metadata?.resourceTypeParam ? getStringParam(toolCall.params, [metadata.resourceTypeParam]) : null)
    ?? getStringParam(toolCall.params, ['resource_type', 'record_type', 'asset_type', 'contract_type', 'metric_type', 'event_type'])
    ?? inferResourceTypeFromToolName(toolCall.toolName);

  return {
    mcpDomain: normalizeKey(mcpDomain),
    resourceType: normalizeKey(resourceType),
  };
}

async function writeAbacAuditLog(entry: {
  agentId: string;
  agentRole: string;
  mcpDomain: string;
  resourceType: string;
  classificationLevel: DataClassificationLevel;
  policyId: string | null;
  decision: AbacPermission;
  taskId?: string;
}): Promise<void> {
  await systemQuery(
    `INSERT INTO abac_audit_log
       (agent_id, agent_role, mcp_domain, resource_type, classification_level, policy_id, decision, task_id, timestamp)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      entry.agentId,
      entry.agentRole,
      entry.mcpDomain,
      entry.resourceType,
      entry.classificationLevel,
      entry.policyId,
      entry.decision,
      entry.taskId ?? '',
      new Date().toISOString(),
    ],
  );
}

export async function ensureAgentRoleRecord(roleName: string): Promise<string> {
  const normalized = roleName.trim();
  const [existing] = await systemQuery<{ id: string }>(
    'SELECT id FROM agent_roles WHERE name = $1 LIMIT 1',
    [normalized],
  );
  if (existing?.id) return existing.id;

  const [created] = await systemQuery<{ id: string }>(
    `INSERT INTO agent_roles (name, description)
     VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [normalized, 'Auto-created from active agent role lookup'],
  );
  return created.id;
}

export async function resolveClassificationLevel(
  mcpDomain: string,
  resourceType: string,
): Promise<ClassificationLookup> {
  const [row] = await systemQuery<{ classification_level: DataClassificationLevel }>(
    `SELECT classification_level
     FROM data_classifications
     WHERE mcp_domain = $1 AND resource_type = $2
     LIMIT 1`,
    [normalizeKey(mcpDomain), normalizeKey(resourceType)],
  );

  if (row?.classification_level) {
    return {
      classificationLevel: row.classification_level,
      configured: true,
      reason: `Classification resolved from data_classifications for ${mcpDomain}/${resourceType}`,
    };
  }

  return {
    classificationLevel: 'restricted',
    configured: false,
    reason: `No classification configured for ${mcpDomain}/${resourceType}; defaulting to restricted`,
  };
}

async function evaluatePolicyForRole(
  agentRole: string,
  mcpDomain: string,
  resourceType: string,
  classificationLevel: DataClassificationLevel,
): Promise<AbacPermissionResult> {
  await ensureAgentRoleRecord(agentRole);

  const rows = await systemQuery<{
    id: string;
    permission: AbacPermission;
    priority: number;
    resource_type: string | null;
  }>(
    `SELECT p.id, p.permission, p.priority, p.resource_type
     FROM abac_policies p
     JOIN agent_roles ar ON ar.id = p.agent_role_id
     WHERE ar.name = $1
       AND p.mcp_domain = $2
       AND p.classification_level = $3
       AND (p.resource_type IS NULL OR p.resource_type = $4)
     ORDER BY p.priority DESC,
              CASE WHEN p.permission = 'deny' THEN 0 ELSE 1 END ASC,
              CASE WHEN p.resource_type IS NULL THEN 1 ELSE 0 END ASC,
              p.created_at DESC`,
    [agentRole, mcpDomain, classificationLevel, resourceType],
  );

  const winner = rows[0];
  if (!winner) {
    return {
      allowed: false,
      policyId: null,
      reason: `No ABAC policy matched role=${agentRole}, domain=${mcpDomain}, resource=${resourceType}, classification=${classificationLevel}`,
      agentRole,
    };
  }

  return {
    allowed: winner.permission === 'allow',
    policyId: winner.id,
    reason: `${winner.permission.toUpperCase()} by policy ${winner.id} (priority ${winner.priority}${winner.resource_type ? `, resource ${winner.resource_type}` : ', domain-wide'})`,
    agentRole,
  };
}

async function lookupAgentRole(agentId: string): Promise<string> {
  const [agent] = await systemQuery<{ role: string }>(
    'SELECT role FROM company_agents WHERE id::text = $1 OR role = $1 LIMIT 1',
    [agentId],
  );
  if (!agent?.role) {
    throw new AgentPermissionError(`Unable to resolve agent role for ${agentId}`);
  }
  return agent.role;
}

export async function checkAgentPermission(
  agentId: string,
  mcpDomain: string,
  resourceType: string,
  classificationLevel: DataClassificationLevel,
  options?: { taskId?: string; agentRole?: string; writeAudit?: boolean; auditAgentId?: string },
): Promise<AbacPermissionResult> {
  const normalizedDomain = normalizeKey(mcpDomain);
  const normalizedResource = normalizeKey(resourceType);
  const agentRole = options?.agentRole ?? await lookupAgentRole(agentId);
  const result = await evaluatePolicyForRole(agentRole, normalizedDomain, normalizedResource, classificationLevel);

  if (options?.writeAudit !== false) {
    await writeAbacAuditLog({
      agentId: options?.auditAgentId ?? agentId,
      agentRole,
      mcpDomain: normalizedDomain,
      resourceType: normalizedResource,
      classificationLevel,
      policyId: result.policyId,
      decision: result.allowed ? 'allow' : 'deny',
      taskId: options?.taskId,
    });
  }

  return result;
}

export async function testAgentPermissionByRole(
  agentRole: string,
  mcpDomain: string,
  resourceType: string,
  classificationLevel: DataClassificationLevel,
): Promise<AbacPermissionResult> {
  return evaluatePolicyForRole(
    agentRole.trim(),
    normalizeKey(mcpDomain),
    normalizeKey(resourceType),
    classificationLevel,
  );
}

export async function abacMiddleware<T extends ToolResult | unknown>(
  agentId: string,
  toolCall: AbacToolCall,
  next: () => Promise<T>,
): Promise<T> {
  const target = extractAbacTarget(toolCall);
  if (!target) {
    return next();
  }

  const classification = await resolveClassificationLevel(target.mcpDomain, target.resourceType);
  const permission = await checkAgentPermission(
    agentId,
    target.mcpDomain,
    target.resourceType,
    classification.classificationLevel,
    {
      taskId: toolCall.taskId,
      agentRole: toolCall.agentRole,
      auditAgentId: toolCall.auditAgentId,
    },
  );

  if (!permission.allowed) {
    throw new AgentPermissionError(
      `${permission.reason}. Tool ${toolCall.toolName} cannot access ${target.mcpDomain}/${target.resourceType} (${classification.classificationLevel}).`,
      permission.policyId,
    );
  }

  return next();
}