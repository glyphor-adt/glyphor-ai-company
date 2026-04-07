import { systemQuery } from './db.js';
import type { CapacityTier } from './agentCapacity.js';

const METRICS_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_WINDOWS = [7, 30, 90] as const;

type WindowDays = typeof DEFAULT_WINDOWS[number];

interface AgentIdentityRow {
  agent_id: string;
  agent_name: string;
  department: string | null;
  role_category: string | null;
}

interface CountRow {
  total: number | string;
  completed?: number | string;
  failed?: number | string;
  avg_minutes?: number | string | null;
  breached?: number | string;
  contradicted?: number | string;
  total_facts?: number | string;
  total_tokens?: number | string;
  avg_confidence?: number | string | null;
  total_reversals?: number | string;
}

interface CacheRow {
  metrics: unknown;
  computed_at: string;
}

interface TrustRow {
  trust_score: number | string | null;
}

interface AutonomyRow {
  avg_level: number | string | null;
}

interface BenchmarkCompletionRow {
  role_category: string;
  avg_completion_rate: number | string | null;
  agent_count: number | string;
}

interface BenchmarkAutonomyRow {
  autonomy_level: CapacityTier;
  avg_days: number | string | null;
  sample_size: number | string;
}

interface BenchmarkEscalationRow {
  escalation_type: string;
  count: number | string;
}

interface ExceptionLogRow {
  task_id: string;
  agent_id: string;
  agent_name: string;
  escalation_reason: string | null;
  escalated_at: string;
  resolved_by_human_id: string | null;
  resolution: string | null;
  resolution_time_minutes: number | string | null;
}

interface ReversalRow {
  id: string;
  audit_log_id: string;
  agent_id: string;
  action_type: string;
  reversal_reason: string;
  reversed_by: string;
  reversed_at: string;
  resolution_notes: string | null;
  audit_summary: string | null;
}

interface ActionTypeRow {
  action: string;
}

interface CommonReasonRow {
  reversal_reason: string;
}

export interface AgentMetricsSnapshot {
  agentId: string;
  agentName: string;
  department: string | null;
  roleCategory: string | null;
  windowDays: number;
  tasksDispatched: number;
  tasksCompleted: number;
  tasksFailed: number;
  tasksEscalated: number;
  completionRate: number;
  escalationRate: number;
  avgConfidenceScore: number | null;
  avgTimeToCompletionMinutes: number | null;
  computeCostPerTask: number;
  slaBreachRate: number;
  contradictionRate: number;
  trustScoreCurrent: number | null;
  computedAt: string;
}

export interface FleetLeaderMetric {
  agentId: string;
  agentName: string;
  value: number;
}

export interface FleetMetricsSnapshot extends Omit<AgentMetricsSnapshot, 'agentId' | 'agentName' | 'department' | 'roleCategory'> {
  mostReliableAgent: FleetLeaderMetric | null;
  mostEscalations: FleetLeaderMetric | null;
  mostImproved: (FleetLeaderMetric & { previousValue: number; delta: number }) | null;
  avgAutonomyLevel: number | null;
  totalAgents: number;
}

export interface ExceptionLogFilters {
  agentId?: string;
  startDate?: string;
  endDate?: string;
  resolutionStatus?: 'resolved' | 'unresolved' | 'all';
  page?: number;
  pageSize?: number;
}

export interface ExceptionLogEntry {
  taskId: string;
  agentId: string;
  agentName: string;
  escalationReason: string | null;
  escalatedAt: string;
  resolvedByHumanId: string | null;
  resolution: string | null;
  resolutionTimeMinutes: number | null;
}

export interface ExceptionLogResult {
  page: number;
  pageSize: number;
  total: number;
  items: ExceptionLogEntry[];
}

export interface ActionReversalEntry {
  id: string;
  auditLogId: string;
  agentId: string;
  actionType: string;
  reversalReason: string;
  reversedBy: string;
  reversedAt: string;
  resolutionNotes: string | null;
  auditSummary: string | null;
}

export interface ReversalLogFilters {
  agentId?: string;
  windowDays?: number;
  page?: number;
  pageSize?: number;
}

export interface ReversalLogResult {
  page: number;
  pageSize: number;
  total: number;
  items: ActionReversalEntry[];
}

export interface ReversalStats {
  agentId: string;
  windowDays: number;
  totalReversals: number;
  reversalRate: number;
  mostCommonReason: string | null;
}

export interface AgentMetricsWindows {
  agentId: string;
  windows: Record<WindowDays, AgentMetricsSnapshot>;
  reversals: Record<WindowDays, ReversalStats>;
}

export interface BenchmarkRoleCategoryMetric {
  roleCategory: string;
  avgCompletionRate: number;
  agentCount: number;
}

export interface BenchmarkAutonomyMetric {
  autonomyLevel: CapacityTier;
  avgDays: number | null;
  sampleSize: number;
}

export interface BenchmarkEscalationMetric {
  escalationType: string;
  count: number;
}

export interface BenchmarkReport {
  generatedAt: string;
  windowDays: number;
  avgCompletionRateByRoleCategory: BenchmarkRoleCategoryMetric[];
  avgDaysToEachAutonomyLevel: BenchmarkAutonomyMetric[];
  mostCommonEscalationTypes: BenchmarkEscalationMetric[];
}

interface WindowBounds {
  start: Date;
  end: Date;
}

interface AgentIdentity {
  agentId: string;
  agentName: string;
  department: string | null;
  roleCategory: string | null;
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function asNullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const numeric = asNumber(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeDivide(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

function roundMetric(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 10000) / 10000;
}

function buildWindowBounds(windowDays: number, end = new Date()): WindowBounds {
  return {
    start: new Date(end.getTime() - windowDays * 24 * 60 * 60 * 1000),
    end,
  };
}

function buildPreviousWindowBounds(windowDays: number, end = new Date()): WindowBounds {
  const current = buildWindowBounds(windowDays, end);
  return {
    start: new Date(current.start.getTime() - windowDays * 24 * 60 * 60 * 1000),
    end: current.start,
  };
}

function parseCachedMetrics(value: unknown): AgentMetricsSnapshot | null {
  let record: unknown = value;
  if (typeof value === 'string') {
    try {
      record = JSON.parse(value);
    } catch {
      return null;
    }
  }

  if (!isRecord(record)) return null;
  if (typeof record.agentId !== 'string' || typeof record.agentName !== 'string') return null;

  return {
    agentId: record.agentId,
    agentName: record.agentName,
    department: typeof record.department === 'string' ? record.department : null,
    roleCategory: typeof record.roleCategory === 'string' ? record.roleCategory : null,
    windowDays: asNumber(record.windowDays),
    tasksDispatched: asNumber(record.tasksDispatched),
    tasksCompleted: asNumber(record.tasksCompleted),
    tasksFailed: asNumber(record.tasksFailed),
    tasksEscalated: asNumber(record.tasksEscalated),
    completionRate: asNumber(record.completionRate),
    escalationRate: asNumber(record.escalationRate),
    avgConfidenceScore: asNullableNumber(record.avgConfidenceScore),
    avgTimeToCompletionMinutes: asNullableNumber(record.avgTimeToCompletionMinutes),
    computeCostPerTask: asNumber(record.computeCostPerTask),
    slaBreachRate: asNumber(record.slaBreachRate),
    contradictionRate: asNumber(record.contradictionRate),
    trustScoreCurrent: asNullableNumber(record.trustScoreCurrent),
    computedAt: typeof record.computedAt === 'string' ? record.computedAt : new Date().toISOString(),
  };
}

async function resolveAgentIdentity(agentId: string): Promise<AgentIdentity> {
  const rows = await systemQuery<AgentIdentityRow>(
    `SELECT
       COALESCE(c.role, $1) AS agent_id,
       COALESCE(NULLIF(TRIM(c.display_name), ''), NULLIF(TRIM(c.name), ''), $1) AS agent_name,
       c.department,
       COALESCE(ac.metadata->>'role_category', c.department, 'Other') AS role_category
     FROM company_agents c
     LEFT JOIN agent_capacity_config ac ON ac.agent_id = c.role OR ac.agent_id = c.id::text
     WHERE c.role = $1 OR c.id::text = $1
     LIMIT 1`,
    [agentId],
  );

  const row = rows[0];
  if (!row) {
    return { agentId, agentName: agentId, department: null, roleCategory: null };
  }

  return {
    agentId: row.agent_id,
    agentName: row.agent_name,
    department: row.department,
    roleCategory: row.role_category,
  };
}

async function listAgentIdentities(): Promise<AgentIdentity[]> {
  const rows = await systemQuery<AgentIdentityRow>(
    `SELECT
       c.role AS agent_id,
       COALESCE(NULLIF(TRIM(c.display_name), ''), NULLIF(TRIM(c.name), ''), c.role) AS agent_name,
       c.department,
       COALESCE(ac.metadata->>'role_category', c.department, 'Other') AS role_category
     FROM company_agents c
     LEFT JOIN agent_capacity_config ac ON ac.agent_id = c.role OR ac.agent_id = c.id::text
     WHERE c.role IS NOT NULL
       AND c.role <> 'system'
       AND COALESCE(c.status, 'active') NOT IN ('retired', 'inactive')
       AND (
         COALESCE(c.is_temporary, false) = false
         OR c.expires_at IS NULL
         OR c.expires_at > NOW()
       )
     ORDER BY agent_name ASC`,
    [],
  );

  return rows.map((row) => ({
    agentId: row.agent_id,
    agentName: row.agent_name,
    department: row.department,
    roleCategory: row.role_category,
  }));
}

async function getAssignmentMetrics(agentId: string | null, bounds: WindowBounds): Promise<{ total: number; completed: number; failed: number; avgMinutes: number | null }> {
  const params = agentId
    ? [agentId, bounds.start.toISOString(), bounds.end.toISOString()]
    : [bounds.start.toISOString(), bounds.end.toISOString()];
  const rows = await systemQuery<CountRow>(
    agentId
      ? `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
           COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
           AVG(EXTRACT(EPOCH FROM (completed_at - COALESCE(dispatched_at, created_at))) / 60.0)
             FILTER (WHERE status = 'completed' AND completed_at IS NOT NULL) AS avg_minutes
         FROM work_assignments
         WHERE assigned_to = $1
           AND COALESCE(dispatched_at, created_at) >= $2
           AND COALESCE(dispatched_at, created_at) < $3`
      : `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
           COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
           AVG(EXTRACT(EPOCH FROM (completed_at - COALESCE(dispatched_at, created_at))) / 60.0)
             FILTER (WHERE status = 'completed' AND completed_at IS NOT NULL) AS avg_minutes
         FROM work_assignments
         WHERE COALESCE(dispatched_at, created_at) >= $1
           AND COALESCE(dispatched_at, created_at) < $2`,
    params,
  );

  const row = rows[0];
  const assignmentMetrics = {
    total: asNumber(row?.total),
    completed: asNumber(row?.completed),
    failed: asNumber(row?.failed),
    avgMinutes: roundMetric(asNullableNumber(row?.avg_minutes)),
  };

  // Fallback: some workloads run without writing work_assignments.
  // In that case, derive reliability counts from agent_runs so dashboards stay populated.
  if (assignmentMetrics.total > 0) {
    return assignmentMetrics;
  }

  const runParams = agentId
    ? [agentId, bounds.start.toISOString(), bounds.end.toISOString()]
    : [bounds.start.toISOString(), bounds.end.toISOString()];
  const runRows = await systemQuery<CountRow>(
    agentId
      ? `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
           COUNT(*) FILTER (WHERE status IN ('failed', 'error', 'aborted'))::int AS failed,
           AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) / 60.0)
             FILTER (WHERE status = 'completed' AND completed_at IS NOT NULL) AS avg_minutes
         FROM agent_runs
         WHERE agent_role = $1
           AND started_at >= $2
           AND started_at < $3`
      : `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
           COUNT(*) FILTER (WHERE status IN ('failed', 'error', 'aborted'))::int AS failed,
           AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) / 60.0)
             FILTER (WHERE status = 'completed' AND completed_at IS NOT NULL) AS avg_minutes
         FROM agent_runs
         WHERE started_at >= $1
           AND started_at < $2`,
    runParams,
  );

  const runRow = runRows[0];
  return {
    total: asNumber(runRow?.total),
    completed: asNumber(runRow?.completed),
    failed: asNumber(runRow?.failed),
    avgMinutes: roundMetric(asNullableNumber(runRow?.avg_minutes)),
  };
}

async function getEscalationCount(agentId: string | null, bounds: WindowBounds): Promise<number> {
  const params = agentId
    ? [agentId, bounds.start.toISOString(), bounds.end.toISOString()]
    : [bounds.start.toISOString(), bounds.end.toISOString()];
  const rows = await systemQuery<CountRow>(
    agentId
      ? `SELECT COUNT(DISTINCT al.contract_id)::int AS total
         FROM agent_handoff_contract_audit_log al
         INNER JOIN agent_handoff_contracts c ON c.id = al.contract_id
         WHERE c.receiving_agent_id = $1
           AND c.escalation_policy = 'escalate_to_human'
           AND al.event_type IN ('escalated', 'sla_breached')
           AND al.created_at >= $2
           AND al.created_at < $3`
      : `SELECT COUNT(DISTINCT al.contract_id)::int AS total
         FROM agent_handoff_contract_audit_log al
         INNER JOIN agent_handoff_contracts c ON c.id = al.contract_id
         WHERE c.escalation_policy = 'escalate_to_human'
           AND al.event_type IN ('escalated', 'sla_breached')
           AND al.created_at >= $1
           AND al.created_at < $2`,
    params,
  );
  return asNumber(rows[0]?.total);
}

async function getConfidenceMetrics(agentId: string | null, bounds: WindowBounds): Promise<number | null> {
  const params = agentId
    ? [agentId, bounds.start.toISOString(), bounds.end.toISOString()]
    : [bounds.start.toISOString(), bounds.end.toISOString()];
  const rows = await systemQuery<CountRow>(
    agentId
      ? `SELECT AVG(confidence_at_decision) AS avg_confidence
         FROM decision_traces
         WHERE agent_id = $1
           AND created_at >= $2
           AND created_at < $3`
      : `SELECT AVG(confidence_at_decision) AS avg_confidence
         FROM decision_traces
         WHERE created_at >= $1
           AND created_at < $2`,
    params,
  );
  return roundMetric(asNullableNumber(rows[0]?.avg_confidence));
}

async function getComputeTokensPerCompletedTask(agentId: string | null, bounds: WindowBounds, tasksCompleted: number): Promise<number> {
  if (tasksCompleted <= 0) return 0;

  const params = agentId
    ? [agentId, bounds.start.toISOString(), bounds.end.toISOString()]
    : [bounds.start.toISOString(), bounds.end.toISOString()];
  const rows = await systemQuery<CountRow>(
    agentId
      ? `SELECT COALESCE(SUM(
             COALESCE(input_tokens, 0) +
             COALESCE(output_tokens, 0) +
             COALESCE(thinking_tokens, 0) +
             COALESCE(cached_input_tokens, 0)
           ), 0)::float AS total_tokens
         FROM activity_log
         WHERE action = 'agent.run.completed'
           AND (agent_role = $1 OR agent_id = $1)
           AND created_at >= $2
           AND created_at < $3`
      : `SELECT COALESCE(SUM(
             COALESCE(input_tokens, 0) +
             COALESCE(output_tokens, 0) +
             COALESCE(thinking_tokens, 0) +
             COALESCE(cached_input_tokens, 0)
           ), 0)::float AS total_tokens
         FROM activity_log
         WHERE action = 'agent.run.completed'
           AND created_at >= $1
           AND created_at < $2`,
    params,
  );

  return roundMetric(safeDivide(asNumber(rows[0]?.total_tokens), tasksCompleted)) ?? 0;
}

async function getSlaBreachRate(agentId: string | null, bounds: WindowBounds): Promise<number> {
  const params = agentId
    ? [agentId, bounds.start.toISOString(), bounds.end.toISOString()]
    : [bounds.start.toISOString(), bounds.end.toISOString()];
  const rows = await systemQuery<CountRow>(
    agentId
      ? `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE sla_breached_at IS NOT NULL)::int AS breached
         FROM agent_handoff_contracts
         WHERE receiving_agent_id = $1
           AND issued_at >= $2
           AND issued_at < $3`
      : `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE sla_breached_at IS NOT NULL)::int AS breached
         FROM agent_handoff_contracts
         WHERE issued_at >= $1
           AND issued_at < $2`,
    params,
  );

  const total = asNumber(rows[0]?.total);
  const breached = asNumber(rows[0]?.breached);
  return roundMetric(safeDivide(breached, total)) ?? 0;
}

async function getContradictionRate(agentId: string | null, bounds: WindowBounds): Promise<number> {
  const params = agentId
    ? [agentId, bounds.start.toISOString(), bounds.end.toISOString()]
    : [bounds.start.toISOString(), bounds.end.toISOString()];
  const rows = await systemQuery<CountRow>(
    agentId
      ? `WITH authored_facts AS (
           SELECT id
           FROM kg_facts
           WHERE source_agent_id = $1
             AND created_at >= $2
             AND created_at < $3
         )
         SELECT
           (SELECT COUNT(*)::int FROM authored_facts) AS total_facts,
           (SELECT COUNT(DISTINCT af.id)::int
            FROM authored_facts af
            INNER JOIN kg_contradictions kc
              ON (kc.fact_a_id = af.id OR kc.fact_b_id = af.id)
             AND kc.detected_at >= $2
             AND kc.detected_at < $3) AS contradicted`
      : `WITH authored_facts AS (
           SELECT id
           FROM kg_facts
           WHERE created_at >= $1
             AND created_at < $2
         )
         SELECT
           (SELECT COUNT(*)::int FROM authored_facts) AS total_facts,
           (SELECT COUNT(DISTINCT af.id)::int
            FROM authored_facts af
            INNER JOIN kg_contradictions kc
              ON (kc.fact_a_id = af.id OR kc.fact_b_id = af.id)
             AND kc.detected_at >= $1
             AND kc.detected_at < $2) AS contradicted`,
    params,
  );

  const totalFacts = asNumber(rows[0]?.total_facts);
  const contradicted = asNumber(rows[0]?.contradicted);
  return roundMetric(safeDivide(contradicted, totalFacts)) ?? 0;
}

async function getTrustScore(agentId: string | null): Promise<number | null> {
  const rows = await systemQuery<TrustRow>(
    agentId
      ? `SELECT trust_score
         FROM agent_trust_scores
         WHERE agent_role = $1
         LIMIT 1`
      : `SELECT AVG(trust_score) AS trust_score
         FROM agent_trust_scores`,
    agentId ? [agentId] : [],
  );
  return roundMetric(asNullableNumber(rows[0]?.trust_score));
}

async function computeMetricsSnapshot(identity: AgentIdentity | null, windowDays: number, bounds: WindowBounds): Promise<AgentMetricsSnapshot> {
  const [assignments, escalations, avgConfidenceScore, slaBreachRate, contradictionRate, trustScoreCurrent] = await Promise.all([
    getAssignmentMetrics(identity?.agentId ?? null, bounds).catch(() => ({ total: 0, completed: 0, failed: 0, avgMinutes: null })),
    getEscalationCount(identity?.agentId ?? null, bounds).catch(() => 0),
    getConfidenceMetrics(identity?.agentId ?? null, bounds).catch(() => null),
    getSlaBreachRate(identity?.agentId ?? null, bounds).catch(() => 0),
    getContradictionRate(identity?.agentId ?? null, bounds).catch(() => 0),
    getTrustScore(identity?.agentId ?? null).catch(() => null),
  ]);

  const computeCostPerTask = await getComputeTokensPerCompletedTask(identity?.agentId ?? null, bounds, assignments.completed)
    .catch(() => 0);

  return {
    agentId: identity?.agentId ?? '__fleet__',
    agentName: identity?.agentName ?? 'Fleet',
    department: identity?.department ?? null,
    roleCategory: identity?.roleCategory ?? null,
    windowDays,
    tasksDispatched: assignments.total,
    tasksCompleted: assignments.completed,
    tasksFailed: assignments.failed,
    tasksEscalated: escalations,
    completionRate: roundMetric(safeDivide(assignments.completed, assignments.total)) ?? 0,
    escalationRate: roundMetric(safeDivide(escalations, assignments.total)) ?? 0,
    avgConfidenceScore,
    avgTimeToCompletionMinutes: assignments.avgMinutes,
    computeCostPerTask,
    slaBreachRate,
    contradictionRate,
    trustScoreCurrent,
    computedAt: new Date().toISOString(),
  };
}

async function readMetricsCache(agentId: string, windowDays: number): Promise<AgentMetricsSnapshot | null> {
  let rows: CacheRow[] = [];
  try {
    rows = await systemQuery<CacheRow>(
      `SELECT metrics, computed_at
       FROM agent_metrics_cache
       WHERE agent_id = $1 AND window_days = $2
       LIMIT 1`,
      [agentId, windowDays],
    );
  } catch {
    return null;
  }

  const row = rows[0];
  if (!row) return null;
  const ageMs = Date.now() - new Date(row.computed_at).getTime();
  if (ageMs > METRICS_CACHE_TTL_MS) return null;
  return parseCachedMetrics(row.metrics);
}

async function writeMetricsCache(agentId: string, windowDays: number, metrics: AgentMetricsSnapshot): Promise<void> {
  try {
    await systemQuery(
      `INSERT INTO agent_metrics_cache (agent_id, window_days, metrics, computed_at)
       VALUES ($1, $2, $3::jsonb, NOW())
       ON CONFLICT (agent_id, window_days)
       DO UPDATE SET metrics = EXCLUDED.metrics, computed_at = EXCLUDED.computed_at`,
      [agentId, windowDays, JSON.stringify(metrics)],
    );
  } catch {
    // Best-effort cache write only.
  }
}

export async function computeAgentMetrics(agentId: string, windowDays: number): Promise<AgentMetricsSnapshot> {
  const identity = await resolveAgentIdentity(agentId);
  const cached = await readMetricsCache(identity.agentId, windowDays);
  if (cached) return cached;

  const metrics = await computeMetricsSnapshot(identity, windowDays, buildWindowBounds(windowDays));
  await writeMetricsCache(identity.agentId, windowDays, metrics);
  return metrics;
}

async function getAverageAutonomyLevel(): Promise<number | null> {
  const rows = await systemQuery<AutonomyRow>(
    `SELECT AVG(
       CASE capacity_tier
         WHEN 'observe' THEN 1
         WHEN 'draft' THEN 2
         WHEN 'execute' THEN 3
         WHEN 'commit' THEN 4
         ELSE NULL
       END
     ) AS avg_level
     FROM agent_capacity_config`,
    [],
  );
  return roundMetric(asNullableNumber(rows[0]?.avg_level));
}

export async function computeFleetMetrics(windowDays: number): Promise<FleetMetricsSnapshot> {
  const [fleetBase, avgAutonomyLevel, agents] = await Promise.all([
    computeMetricsSnapshot(null, windowDays, buildWindowBounds(windowDays)).catch(() => ({
      agentId: '__fleet__',
      agentName: 'Fleet',
      department: null,
      roleCategory: null,
      windowDays,
      tasksDispatched: 0,
      tasksCompleted: 0,
      tasksFailed: 0,
      tasksEscalated: 0,
      completionRate: 0,
      escalationRate: 0,
      avgConfidenceScore: null,
      avgTimeToCompletionMinutes: null,
      computeCostPerTask: 0,
      slaBreachRate: 0,
      contradictionRate: 0,
      trustScoreCurrent: null,
      computedAt: new Date().toISOString(),
    })),
    getAverageAutonomyLevel().catch(() => null),
    listAgentIdentities().catch(() => []),
  ]);

  const currentMetrics = await Promise.all(agents.map((agent) => computeAgentMetrics(agent.agentId, windowDays)));
  const previousMetrics = await Promise.all(agents.map((agent) => computeMetricsSnapshot(agent, windowDays, buildPreviousWindowBounds(windowDays))));

  let mostReliableAgent: FleetLeaderMetric | null = null;
  let mostEscalations: FleetLeaderMetric | null = null;
  let mostImproved: (FleetLeaderMetric & { previousValue: number; delta: number }) | null = null;

  currentMetrics.forEach((metric, index) => {
    if (!mostReliableAgent || metric.completionRate > mostReliableAgent.value) {
      mostReliableAgent = {
        agentId: metric.agentId,
        agentName: metric.agentName,
        value: metric.completionRate,
      };
    }

    if (!mostEscalations || metric.tasksEscalated > mostEscalations.value) {
      mostEscalations = {
        agentId: metric.agentId,
        agentName: metric.agentName,
        value: metric.tasksEscalated,
      };
    }

    const previous = previousMetrics[index];
    const delta = metric.completionRate - previous.completionRate;
    if (!mostImproved || delta > mostImproved.delta) {
      mostImproved = {
        agentId: metric.agentId,
        agentName: metric.agentName,
        value: metric.completionRate,
        previousValue: previous.completionRate,
        delta: roundMetric(delta) ?? 0,
      };
    }
  });

  return {
    ...fleetBase,
    mostReliableAgent,
    mostEscalations,
    mostImproved,
    avgAutonomyLevel,
    totalAgents: agents.length,
  };
}

export async function getAgentMetricsWindows(agentId: string): Promise<AgentMetricsWindows> {
  const [seven, thirty, ninety, reversals7, reversals30, reversals90] = await Promise.all([
    computeAgentMetrics(agentId, 7),
    computeAgentMetrics(agentId, 30),
    computeAgentMetrics(agentId, 90),
    getReversalStats(agentId, 7),
    getReversalStats(agentId, 30),
    getReversalStats(agentId, 90),
  ]);

  return {
    agentId: seven.agentId,
    windows: {
      7: seven,
      30: thirty,
      90: ninety,
    },
    reversals: {
      7: reversals7,
      30: reversals30,
      90: reversals90,
    },
  };
}

export async function listAgentMetrics(windowDays: number): Promise<AgentMetricsSnapshot[]> {
  const agents = await listAgentIdentities();
  return Promise.all(agents.map((agent) => computeAgentMetrics(agent.agentId, windowDays)));
}

export async function getExceptionLog(filters: ExceptionLogFilters = {}): Promise<ExceptionLogResult> {
  const page = Math.max(1, Math.trunc(filters.page ?? 1));
  const pageSize = Math.min(200, Math.max(1, Math.trunc(filters.pageSize ?? 50)));
  const offset = (page - 1) * pageSize;

  const conditions: string[] = ["c.escalation_policy = 'escalate_to_human'", 'esc.escalated_at IS NOT NULL'];
  const values: unknown[] = [];

  const addParam = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };

  if (filters.agentId) {
    conditions.push(`c.receiving_agent_id = ${addParam(filters.agentId)}`);
  }

  if (filters.startDate) {
    conditions.push(`esc.escalated_at >= ${addParam(filters.startDate)}`);
  }

  if (filters.endDate) {
    conditions.push(`esc.escalated_at < ${addParam(filters.endDate)}`);
  }

  if (filters.resolutionStatus === 'resolved') {
    conditions.push('term.terminal_at IS NOT NULL');
  } else if (filters.resolutionStatus === 'unresolved') {
    conditions.push('term.terminal_at IS NULL');
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const baseQuery = `
    FROM agent_handoff_contracts c
    LEFT JOIN LATERAL (
      SELECT created_at AS escalated_at
      FROM agent_handoff_contract_audit_log
      WHERE contract_id = c.id AND event_type IN ('escalated', 'sla_breached')
      ORDER BY created_at DESC
      LIMIT 1
    ) esc ON TRUE
    LEFT JOIN LATERAL (
      SELECT created_at AS terminal_at, details
      FROM agent_handoff_contract_audit_log
      WHERE contract_id = c.id AND event_type IN ('completed', 'failed', 'rejected')
      ORDER BY created_at DESC
      LIMIT 1
    ) term ON TRUE
    ${where}`;

  const countRows = await systemQuery<CountRow>(`SELECT COUNT(*)::int AS total ${baseQuery}`, values);
  const rows = await systemQuery<ExceptionLogRow>(
    `SELECT
       c.task_id,
       c.receiving_agent_id AS agent_id,
       COALESCE(c.receiving_agent_name, c.receiving_agent_id) AS agent_name,
       c.escalation_reason,
       esc.escalated_at,
       COALESCE(term.details->>'resolved_by_human_id', term.details->>'resolvedBy', term.details->>'resolved_by', term.details->>'approverHumanId') AS resolved_by_human_id,
       COALESCE(term.details->>'resolution', term.details->>'reason', c.output_payload->>'resolution', c.output_payload->>'output') AS resolution,
       CASE
         WHEN term.terminal_at IS NULL THEN NULL
         ELSE EXTRACT(EPOCH FROM (COALESCE(c.completed_at, term.terminal_at) - esc.escalated_at)) / 60.0
       END AS resolution_time_minutes
     ${baseQuery}
     ORDER BY esc.escalated_at DESC
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, pageSize, offset],
  );

  return {
    page,
    pageSize,
    total: asNumber(countRows[0]?.total),
    items: rows.map((row) => ({
      taskId: row.task_id,
      agentId: row.agent_id,
      agentName: row.agent_name,
      escalationReason: row.escalation_reason,
      escalatedAt: row.escalated_at,
      resolvedByHumanId: row.resolved_by_human_id,
      resolution: row.resolution,
      resolutionTimeMinutes: roundMetric(asNullableNumber(row.resolution_time_minutes)),
    })),
  };
}

export async function logReversal(
  auditLogId: string,
  agentId: string,
  reason: string,
  reversedBy: string,
  resolutionNotes?: string | null,
): Promise<ActionReversalEntry> {
  const actionRows = await systemQuery<ActionTypeRow>(
    `SELECT action FROM activity_log WHERE id = $1 LIMIT 1`,
    [auditLogId],
  );
  const actionType = actionRows[0]?.action ?? 'unknown';

  const rows = await systemQuery<ReversalRow>(
    `INSERT INTO action_reversals (
       audit_log_id,
       agent_id,
       action_type,
       reversal_reason,
       reversed_by,
       reversed_at,
       resolution_notes
     )
     VALUES ($1,$2,$3,$4,$5,NOW(),$6)
     RETURNING id, audit_log_id, agent_id, action_type, reversal_reason, reversed_by, reversed_at, resolution_notes, NULL::text AS audit_summary`,
    [auditLogId, agentId, actionType, reason, reversedBy, resolutionNotes ?? null],
  );

  const row = rows[0];
  return {
    id: row.id,
    auditLogId: row.audit_log_id,
    agentId: row.agent_id,
    actionType: row.action_type,
    reversalReason: row.reversal_reason,
    reversedBy: row.reversed_by,
    reversedAt: row.reversed_at,
    resolutionNotes: row.resolution_notes,
    auditSummary: row.audit_summary,
  };
}

export async function listActionReversals(filters: ReversalLogFilters = {}): Promise<ReversalLogResult> {
  const page = Math.max(1, Math.trunc(filters.page ?? 1));
  const pageSize = Math.min(200, Math.max(1, Math.trunc(filters.pageSize ?? 50)));
  const offset = (page - 1) * pageSize;

  const conditions: string[] = [];
  const values: unknown[] = [];

  const addParam = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };

  if (filters.agentId) {
    conditions.push(`ar.agent_id = ${addParam(filters.agentId)}`);
  }

  if (filters.windowDays) {
    conditions.push(`ar.reversed_at >= ${addParam(new Date(Date.now() - filters.windowDays * 24 * 60 * 60 * 1000).toISOString())}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const baseQuery = `
    FROM action_reversals ar
    LEFT JOIN activity_log al ON al.id = ar.audit_log_id
    ${where}`;

  const countRows = await systemQuery<CountRow>(`SELECT COUNT(*)::int AS total ${baseQuery}`, values);
  const rows = await systemQuery<ReversalRow>(
    `SELECT
       ar.id,
       ar.audit_log_id,
       ar.agent_id,
       ar.action_type,
       ar.reversal_reason,
       ar.reversed_by,
       ar.reversed_at,
       ar.resolution_notes,
       al.summary AS audit_summary
     ${baseQuery}
     ORDER BY ar.reversed_at DESC
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, pageSize, offset],
  );

  return {
    page,
    pageSize,
    total: asNumber(countRows[0]?.total),
    items: rows.map((row) => ({
      id: row.id,
      auditLogId: row.audit_log_id,
      agentId: row.agent_id,
      actionType: row.action_type,
      reversalReason: row.reversal_reason,
      reversedBy: row.reversed_by,
      reversedAt: row.reversed_at,
      resolutionNotes: row.resolution_notes,
      auditSummary: row.audit_summary,
    })),
  };
}

export async function getReversalStats(agentId: string, windowDays: number): Promise<ReversalStats> {
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  const [reversalRows, auditRows, reasonRows] = await Promise.all([
    systemQuery<CountRow>(
      `SELECT COUNT(*)::int AS total_reversals
       FROM action_reversals
       WHERE agent_id = $1 AND reversed_at >= $2`,
      [agentId, cutoff],
    ),
    systemQuery<CountRow>(
      `SELECT COUNT(*)::int AS total
       FROM activity_log
       WHERE (agent_role = $1 OR agent_id = $1)
         AND created_at >= $2`,
      [agentId, cutoff],
    ),
    systemQuery<CommonReasonRow>(
      `SELECT reversal_reason
       FROM action_reversals
       WHERE agent_id = $1 AND reversed_at >= $2
       GROUP BY reversal_reason
       ORDER BY COUNT(*) DESC, reversal_reason ASC
       LIMIT 1`,
      [agentId, cutoff],
    ),
  ]);

  const totalReversals = asNumber(reversalRows[0]?.total_reversals);
  const totalActions = asNumber(auditRows[0]?.total);

  return {
    agentId,
    windowDays,
    totalReversals,
    reversalRate: roundMetric(safeDivide(totalReversals, totalActions)) ?? 0,
    mostCommonReason: reasonRows[0]?.reversal_reason ?? null,
  };
}

export async function getBenchmarkReport(windowDays = 90): Promise<BenchmarkReport> {
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  const [completionRows, autonomyRows, escalationRows] = await Promise.all([
    systemQuery<BenchmarkCompletionRow>(
      `WITH agent_completion AS (
         SELECT
           wa.assigned_to AS agent_id,
           COALESCE(ac.metadata->>'role_category', ca.department, 'Other') AS role_category,
           COUNT(*)::int AS dispatched,
           COUNT(*) FILTER (WHERE wa.status = 'completed')::int AS completed
         FROM work_assignments wa
         LEFT JOIN company_agents ca ON ca.role = wa.assigned_to OR ca.id::text = wa.assigned_to
         LEFT JOIN agent_capacity_config ac ON ac.agent_id = wa.assigned_to
         WHERE COALESCE(wa.dispatched_at, wa.created_at) >= $1
         GROUP BY wa.assigned_to, COALESCE(ac.metadata->>'role_category', ca.department, 'Other')
       )
       SELECT
         role_category,
         AVG(CASE WHEN dispatched > 0 THEN completed::float / dispatched ELSE NULL END) AS avg_completion_rate,
         COUNT(*)::int AS agent_count
       FROM agent_completion
       GROUP BY role_category
       ORDER BY avg_completion_rate DESC NULLS LAST, role_category ASC`,
      [cutoff],
    ),
    systemQuery<BenchmarkAutonomyRow>(
      `SELECT
         ac.capacity_tier AS autonomy_level,
         AVG(EXTRACT(EPOCH FROM (ac.updated_at - ca.created_at)) / 86400.0) AS avg_days,
         COUNT(*)::int AS sample_size
       FROM agent_capacity_config ac
       INNER JOIN company_agents ca ON ca.role = ac.agent_id OR ca.id::text = ac.agent_id
       GROUP BY ac.capacity_tier
       ORDER BY ac.capacity_tier ASC`,
      [],
    ),
    systemQuery<BenchmarkEscalationRow>(
      `SELECT
         COALESCE(NULLIF(TRIM(escalation_reason), ''), 'unspecified') AS escalation_type,
         COUNT(*)::int AS count
       FROM agent_handoff_contracts
       WHERE escalation_reason IS NOT NULL
         AND issued_at >= $1
       GROUP BY COALESCE(NULLIF(TRIM(escalation_reason), ''), 'unspecified')
       ORDER BY count DESC, escalation_type ASC
       LIMIT 10`,
      [cutoff],
    ),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    windowDays,
    avgCompletionRateByRoleCategory: completionRows.map((row) => ({
      roleCategory: row.role_category,
      avgCompletionRate: roundMetric(asNullableNumber(row.avg_completion_rate)) ?? 0,
      agentCount: asNumber(row.agent_count),
    })),
    avgDaysToEachAutonomyLevel: autonomyRows.map((row) => ({
      autonomyLevel: row.autonomy_level,
      avgDays: roundMetric(asNullableNumber(row.avg_days)),
      sampleSize: asNumber(row.sample_size),
    })),
    mostCommonEscalationTypes: escalationRows.map((row) => ({
      escalationType: row.escalation_type,
      count: asNumber(row.count),
    })),
  };
}