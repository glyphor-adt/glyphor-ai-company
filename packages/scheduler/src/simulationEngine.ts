/**
 * T+1 Simulation Engine
 *
 * Simulates the impact of a proposed action across the organization:
 *   1. Plan      — Parse the action into impact dimensions
 *   2. Spawn     — Create perspective agents for each department
 *   3. Execute   — Each agent assesses impact from their viewpoint
 *   4. Cascade   — Identify second-order effects and dependencies
 *   5. Synthesize— Merge into an impact matrix with confidence scores
 *   6. Cleanup   — Retire temporary agents
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CompanyAgentRole, AgentExecutionResult } from '@glyphor/agent-runtime';
import { createTemporaryAgent, retireTemporaryAgent } from './agentLifecycle.js';

/* ── Types ──────────────────────────────────── */

export type SimulationStatus =
  | 'planning'
  | 'spawning'
  | 'executing'
  | 'cascading'
  | 'synthesizing'
  | 'completed'
  | 'failed'
  | 'accepted'
  | 'rejected';

export interface SimulationRequest {
  action: string;           // The proposed action to simulate
  perspective: 'optimistic' | 'neutral' | 'pessimistic';
  requestedBy: string;
}

export interface ImpactDimension {
  area: string;             // e.g. "Revenue", "Engineering", "Customer Satisfaction"
  perspective: string;      // which agent assessed this
  impact: 'positive' | 'negative' | 'neutral';
  magnitude: number;        // -10 to +10
  confidence: number;       // 0 to 1
  reasoning: string;
  secondOrderEffects: string[];
}

export interface CascadeLink {
  from: string;             // dimension area
  to: string;               // affected dimension area
  effect: string;           // description of the cascade
  delay: string;            // immediate | days | weeks | months
}

export interface SimulationReport {
  summary: string;
  overallScore: number;     // -10 to +10 weighted average
  dimensions: ImpactDimension[];
  cascadeChain: CascadeLink[];
  votes: Array<{ agent: string; vote: 'approve' | 'caution' | 'reject'; reasoning: string }>;
  recommendation: 'proceed' | 'proceed_with_caution' | 'reconsider';
}

export interface SimulationRecord {
  id: string;
  action: string;
  perspective: 'optimistic' | 'neutral' | 'pessimistic';
  status: SimulationStatus;
  requested_by: string;
  dimensions: ImpactDimension[];
  report: SimulationReport | null;
  created_at: string;
  completed_at: string | null;
  accepted_at: string | null;
  accepted_by: string | null;
  error: string | null;
}

/* ── Simulation perspectives ──────────────── */

const SIMULATION_AGENTS: Array<{ role: string; area: string }> = [
  { role: 'cto', area: 'Engineering & Technology' },
  { role: 'cfo', area: 'Financial Impact' },
  { role: 'cmo', area: 'Marketing & Brand' },
  { role: 'cpo', area: 'Product & User Experience' },
  { role: 'vp-sales', area: 'Sales & Revenue' },
  { role: 'vp-customer-success', area: 'Customer Satisfaction' },
];

/* ── Engine ─────────────────────────────────── */

export class SimulationEngine {
  constructor(
    private supabase: SupabaseClient,
    private agentExecutor: (
      role: CompanyAgentRole,
      task: string,
      payload: Record<string, unknown>,
    ) => Promise<AgentExecutionResult | void>,
  ) {}

  /**
   * Launch a simulation. Returns the simulation ID for polling.
   */
  async launch(req: SimulationRequest): Promise<string> {
    const id = `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const record: SimulationRecord = {
      id,
      action: req.action,
      perspective: req.perspective,
      status: 'planning',
      requested_by: req.requestedBy,
      dimensions: [],
      report: null,
      created_at: new Date().toISOString(),
      completed_at: null,
      accepted_at: null,
      accepted_by: null,
      error: null,
    };

    await this.supabase.from('simulations').insert(record);

    // Run phases async
    this.runPhases(id, req).catch((err) => {
      console.error(`[SimulationEngine] Fatal error in sim ${id}:`, err);
      this.supabase.from('simulations').update({
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      }).eq('id', id);
    });

    return id;
  }

  async get(id: string): Promise<SimulationRecord | null> {
    const { data } = await this.supabase
      .from('simulations')
      .select('*')
      .eq('id', id)
      .single();
    return data as SimulationRecord | null;
  }

  async list(limit = 20): Promise<SimulationRecord[]> {
    const { data } = await this.supabase
      .from('simulations')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    return (data as SimulationRecord[]) ?? [];
  }

  /**
   * Mark a simulation as accepted by a founder.
   */
  async accept(id: string, acceptedBy: string): Promise<void> {
    await this.supabase.from('simulations').update({
      status: 'accepted',
      accepted_at: new Date().toISOString(),
      accepted_by: acceptedBy,
    }).eq('id', id);

    await this.supabase.from('activity_log').insert({
      agent_id: 'system',
      action: 'simulation.accepted',
      detail: `Simulation ${id} accepted by ${acceptedBy}`,
      created_at: new Date().toISOString(),
    });
  }

  /* ── Internal phase runner ──────────────── */

  private async runPhases(id: string, req: SimulationRequest): Promise<void> {
    // Phase 2: Spawn temporary agents
    await this.updateStatus(id, 'spawning');
    const spawnedAgentIds: string[] = [];

    for (const sa of SIMULATION_AGENTS) {
      try {
        const agent = await createTemporaryAgent(this.supabase, {
          name: `${sa.role}-sim-${id.slice(-6)}`,
          role: `${sa.role}-sim-${id.slice(-6)}`,
          department: 'Simulation',
          reportsTo: 'chief-of-staff',
          systemPrompt: buildImpactPrompt(req.action, sa.area, req.perspective),
          maxTurns: 6,
          ttlDays: 1,
          spawnedBy: id,
          spawnedFor: `Simulation: ${sa.area} impact assessment`,
        });
        spawnedAgentIds.push(agent.id);
      } catch (err) {
        console.error(`[SimulationEngine] Failed to spawn agent for ${sa.area}:`, err);
      }
    }

    // Phase 3: Execute — get impact assessments
    await this.updateStatus(id, 'executing');
    const dimensions: ImpactDimension[] = [];

    for (const sa of SIMULATION_AGENTS) {
      try {
        const result = await this.agentExecutor(
          sa.role as CompanyAgentRole,
          'on_demand',
          { message: buildImpactPrompt(req.action, sa.area, req.perspective) },
        );

        const output = (result as AgentExecutionResult)?.output ?? '';
        const dimension = parseImpactDimension(output, sa.area, sa.role);
        dimensions.push(dimension);
      } catch (err) {
        dimensions.push({
          area: sa.area,
          perspective: sa.role,
          impact: 'neutral',
          magnitude: 0,
          confidence: 0,
          reasoning: `Assessment failed: ${err instanceof Error ? err.message : String(err)}`,
          secondOrderEffects: [],
        });
      }

      await this.supabase.from('simulations').update({ dimensions }).eq('id', id);
    }

    // Phase 4: Cascade — identify second-order effects
    await this.updateStatus(id, 'cascading');
    const cascadeChain = buildCascadeChain(dimensions);

    // Phase 5: Synthesize
    await this.updateStatus(id, 'synthesizing');
    const report = await this.synthesize(req, dimensions, cascadeChain);

    await this.supabase.from('simulations').update({
      status: 'completed',
      report,
      dimensions,
      completed_at: new Date().toISOString(),
    }).eq('id', id);

    // Phase 6: Cleanup
    for (const agentId of spawnedAgentIds) {
      await retireTemporaryAgent(this.supabase, agentId, 'Simulation complete').catch(() => {});
    }

    await this.supabase.from('activity_log').insert({
      agent_id: 'system',
      action: 'simulation.completed',
      detail: `Simulation completed: "${req.action.slice(0, 100)}" — score: ${report.overallScore}`,
      created_at: new Date().toISOString(),
    });
  }

  private async synthesize(
    req: SimulationRequest,
    dimensions: ImpactDimension[],
    cascadeChain: CascadeLink[],
  ): Promise<SimulationReport> {
    // Calculate overall score as weighted average
    const weighted = dimensions.filter((d) => d.confidence > 0);
    const totalWeight = weighted.reduce((s, d) => s + d.confidence, 0);
    const overallScore = totalWeight > 0
      ? Math.round(weighted.reduce((s, d) => s + d.magnitude * d.confidence, 0) / totalWeight * 10) / 10
      : 0;

    // Generate votes from each dimension
    const votes = dimensions.map((d) => ({
      agent: d.perspective,
      vote: (d.magnitude >= 3 ? 'approve' : d.magnitude <= -3 ? 'reject' : 'caution') as 'approve' | 'caution' | 'reject',
      reasoning: d.reasoning,
    }));

    const approvals = votes.filter((v) => v.vote === 'approve').length;
    const rejections = votes.filter((v) => v.vote === 'reject').length;
    const recommendation: 'proceed' | 'proceed_with_caution' | 'reconsider' =
      rejections >= 3 ? 'reconsider'
      : approvals >= 4 ? 'proceed'
      : 'proceed_with_caution';

    // Generate summary via chief-of-staff
    let summary = `Impact simulation of "${req.action}" across ${dimensions.length} dimensions. Overall score: ${overallScore}/10.`;

    try {
      const synthesisPrompt = [
        `Summarize this T+1 simulation in 2-3 paragraphs.`,
        `Action: "${req.action}"`,
        `Perspective: ${req.perspective}`,
        `Overall score: ${overallScore}/10`,
        `Recommendation: ${recommendation}`,
        '',
        ...dimensions.map((d) =>
          `${d.area} (${d.perspective}): ${d.impact} impact, magnitude ${d.magnitude}/10, confidence ${Math.round(d.confidence * 100)}%`,
        ),
      ].join('\n');

      const result = await this.agentExecutor(
        'chief-of-staff',
        'on_demand',
        { message: synthesisPrompt },
      );
      summary = (result as AgentExecutionResult)?.output ?? summary;
    } catch {
      // Use fallback summary
    }

    return {
      summary,
      overallScore,
      dimensions,
      cascadeChain,
      votes,
      recommendation,
    };
  }

  private async updateStatus(id: string, status: SimulationStatus): Promise<void> {
    await this.supabase.from('simulations').update({ status }).eq('id', id);
  }
}

/* ── Prompt builders ───────────────────────── */

function buildImpactPrompt(
  action: string,
  area: string,
  perspective: 'optimistic' | 'neutral' | 'pessimistic',
): string {
  const biasInstruction =
    perspective === 'optimistic'
      ? 'Lean toward identifying positive outcomes and upside potential.'
      : perspective === 'pessimistic'
      ? 'Lean toward identifying risks, downsides, and worst-case scenarios.'
      : 'Be balanced and objective in your assessment.';

  return [
    `You are assessing the impact of a proposed action on ${area}.`,
    ``,
    `Proposed action: "${action}"`,
    ``,
    `${biasInstruction}`,
    ``,
    `Respond with valid JSON:`,
    `{`,
    `  "impact": "positive" | "negative" | "neutral",`,
    `  "magnitude": <number from -10 to 10>,`,
    `  "confidence": <number from 0 to 1>,`,
    `  "reasoning": "2-3 sentence explanation",`,
    `  "secondOrderEffects": ["effect1", "effect2"]`,
    `}`,
  ].join('\n');
}

function parseImpactDimension(
  output: string,
  area: string,
  perspective: string,
): ImpactDimension {
  try {
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        area,
        perspective,
        impact: parsed.impact ?? 'neutral',
        magnitude: Math.max(-10, Math.min(10, parsed.magnitude ?? 0)),
        confidence: Math.max(0, Math.min(1, parsed.confidence ?? 0.5)),
        reasoning: parsed.reasoning ?? output.slice(0, 200),
        secondOrderEffects: parsed.secondOrderEffects ?? [],
      };
    }
  } catch {
    // Fall through to default
  }

  return {
    area,
    perspective,
    impact: 'neutral',
    magnitude: 0,
    confidence: 0.3,
    reasoning: output.slice(0, 200),
    secondOrderEffects: [],
  };
}

function buildCascadeChain(dimensions: ImpactDimension[]): CascadeLink[] {
  const chain: CascadeLink[] = [];

  for (const dim of dimensions) {
    for (const effect of dim.secondOrderEffects) {
      // Try to match second-order effects to other dimensions
      const target = dimensions.find((d) =>
        d.area !== dim.area &&
        effect.toLowerCase().includes(d.area.toLowerCase().split(' ')[0].toLowerCase()),
      );
      if (target) {
        chain.push({
          from: dim.area,
          to: target.area,
          effect,
          delay: 'weeks',
        });
      }
    }
  }

  return chain;
}
