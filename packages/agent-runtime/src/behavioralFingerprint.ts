import { systemQuery } from '@glyphor/shared/db';

import { HIGH_STAKES_TOOLS } from './constitutionalPreCheck.js';
import { AGENT_MANAGER, WRITE_TOOLS, type CompanyAgentRole } from './types.js';

export interface BehaviorProfile {
  agentRole: string;
  normalToolPatterns: Map<string, number>;
  normalKGAccessPatterns: string[];
  normalMessageTargets: string[];
  normalBudgetRange: [number, number];
  normalTurnRange: [number, number];
  baselinePeriod: string;
}

export interface BehavioralAnomaly {
  anomalyType: 'unexpected_sensitive_tool' | 'unusual_message_target' | 'budget_spike';
  severity: 'low' | 'medium' | 'high' | 'critical';
  summary: string;
  details: Record<string, unknown>;
}

export interface BehaviorCheckInput {
  agentId: string;
  agentRole: CompanyAgentRole;
  toolName: string;
  params: Record<string, unknown>;
  currentRunCostUsd: number;
  currentRunToolCounts: Map<string, number>;
}

const PROFILE_CACHE_TTL_MS = 5 * 60 * 1000;

const profileCache = new Map<string, { profile: BehaviorProfile; fetchedAt: number }>();

const MESSAGE_TOOLS = new Set([
  'send_agent_message',
  'create_peer_work_request',
  'request_peer_work',
  'peer_data_request',
  'create_handoff',
]);

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[idx] ?? 0;
}

function isManagerRelationship(fromRole: CompanyAgentRole, toRole: string): boolean {
  const directManager = AGENT_MANAGER[fromRole];
  if (directManager === toRole) return true;
  return Object.entries(AGENT_MANAGER).some(([child, manager]) => child === toRole && manager === fromRole);
}

function extractMessageTarget(toolName: string, params: Record<string, unknown>): string | null {
  if (!MESSAGE_TOOLS.has(toolName)) return null;
  const candidate = params.to_agent ?? params.peer_role ?? params.recipient ?? params.target_role;
  return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate.trim() : null;
}

export async function loadBehaviorProfile(agentRole: CompanyAgentRole): Promise<BehaviorProfile> {
  const cached = profileCache.get(agentRole);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < PROFILE_CACHE_TTL_MS) {
    return cached.profile;
  }

  const [runs, targets, grants] = await Promise.all([
    systemQuery<{ cost: number | null; total_turns: number | null }>(
      `SELECT cost, total_turns
       FROM agent_runs
       WHERE agent_id = $1
         AND started_at >= NOW() - INTERVAL '30 days'
         AND cost IS NOT NULL
       ORDER BY started_at DESC
       LIMIT 100`,
      [agentRole],
    ).catch(() => []),
    systemQuery<{ to_agent: string; count: string }>(
      `SELECT to_agent, COUNT(*)::text AS count
       FROM agent_messages
       WHERE from_agent = $1
         AND created_at >= NOW() - INTERVAL '30 days'
       GROUP BY to_agent
       ORDER BY COUNT(*) DESC
       LIMIT 12`,
      [agentRole],
    ).catch(() => []),
    systemQuery<{ tool_name: string }>(
      `SELECT tool_name
       FROM agent_tool_grants
       WHERE agent_role = $1
         AND is_active = true`,
      [agentRole],
    ).catch(() => []),
  ]);

  const costs = runs.map((row) => Number(row.cost ?? 0)).filter((value) => Number.isFinite(value) && value > 0);
  const turns = runs.map((row) => Number(row.total_turns ?? 0)).filter((value) => Number.isFinite(value) && value > 0);

  const profile: BehaviorProfile = {
    agentRole,
    normalToolPatterns: new Map(grants.map((row) => [row.tool_name, 1])),
    normalKGAccessPatterns: [],
    normalMessageTargets: targets.map((row) => row.to_agent),
    normalBudgetRange: costs.length > 0
      ? [percentile(costs, 0.1), percentile(costs, 0.9)]
      : [0, 0],
    normalTurnRange: turns.length > 0
      ? [percentile(turns, 0.1), percentile(turns, 0.9)]
      : [0, 0],
    baselinePeriod: '30 days',
  };

  profileCache.set(agentRole, { profile, fetchedAt: now });
  return profile;
}

export function detectBehavioralAnomalies(
  profile: BehaviorProfile,
  input: BehaviorCheckInput,
): BehavioralAnomaly[] {
  const anomalies: BehavioralAnomaly[] = [];
  const toolCount = (input.currentRunToolCounts.get(input.toolName) ?? 0) + 1;
  const isSensitiveTool = HIGH_STAKES_TOOLS.has(input.toolName) || WRITE_TOOLS.has(input.toolName);

  if (isSensitiveTool && profile.normalToolPatterns.size > 0 && !profile.normalToolPatterns.has(input.toolName)) {
    anomalies.push({
      anomalyType: 'unexpected_sensitive_tool',
      severity: HIGH_STAKES_TOOLS.has(input.toolName) ? 'high' : 'medium',
      summary: `${input.agentRole} invoked sensitive tool ${input.toolName} outside its usual grant profile.`,
      details: {
        toolName: input.toolName,
        callCountThisRun: toolCount,
        grantedSensitiveTools: Array.from(profile.normalToolPatterns.keys()).slice(0, 20),
      },
    });
  }

  const messageTarget = extractMessageTarget(input.toolName, input.params);
  if (
    messageTarget
    && !profile.normalMessageTargets.includes(messageTarget)
    && !isManagerRelationship(input.agentRole, messageTarget)
    && messageTarget !== 'chief-of-staff'
  ) {
    anomalies.push({
      anomalyType: 'unusual_message_target',
      severity: 'medium',
      summary: `${input.agentRole} messaged ${messageTarget}, which is outside its recent communication pattern.`,
      details: {
        toolName: input.toolName,
        target: messageTarget,
        knownTargets: profile.normalMessageTargets,
      },
    });
  }

  const historicalHigh = profile.normalBudgetRange[1];
  if (historicalHigh > 0 && input.currentRunCostUsd > historicalHigh * 3) {
    anomalies.push({
      anomalyType: 'budget_spike',
      severity: 'high',
      summary: `${input.agentRole} exceeded 3x its normal run cost envelope.`,
      details: {
        currentRunCostUsd: input.currentRunCostUsd,
        normalBudgetRange: profile.normalBudgetRange,
        toolName: input.toolName,
      },
    });
  }

  return anomalies;
}

export async function persistBehavioralAnomalies(
  input: BehaviorCheckInput,
  anomalies: BehavioralAnomaly[],
): Promise<void> {
  if (anomalies.length === 0) return;

  await Promise.all(anomalies.map((anomaly) =>
    systemQuery(
      `INSERT INTO security_anomalies (agent_role, agent_id, tool_name, anomaly_type, severity, summary, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        input.agentRole,
        input.agentId,
        input.toolName,
        anomaly.anomalyType,
        anomaly.severity,
        anomaly.summary,
        JSON.stringify(anomaly.details),
      ],
    ).catch(() => undefined),
  ));
}

