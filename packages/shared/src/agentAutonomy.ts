import { systemQuery, systemTransaction } from './db.js';

const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000000';
const LOOKBACK_DAYS = 30;
const MS_PER_DAY = 86_400_000;

export type AutonomyChangeType = 'promoted' | 'demoted' | 'admin_override' | 'auto_promote' | 'auto_demote';

export interface AutonomyLevelDefinition {
  level: number;
  label: string;
  description: string;
  executionPolicy: string;
  reviewPolicy: string;
  metadata: Record<string, unknown>;
}

export interface AutonomyLevelThreshold {
  level: number;
  completionRateThreshold: number | null;
  confidenceScoreThreshold: number | null;
  escalationRateMax: number | null;
  contradictionRateMax: number | null;
  slaBreachRateMax: number | null;
  minTasksCompleted: number | null;
  metadata: Record<string, unknown>;
}

export interface AgentAutonomyConfig {
  agentId: string;
  currentLevel: number;
  maxAllowedLevel: number;
  autoPromote: boolean;
  autoDemote: boolean;
  promotedAt: string | null;
  lastLevelChangeAt: string;
  lastLevelChangeReason: string | null;
}

export interface AutonomyEvaluationMetrics {
  avgCompletionRate: number;
  avgConfidenceScore: number;
  escalationRate: number;
  contradictionRate: number;
  slaBreachRate: number;
  totalRuns30d: number;
  totalTasksCompleted30d: number;
  totalTasksCompletedLifetime: number;
  currentTrustScore: number;
  sparkline30d: number[];
  trustTrend30d: number;
}

export interface AutonomyRequirementProgress {
  key: 'completion_rate' | 'confidence_score' | 'escalation_rate' | 'contradiction_rate' | 'sla_breach_rate' | 'min_tasks_completed';
  label: string;
  operator: '>=' | '<=';
  target: number;
  actual: number;
  met: boolean;
  progress: number;
}

export interface AutonomyThresholdProgress {
  level: number;
  label: string;
  met: boolean;
  requirements: AutonomyRequirementProgress[];
}

export interface AutonomyEvaluationResult {
  agentId: string;
  currentLevel: number;
  suggestedLevel: number;
  metrics: AutonomyEvaluationMetrics;
  meetsThresholdFor: number[];
  thresholdProgress: AutonomyThresholdProgress[];
}

export interface AutonomyHistoryEntry {
  id: string;
  agentId: string;
  fromLevel: number;
  toLevel: number;
  changeType: AutonomyChangeType;
  trustScoreAtChange: number | null;
  metricsSnapshot: Record<string, unknown>;
  reason: string | null;
  changedBy: string;
  createdAt: string;
}

export interface AutonomyOverviewItem extends AutonomyEvaluationResult {
  displayName: string;
  role: string;
  title: string | null;
  department: string | null;
  status: string | null;
  maxAllowedLevel: number;
  autoPromote: boolean;
  autoDemote: boolean;
  lastLevelChangeAt: string;
  lastLevelChangeReason: string | null;
}

export interface AutonomyAgentDetail {
  agent: {
    id: string;
    role: string;
    displayName: string;
    title: string | null;
    department: string | null;
    status: string | null;
  };
  config: AgentAutonomyConfig;
  evaluation: AutonomyEvaluationResult;
  levels: AutonomyLevelDefinition[];
  thresholds: AutonomyLevelThreshold[];
  history: AutonomyHistoryEntry[];
}

export interface UpdateAgentAutonomyConfigInput {
  maxAllowedLevel?: number;
  autoPromote?: boolean;
  autoDemote?: boolean;
  updatedBy: string;
  reason?: string;
}

export interface ChangeAutonomyLevelInput {
  targetLevel?: number;
  changedBy: string;
  reason?: string;
}

export interface AutonomyOverviewFilters {
  department?: string;
  level?: number;
}

export interface AutonomyCohortBenchmark {
  roleCategory: string;
  averageLevel: number;
  averageDaysToLevel0: number | null;
  averageDaysToLevel1: number | null;
  averageDaysToLevel2: number | null;
  averageDaysToLevel3: number | null;
  averageDaysToLevel4: number | null;
}

export interface DailyAutonomyAdjustment {
  agentId: string;
  fromLevel: number;
  toLevel: number;
  changeType: 'auto_promote' | 'auto_demote';
  reason: string;
  metrics: AutonomyEvaluationMetrics;
}

interface AgentRow {
  id: string;
  role: string;
  display_name: string | null;
  name: string | null;
  title: string | null;
  department: string | null;
  status: string | null;
}

interface ConfigRow {
  agent_id: string;
  current_level: number;
  max_allowed_level: number;
  auto_promote: boolean;
  auto_demote: boolean;
  promoted_at: string | null;
  last_level_change_at: string;
  last_level_change_reason: string | null;
}

interface LevelRow {
  level: number;
  label: string;
  description: string;
  execution_policy: string;
  review_policy: string;
  metadata: Record<string, unknown> | null;
}

interface ThresholdRow {
  level: number;
  completion_rate_threshold: number | null;
  confidence_score_threshold: number | null;
  escalation_rate_max: number | null;
  contradiction_rate_max: number | null;
  sla_breach_rate_max: number | null;
  min_tasks_completed: number | null;
  metadata: Record<string, unknown> | null;
}

interface TrustRow {
  trust_score: number;
  score_history: unknown;
}

interface RunMetricsRow {
  total_runs: number;
  terminal_runs: number;
  completed_runs: number;
  avg_confidence_score: number | null;
}

interface OutcomeMetricsRow {
  total_outcomes: number;
  completed_outcomes: number;
  escalated_outcomes: number;
}

interface CountRow {
  count: number;
}

interface HistoryRow {
  id: string;
  agent_id: string;
  from_level: number;
  to_level: number;
  change_type: AutonomyChangeType;
  trust_score_at_change: number | null;
  metrics_snapshot: Record<string, unknown> | null;
  reason: string | null;
  changed_by: string;
  created_at: string;
}

interface CohortRow {
  role_category: string | null;
  average_level: number;
  avg_days_level_0: number | null;
  avg_days_level_1: number | null;
  avg_days_level_2: number | null;
  avg_days_level_3: number | null;
  avg_days_level_4: number | null;
}

function clampLevel(value: number): number {
  return Math.max(0, Math.min(4, Math.trunc(value)));
}

function toObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return {};
}

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function round(value: number, digits = 4): number {
  return Number(value.toFixed(digits));
}

function mapLevelRow(row: LevelRow): AutonomyLevelDefinition {
  return {
    level: row.level,
    label: row.label,
    description: row.description,
    executionPolicy: row.execution_policy,
    reviewPolicy: row.review_policy,
    metadata: toObject(row.metadata),
  };
}

function mapThresholdRow(row: ThresholdRow): AutonomyLevelThreshold {
  return {
    level: row.level,
    completionRateThreshold: row.completion_rate_threshold,
    confidenceScoreThreshold: row.confidence_score_threshold,
    escalationRateMax: row.escalation_rate_max,
    contradictionRateMax: row.contradiction_rate_max,
    slaBreachRateMax: row.sla_breach_rate_max,
    minTasksCompleted: row.min_tasks_completed,
    metadata: toObject(row.metadata),
  };
}

function mapConfigRow(row: ConfigRow): AgentAutonomyConfig {
  return {
    agentId: row.agent_id,
    currentLevel: row.current_level,
    maxAllowedLevel: row.max_allowed_level,
    autoPromote: row.auto_promote,
    autoDemote: row.auto_demote,
    promotedAt: row.promoted_at,
    lastLevelChangeAt: row.last_level_change_at,
    lastLevelChangeReason: row.last_level_change_reason,
  };
}

function mapHistoryRow(row: HistoryRow): AutonomyHistoryEntry {
  return {
    id: row.id,
    agentId: row.agent_id,
    fromLevel: row.from_level,
    toLevel: row.to_level,
    changeType: row.change_type,
    trustScoreAtChange: row.trust_score_at_change,
    metricsSnapshot: toObject(row.metrics_snapshot),
    reason: row.reason,
    changedBy: row.changed_by,
    createdAt: row.created_at,
  };
}

async function resolveAgent(agentId: string): Promise<AgentRow> {
  const rows = await systemQuery<AgentRow>(
    `SELECT id::text AS id, role, display_name, name, title, department, status
     FROM company_agents
     WHERE role = $1 OR id::text = $1
     LIMIT 1`,
    [agentId],
  );

  if (!rows[0]) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  return rows[0];
}

async function ensureAgentAutonomyConfig(agentId: string): Promise<void> {
  const rows = await systemQuery<{ agent_id: string }>(
    'SELECT agent_id FROM agent_autonomy_config WHERE agent_id = $1 LIMIT 1',
    [agentId],
  );
  if (rows[0]) return;

  await systemQuery(
    `INSERT INTO agent_autonomy_config (
       agent_id,
       current_level,
       max_allowed_level,
       auto_promote,
       auto_demote,
       last_level_change_at,
       last_level_change_reason,
       tenant_id,
       created_at,
       updated_at
     )
     VALUES ($1, 0, 1, TRUE, TRUE, NOW(), 'Provisioned on read', $2, NOW(), NOW())
     ON CONFLICT (agent_id) DO NOTHING`,
    [agentId, DEFAULT_TENANT_ID],
  );
}

async function getConfigRow(agentId: string): Promise<ConfigRow> {
  await ensureAgentAutonomyConfig(agentId);
  const rows = await systemQuery<ConfigRow>(
    `SELECT agent_id, current_level, max_allowed_level, auto_promote, auto_demote, promoted_at, last_level_change_at, last_level_change_reason
     FROM agent_autonomy_config
     WHERE agent_id = $1
     LIMIT 1`,
    [agentId],
  );
  if (!rows[0]) {
    throw new Error(`Autonomy config not found for ${agentId}`);
  }
  return rows[0];
}

function buildSparkline(scoreHistory: unknown, currentTrustScore: number): { sparkline30d: number[]; trustTrend30d: number } {
  const sinceMs = Date.now() - LOOKBACK_DAYS * MS_PER_DAY;
  const entries = toArray(scoreHistory)
    .map((entry) => toObject(entry))
    .flatMap((entry) => {
      const timestamp = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : Number.NaN;
      const score = typeof entry.score === 'number' ? entry.score : typeof entry.score === 'string' ? Number(entry.score) : Number.NaN;
      if (!Number.isFinite(timestamp) || !Number.isFinite(score)) return [];
      return [{ timestamp, score }];
    })
    .filter((entry) => entry.timestamp >= sinceMs)
    .sort((left, right) => left.timestamp - right.timestamp);

  const sparkline30d: number[] = [];
  let lastScore = entries[0]?.score ?? currentTrustScore;
  for (let day = LOOKBACK_DAYS - 1; day >= 0; day -= 1) {
    const dayStart = Date.now() - day * MS_PER_DAY;
    for (const entry of entries) {
      if (entry.timestamp <= dayStart) {
        lastScore = entry.score;
      } else {
        break;
      }
    }
    sparkline30d.push(round(lastScore));
  }

  const first = sparkline30d[0] ?? currentTrustScore;
  const last = sparkline30d[sparkline30d.length - 1] ?? currentTrustScore;
  return {
    sparkline30d,
    trustTrend30d: round(last - first),
  };
}

function buildRequirementProgress(
  key: AutonomyRequirementProgress['key'],
  label: string,
  operator: AutonomyRequirementProgress['operator'],
  target: number,
  actual: number,
): AutonomyRequirementProgress {
  const met = operator === '>=' ? actual >= target : actual <= target;
  const rawProgress = operator === '>='
    ? target <= 0 ? 1 : actual / target
    : actual <= 0 ? 1 : target / actual;

  return {
    key,
    label,
    operator,
    target: round(target),
    actual: round(actual),
    met,
    progress: round(Math.max(0, Math.min(1, rawProgress))),
  };
}

function buildThresholdProgress(
  levels: AutonomyLevelDefinition[],
  thresholds: AutonomyLevelThreshold[],
  metrics: AutonomyEvaluationMetrics,
): { meetsThresholdFor: number[]; thresholdProgress: AutonomyThresholdProgress[]; suggestedLevel: number } {
  const labelMap = new Map(levels.map((level) => [level.level, level.label]));
  const thresholdProgress = thresholds
    .sort((left, right) => left.level - right.level)
    .map((threshold) => {
      const requirements: AutonomyRequirementProgress[] = [];

      if (threshold.completionRateThreshold != null) {
        requirements.push(buildRequirementProgress('completion_rate', 'Completion rate', '>=', threshold.completionRateThreshold, metrics.avgCompletionRate));
      }
      if (threshold.confidenceScoreThreshold != null) {
        requirements.push(buildRequirementProgress('confidence_score', 'Confidence score', '>=', threshold.confidenceScoreThreshold, metrics.avgConfidenceScore));
      }
      if (threshold.escalationRateMax != null) {
        requirements.push(buildRequirementProgress('escalation_rate', 'Escalation rate', '<=', threshold.escalationRateMax, metrics.escalationRate));
      }
      if (threshold.contradictionRateMax != null) {
        requirements.push(buildRequirementProgress('contradiction_rate', 'Contradiction rate', '<=', threshold.contradictionRateMax, metrics.contradictionRate));
      }
      if (threshold.slaBreachRateMax != null) {
        requirements.push(buildRequirementProgress('sla_breach_rate', 'SLA breach rate', '<=', threshold.slaBreachRateMax, metrics.slaBreachRate));
      }
      if (threshold.minTasksCompleted != null) {
        requirements.push(buildRequirementProgress('min_tasks_completed', 'Completed tasks', '>=', threshold.minTasksCompleted, metrics.totalTasksCompletedLifetime));
      }

      const met = threshold.level === 0 || requirements.every((requirement) => requirement.met);
      return {
        level: threshold.level,
        label: labelMap.get(threshold.level) ?? `Level ${threshold.level}`,
        met,
        requirements,
      };
    });

  const meetsThresholdFor = thresholdProgress.filter((entry) => entry.met).map((entry) => entry.level);
  const suggestedLevel = meetsThresholdFor.length > 0 ? Math.max(...meetsThresholdFor) : 0;
  return { meetsThresholdFor, thresholdProgress, suggestedLevel };
}

async function loadRunMetrics(agentRole: string, since: string): Promise<RunMetricsRow> {
  const rows = await systemQuery<RunMetricsRow>(
    `SELECT
       COUNT(*)::int AS total_runs,
       COUNT(*) FILTER (WHERE status IN ('completed', 'failed', 'aborted', 'skipped_precheck'))::int AS terminal_runs,
       COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_runs,
       AVG(reasoning_confidence) FILTER (WHERE reasoning_confidence IS NOT NULL)::double precision AS avg_confidence_score
     FROM agent_runs
     WHERE agent_id = $1
       AND started_at >= $2::timestamptz`,
    [agentRole, since],
  );
  return rows[0] ?? { total_runs: 0, terminal_runs: 0, completed_runs: 0, avg_confidence_score: null };
}

async function loadOutcomeMetrics(agentRole: string, since: string): Promise<OutcomeMetricsRow> {
  const rows = await systemQuery<OutcomeMetricsRow>(
    `SELECT
       COUNT(*)::int AS total_outcomes,
       COUNT(*) FILTER (WHERE final_status = 'submitted')::int AS completed_outcomes,
       COUNT(*) FILTER (WHERE final_status IN ('flagged_blocker', 'partial_progress', 'aborted'))::int AS escalated_outcomes
     FROM task_run_outcomes
     WHERE agent_role = $1
       AND created_at >= $2::timestamptz`,
    [agentRole, since],
  );
  return rows[0] ?? { total_outcomes: 0, completed_outcomes: 0, escalated_outcomes: 0 };
}

async function safeCount(sql: string, params: unknown[]): Promise<number> {
  try {
    const rows = await systemQuery<CountRow>(sql, params);
    return rows[0]?.count ?? 0;
  } catch {
    return 0;
  }
}

async function loadMetrics(agentRole: string): Promise<AutonomyEvaluationMetrics> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * MS_PER_DAY).toISOString();

  const [trustRows, runMetrics, outcomeMetrics, contradictionCount, slaRows, lifetimeRunsRows] = await Promise.all([
    systemQuery<TrustRow>(
      'SELECT trust_score, score_history FROM agent_trust_scores WHERE agent_role = $1 LIMIT 1',
      [agentRole],
    ),
    loadRunMetrics(agentRole, since),
    loadOutcomeMetrics(agentRole, since),
    safeCount(
      `SELECT COUNT(*)::int AS count
       FROM kg_contradictions
       WHERE detected_at >= $2::timestamptz
         AND ($1 = fact_a_agent_id OR $1 = fact_b_agent_id)`,
      [agentRole, since],
    ),
    systemQuery<{ total_contracts: number; breached_contracts: number }>(
      `SELECT
         COUNT(*)::int AS total_contracts,
         COUNT(*) FILTER (WHERE sla_breached_at IS NOT NULL)::int AS breached_contracts
       FROM agent_handoff_contracts
       WHERE receiving_agent_id = $1
         AND issued_at >= $2::timestamptz`,
      [agentRole, since],
    ).catch(() => []),
    systemQuery<CountRow>(
      `SELECT COUNT(*) FILTER (WHERE status = 'completed')::int AS count
       FROM agent_runs
       WHERE agent_id = $1`,
      [agentRole],
    ),
  ]);

  const trustRow = trustRows[0] ?? { trust_score: 0.5, score_history: [] };
  const completionRate = outcomeMetrics.total_outcomes > 0
    ? outcomeMetrics.completed_outcomes / Math.max(1, outcomeMetrics.total_outcomes)
    : runMetrics.completed_runs / Math.max(1, runMetrics.terminal_runs || runMetrics.total_runs || 1);
  const escalationRate = outcomeMetrics.total_outcomes > 0
    ? outcomeMetrics.escalated_outcomes / Math.max(1, outcomeMetrics.total_outcomes)
    : (runMetrics.total_runs - runMetrics.completed_runs) / Math.max(1, runMetrics.total_runs || 1);
  const totalCompleted30d = outcomeMetrics.total_outcomes > 0 ? outcomeMetrics.completed_outcomes : runMetrics.completed_runs;
  const contradictionRate = contradictionCount / Math.max(1, runMetrics.total_runs || outcomeMetrics.total_outcomes || 1);
  const totalContracts = slaRows[0]?.total_contracts ?? 0;
  const breachedContracts = slaRows[0]?.breached_contracts ?? 0;
  const slaBreachRate = breachedContracts / Math.max(1, totalContracts || 1);
  const sparkline = buildSparkline(trustRow.score_history, trustRow.trust_score);

  return {
    avgCompletionRate: round(completionRate),
    avgConfidenceScore: round(runMetrics.avg_confidence_score ?? trustRow.trust_score),
    escalationRate: round(Math.max(0, escalationRate)),
    contradictionRate: round(Math.max(0, contradictionRate)),
    slaBreachRate: round(Math.max(0, slaBreachRate)),
    totalRuns30d: runMetrics.total_runs,
    totalTasksCompleted30d: totalCompleted30d,
    totalTasksCompletedLifetime: lifetimeRunsRows[0]?.count ?? 0,
    currentTrustScore: round(trustRow.trust_score),
    sparkline30d: sparkline.sparkline30d,
    trustTrend30d: sparkline.trustTrend30d,
  };
}

export async function getAutonomyLevels(): Promise<AutonomyLevelDefinition[]> {
  const rows = await systemQuery<LevelRow>(
    `SELECT level, label, description, execution_policy, review_policy, metadata
     FROM autonomy_level_config
     WHERE tenant_id = $1
     ORDER BY level ASC`,
    [DEFAULT_TENANT_ID],
  );
  return rows.map(mapLevelRow);
}

export async function getAutonomyThresholds(): Promise<AutonomyLevelThreshold[]> {
  const rows = await systemQuery<ThresholdRow>(
    `SELECT level, completion_rate_threshold, confidence_score_threshold, escalation_rate_max, contradiction_rate_max, sla_breach_rate_max, min_tasks_completed, metadata
     FROM autonomy_level_thresholds
     WHERE tenant_id = $1
     ORDER BY level ASC`,
    [DEFAULT_TENANT_ID],
  );
  return rows.map(mapThresholdRow);
}

export async function getAgentAutonomyConfig(agentId: string): Promise<AgentAutonomyConfig> {
  const agent = await resolveAgent(agentId);
  return mapConfigRow(await getConfigRow(agent.role));
}

export async function evaluateAutonomyLevel(agentId: string): Promise<AutonomyEvaluationResult> {
  const agent = await resolveAgent(agentId);
  const [config, levels, thresholds, metrics] = await Promise.all([
    getConfigRow(agent.role),
    getAutonomyLevels(),
    getAutonomyThresholds(),
    loadMetrics(agent.role),
  ]);

  const progress = buildThresholdProgress(levels, thresholds, metrics);
  return {
    agentId: agent.role,
    currentLevel: config.current_level,
    suggestedLevel: progress.suggestedLevel,
    metrics,
    meetsThresholdFor: progress.meetsThresholdFor,
    thresholdProgress: progress.thresholdProgress,
  };
}

function getDisplayName(agent: AgentRow): string {
  return agent.display_name?.trim() || agent.name?.trim() || agent.role;
}

export async function listAutonomyOverview(filters: AutonomyOverviewFilters = {}): Promise<AutonomyOverviewItem[]> {
  const params: unknown[] = [];
  const where = [`COALESCE(status, 'active') NOT IN ('inactive', 'retired', 'deleted')`];

  if (filters.department) {
    params.push(filters.department);
    where.push(`department = $${params.length}`);
  }

  const agents = await systemQuery<AgentRow>(
    `SELECT id::text AS id, role, display_name, name, title, department, status
     FROM company_agents
     WHERE ${where.join(' AND ')}
     ORDER BY COALESCE(display_name, name, role) ASC`,
    params,
  );

  const items = await Promise.all(agents.map(async (agent) => {
    const [config, evaluation] = await Promise.all([
      getAgentAutonomyConfig(agent.role),
      evaluateAutonomyLevel(agent.role),
    ]);

    return {
      ...evaluation,
      displayName: getDisplayName(agent),
      role: agent.role,
      title: agent.title,
      department: agent.department,
      status: agent.status,
      maxAllowedLevel: config.maxAllowedLevel,
      autoPromote: config.autoPromote,
      autoDemote: config.autoDemote,
      lastLevelChangeAt: config.lastLevelChangeAt,
      lastLevelChangeReason: config.lastLevelChangeReason,
    } satisfies AutonomyOverviewItem;
  }));

  return items.filter((item) => filters.level == null || item.currentLevel === clampLevel(filters.level));
}

export async function getAutonomyHistory(agentId: string, limit = 50): Promise<AutonomyHistoryEntry[]> {
  const agent = await resolveAgent(agentId);
  const rows = await systemQuery<HistoryRow>(
    `SELECT id, agent_id, from_level, to_level, change_type, trust_score_at_change, metrics_snapshot, reason, changed_by, created_at
     FROM autonomy_level_history
     WHERE agent_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [agent.role, Math.max(1, Math.min(200, limit))],
  );
  return rows.map(mapHistoryRow);
}

export async function getAutonomyAgentDetail(agentId: string): Promise<AutonomyAgentDetail> {
  const agent = await resolveAgent(agentId);
  const [config, evaluation, levels, thresholds, history] = await Promise.all([
    getAgentAutonomyConfig(agent.role),
    evaluateAutonomyLevel(agent.role),
    getAutonomyLevels(),
    getAutonomyThresholds(),
    getAutonomyHistory(agent.role, 100),
  ]);

  return {
    agent: {
      id: agent.id,
      role: agent.role,
      displayName: getDisplayName(agent),
      title: agent.title,
      department: agent.department,
      status: agent.status,
    },
    config,
    evaluation,
    levels,
    thresholds,
    history,
  };
}

async function writeLevelChange(
  agentId: string,
  fromLevel: number,
  toLevel: number,
  changeType: AutonomyChangeType,
  changedBy: string,
  reason: string,
  metrics: AutonomyEvaluationMetrics,
): Promise<void> {
  const promotedAt = toLevel > fromLevel ? new Date().toISOString() : null;

  await systemTransaction(async (client) => {
    await client.query(
      `UPDATE agent_autonomy_config
       SET current_level = $2,
           promoted_at = CASE WHEN $2 > $1 THEN COALESCE($3::timestamptz, promoted_at) ELSE promoted_at END,
           last_level_change_at = NOW(),
           last_level_change_reason = $4,
           updated_at = NOW()
       WHERE agent_id = $5`,
      [fromLevel, toLevel, promotedAt, reason, agentId],
    );

    await client.query(
      `INSERT INTO autonomy_level_history (
         agent_id,
         from_level,
         to_level,
         change_type,
         trust_score_at_change,
         metrics_snapshot,
         reason,
         changed_by,
         tenant_id,
         created_at
       )
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,NOW())`,
      [
        agentId,
        fromLevel,
        toLevel,
        changeType,
        metrics.currentTrustScore,
        JSON.stringify(metrics),
        reason,
        changedBy,
        DEFAULT_TENANT_ID,
      ],
    );
  });
}

export async function updateAgentAutonomyConfig(agentId: string, input: UpdateAgentAutonomyConfigInput): Promise<AgentAutonomyConfig> {
  const agent = await resolveAgent(agentId);
  const current = await getConfigRow(agent.role);

  const nextMaxAllowedLevel = input.maxAllowedLevel == null ? current.max_allowed_level : clampLevel(input.maxAllowedLevel);
  const nextCurrentLevel = Math.min(current.current_level, nextMaxAllowedLevel);
  const nextAutoPromote = input.autoPromote == null ? current.auto_promote : input.autoPromote;
  const nextAutoDemote = input.autoDemote == null ? current.auto_demote : input.autoDemote;
  const reason = input.reason?.trim() || 'Autonomy config updated';

  await systemTransaction(async (client) => {
    await client.query(
      `UPDATE agent_autonomy_config
       SET current_level = $2,
           max_allowed_level = $3,
           auto_promote = $4,
           auto_demote = $5,
           last_level_change_reason = CASE WHEN $2 <> $1 THEN $6 ELSE last_level_change_reason END,
           last_level_change_at = CASE WHEN $2 <> $1 THEN NOW() ELSE last_level_change_at END,
           updated_at = NOW()
       WHERE agent_id = $7`,
      [
        current.current_level,
        nextCurrentLevel,
        nextMaxAllowedLevel,
        nextAutoPromote,
        nextAutoDemote,
        reason,
        agent.role,
      ],
    );

    if (nextCurrentLevel !== current.current_level) {
      const metrics = (await evaluateAutonomyLevel(agent.role)).metrics;
      await client.query(
        `INSERT INTO autonomy_level_history (
           agent_id,
           from_level,
           to_level,
           change_type,
           trust_score_at_change,
           metrics_snapshot,
           reason,
           changed_by,
           tenant_id,
           created_at
         )
         VALUES ($1,$2,$3,'admin_override',$4,$5::jsonb,$6,$7,$8,NOW())`,
        [
          agent.role,
          current.current_level,
          nextCurrentLevel,
          metrics.currentTrustScore,
          JSON.stringify(metrics),
          reason,
          input.updatedBy,
          DEFAULT_TENANT_ID,
        ],
      );
    }
  });

  return getAgentAutonomyConfig(agent.role);
}

async function changeAutonomyLevel(
  agentId: string,
  direction: 'promote' | 'demote',
  input: ChangeAutonomyLevelInput,
): Promise<AgentAutonomyConfig> {
  const agent = await resolveAgent(agentId);
  const config = await getConfigRow(agent.role);
  const evaluation = await evaluateAutonomyLevel(agent.role);

  const fallbackTarget = direction === 'promote' ? config.current_level + 1 : config.current_level - 1;
  const requestedTarget = input.targetLevel == null ? fallbackTarget : clampLevel(input.targetLevel);
  const targetLevel = direction === 'promote'
    ? Math.min(requestedTarget, config.max_allowed_level)
    : requestedTarget;

  if (direction === 'promote' && targetLevel <= config.current_level) {
    throw new Error('Agent is already at the maximum allowed autonomy level');
  }
  if (direction === 'demote' && targetLevel >= config.current_level) {
    throw new Error('Agent is already at or below the requested autonomy level');
  }

  const reason = input.reason?.trim() || (direction === 'promote'
    ? `Manual promotion to level ${targetLevel}`
    : `Manual demotion to level ${targetLevel}`);

  await writeLevelChange(
    agent.role,
    config.current_level,
    targetLevel,
    'admin_override',
    input.changedBy,
    reason,
    evaluation.metrics,
  );

  return getAgentAutonomyConfig(agent.role);
}

export async function promoteAgentAutonomy(agentId: string, input: ChangeAutonomyLevelInput): Promise<AgentAutonomyConfig> {
  return changeAutonomyLevel(agentId, 'promote', input);
}

export async function demoteAgentAutonomy(agentId: string, input: ChangeAutonomyLevelInput): Promise<AgentAutonomyConfig> {
  return changeAutonomyLevel(agentId, 'demote', input);
}

export async function getAutonomyCohortBenchmarks(): Promise<AutonomyCohortBenchmark[]> {
  const rows = await systemQuery<CohortRow>(
    `WITH history AS (
       SELECT
         h.agent_id,
         h.to_level,
         MIN(h.created_at) AS reached_at
       FROM autonomy_level_history h
       GROUP BY h.agent_id, h.to_level
     )
     SELECT
       COALESCE(aac.metadata->>'role_category', ca.department, 'Other') AS role_category,
       AVG(aac.current_level)::double precision AS average_level,
       AVG(EXTRACT(EPOCH FROM (h0.reached_at - aac.created_at)) / 86400.0)::double precision AS avg_days_level_0,
       AVG(EXTRACT(EPOCH FROM (h1.reached_at - aac.created_at)) / 86400.0)::double precision AS avg_days_level_1,
       AVG(EXTRACT(EPOCH FROM (h2.reached_at - aac.created_at)) / 86400.0)::double precision AS avg_days_level_2,
       AVG(EXTRACT(EPOCH FROM (h3.reached_at - aac.created_at)) / 86400.0)::double precision AS avg_days_level_3,
       AVG(EXTRACT(EPOCH FROM (h4.reached_at - aac.created_at)) / 86400.0)::double precision AS avg_days_level_4
     FROM agent_autonomy_config aac
     LEFT JOIN company_agents ca ON ca.role = aac.agent_id
     LEFT JOIN history h0 ON h0.agent_id = aac.agent_id AND h0.to_level = 0
     LEFT JOIN history h1 ON h1.agent_id = aac.agent_id AND h1.to_level = 1
     LEFT JOIN history h2 ON h2.agent_id = aac.agent_id AND h2.to_level = 2
     LEFT JOIN history h3 ON h3.agent_id = aac.agent_id AND h3.to_level = 3
     LEFT JOIN history h4 ON h4.agent_id = aac.agent_id AND h4.to_level = 4
     GROUP BY COALESCE(aac.metadata->>'role_category', ca.department, 'Other')
     ORDER BY role_category ASC`,
  );

  return rows.map((row) => ({
    roleCategory: row.role_category ?? 'Other',
    averageLevel: round(row.average_level ?? 0, 2),
    averageDaysToLevel0: row.avg_days_level_0 == null ? null : round(row.avg_days_level_0, 2),
    averageDaysToLevel1: row.avg_days_level_1 == null ? null : round(row.avg_days_level_1, 2),
    averageDaysToLevel2: row.avg_days_level_2 == null ? null : round(row.avg_days_level_2, 2),
    averageDaysToLevel3: row.avg_days_level_3 == null ? null : round(row.avg_days_level_3, 2),
    averageDaysToLevel4: row.avg_days_level_4 == null ? null : round(row.avg_days_level_4, 2),
  }));
}

export async function processDailyAutonomyAdjustments(): Promise<DailyAutonomyAdjustment[]> {
  const rows = await systemQuery<ConfigRow>(
    `SELECT agent_id, current_level, max_allowed_level, auto_promote, auto_demote, promoted_at, last_level_change_at, last_level_change_reason
     FROM agent_autonomy_config
     WHERE auto_promote = TRUE OR auto_demote = TRUE`,
  );

  const changes: DailyAutonomyAdjustment[] = [];

  for (const row of rows) {
    const evaluation = await evaluateAutonomyLevel(row.agent_id);
    const suggestedLevel = evaluation.suggestedLevel;

    if (row.auto_promote && suggestedLevel > row.current_level && suggestedLevel <= row.max_allowed_level) {
      const toLevel = Math.min(suggestedLevel, row.max_allowed_level);
      const reason = `Daily autonomy job promoted ${row.agent_id} from ${row.current_level} to ${toLevel} based on 30-day trust metrics.`;
      await writeLevelChange(row.agent_id, row.current_level, toLevel, 'auto_promote', 'system', reason, evaluation.metrics);
      changes.push({
        agentId: row.agent_id,
        fromLevel: row.current_level,
        toLevel,
        changeType: 'auto_promote',
        reason,
        metrics: evaluation.metrics,
      });
      continue;
    }

    if (row.auto_demote && suggestedLevel < row.current_level) {
      const reason = `Daily autonomy job demoted ${row.agent_id} from ${row.current_level} to ${suggestedLevel} based on 30-day trust metrics.`;
      await writeLevelChange(row.agent_id, row.current_level, suggestedLevel, 'auto_demote', 'system', reason, evaluation.metrics);
      changes.push({
        agentId: row.agent_id,
        fromLevel: row.current_level,
        toLevel: suggestedLevel,
        changeType: 'auto_demote',
        reason,
        metrics: evaluation.metrics,
      });
    }
  }

  return changes;
}