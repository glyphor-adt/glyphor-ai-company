/**
 * Dynamic Trust Scoring — Agents earn or lose trust based on performance.
 *
 * High-trust agents get auto-promoted (yellow → green authority for their domain).
 * Degrading agents get auto-demoted. Agents see their own trust score in context.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
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
  | 'constitutional_adherence'
  | 'peer_feedback'
  | 'human_override'
  | 'formal_failure'
  | 'reflection_quality';

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
  constitutional_adherence: 0.03,
  peer_feedback: 0.02,
  human_override: -0.06,
  formal_failure: -0.09,
  reflection_quality: 0.02,
};

// ─── Class ──────────────────────────────────────────────────────

export class TrustScorer {
  constructor(
    private supabase: SupabaseClient,
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

    const { data, error } = await this.supabase
      .from('agent_trust_scores')
      .select('*')
      .eq('agent_role', agentRole)
      .single();

    if (error || !data) {
      const defaultTrust: TrustScore = {
        agentRole,
        trustScore: 0.5,
        domainScores: {},
        totalRuns: 0,
        suspended: false,
        autoPromotionEligible: false,
      };

      await this.supabase.from('agent_trust_scores').insert({
        agent_role: agentRole,
        trust_score: 0.5,
        domain_scores: {},
      });

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

    await this.supabase.rpc('update_trust_score', {
      p_agent_role: agentRole,
      p_new_score: newScore,
      p_domain_scores: newDomainScores,
      p_history_entry: historyEntry,
      p_max_history: MAX_HISTORY_ENTRIES,
      p_suspended: suspended,
      p_auto_promotion: autoPromotionEligible,
      p_increment_runs: delta.source === 'reasoning_confidence',
    });

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
