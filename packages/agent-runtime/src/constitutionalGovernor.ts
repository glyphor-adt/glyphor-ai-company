/**
 * Constitutional Agent Governance — Gives each agent a set of weighted
 * natural-language principles that govern how it reasons.
 *
 * The reasoning engine's verification pipeline scores outputs against
 * the agent's constitution. Low-adherence outputs get revised.
 * Constitutions self-improve over time based on which principles
 * correlate with higher output quality.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ModelClient } from './modelClient.js';
import type { RedisCache } from './redisCache.js';

// ─── Types ──────────────────────────────────────────────────────

export interface ConstitutionalPrinciple {
  id: string;
  text: string;
  category:
    | 'output_quality'
    | 'risk_management'
    | 'financial_prudence'
    | 'communication'
    | 'technical_accuracy'
    | 'ethical'
    | 'domain_specific';
  weight: number;         // 0-1, threshold for triggering revision
  source: 'system' | 'learned' | 'human';
  effectiveness: number;  // rolling effectiveness score, updated by learning loop
  createdAt: string;
}

export interface ConstitutionalEvaluation {
  principleScores: Array<{
    principleId: string;
    score: number;     // 0-1
    reasoning: string;
  }>;
  overallAdherence: number;
  violations: string[];
  revisionRequired: boolean;
  revisionGuidance: string;
}

export interface Constitution {
  agentRole: string;
  principles: ConstitutionalPrinciple[];
  version: number;
}

// ─── Constants ──────────────────────────────────────────────────

const EVALUATION_MODEL = 'gemini-2.0-flash';
const ADHERENCE_THRESHOLD = 0.7;
const CONSTITUTION_CACHE_TTL = 600; // 10 min

const EVALUATION_SYSTEM_PROMPT = `You are a constitutional evaluator for an AI agent. You evaluate whether the agent's output adheres to its assigned constitutional principles.

For each principle, score 0-1:
- 1.0 = fully adheres
- 0.7-0.9 = mostly adheres, minor gaps
- 0.4-0.6 = partially adheres, notable gaps
- 0.1-0.3 = mostly violates
- 0.0 = completely violates

Respond ONLY with JSON, no markdown fences:
{
  "scores": [
    { "principleId": "...", "score": 0.85, "reasoning": "brief explanation" }
  ],
  "violations": ["principle_id_1"],
  "revisionGuidance": "specific instructions to fix violations, empty string if no revision needed"
}`;

// ─── Class ──────────────────────────────────────────────────────

export class ConstitutionalGovernor {
  constructor(
    private supabase: SupabaseClient,
    private modelClient: ModelClient,
    private cache: RedisCache | null,
  ) {}

  /**
   * Load the active constitution for an agent role.
   * Returns null if no constitution exists (agent operates unconstrained).
   */
  async getConstitution(agentRole: string): Promise<Constitution | null> {
    const cacheKey = `constitution:${agentRole}`;

    if (this.cache) {
      const cached = await this.cache.get<Constitution>(cacheKey);
      if (cached) return cached;
    }

    const { data, error } = await this.supabase
      .from('agent_constitutions')
      .select('agent_role, principles, version')
      .eq('agent_role', agentRole)
      .eq('active', true)
      .single();

    if (error || !data) return null;

    const constitution: Constitution = {
      agentRole: data.agent_role,
      principles: data.principles as ConstitutionalPrinciple[],
      version: data.version,
    };

    if (this.cache) {
      await this.cache.set(cacheKey, constitution, CONSTITUTION_CACHE_TTL);
    }

    return constitution;
  }

  /**
   * Evaluate agent output against its constitution.
   * Called from the reasoning engine's verification pipeline.
   */
  async evaluate(
    agentRole: string,
    taskDescription: string,
    agentOutput: string,
    constitution: Constitution,
  ): Promise<ConstitutionalEvaluation> {
    const userPrompt = [
      `AGENT ROLE: ${agentRole}`,
      `TASK: ${taskDescription}`,
      '',
      'CONSTITUTIONAL PRINCIPLES:',
      ...constitution.principles.map(
        (p, i) => `${i + 1}. [${p.id}] (weight: ${p.weight}, category: ${p.category}) ${p.text}`,
      ),
      '',
      'AGENT OUTPUT TO EVALUATE:',
      agentOutput,
    ].join('\n');

    const response = await this.modelClient.generate({
      model: EVALUATION_MODEL,
      systemInstruction: EVALUATION_SYSTEM_PROMPT,
      contents: [{ role: 'user', content: userPrompt, timestamp: Date.now() }],
      temperature: 0.2,
      maxTokens: 600,
    });

    let parsed: { scores?: Array<{ principleId: string; score: number; reasoning: string }>; violations?: string[]; revisionGuidance?: string };
    try {
      parsed = JSON.parse(response.text ?? '{}');
    } catch {
      parsed = {};
    }

    // Compute weighted adherence
    let weightedSum = 0;
    let totalWeight = 0;
    const violations: string[] = [];

    for (const score of parsed.scores ?? []) {
      const principle = constitution.principles.find(p => p.id === score.principleId);
      if (!principle) continue;

      weightedSum += score.score * principle.weight;
      totalWeight += principle.weight;

      if (score.score < principle.weight) {
        violations.push(score.principleId);
      }
    }

    const overallAdherence = totalWeight > 0 ? weightedSum / totalWeight : 1.0;

    return {
      principleScores: parsed.scores ?? [],
      overallAdherence,
      violations,
      revisionRequired: overallAdherence < ADHERENCE_THRESHOLD,
      revisionGuidance: parsed.revisionGuidance ?? '',
    };
  }

  /**
   * Record evaluation results in DB.
   */
  async recordEvaluation(
    runId: string,
    agentRole: string,
    constitutionVersion: number,
    evaluation: ConstitutionalEvaluation,
    preRevisionConfidence?: number,
    postRevisionConfidence?: number,
  ): Promise<void> {
    await this.supabase.from('constitutional_evaluations').insert({
      run_id: runId,
      agent_role: agentRole,
      constitution_version: constitutionVersion,
      principle_scores: evaluation.principleScores,
      overall_adherence: evaluation.overallAdherence,
      violations: evaluation.violations,
      revision_triggered: evaluation.revisionRequired,
      pre_revision_confidence: preRevisionConfidence,
      post_revision_confidence: postRevisionConfidence,
    });
  }

  /**
   * Update principle effectiveness scores based on run outcome.
   * Called post-run when reflection quality is known.
   */
  async updateEffectiveness(
    agentRole: string,
    runId: string,
    reflectionQuality: number,
  ): Promise<void> {
    const constitution = await this.getConstitution(agentRole);
    if (!constitution) return;

    const { data: evalData } = await this.supabase
      .from('constitutional_evaluations')
      .select('principle_scores')
      .eq('run_id', runId)
      .single();

    if (!evalData) return;

    const updatedPrinciples = constitution.principles.map(principle => {
      const score = (evalData.principle_scores as Array<{ principleId: string; score: number }>).find(
        s => s.principleId === principle.id,
      );
      if (!score) return principle;

      const correlation = score.score * reflectionQuality;
      const decay = 0.05;
      const newEffectiveness = principle.effectiveness * (1 - decay) + correlation * decay;

      return { ...principle, effectiveness: Math.max(0.1, Math.min(1.0, newEffectiveness)) };
    });

    await this.supabase
      .from('agent_constitutions')
      .update({ principles: updatedPrinciples, updated_at: new Date().toISOString() })
      .eq('agent_role', agentRole)
      .eq('active', true);

    if (this.cache) {
      await this.cache.del(`constitution:${agentRole}`);
    }
  }
}
