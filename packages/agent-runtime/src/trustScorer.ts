/**
 * Dynamic Trust Scoring — Agents earn or lose trust based on performance.
 *
 * High-trust agents get auto-promoted (yellow → green authority for their domain).
 * Degrading agents get auto-demoted. Agents see their own trust score in context.
 */

import { systemQuery } from '@glyphor/shared/db';
import type { RedisCache } from './redisCache.js';
import type { DecisionTier } from './types.js';

// ─── Types ──────────────────────────────────────────────────────

export interface TrustScore {
  agentRole: string;
  trustScore: number;
  domainScores: Record<string, number>;
  totalRuns: number;
  suspended: boolean;
  autoPromotionEligible: boolean;
}

export type TrustDeltaSource =
  | 'reasoning_confidence'
  | 'reasoning_verification'
  | 'constitutional_adherence'
  | 'constitutional_eval'
  | 'constitutional_gate_block'
  | 'peer_feedback'
  | 'human_override'
  | 'formal_failure'
  | 'reflection_quality'
  | 'drift_detection'
  | 'task_outcome_quality';

export interface TrustDelta {
  source: TrustDeltaSource;
  delta: number;
  reason: string;
  domain?: string;
}

// ─── Constants ──────────────────────────────────────────────────

const TRUST_CACHE_TTL = 120; // 2 min
const PROMOTION_THRESHOLD = 0.85;
const DEMOTION_THRESHOLD = 0.4;
const SUSPENSION_THRESHOLD = 0.2;
const MAX_HISTORY_ENTRIES = 50;

const DELTA_WEIGHTS: Record<TrustDeltaSource, number> = {
  reasoning_confidence: 0.02,
  reasoning_verification: 0.02,
  constitutional_adherence: 0.03,
  constitutional_eval: 0.03,
  constitutional_gate_block: 1.5,
  peer_feedback: 0.02,
  human_override: -0.06,
  formal_failure: -0.09,
  reflection_quality: 0.02,
  drift_detection: -0.04,
  task_outcome_quality: 1.0,
};

// ─── Class ──────────────────────────────────────────────────────

export class TrustScorer {
  constructor(
    private cache: RedisCache | null,
  ) {}

  /**
   * Get trust score for an agent. Creates default if doesn't exist.
   */
  async getTrust(agentRole: string): Promise<TrustScore> {
    const cacheKey = `trust:${agentRole}`;

    if (this.cache) {
      const cached = await this.cache.get<TrustScore>(cacheKey);
      if (cached) return cached;
    }

    const [data] = await systemQuery<{
      agent_role: string;
      trust_score: number;
      domain_scores: Record<string, number> | null;
      total_runs: number;
      suspended: boolean;
      auto_promotion_eligible: boolean;
    }>(
      'SELECT * FROM agent_trust_scores WHERE agent_role = $1 LIMIT 1',
      [agentRole],
    );

    if (!data) {
      const defaultTrust: TrustScore = {
        agentRole,
        trustScore: 0.5,
        domainScores: {},
        totalRuns: 0,
        suspended: false,
        autoPromotionEligible: false,
      };

      await systemQuery(
        'INSERT INTO agent_trust_scores (agent_role, trust_score, domain_scores) VALUES ($1, $2, $3)',
        [agentRole, 0.5, JSON.stringify({})],
      );

      return defaultTrust;
    }

    const trust: TrustScore = {
      agentRole: data.agent_role,
      trustScore: data.trust_score,
      domainScores: data.domain_scores ?? {},
      totalRuns: data.total_runs,
      suspended: data.suspended,
      autoPromotionEligible: data.auto_promotion_eligible,
    };

    if (this.cache) {
      await this.cache.set(cacheKey, trust, TRUST_CACHE_TTL);
    }

    return trust;
  }

  /**
   * Apply a trust delta after a run event.
   */
  async applyDelta(agentRole: string, delta: TrustDelta): Promise<TrustScore> {
    const current = await this.getTrust(agentRole);
    if (current.suspended) return current;

    const weightedDelta = delta.delta * (DELTA_WEIGHTS[delta.source] ?? 0.02);
    const newScore = Math.max(0, Math.min(1, current.trustScore + weightedDelta));

    // Domain-specific update
    const newDomainScores = { ...current.domainScores };
    if (delta.domain) {
      const currentDomain = newDomainScores[delta.domain] ?? 0.5;
      newDomainScores[delta.domain] = Math.max(0, Math.min(1, currentDomain + weightedDelta));
    }

    const historyEntry = {
      score: newScore,
      delta: weightedDelta,
      reason: delta.reason,
      source: delta.source,
      timestamp: new Date().toISOString(),
    };

    const suspended = newScore < SUSPENSION_THRESHOLD;
    const autoPromotionEligible = newScore >= PROMOTION_THRESHOLD && current.totalRuns >= 20;

    await systemQuery(
      'SELECT * FROM update_trust_score($1, $2, $3, $4, $5, $6, $7, $8)',
      [agentRole, newScore, JSON.stringify(newDomainScores), JSON.stringify(historyEntry), MAX_HISTORY_ENTRIES, suspended, autoPromotionEligible, delta.source === 'reasoning_confidence'],
    );

    if (this.cache) {
      await this.cache.del(`trust:${agentRole}`);
    }

    return {
      agentRole,
      trustScore: newScore,
      domainScores: newDomainScores,
      totalRuns: current.totalRuns + (delta.source === 'reasoning_confidence' ? 1 : 0),
      suspended,
      autoPromotionEligible,
    };
  }

  /**
   * Compute and apply a trust delta from batch outcome quality scores.
   * Positive signal when avgBatchQualityScore >= 4.0, negative when <= 2.0,
   * neutral zone between 2.0 and 4.0.
   */
  async applyBatchOutcomeDelta(
    agentRole: string,
    avgBatchQualityScore: number,
  ): Promise<TrustScore | null> {
    try {
      let delta: number;
      if (avgBatchQualityScore >= 4.0) {
        delta = (avgBatchQualityScore - 3.0) / 5.0;
      } else if (avgBatchQualityScore <= 2.0) {
        delta = -((3.0 - avgBatchQualityScore) / 5.0);
      } else {
        // Neutral zone — no trust change
        return null;
      }

      return await this.applyDelta(agentRole, {
        source: 'task_outcome_quality',
        delta,
        reason: `Batch outcome quality: ${avgBatchQualityScore.toFixed(1)}/5.0`,
      });
    } catch (err) {
      console.warn('[TrustScorer] applyBatchOutcomeDelta failed for', agentRole, (err as Error).message);
      return null;
    }
  }

  /**
   * Apply a fixed penalty when a constitutional gate blocks a tool call.
   * -0.15 raw delta × 1.5 weight = -0.225 effective trust reduction.
   */
  async applyConstitutionalBlockDelta(
    agentRole: string,
    toolName: string,
  ): Promise<TrustScore | null> {
    try {
      return await this.applyDelta(agentRole, {
        source: 'constitutional_gate_block',
        delta: -0.15,
        reason: `Constitutional gate blocked tool call: ${toolName}`,
      });
    } catch (err) {
      console.warn('[TrustScorer] applyConstitutionalBlockDelta failed for', agentRole, (err as Error).message);
      return null;
    }
  }

  /**
   * Get effective authority tier for an action, adjusted by trust.
   */
  getEffectiveAuthority(
    baseAuthority: DecisionTier,
    trust: TrustScore,
    domain?: string,
  ): DecisionTier {
    const domainTrust = domain ? (trust.domainScores[domain] ?? trust.trustScore) : trust.trustScore;

    // Promotion: yellow → green for high-trust agents
    if (baseAuthority === 'yellow' && domainTrust >= PROMOTION_THRESHOLD && trust.autoPromotionEligible) {
      return 'green';
    }

    // Demotion: green → yellow for low-trust agents
    if (baseAuthority === 'green' && domainTrust < DEMOTION_THRESHOLD) {
      return 'yellow';
    }

    // red never gets promoted
    return baseAuthority;
  }
}
