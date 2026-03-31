import Ajv, { type ErrorObject } from 'ajv';
import { systemQuery } from '@glyphor/shared/db';
import type {
  HandoffContract,
  HandoffContractInputValue,
  HandoffContractStatus,
  HandoffEscalationPolicy,
} from './types.js';

const ajv = new Ajv({ allErrors: true, strict: false });

type NewHandoffContract = Omit<HandoffContract, 'id' | 'issuedAt' | 'status' | 'updatedAt'>;

interface HandoffContractRow {
  id: string;
  issued_at: string;
  requesting_agent_id: string;
  requesting_agent_name: string;
  receiving_agent_id: string;
  receiving_agent_name: string;
  task_id: string;
  parent_contract_id: string | null;
  task_description: string;
  required_inputs: HandoffContractInputValue[] | null;
  expected_output_schema: Record<string, unknown> | null;
  confidence_threshold: number | string;
  deadline: string | null;
  escalation_policy: HandoffEscalationPolicy;
  status: HandoffContractStatus;
  accepted_at: string | null;
  completed_at: string | null;
  output_payload: unknown;
  output_confidence_score: number | string | null;
  rejection_reason: string | null;
  escalation_reason: string | null;
  sla_breached_at: string | null;
  updated_at: string;
}

interface AgentIdentityRow {
  role: string;
  display_name: string | null;
  name: string | null;
}

export interface ContractValidationResult {
  valid: boolean;
  errors: string[];
}

export interface ContractSlaCheckResult {
  checked: number;
  breached: number;
  escalated: number;
}

export interface ContractListFilters {
  status?: HandoffContractStatus;
  requestingAgentId?: string;
  receivingAgentId?: string;
  startDate?: string;
  endDate?: string;
}

export const DEFAULT_HANDOFF_CONFIDENCE_THRESHOLD = 0.7;

export class ContractRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContractRequiredError';
  }
}

export function buildDefaultExpectedOutputSchema(description?: string): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: true,
    properties: {
      output: {
        type: 'string',
        minLength: 1,
        description: description ?? 'Formal deliverable payload for the delegated task.',
      },
      assignmentId: { type: 'string' },
      submittedBy: { type: 'string' },
      status: { type: 'string' },
    },
    required: ['output'],
  };
}

export function buildRequiredInputs(inputs: Array<{ key: string; type: string; value: unknown }>): HandoffContractInputValue[] {
  return inputs.map((input) => ({
    key: input.key,
    type: input.type,
    value: input.value,
    provided: input.value !== undefined && input.value !== null && (!(typeof input.value === 'string') || input.value.trim().length > 0),
  }));
}

export async function issueContract(contract: NewHandoffContract): Promise<HandoffContract> {
  const requester = await resolveAgentIdentity(contract.requestingAgentId, contract.requestingAgentName);
  const receiver = await resolveAgentIdentity(contract.receivingAgentId, contract.receivingAgentName);

  const [row] = await systemQuery<HandoffContractRow>(
    `INSERT INTO agent_handoff_contracts (
       requesting_agent_id,
       requesting_agent_name,
       receiving_agent_id,
       receiving_agent_name,
       task_id,
       parent_contract_id,
       task_description,
       required_inputs,
       expected_output_schema,
       confidence_threshold,
       deadline,
       escalation_policy,
       status,
       issued_at,
       updated_at
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,'issued',NOW(),NOW())
     RETURNING *`,
    [
      requester.agentId,
      requester.agentName,
      receiver.agentId,
      receiver.agentName,
      contract.taskId,
      contract.parentContractId ?? null,
      contract.taskDescription,
      JSON.stringify(contract.requiredInputs ?? []),
      JSON.stringify(contract.expectedOutputSchema ?? buildDefaultExpectedOutputSchema(contract.taskDescription)),
      contract.confidenceThreshold,
      contract.deadline ? contract.deadline.toISOString() : null,
      contract.escalationPolicy,
    ],
  );

  const created = mapContractRow(row);
  await logContractAudit(created.id, 'issued', {
    taskId: created.taskId,
    requestingAgentId: created.requestingAgentId,
    receivingAgentId: created.receivingAgentId,
  });
  return created;
}

export async function acceptContract(contractId: string, agentId: string): Promise<HandoffContract> {
  const contract = await getContractById(contractId);
  ensureReceivingAgent(contract, agentId);

  if (contract.status === 'accepted' || contract.status === 'in_progress' || contract.status === 'completed') {
    return contract;
  }
  if (contract.status !== 'issued') {
    throw new Error(`Contract ${contractId} cannot be accepted from status ${contract.status}`);
  }

  const [row] = await systemQuery<HandoffContractRow>(
    `UPDATE agent_handoff_contracts
     SET status = 'accepted',
         accepted_at = NOW(),
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [contractId],
  );

  await logContractAudit(contractId, 'accepted', { agentId });
  return mapContractRow(row);
}

export async function markContractInProgress(contractId: string, agentId: string): Promise<HandoffContract> {
  const contract = await getContractById(contractId);
  ensureReceivingAgent(contract, agentId);

  if (contract.status === 'in_progress' || contract.status === 'completed') {
    return contract;
  }
  if (contract.status === 'issued') {
    await acceptContract(contractId, agentId);
  }

  const [row] = await systemQuery<HandoffContractRow>(
    `UPDATE agent_handoff_contracts
     SET status = 'in_progress',
         accepted_at = COALESCE(accepted_at, NOW()),
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [contractId],
  );

  await logContractAudit(contractId, 'in_progress', { agentId });
  return mapContractRow(row);
}

export async function rejectContract(contractId: string, agentId: string, reason: string): Promise<HandoffContract> {
  const contract = await getContractById(contractId);
  ensureReceivingAgent(contract, agentId);

  const [row] = await systemQuery<HandoffContractRow>(
    `UPDATE agent_handoff_contracts
     SET status = 'rejected',
         rejection_reason = $2,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [contractId, reason],
  );

  await notifyAgent(contract.requestingAgentId, agentId, `Handoff contract ${contractId} was rejected. Reason: ${reason}`, {
    contract_id: contractId,
    task_id: contract.taskId,
    status: 'rejected',
  });
  await logContractAudit(contractId, 'rejected', { agentId, reason });
  return mapContractRow(row);
}

export async function failContract(
  contractId: string,
  agentId: string,
  reason: string,
  outputPayload?: unknown,
): Promise<HandoffContract> {
  const contract = await getContractById(contractId);
  ensureReceivingAgent(contract, agentId);

  const [row] = await systemQuery<HandoffContractRow>(
    `UPDATE agent_handoff_contracts
     SET status = 'failed',
         escalation_reason = $2,
         output_payload = COALESCE($3::jsonb, output_payload),
         completed_at = NOW(),
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [contractId, reason, outputPayload == null ? null : JSON.stringify(outputPayload)],
  );

  await notifyAgent(contract.requestingAgentId, agentId, `Handoff contract ${contractId} failed. Reason: ${reason}`, {
    contract_id: contractId,
    task_id: contract.taskId,
    status: 'failed',
  });
  await logContractAudit(contractId, 'failed', { agentId, reason });
  return mapContractRow(row);
}

export async function completeContract(
  contractId: string,
  agentId: string,
  outputPayload: unknown,
  confidenceScore: number,
): Promise<HandoffContract> {
  const contract = await getContractById(contractId);
  ensureReceivingAgent(contract, agentId);

  const validation = validateContractOutput(contract, outputPayload);
  if (!validation.valid) {
    return failContract(contractId, agentId, `Output schema mismatch: ${validation.errors.join('; ')}`, outputPayload);
  }

  if (confidenceScore < contract.confidenceThreshold) {
    return escalateContract(contract, `Confidence ${confidenceScore.toFixed(2)} below threshold ${contract.confidenceThreshold.toFixed(2)}`, outputPayload, confidenceScore);
  }

  const [row] = await systemQuery<HandoffContractRow>(
    `UPDATE agent_handoff_contracts
     SET status = 'completed',
         output_payload = $2::jsonb,
         output_confidence_score = $3,
         completed_at = NOW(),
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [contractId, JSON.stringify(outputPayload), confidenceScore],
  );

  await logContractAudit(contractId, 'completed', { agentId, confidenceScore });
  return mapContractRow(row);
}

export function validateContractOutput(contract: HandoffContract, output: unknown): ContractValidationResult {
  if (!contract.expectedOutputSchema || Object.keys(contract.expectedOutputSchema).length === 0) {
    return { valid: true, errors: [] };
  }

  const validate = ajv.compile(contract.expectedOutputSchema);
  const valid = Boolean(validate(output));
  return {
    valid,
    errors: valid ? [] : formatAjvErrors(validate.errors ?? []),
  };
}

export async function checkSLAs(): Promise<ContractSlaCheckResult> {
  const rows = await systemQuery<HandoffContractRow>(
    `SELECT *
     FROM agent_handoff_contracts
     WHERE status = 'in_progress'
       AND deadline IS NOT NULL
       AND deadline < NOW()
       AND sla_breached_at IS NULL
     ORDER BY deadline ASC`,
    [],
  );

  const result: ContractSlaCheckResult = {
    checked: rows.length,
    breached: 0,
    escalated: 0,
  };

  for (const row of rows) {
    const contract = mapContractRow(row);
    await systemQuery(
      `UPDATE agent_handoff_contracts
       SET sla_breached_at = NOW(),
           status = 'escalated',
           escalation_reason = COALESCE(escalation_reason, $2),
           updated_at = NOW()
       WHERE id = $1`,
      [contract.id, 'SLA deadline breached'],
    );
    await triggerEscalation(contract, 'SLA deadline breached');
    await logContractAudit(contract.id, 'sla_breached', {
      requestingAgentId: contract.requestingAgentId,
      receivingAgentId: contract.receivingAgentId,
    });
    result.breached++;
    result.escalated++;
  }

  return result;
}

export async function getContractById(contractId: string): Promise<HandoffContract> {
  const rows = await systemQuery<HandoffContractRow>(
    'SELECT * FROM agent_handoff_contracts WHERE id = $1 LIMIT 1',
    [contractId],
  );
  const row = rows[0];
  if (!row) {
    throw new Error(`Contract not found: ${contractId}`);
  }
  return mapContractRow(row);
}

export async function getActiveContractForTask(taskId: string, agentId?: string): Promise<HandoffContract | null> {
  const values: unknown[] = [taskId];
  let where = "task_id = $1 AND status IN ('issued', 'accepted', 'in_progress', 'escalated')";
  if (agentId) {
    values.push(agentId);
    where += ` AND receiving_agent_id = $${values.length}`;
  }
  const rows = await systemQuery<HandoffContractRow>(
    `SELECT * FROM agent_handoff_contracts
     WHERE ${where}
     ORDER BY issued_at DESC
     LIMIT 1`,
    values,
  );
  return rows[0] ? mapContractRow(rows[0]) : null;
}

export async function requireContractForTask(taskId: string, agentId: string): Promise<HandoffContract> {
  const contract = await getActiveContractForTask(taskId, agentId);
  if (!contract) {
    throw new ContractRequiredError(`Formal handoff contract required for task ${taskId} and agent ${agentId}.`);
  }
  return contract;
}

export async function acceptContractForTask(taskId: string, agentId: string): Promise<HandoffContract> {
  const contract = await requireContractForTask(taskId, agentId);
  return acceptContract(contract.id, agentId);
}

export async function markContractInProgressForTask(taskId: string, agentId: string): Promise<HandoffContract> {
  const contract = await requireContractForTask(taskId, agentId);
  return markContractInProgress(contract.id, agentId);
}

export async function completeContractForTask(
  taskId: string,
  agentId: string,
  outputPayload: unknown,
  confidenceScore: number,
): Promise<HandoffContract> {
  const contract = await requireContractForTask(taskId, agentId);
  return completeContract(contract.id, agentId, outputPayload, confidenceScore);
}

export async function failContractForTask(
  taskId: string,
  agentId: string,
  reason: string,
  outputPayload?: unknown,
): Promise<HandoffContract> {
  const contract = await requireContractForTask(taskId, agentId);
  return failContract(contract.id, agentId, reason, outputPayload);
}

export async function listContracts(
  filters: ContractListFilters = {},
  page = 1,
  pageSize = 50,
): Promise<{ total: number; contracts: HandoffContract[] }> {
  const { where, values } = buildContractWhere(filters);
  const countRows = await systemQuery<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM agent_handoff_contracts ${where}`,
    values,
  );

  const safePage = Math.max(1, page);
  const safePageSize = Math.max(1, pageSize);
  const offset = (safePage - 1) * safePageSize;
  const rows = await systemQuery<HandoffContractRow>(
    `SELECT * FROM agent_handoff_contracts ${where}
     ORDER BY issued_at DESC
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, safePageSize, offset],
  );

  return {
    total: countRows[0]?.count ?? 0,
    contracts: rows.map(mapContractRow),
  };
}

async function escalateContract(
  contract: HandoffContract,
  reason: string,
  outputPayload?: unknown,
  confidenceScore?: number,
): Promise<HandoffContract> {
  const [row] = await systemQuery<HandoffContractRow>(
    `UPDATE agent_handoff_contracts
     SET status = 'escalated',
         escalation_reason = $2,
         output_payload = COALESCE($3::jsonb, output_payload),
         output_confidence_score = COALESCE($4, output_confidence_score),
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [contract.id, reason, outputPayload == null ? null : JSON.stringify(outputPayload), confidenceScore ?? null],
  );

  await triggerEscalation(contract, reason, outputPayload);
  await logContractAudit(contract.id, 'escalated', { reason, confidenceScore });
  return mapContractRow(row);
}

async function triggerEscalation(contract: HandoffContract, reason: string, outputPayload?: unknown): Promise<void> {
  if (contract.escalationPolicy === 'return_to_issuer') {
    await notifyAgent(contract.requestingAgentId, contract.receivingAgentId, `Contract ${contract.id} requires issuer review. Reason: ${reason}`, {
      contract_id: contract.id,
      task_id: contract.taskId,
      escalation_policy: contract.escalationPolicy,
      output_payload: outputPayload ?? null,
    });
    return;
  }

  const message = contract.escalationPolicy === 'escalate_to_human'
    ? `Contract ${contract.id} requires human escalation. Reason: ${reason}`
    : `Contract ${contract.id} escalated to chief-of-staff. Reason: ${reason}`;

  await notifyAgent('chief-of-staff', contract.receivingAgentId, message, {
    contract_id: contract.id,
    task_id: contract.taskId,
    escalation_policy: contract.escalationPolicy,
    requesting_agent_id: contract.requestingAgentId,
    receiving_agent_id: contract.receivingAgentId,
  });
}

async function notifyAgent(toAgent: string, fromAgent: string, message: string, context: Record<string, unknown>): Promise<void> {
  await systemQuery(
    `INSERT INTO agent_messages
       (from_agent, to_agent, thread_id, message, message_type, priority, status, context)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [fromAgent, toAgent, crypto.randomUUID(), message, 'task', 'urgent', 'pending', JSON.stringify(context)],
  );
}

async function logContractAudit(contractId: string, eventType: string, details: Record<string, unknown>): Promise<void> {
  try {
    await systemQuery(
      `INSERT INTO agent_handoff_contract_audit_log
         (contract_id, event_type, details, created_at)
       VALUES ($1,$2,$3::jsonb,NOW())`,
      [contractId, eventType, JSON.stringify(details)],
    );
  } catch (err) {
    console.warn('[HandoffContracts] Failed to write contract audit log:', (err as Error).message);
  }

  try {
    await systemQuery(
      `INSERT INTO activity_log (agent_role, action, summary, details, created_at)
       VALUES ($1,$2,$3,$4::jsonb,NOW())`,
      ['system', `contract.${eventType}`, `Handoff contract ${contractId}: ${eventType}`, JSON.stringify(details)],
    );
  } catch (err) {
    console.warn('[HandoffContracts] Failed to write activity_log:', (err as Error).message);
  }
}

async function resolveAgentIdentity(agentId: string, fallbackName?: string): Promise<{ agentId: string; agentName: string }> {
  const rows = await systemQuery<AgentIdentityRow>(
    `SELECT role, display_name, name
     FROM company_agents
     WHERE role = $1 OR id::text = $1
     LIMIT 1`,
    [agentId],
  );

  const row = rows[0];
  if (!row) {
    return { agentId, agentName: fallbackName ?? agentId };
  }

  return {
    agentId: row.role,
    agentName: row.display_name ?? row.name ?? fallbackName ?? row.role,
  };
}

function ensureReceivingAgent(contract: HandoffContract, agentId: string): void {
  if (contract.receivingAgentId !== agentId) {
    throw new Error(`Contract ${contract.id} is assigned to ${contract.receivingAgentId}, not ${agentId}`);
  }
}

function buildContractWhere(filters: ContractListFilters): { where: string; values: unknown[] } {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (filters.status) {
    values.push(filters.status);
    conditions.push(`status = $${values.length}`);
  }
  if (filters.requestingAgentId) {
    values.push(filters.requestingAgentId);
    conditions.push(`requesting_agent_id = $${values.length}`);
  }
  if (filters.receivingAgentId) {
    values.push(filters.receivingAgentId);
    conditions.push(`receiving_agent_id = $${values.length}`);
  }
  if (filters.startDate) {
    values.push(filters.startDate);
    conditions.push(`issued_at >= $${values.length}`);
  }
  if (filters.endDate) {
    values.push(filters.endDate);
    conditions.push(`issued_at <= $${values.length}`);
  }

  return {
    where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    values,
  };
}

function mapContractRow(row: HandoffContractRow): HandoffContract {
  return {
    id: row.id,
    issuedAt: new Date(row.issued_at),
    requestingAgentId: row.requesting_agent_id,
    requestingAgentName: row.requesting_agent_name,
    receivingAgentId: row.receiving_agent_id,
    receivingAgentName: row.receiving_agent_name,
    taskId: row.task_id,
    parentContractId: row.parent_contract_id ?? undefined,
    taskDescription: row.task_description,
    requiredInputs: Array.isArray(row.required_inputs) ? row.required_inputs : [],
    expectedOutputSchema: row.expected_output_schema ?? {},
    confidenceThreshold: Number(row.confidence_threshold),
    deadline: row.deadline ? new Date(row.deadline) : undefined,
    escalationPolicy: row.escalation_policy,
    status: row.status,
    acceptedAt: row.accepted_at ? new Date(row.accepted_at) : undefined,
    completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    outputPayload: row.output_payload ?? undefined,
    outputConfidenceScore: row.output_confidence_score == null ? undefined : Number(row.output_confidence_score),
    rejectionReason: row.rejection_reason ?? undefined,
    escalationReason: row.escalation_reason ?? undefined,
    slaBreachedAt: row.sla_breached_at ? new Date(row.sla_breached_at) : undefined,
    updatedAt: new Date(row.updated_at),
  };
}

function formatAjvErrors(errors: ErrorObject[]): string[] {
  return errors.map((error) => {
    const path = error.instancePath || '/';
    const suffix = error.message ? ` ${error.message}` : '';
    return `${path}${suffix}`.trim();
  });
}