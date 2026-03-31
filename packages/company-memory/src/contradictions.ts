import { TrustScorer } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

export interface FactProvenanceScore {
  recency_score: number;
  authority_score: number;
  source_type_score: number;
  human_verified_bonus: number;
  final_score: number;
  weights: {
    recency: number;
    authority: number;
    source_type: number;
    human_verified: number;
  };
  half_life_days: number;
  source_agent_id: string | null;
  source_type: string;
  human_verified: boolean;
  valid_from: string | null;
}

export interface ContradictionListFilters {
  status?: string;
  entityType?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

export interface ContradictionListItem {
  id: string;
  entity_id: string;
  entity_type: string;
  entity_key: string;
  display_name: string | null;
  fact_key: string;
  fact_a_id: string;
  fact_b_id: string;
  fact_a_value: unknown;
  fact_b_value: unknown;
  fact_a_agent_id: string | null;
  fact_b_agent_id: string | null;
  detected_at: string;
  status: string;
  resolution_winner_fact_id: string | null;
  resolution_reason: string | null;
  provenance_scores: Record<string, unknown>;
  resolved_at: string | null;
  resolved_by: string | null;
}

export interface ContradictionDetail extends ContradictionListItem {
  fact_a: Record<string, unknown> | null;
  fact_b: Record<string, unknown> | null;
  traces: Array<{
    id: string;
    trace_type: string;
    actor_id: string;
    payload: Record<string, unknown>;
    reason: string | null;
    created_at: string;
  }>;
  chief_of_staff_recommendation: Record<string, unknown> | null;
}

export interface ContradictionResolutionResult {
  contradictionId: string;
  outcome: 'auto_resolved' | 'escalated_to_chief_of_staff' | 'noop';
  winnerFactId?: string;
  scoreDifference?: number;
  factAScore?: FactProvenanceScore;
  factBScore?: FactProvenanceScore;
  summary?: Record<string, unknown>;
}

interface ActiveFactRow {
  id: string;
  entity_id: string;
  entity_type: string;
  entity_key: string;
  display_name: string | null;
  fact_key: string;
  fact_value: unknown;
  source_agent_id: string | null;
}

interface FactRow {
  id: string;
  entity_id: string;
  fact_key: string;
  fact_value: unknown;
  source_agent_id: string | null;
  source_type: string;
  human_verified: boolean;
  valid_from: string | null;
  valid_until: string | null;
}

const DEFAULT_HALF_LIFE_DAYS = 30;
const DEFAULT_AUTO_RESOLVE_THRESHOLD = 0.15;
const DEFAULT_WEIGHTS = {
  recency: 0.3,
  authority: 0.4,
  source_type: 0.2,
  human_verified: 0.1,
};

export class KnowledgeContradictionStore {
  private readonly trustScorer = new TrustScorer(null);

  async detectContradictions(): Promise<ContradictionListItem[]> {
    await this.synchronizeDetectedContradictions();
    const result = await this.listContradictions({ status: 'detected', page: 1, pageSize: 500 });
    return result.items;
  }

  async synchronizeDetectedContradictions(): Promise<{ created: number; totalDetected: number }> {
    const facts = await systemQuery<ActiveFactRow>(
      `SELECT
         f.id,
         f.entity_id,
         e.entity_type,
         e.entity_key,
         e.display_name,
         f.fact_key,
         f.fact_value,
         f.source_agent_id
       FROM kg_facts f
       JOIN kg_entities e ON e.id = f.entity_id
       WHERE f.valid_until IS NULL
       ORDER BY f.entity_id, f.fact_key, f.created_at DESC`,
    );

    const grouped = new Map<string, ActiveFactRow[]>();
    for (const fact of facts) {
      const key = `${fact.entity_id}:${fact.fact_key}`;
      const bucket = grouped.get(key) ?? [];
      bucket.push(fact);
      grouped.set(key, bucket);
    }

    let created = 0;
    for (const bucket of grouped.values()) {
      const uniqueFacts = bucket.filter((fact, index) =>
        bucket.findIndex((candidate) =>
          candidate.id === fact.id
          || (
            stableStringify(candidate.fact_value) === stableStringify(fact.fact_value)
            && candidate.source_agent_id === fact.source_agent_id
          )
        ) === index,
      );

      if (new Set(uniqueFacts.map((fact) => stableStringify(fact.fact_value))).size < 2) {
        continue;
      }

      for (let left = 0; left < uniqueFacts.length; left += 1) {
        for (let right = left + 1; right < uniqueFacts.length; right += 1) {
          const factA = uniqueFacts[left];
          const factB = uniqueFacts[right];
          if (stableStringify(factA.fact_value) === stableStringify(factB.fact_value)) {
            continue;
          }

          const existing = await systemQuery<{ id: string }>(
            `SELECT id
             FROM kg_contradictions
             WHERE (fact_a_id = $1 AND fact_b_id = $2)
                OR (fact_a_id = $2 AND fact_b_id = $1)
             LIMIT 1`,
            [factA.id, factB.id],
          );

          if (existing.length > 0) continue;

          const [row] = await systemQuery<{ id: string }>(
            `INSERT INTO kg_contradictions (
               entity_id,
               fact_key,
               fact_a_id,
               fact_b_id,
               fact_a_value,
               fact_b_value,
               fact_a_agent_id,
               fact_b_agent_id,
               status,
               provenance_scores
             )
             VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, 'detected', '{}'::jsonb)
             RETURNING id`,
            [
              factA.entity_id,
              factA.fact_key,
              factA.id,
              factB.id,
              stableStringify(factA.fact_value),
              stableStringify(factB.fact_value),
              factA.source_agent_id,
              factB.source_agent_id,
            ],
          );

          created += 1;
          await this.recordDecisionTrace(row.id, 'detection', 'system', {
            entity: {
              entityId: factA.entity_id,
              entityType: factA.entity_type,
              entityKey: factA.entity_key,
              displayName: factA.display_name,
            },
            factKey: factA.fact_key,
            factA: { id: factA.id, value: factA.fact_value, sourceAgentId: factA.source_agent_id },
            factB: { id: factB.id, value: factB.fact_value, sourceAgentId: factB.source_agent_id },
          }, 'Contradiction detected from active fact set.');
        }
      }
    }

    const [countRow] = await systemQuery<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM kg_contradictions
       WHERE status = 'detected'`,
    );

    return { created, totalDetected: Number(countRow?.count ?? 0) };
  }

  async scoreFactProvenance(factId: string): Promise<FactProvenanceScore> {
    const [fact] = await systemQuery<FactRow>(
      `SELECT id, entity_id, fact_key, fact_value, source_agent_id, source_type, human_verified, valid_from, valid_until
       FROM kg_facts
       WHERE id = $1
       LIMIT 1`,
      [factId],
    );

    if (!fact) {
      throw new Error(`Fact not found: ${factId}`);
    }

    const halfLifeDays = await readNumericConfig('contradictions_provenance_half_life_days', DEFAULT_HALF_LIFE_DAYS);
    const weights = {
      recency: await readNumericConfig('contradictions_weight_recency', DEFAULT_WEIGHTS.recency),
      authority: await readNumericConfig('contradictions_weight_authority', DEFAULT_WEIGHTS.authority),
      source_type: await readNumericConfig('contradictions_weight_source_type', DEFAULT_WEIGHTS.source_type),
      human_verified: await readNumericConfig('contradictions_weight_human_verified', DEFAULT_WEIGHTS.human_verified),
    };

    const validFrom = fact.valid_from ? new Date(fact.valid_from) : null;
    const ageDays = validFrom
      ? Math.max(0, (Date.now() - validFrom.getTime()) / (1000 * 60 * 60 * 24))
      : Number.POSITIVE_INFINITY;
    const recencyScore = Number.isFinite(ageDays)
      ? clamp01(1 - (ageDays / Math.max(halfLifeDays * 2, 1)))
      : 0;

    let authorityScore = 0.5;
    if (fact.source_agent_id) {
      try {
        authorityScore = clamp01((await this.trustScorer.getTrust(fact.source_agent_id)).trustScore);
      } catch {
        authorityScore = 0.5;
      }
    }

    const sourceTypeScore = sourceTypeWeight(fact.source_type);
    const humanVerifiedBonus = fact.human_verified ? 0.3 : 0;
    const finalScore = clamp01(
      (recencyScore * weights.recency)
      + (authorityScore * weights.authority)
      + (sourceTypeScore * weights.source_type)
      + (humanVerifiedBonus * weights.human_verified),
    );

    return {
      recency_score: round4(recencyScore),
      authority_score: round4(authorityScore),
      source_type_score: round4(sourceTypeScore),
      human_verified_bonus: round4(humanVerifiedBonus),
      final_score: round4(finalScore),
      weights,
      half_life_days: halfLifeDays,
      source_agent_id: fact.source_agent_id,
      source_type: fact.source_type,
      human_verified: fact.human_verified,
      valid_from: fact.valid_from,
    };
  }

  async resolveContradiction(contradictionId: string): Promise<ContradictionResolutionResult> {
    const contradiction = await this.getContradictionDetail(contradictionId);
    if (!contradiction) {
      throw new Error(`Contradiction not found: ${contradictionId}`);
    }

    if (contradiction.status !== 'detected') {
      return { contradictionId, outcome: 'noop' };
    }

    const threshold = await readNumericConfig('contradictions_auto_resolve_threshold', DEFAULT_AUTO_RESOLVE_THRESHOLD);
    const factAScore = await this.scoreFactProvenance(contradiction.fact_a_id);
    const factBScore = await this.scoreFactProvenance(contradiction.fact_b_id);
    const scoreDifference = round4(Math.abs(factAScore.final_score - factBScore.final_score));
    const provenance = {
      fact_a: factAScore,
      fact_b: factBScore,
      threshold,
      score_difference: scoreDifference,
      evaluated_at: new Date().toISOString(),
    };

    if (scoreDifference > threshold) {
      const winnerFactId = factAScore.final_score >= factBScore.final_score
        ? contradiction.fact_a_id
        : contradiction.fact_b_id;
      const loserFactId = winnerFactId === contradiction.fact_a_id
        ? contradiction.fact_b_id
        : contradiction.fact_a_id;

      await systemQuery(
        `UPDATE kg_facts
         SET valid_until = NOW(), updated_at = NOW()
         WHERE id = $1
           AND valid_until IS NULL`,
        [loserFactId],
      );

      const reason = `Auto-resolved: provenance score delta ${scoreDifference.toFixed(4)} exceeded threshold ${threshold.toFixed(4)}.`;
      await systemQuery(
        `UPDATE kg_contradictions
         SET status = 'auto_resolved',
             resolution_winner_fact_id = $2,
             resolution_reason = $3,
             provenance_scores = $4::jsonb,
             resolved_at = NOW(),
             resolved_by = 'system'
         WHERE id = $1`,
        [contradictionId, winnerFactId, reason, JSON.stringify(provenance)],
      );

      await this.recordDecisionTrace(contradictionId, 'auto_resolution', 'system', {
        contradictionId,
        winnerFactId,
        loserFactId,
        threshold,
        scoreDifference,
        provenance,
      }, reason);

      return {
        contradictionId,
        outcome: 'auto_resolved',
        winnerFactId,
        scoreDifference,
        factAScore,
        factBScore,
      };
    }

    const summary = {
      entity: {
        entityId: contradiction.entity_id,
        entityType: contradiction.entity_type,
        entityKey: contradiction.entity_key,
        displayName: contradiction.display_name,
      },
      factKey: contradiction.fact_key,
      factAValue: contradiction.fact_a_value,
      factBValue: contradiction.fact_b_value,
      factAScore,
      factBScore,
      scoreDifference,
      recommendation: buildRecommendation(factAScore, factBScore, threshold),
    };

    await systemQuery(
      `UPDATE kg_contradictions
       SET status = 'escalated_to_chief_of_staff',
           resolution_reason = $2,
           provenance_scores = $3::jsonb
       WHERE id = $1`,
      [
        contradictionId,
        'Automatic provenance threshold not met; escalated to Chief of Staff.',
        JSON.stringify(summary),
      ],
    );

    await this.recordDecisionTrace(contradictionId, 'escalated_to_chief_of_staff', 'system', summary, 'Automatic provenance threshold not met.');

    return {
      contradictionId,
      outcome: 'escalated_to_chief_of_staff',
      scoreDifference,
      factAScore,
      factBScore,
      summary,
    };
  }

  async applyChiefOfStaffDecision(
    contradictionId: string,
    decision: {
      action: 'resolve' | 'escalate_to_human';
      winnerFactId?: string;
      reason: string;
      payload?: Record<string, unknown>;
    },
  ): Promise<void> {
    const contradiction = await this.getContradictionDetail(contradictionId);
    if (!contradiction) {
      throw new Error(`Contradiction not found: ${contradictionId}`);
    }

    if (decision.action === 'resolve') {
      if (!decision.winnerFactId) {
        throw new Error('winnerFactId is required when Chief of Staff resolves a contradiction');
      }
      if (![contradiction.fact_a_id, contradiction.fact_b_id].includes(decision.winnerFactId)) {
        throw new Error('winnerFactId must match one of the contradiction facts');
      }

      const losingFactId = decision.winnerFactId === contradiction.fact_a_id
        ? contradiction.fact_b_id
        : contradiction.fact_a_id;

      await systemQuery(
        `UPDATE kg_facts
         SET valid_until = NOW(), updated_at = NOW()
         WHERE id = $1
           AND valid_until IS NULL`,
        [losingFactId],
      );

      await systemQuery(
        `UPDATE kg_contradictions
         SET status = 'auto_resolved',
             resolution_winner_fact_id = $2,
             resolution_reason = $3,
             resolved_at = NOW(),
             resolved_by = 'chief-of-staff'
         WHERE id = $1`,
        [contradictionId, decision.winnerFactId, decision.reason],
      );

      await this.recordDecisionTrace(contradictionId, 'chief_of_staff_resolution', 'chief-of-staff', {
        contradictionId,
        winnerFactId: decision.winnerFactId,
        losingFactId,
        ...(decision.payload ?? {}),
      }, decision.reason);
      return;
    }

    await systemQuery(
      `UPDATE kg_contradictions
       SET status = 'escalated_to_human',
           resolution_reason = $2
       WHERE id = $1`,
      [contradictionId, decision.reason],
    );

    await this.recordDecisionTrace(contradictionId, 'chief_of_staff_recommendation', 'chief-of-staff', {
      contradictionId,
      ...(decision.payload ?? {}),
    }, decision.reason);
  }

  async resolveContradictionByHuman(
    contradictionId: string,
    winnerFactId: string,
    reason: string,
    resolvedBy: string,
  ): Promise<void> {
    const contradiction = await this.getContradictionDetail(contradictionId);
    if (!contradiction) {
      throw new Error(`Contradiction not found: ${contradictionId}`);
    }
    if (![contradiction.fact_a_id, contradiction.fact_b_id].includes(winnerFactId)) {
      throw new Error('winnerFactId must match one of the contradiction facts');
    }

    const losingFactId = winnerFactId === contradiction.fact_a_id
      ? contradiction.fact_b_id
      : contradiction.fact_a_id;

    await systemQuery(
      `UPDATE kg_facts
       SET valid_until = NOW(), updated_at = NOW()
       WHERE id = $1
         AND valid_until IS NULL`,
      [losingFactId],
    );

    await systemQuery(
      `UPDATE kg_contradictions
       SET status = 'resolved_by_human',
           resolution_winner_fact_id = $2,
           resolution_reason = $3,
           resolved_at = NOW(),
           resolved_by = $4
       WHERE id = $1`,
      [contradictionId, winnerFactId, reason, resolvedBy],
    );

    await this.recordDecisionTrace(contradictionId, 'human_resolution', resolvedBy, {
      contradictionId,
      winnerFactId,
      losingFactId,
    }, reason);
  }

  async dismissContradiction(
    contradictionId: string,
    reason: string,
    resolvedBy: string,
  ): Promise<void> {
    await systemQuery(
      `UPDATE kg_contradictions
       SET status = 'dismissed',
           resolution_reason = $2,
           resolved_at = NOW(),
           resolved_by = $3
       WHERE id = $1`,
      [contradictionId, reason, resolvedBy],
    );

    await this.recordDecisionTrace(contradictionId, 'dismissed', resolvedBy, { contradictionId }, reason);
  }

  async listContradictions(filters: ContradictionListFilters): Promise<{ items: ContradictionListItem[]; total: number; page: number; pageSize: number }> {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.max(1, Math.min(200, filters.pageSize ?? 50));
    const offset = (page - 1) * pageSize;

    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filters.status) {
      values.push(filters.status);
      conditions.push(`c.status = $${values.length}`);
    }
    if (filters.entityType) {
      values.push(filters.entityType);
      conditions.push(`e.entity_type = $${values.length}`);
    }
    if (filters.dateFrom) {
      values.push(filters.dateFrom);
      conditions.push(`c.detected_at >= $${values.length}::timestamptz`);
    }
    if (filters.dateTo) {
      values.push(filters.dateTo);
      conditions.push(`c.detected_at <= $${values.length}::timestamptz`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const baseSql = `
      FROM kg_contradictions c
      JOIN kg_entities e ON e.id = c.entity_id
      ${whereClause}`;

    const countRows = await systemQuery<{ count: string }>(
      `SELECT COUNT(*)::text AS count ${baseSql}`,
      values,
    );

    values.push(pageSize, offset);
    const rows = await systemQuery<ContradictionListItem>(
      `SELECT
         c.id,
         c.entity_id,
         e.entity_type,
         e.entity_key,
         e.display_name,
         c.fact_key,
         c.fact_a_id,
         c.fact_b_id,
         c.fact_a_value,
         c.fact_b_value,
         c.fact_a_agent_id,
         c.fact_b_agent_id,
         c.detected_at,
         c.status,
         c.resolution_winner_fact_id,
         c.resolution_reason,
         c.provenance_scores,
         c.resolved_at,
         c.resolved_by
       ${baseSql}
       ORDER BY c.detected_at DESC
       LIMIT $${values.length - 1}
       OFFSET $${values.length}`,
      values,
    );

    return {
      items: rows.map((row) => ({
        ...row,
        provenance_scores: (row.provenance_scores ?? {}) as Record<string, unknown>,
      })),
      total: Number(countRows[0]?.count ?? 0),
      page,
      pageSize,
    };
  }

  async getContradictionDetail(contradictionId: string): Promise<ContradictionDetail | null> {
    const [row] = await systemQuery<ContradictionListItem>(
      `SELECT
         c.id,
         c.entity_id,
         e.entity_type,
         e.entity_key,
         e.display_name,
         c.fact_key,
         c.fact_a_id,
         c.fact_b_id,
         c.fact_a_value,
         c.fact_b_value,
         c.fact_a_agent_id,
         c.fact_b_agent_id,
         c.detected_at,
         c.status,
         c.resolution_winner_fact_id,
         c.resolution_reason,
         c.provenance_scores,
         c.resolved_at,
         c.resolved_by
       FROM kg_contradictions c
       JOIN kg_entities e ON e.id = c.entity_id
       WHERE c.id = $1
       LIMIT 1`,
      [contradictionId],
    );

    if (!row) return null;

    const factRows = await systemQuery<Record<string, unknown>>(
      `SELECT *
       FROM kg_facts
       WHERE id = ANY($1::uuid[])`,
      [[row.fact_a_id, row.fact_b_id]],
    );

    const traces = await systemQuery<{
      id: string;
      trace_type: string;
      actor_id: string;
      payload: Record<string, unknown>;
      reason: string | null;
      created_at: string;
    }>(
      `SELECT id, trace_type, actor_id, payload, reason, created_at
       FROM decision_traces
       WHERE contradiction_id = $1
       ORDER BY created_at DESC`,
      [contradictionId],
    );

    const chiefOfStaffRecommendation = traces.find((trace) =>
      trace.trace_type === 'chief_of_staff_recommendation' || trace.trace_type === 'chief_of_staff_resolution',
    )?.payload ?? null;

    return {
      ...row,
      provenance_scores: (row.provenance_scores ?? {}) as Record<string, unknown>,
      fact_a: factRows.find((fact) => fact.id === row.fact_a_id) ?? null,
      fact_b: factRows.find((fact) => fact.id === row.fact_b_id) ?? null,
      traces: traces.map((trace) => ({
        ...trace,
        payload: (trace.payload ?? {}) as Record<string, unknown>,
      })),
      chief_of_staff_recommendation: chiefOfStaffRecommendation as Record<string, unknown> | null,
    };
  }

  private async recordDecisionTrace(
    contradictionId: string,
    traceType: string,
    actorId: string,
    payload: Record<string, unknown>,
    reason: string,
  ): Promise<void> {
    await systemQuery(
      `INSERT INTO decision_traces (contradiction_id, trace_type, actor_id, payload, reason)
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [contradictionId, traceType, actorId, JSON.stringify(payload), reason],
    );
  }
}

async function readNumericConfig(key: string, fallback: number): Promise<number> {
  try {
    const [row] = await systemQuery<{ value: unknown }>(
      'SELECT value FROM system_config WHERE key = $1 LIMIT 1',
      [key],
    );
    if (!row) return fallback;
    const raw = row.value;
    const numeric = typeof raw === 'number'
      ? raw
      : typeof raw === 'string'
        ? Number(raw)
        : typeof raw === 'object' && raw != null && 'value' in raw
          ? Number((raw as { value: unknown }).value)
          : Number.NaN;
    return Number.isFinite(numeric) ? numeric : fallback;
  } catch {
    return fallback;
  }
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortObject(value));
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortObject((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function sourceTypeWeight(sourceType: string): number {
  switch (sourceType) {
    case 'human_input':
      return 1.0;
    case 'mcp_tool':
      return 0.8;
    case 'agent_output':
    default:
      return 0.6;
  }
}

function buildRecommendation(
  factAScore: FactProvenanceScore,
  factBScore: FactProvenanceScore,
  threshold: number,
): string {
  if (factAScore.final_score === factBScore.final_score) {
    return `Scores are tied below the ${threshold.toFixed(2)} auto-resolution threshold. Human judgment recommended.`;
  }
  const preferred = factAScore.final_score > factBScore.final_score ? 'fact_a' : 'fact_b';
  return `${preferred} has slightly stronger provenance, but the delta did not clear the ${threshold.toFixed(2)} auto-resolution threshold.`;
}