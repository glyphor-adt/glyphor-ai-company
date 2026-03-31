import { systemQuery, systemTransaction } from './db.js';

export interface ReactIteration {
  thought: string;
  action: string;
  observation: string;
  iteration: number;
}

export interface SelfCritiqueOutput {
  issues_found: string[];
  revisions_made: string[];
  final_confidence: number;
}

export interface T1SimulationResult {
  states_evaluated: Array<Record<string, unknown>>;
  rejected_states: Array<Record<string, unknown>>;
  selected_state: Record<string, unknown> | null;
  forward_progress_score: number;
}

export interface ValueAnalysisResult {
  function_score: number;
  cost_score: number;
  value_ratio: number;
  alternatives_considered: Array<Record<string, unknown>>;
}

export interface AlternativeRejected {
  description: string;
  rejection_reason: string;
}

export interface AbacDecisionTrace {
  policy_id: string | null;
  decision: string;
  mcp_domain: string;
  resource_type: string;
  classification_level: string;
  task_id: string;
  timestamp: string;
}

export interface AuditLogLink {
  id: string;
  agent_role: string | null;
  agent_id: string | null;
  action: string | null;
  activity_type: string | null;
  summary: string | null;
  description: string | null;
  detail: string | null;
  details: Record<string, unknown>;
  tier: string | null;
  created_at: string;
}

export interface LinkedContract {
  id: string;
  task_id: string;
  status: string;
  task_description: string;
  requesting_agent_id: string;
  requesting_agent_name: string;
  receiving_agent_id: string;
  receiving_agent_name: string;
  confidence_threshold: number;
  output_confidence_score: number | null;
  issued_at: string;
  accepted_at: string | null;
  completed_at: string | null;
  deadline: string | null;
}

export interface DecisionTraceEntry {
  id: string;
  auditLogId: string;
  agentId: string;
  taskId: string;
  reactIterations: ReactIteration[];
  selfCritiqueOutput: SelfCritiqueOutput | null;
  t1SimulationResult: T1SimulationResult | null;
  valueAnalysisResult: ValueAnalysisResult | null;
  alternativesRejected: AlternativeRejected[];
  confidenceAtDecision: number | null;
  handoffContractId: string | null;
  abacDecisions: AbacDecisionTrace[];
  finalDecisionSummary: string | null;
  nlExplanation: string | null;
  createdAt: string;
  auditLog: AuditLogLink;
  contract: LinkedContract | null;
}

export interface DecisionTraceQueryFilters {
  agentId?: string | string[];
  taskId?: string;
  dateRange?: {
    from?: string;
    to?: string;
  };
  decisionType?: string;
  minConfidence?: number;
  maxConfidence?: number;
  hadT1Simulation?: boolean;
  contractId?: string;
  page?: number;
  pageSize?: number;
}

export interface DecisionTraceQueryResult {
  page: number;
  pageSize: number;
  total: number;
  items: DecisionTraceEntry[];
}

export interface CaptureDecisionTraceInput {
  agentId?: string;
  taskId?: string;
  reactIterations?: ReactIteration[];
  selfCritiqueOutput?: SelfCritiqueOutput | null;
  t1SimulationResult?: T1SimulationResult | null;
  valueAnalysisResult?: ValueAnalysisResult | null;
  alternativesRejected?: AlternativeRejected[];
  confidenceAtDecision?: number | null;
  handoffContractId?: string | null;
  abacDecisions?: AbacDecisionTrace[];
  finalDecisionSummary?: string | null;
  nlExplanation?: string | null;
}

interface DecisionTraceRow {
  id: string;
  audit_log_id: string;
  agent_id: string;
  task_id: string;
  react_iterations: unknown;
  self_critique_output: unknown;
  t1_simulation_result: unknown;
  value_analysis_result: unknown;
  alternatives_rejected: unknown;
  confidence_at_decision: number | null;
  handoff_contract_id: string | null;
  abac_decisions: unknown;
  final_decision_summary: string | null;
  nl_explanation: string | null;
  created_at: string;
  audit_log: unknown;
  contract: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function toArray<T>(value: unknown, mapper: (item: Record<string, unknown>, index: number) => T): T[] {
  let list: unknown[] = [];
  if (Array.isArray(value)) {
    list = value;
  } else if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      list = [];
    }
  }

  return list.filter(isRecord).map(mapper);
}

function uniqueBy<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function normalizeReactIterations(value: unknown): ReactIteration[] {
  return toArray(value, (item, index) => ({
    thought: asString(item.thought) ?? '',
    action: asString(item.action) ?? '',
    observation: asString(item.observation) ?? '',
    iteration: asNumber(item.iteration) ?? index + 1,
  }));
}

function normalizeSelfCritiqueOutput(value: unknown): SelfCritiqueOutput | null {
  if (!isRecord(value) && !(typeof value === 'string' && value.trim().length > 0)) return null;
  const record = toRecord(value);
  return {
    issues_found: toArray(record.issues_found, (item) => ({ value: asString(item.value) ?? '' })).map((item) => item.value).filter(Boolean),
    revisions_made: toArray(record.revisions_made, (item) => ({ value: asString(item.value) ?? '' })).map((item) => item.value).filter(Boolean),
    final_confidence: asNumber(record.final_confidence) ?? 0,
  };
}

function normalizeT1SimulationResult(value: unknown): T1SimulationResult | null {
  if (!isRecord(value) && !(typeof value === 'string' && value.trim().length > 0)) return null;
  const record = toRecord(value);
  return {
    states_evaluated: toArray(record.states_evaluated, (item) => item),
    rejected_states: toArray(record.rejected_states, (item) => item),
    selected_state: isRecord(record.selected_state) ? record.selected_state : null,
    forward_progress_score: asNumber(record.forward_progress_score) ?? 0,
  };
}

function normalizeValueAnalysisResult(value: unknown): ValueAnalysisResult | null {
  if (!isRecord(value) && !(typeof value === 'string' && value.trim().length > 0)) return null;
  const record = toRecord(value);
  return {
    function_score: asNumber(record.function_score) ?? 0,
    cost_score: asNumber(record.cost_score) ?? 0,
    value_ratio: asNumber(record.value_ratio) ?? 0,
    alternatives_considered: toArray(record.alternatives_considered, (item) => item),
  };
}

function normalizeAlternativesRejected(value: unknown): AlternativeRejected[] {
  return toArray(value, (item) => ({
    description: asString(item.description) ?? '',
    rejection_reason: asString(item.rejection_reason) ?? '',
  })).filter((item) => item.description.length > 0 || item.rejection_reason.length > 0);
}

function normalizeAbacDecisions(value: unknown): AbacDecisionTrace[] {
  return toArray(value, (item) => ({
    policy_id: asString(item.policy_id),
    decision: asString(item.decision) ?? 'deny',
    mcp_domain: asString(item.mcp_domain) ?? 'unknown',
    resource_type: asString(item.resource_type) ?? 'unknown',
    classification_level: asString(item.classification_level) ?? 'restricted',
    task_id: asString(item.task_id) ?? '',
    timestamp: asString(item.timestamp) ?? new Date(0).toISOString(),
  }));
}

function normalizeAuditLog(value: unknown): AuditLogLink {
  const record = toRecord(value);
  return {
    id: asString(record.id) ?? '',
    agent_role: asString(record.agent_role),
    agent_id: asString(record.agent_id),
    action: asString(record.action),
    activity_type: asString(record.activity_type),
    summary: asString(record.summary),
    description: asString(record.description),
    detail: asString(record.detail),
    details: toRecord(record.details),
    tier: asString(record.tier),
    created_at: asString(record.created_at) ?? new Date(0).toISOString(),
  };
}

function normalizeContract(value: unknown): LinkedContract | null {
  if (!isRecord(value)) return null;
  return {
    id: asString(value.id) ?? '',
    task_id: asString(value.task_id) ?? '',
    status: asString(value.status) ?? 'issued',
    task_description: asString(value.task_description) ?? '',
    requesting_agent_id: asString(value.requesting_agent_id) ?? '',
    requesting_agent_name: asString(value.requesting_agent_name) ?? '',
    receiving_agent_id: asString(value.receiving_agent_id) ?? '',
    receiving_agent_name: asString(value.receiving_agent_name) ?? '',
    confidence_threshold: asNumber(value.confidence_threshold) ?? 0,
    output_confidence_score: asNumber(value.output_confidence_score),
    issued_at: asString(value.issued_at) ?? new Date(0).toISOString(),
    accepted_at: asString(value.accepted_at),
    completed_at: asString(value.completed_at),
    deadline: asString(value.deadline),
  };
}

function normalizeDecisionTraceRow(row: DecisionTraceRow): DecisionTraceEntry {
  return {
    id: row.id,
    auditLogId: row.audit_log_id,
    agentId: row.agent_id,
    taskId: row.task_id,
    reactIterations: normalizeReactIterations(row.react_iterations),
    selfCritiqueOutput: normalizeSelfCritiqueOutput(row.self_critique_output),
    t1SimulationResult: normalizeT1SimulationResult(row.t1_simulation_result),
    valueAnalysisResult: normalizeValueAnalysisResult(row.value_analysis_result),
    alternativesRejected: normalizeAlternativesRejected(row.alternatives_rejected),
    confidenceAtDecision: row.confidence_at_decision,
    handoffContractId: row.handoff_contract_id,
    abacDecisions: normalizeAbacDecisions(row.abac_decisions),
    finalDecisionSummary: row.final_decision_summary,
    nlExplanation: row.nl_explanation,
    createdAt: row.created_at,
    auditLog: normalizeAuditLog(row.audit_log),
    contract: normalizeContract(row.contract),
  };
}

async function resolveHandoffContractId(taskId: string | undefined, explicitContractId?: string | null): Promise<string | null> {
  if (explicitContractId) return explicitContractId;
  if (!taskId) return null;
  const rows = await systemQuery<{ id: string }>(
    `SELECT id
     FROM agent_handoff_contracts
     WHERE task_id = $1
     ORDER BY issued_at DESC
     LIMIT 1`,
    [taskId],
  );
  return rows[0]?.id ?? null;
}

async function loadAbacDecisions(agentId: string | undefined, taskId: string | undefined): Promise<AbacDecisionTrace[]> {
  if (!agentId || !taskId) return [];
  const rows = await systemQuery<AbacDecisionTrace>(
    `SELECT policy_id, decision, mcp_domain, resource_type, classification_level, task_id, timestamp
     FROM abac_audit_log
     WHERE task_id = $1 AND (agent_role = $2 OR agent_id = $2)
     ORDER BY timestamp ASC`,
    [taskId, agentId],
  );
  return rows;
}

async function getActivityAuditContext(auditLogId: string): Promise<{ agentId: string | null; taskId: string | null }> {
  const rows = await systemQuery<{
    agent_id: string | null;
    agent_role: string | null;
    details: unknown;
    detail: string | null;
  }>(
    `SELECT agent_id, agent_role, details, detail
     FROM activity_log
     WHERE id = $1
     LIMIT 1`,
    [auditLogId],
  );
  const row = rows[0];
  if (!row) return { agentId: null, taskId: null };
  const details = toRecord(row.details);
  const taskId = asString(details.task_id) ?? asString(details.assignment_id) ?? asString(details.run_id) ?? row.detail;
  return {
    agentId: row.agent_id ?? row.agent_role,
    taskId,
  };
}

export async function captureDecisionTrace(auditLogId: string, traceData: CaptureDecisionTraceInput): Promise<DecisionTraceEntry> {
  const activityContext = await getActivityAuditContext(auditLogId);
  const agentId = traceData.agentId ?? activityContext.agentId ?? 'unknown';
  const taskId = traceData.taskId ?? activityContext.taskId ?? auditLogId;
  const handoffContractId = await resolveHandoffContractId(taskId, traceData.handoffContractId);
  const inferredAbac = traceData.abacDecisions ?? await loadAbacDecisions(agentId, taskId);

  await systemTransaction(async (client) => {
    const existingRows = await client.query(
      `SELECT react_iterations, alternatives_rejected, abac_decisions
       FROM decision_traces
       WHERE audit_log_id = $1
       LIMIT 1`,
      [auditLogId],
    );

    const existing = existingRows.rows[0] ?? null;
    const mergedReactIterations = uniqueBy(
      [
        ...normalizeReactIterations(existing?.react_iterations),
        ...(traceData.reactIterations ?? []),
      ],
      (item) => `${item.iteration}:${item.action}:${item.observation}`,
    );

    const mergedAlternatives = uniqueBy(
      [
        ...normalizeAlternativesRejected(existing?.alternatives_rejected),
        ...(traceData.alternativesRejected ?? []),
      ],
      (item) => `${item.description}:${item.rejection_reason}`,
    );

    const mergedAbac = uniqueBy(
      [
        ...normalizeAbacDecisions(existing?.abac_decisions),
        ...inferredAbac,
      ],
      (item) => `${item.policy_id ?? 'none'}:${item.decision}:${item.mcp_domain}:${item.resource_type}:${item.timestamp}`,
    );

    await client.query(
      `INSERT INTO decision_traces (
         audit_log_id,
         agent_id,
         task_id,
         react_iterations,
         self_critique_output,
         t1_simulation_result,
         value_analysis_result,
         alternatives_rejected,
         confidence_at_decision,
         handoff_contract_id,
         abac_decisions,
         final_decision_summary,
         nl_explanation
       )
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11::jsonb,$12,$13)
       ON CONFLICT (audit_log_id) DO UPDATE SET
         agent_id = EXCLUDED.agent_id,
         task_id = EXCLUDED.task_id,
         react_iterations = EXCLUDED.react_iterations,
         self_critique_output = COALESCE(EXCLUDED.self_critique_output, decision_traces.self_critique_output),
         t1_simulation_result = COALESCE(EXCLUDED.t1_simulation_result, decision_traces.t1_simulation_result),
         value_analysis_result = COALESCE(EXCLUDED.value_analysis_result, decision_traces.value_analysis_result),
         alternatives_rejected = EXCLUDED.alternatives_rejected,
         confidence_at_decision = COALESCE(EXCLUDED.confidence_at_decision, decision_traces.confidence_at_decision),
         handoff_contract_id = COALESCE(EXCLUDED.handoff_contract_id, decision_traces.handoff_contract_id),
         abac_decisions = EXCLUDED.abac_decisions,
         final_decision_summary = COALESCE(EXCLUDED.final_decision_summary, decision_traces.final_decision_summary),
         nl_explanation = COALESCE(EXCLUDED.nl_explanation, decision_traces.nl_explanation)`,
      [
        auditLogId,
        agentId,
        taskId,
        JSON.stringify(mergedReactIterations),
        JSON.stringify(traceData.selfCritiqueOutput ?? {}),
        traceData.t1SimulationResult == null ? null : JSON.stringify(traceData.t1SimulationResult),
        traceData.valueAnalysisResult == null ? null : JSON.stringify(traceData.valueAnalysisResult),
        JSON.stringify(mergedAlternatives),
        traceData.confidenceAtDecision ?? null,
        handoffContractId,
        JSON.stringify(mergedAbac),
        traceData.finalDecisionSummary ?? null,
        traceData.nlExplanation ?? null,
      ],
    );
  });

  const trace = await getDecisionTraceByAuditLogId(auditLogId);
  if (!trace) {
    throw new Error(`Decision trace upsert failed for audit log ${auditLogId}`);
  }
  return trace;
}

function buildQueryBase(whereClause: string): string {
  return `
    SELECT
      dt.id,
      dt.audit_log_id,
      dt.agent_id,
      dt.task_id,
      dt.react_iterations,
      dt.self_critique_output,
      dt.t1_simulation_result,
      dt.value_analysis_result,
      dt.alternatives_rejected,
      dt.confidence_at_decision,
      dt.handoff_contract_id,
      dt.abac_decisions,
      dt.final_decision_summary,
      dt.nl_explanation,
      dt.created_at,
      jsonb_build_object(
        'id', a.id,
        'agent_role', a.agent_role,
        'agent_id', a.agent_id,
        'action', a.action,
        'activity_type', a.activity_type,
        'summary', a.summary,
        'description', a.description,
        'detail', a.detail,
        'details', COALESCE(a.details, '{}'::jsonb),
        'tier', a.tier,
        'created_at', a.created_at
      ) AS audit_log,
      CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', c.id,
        'task_id', c.task_id,
        'status', c.status,
        'task_description', c.task_description,
        'requesting_agent_id', c.requesting_agent_id,
        'requesting_agent_name', c.requesting_agent_name,
        'receiving_agent_id', c.receiving_agent_id,
        'receiving_agent_name', c.receiving_agent_name,
        'confidence_threshold', c.confidence_threshold,
        'output_confidence_score', c.output_confidence_score,
        'issued_at', c.issued_at,
        'accepted_at', c.accepted_at,
        'completed_at', c.completed_at,
        'deadline', c.deadline
      ) END AS contract
    FROM decision_traces dt
    JOIN activity_log a ON a.id = dt.audit_log_id
    LEFT JOIN agent_handoff_contracts c ON c.id = dt.handoff_contract_id
    ${whereClause}
  `;
}

export async function queryDecisionTrace(filters: DecisionTraceQueryFilters = {}): Promise<DecisionTraceQueryResult> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? 50));
  const conditions: string[] = [];
  const params: unknown[] = [];

  const addParam = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  if (filters.agentId) {
    const agentIds = Array.isArray(filters.agentId) ? filters.agentId : [filters.agentId];
    conditions.push(`dt.agent_id = ANY(${addParam(agentIds)})`);
  }

  if (filters.taskId) {
    conditions.push(`dt.task_id = ${addParam(filters.taskId)}`);
  }

  if (filters.dateRange?.from) {
    conditions.push(`dt.created_at >= ${addParam(filters.dateRange.from)}`);
  }

  if (filters.dateRange?.to) {
    conditions.push(`dt.created_at <= ${addParam(filters.dateRange.to)}`);
  }

  if (filters.decisionType) {
    conditions.push(`a.action = ${addParam(filters.decisionType)}`);
  }

  if (filters.minConfidence != null) {
    conditions.push(`dt.confidence_at_decision >= ${addParam(filters.minConfidence)}`);
  }

  if (filters.maxConfidence != null) {
    conditions.push(`dt.confidence_at_decision <= ${addParam(filters.maxConfidence)}`);
  }

  if (filters.hadT1Simulation != null) {
    conditions.push(filters.hadT1Simulation ? 'dt.t1_simulation_result IS NOT NULL' : 'dt.t1_simulation_result IS NULL');
  }

  if (filters.contractId) {
    conditions.push(`dt.handoff_contract_id = ${addParam(filters.contractId)}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const countSql = `SELECT COUNT(*)::int AS count FROM decision_traces dt JOIN activity_log a ON a.id = dt.audit_log_id LEFT JOIN agent_handoff_contracts c ON c.id = dt.handoff_contract_id ${whereClause}`;
  const dataSql = `${buildQueryBase(whereClause)} ORDER BY dt.created_at DESC LIMIT ${addParam(pageSize)} OFFSET ${addParam((page - 1) * pageSize)}`;

  const [countRows, rows] = await Promise.all([
    systemQuery<{ count: number }>(countSql, params.slice(0, params.length - 2)),
    systemQuery<DecisionTraceRow>(dataSql, params),
  ]);

  return {
    page,
    pageSize,
    total: countRows[0]?.count ?? 0,
    items: rows.map(normalizeDecisionTraceRow),
  };
}

export async function getDecisionTraceById(traceId: string): Promise<DecisionTraceEntry | null> {
  const rows = await systemQuery<DecisionTraceRow>(
    `${buildQueryBase('WHERE dt.id = $1')} LIMIT 1`,
    [traceId],
  );
  return rows[0] ? normalizeDecisionTraceRow(rows[0]) : null;
}

export async function getDecisionTraceByAuditLogId(auditLogId: string): Promise<DecisionTraceEntry | null> {
  const rows = await systemQuery<DecisionTraceRow>(
    `${buildQueryBase('WHERE dt.audit_log_id = $1')} LIMIT 1`,
    [auditLogId],
  );
  return rows[0] ? normalizeDecisionTraceRow(rows[0]) : null;
}

export async function updateDecisionTraceExplanation(traceId: string, explanation: string): Promise<void> {
  await systemQuery(
    `UPDATE decision_traces
     SET nl_explanation = $2
     WHERE id = $1`,
    [traceId, explanation],
  );
}