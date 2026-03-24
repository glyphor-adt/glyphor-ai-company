/**
 * T+1 Simulation Engine
 *
 * Makes direct, parallel model calls to simulate impact of a proposed action:
 *   1. Plan      — Parse the action into impact dimensions
 *   2. Execute   — All department assessors run in parallel via direct model calls
 *   3. Cascade   — Identify second-order effects and dependencies
 *   4. Synthesize— Merge into an impact matrix with confidence scores
 */

import { systemQuery } from '@glyphor/shared/db';
import { getTierModel } from '@glyphor/shared';
import type { ModelClient } from '@glyphor/agent-runtime';

/* ── Types ──────────────────────────────────── */

export type SimulationStatus =
  | 'planning'
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

export interface QuickCascadeRequest {
  action: string;
  requestedBy: string;
  perspective?: 'optimistic' | 'neutral' | 'pessimistic';
  depth?: 'lightweight' | 'standard';
  timeoutMs?: number;
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

export type CascadePredictionType = 'metric_change' | 'risk_event' | 'team_impact';

export interface CascadePredictionRecord {
  id: string;
  simulation_id: string;
  prediction_type: CascadePredictionType;
  predicted_value: Record<string, unknown>;
  actual_value: Record<string, unknown> | null;
  accuracy_score: number | null;
  outcome_observed_at: string | null;
  created_at: string;
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
  predictions?: CascadePredictionRecord[];
}

export interface QuickCascadeResult {
  simulationId: string;
  summary: string;
  overallScore: number;
  recommendation: SimulationReport['recommendation'];
  report: SimulationReport;
  predictions: CascadePredictionRecord[];
}

/* ── Simulation perspectives ──────────────── */

const SIMULATION_AGENTS: Array<{ role: string; area: string }> = [
  { role: 'cto', area: 'Engineering & Technology' },
  { role: 'cfo', area: 'Financial Impact' },
  { role: 'cmo', area: 'Marketing & Brand' },
  { role: 'cpo', area: 'Product & User Experience' },
  { role: 'vp-sales', area: 'Sales & Revenue' },
];

/* ── Engine ─────────────────────────────────── */

export class SimulationEngine {
  constructor(
    private modelClient: ModelClient,
    private model = getTierModel('default'),
  ) {}

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

    await systemQuery(
      `INSERT INTO simulations (id, action, perspective, status, requested_by, dimensions, report, created_at, completed_at, accepted_at, accepted_by, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [record.id, record.action, record.perspective, record.status, record.requested_by, JSON.stringify(record.dimensions), record.report, record.created_at, record.completed_at, record.accepted_at, record.accepted_by, record.error],
    );

    // Run phases async
    this.runPhases(id, req).catch((err) => {
      console.error(`[SimulationEngine] Fatal error in sim ${id}:`, err);
      systemQuery(
        'UPDATE simulations SET status=$1, error=$2 WHERE id=$3',
        ['failed', err instanceof Error ? err.message : String(err), id],
      );
    });

    return id;
  }

  async get(id: string): Promise<SimulationRecord | null> {
    const [row] = await systemQuery(
      'SELECT * FROM simulations WHERE id=$1',
      [id],
    );
    if (!row) return null;
    const [record] = await this.attachPredictions([row as SimulationRecord]);
    return record ?? null;
  }

  async list(limit = 20): Promise<SimulationRecord[]> {
    const rows = await systemQuery(
      'SELECT * FROM simulations ORDER BY created_at DESC LIMIT $1',
      [limit],
    );
    return this.attachPredictions((rows as SimulationRecord[]) ?? []);
  }

  async accept(id: string, acceptedBy: string): Promise<void> {
    await systemQuery(
      'UPDATE simulations SET status=$1, accepted_at=$2, accepted_by=$3 WHERE id=$4',
      ['accepted', new Date().toISOString(), acceptedBy, id],
    );

    await systemQuery(
      'INSERT INTO activity_log (agent_role, action, summary) VALUES ($1,$2,$3)',
      ['system', 'simulation.accepted', `Simulation ${id} accepted by ${acceptedBy}`],
    );
  }

  async runQuick(req: QuickCascadeRequest): Promise<QuickCascadeResult> {
    const perspective = req.perspective ?? 'neutral';
    const id = `sim-quick-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const record: SimulationRecord = {
      id,
      action: req.action,
      perspective,
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

    await systemQuery(
      `INSERT INTO simulations (id, action, perspective, status, requested_by, dimensions, report, created_at, completed_at, accepted_at, accepted_by, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [record.id, record.action, record.perspective, record.status, record.requested_by, JSON.stringify(record.dimensions), record.report, record.created_at, record.completed_at, record.accepted_at, record.accepted_by, record.error],
    );

    await this.updateStatus(id, 'executing');
    const dimensions = await this.collectDimensions(
      req.action,
      perspective,
      req.depth === 'lightweight' ? 3 : SIMULATION_AGENTS.length,
      req.timeoutMs,
    );

    await systemQuery(
      'UPDATE simulations SET dimensions=$1 WHERE id=$2',
      [JSON.stringify(dimensions), id],
    );

    await this.updateStatus(id, 'cascading');
    const cascadeChain = buildCascadeChain(dimensions).slice(0, req.depth === 'lightweight' ? 3 : undefined);

    await this.updateStatus(id, 'synthesizing');
    const report = await this.synthesize(
      { action: req.action, perspective, requestedBy: req.requestedBy },
      dimensions,
      cascadeChain,
    );

    await systemQuery(
      'UPDATE simulations SET status=$1, report=$2, dimensions=$3, completed_at=$4 WHERE id=$5',
      ['completed', JSON.stringify(report), JSON.stringify(dimensions), new Date().toISOString(), id],
    );

    await this.persistPredictions(id, report);
    const predictions = await this.getPredictionsForSimulation(id);

    return {
      simulationId: id,
      summary: report.summary,
      overallScore: report.overallScore,
      recommendation: report.recommendation,
      report,
      predictions,
    };
  }

  /* ── Internal phase runner ──────────────── */

  private async runPhases(id: string, req: SimulationRequest): Promise<void> {
    // Phase 1: Execute — get all impact assessments in parallel
    await this.updateStatus(id, 'executing');
    const dimensions = await this.collectDimensions(req.action, req.perspective);

    await systemQuery(
      'UPDATE simulations SET dimensions=$1 WHERE id=$2',
      [JSON.stringify(dimensions), id],
    );

    // Phase 2: Cascade — identify second-order effects
    await this.updateStatus(id, 'cascading');
    const cascadeChain = buildCascadeChain(dimensions);

    // Phase 3: Synthesize
    await this.updateStatus(id, 'synthesizing');
    const report = await this.synthesize(req, dimensions, cascadeChain);

    await systemQuery(
      'UPDATE simulations SET status=$1, report=$2, dimensions=$3, completed_at=$4 WHERE id=$5',
      ['completed', JSON.stringify(report), JSON.stringify(dimensions), new Date().toISOString(), id],
    );
    await this.persistPredictions(id, report);

    await systemQuery(
      'INSERT INTO activity_log (agent_role, action, summary) VALUES ($1,$2,$3)',
      ['system', 'simulation.completed', `Simulation completed: "${req.action.slice(0, 100)}" — score: ${report.overallScore}`],
    );
  }

  private async collectDimensions(
    action: string,
    perspective: SimulationRequest['perspective'],
    agentLimit = SIMULATION_AGENTS.length,
    timeoutMs?: number,
  ): Promise<ImpactDimension[]> {
    const activeAgents = SIMULATION_AGENTS.slice(0, agentLimit);
    const results = await Promise.allSettled(
      activeAgents.map((sa) => this.assessImpactWithTimeout(action, sa.area, sa.role, perspective, timeoutMs)),
    );

    return results.map((result, i) => {
      const sa = activeAgents[i];
      if (result.status === 'fulfilled') {
        return result.value;
      }
      return {
        area: sa.area,
        perspective: sa.role,
        impact: 'neutral' as const,
        magnitude: 0,
        confidence: 0,
        reasoning: `Assessment failed: ${result.reason?.message ?? String(result.reason)}`,
        secondOrderEffects: [],
      };
    });
  }

  private async assessImpactWithTimeout(
    action: string,
    area: string,
    role: string,
    perspective: SimulationRequest['perspective'],
    timeoutMs?: number,
  ): Promise<ImpactDimension> {
    if (!timeoutMs || timeoutMs <= 0) {
      return this.assessImpact(action, area, role, perspective);
    }

    return promiseWithTimeout(
      this.assessImpact(action, area, role, perspective),
      timeoutMs,
      `Cascade quick-run timed out for ${role}`,
    );
  }

  private async assessImpact(
    action: string, area: string, role: string, perspective: string,
  ): Promise<ImpactDimension> {
    const prompt = buildImpactPrompt(action, area, perspective as 'optimistic' | 'neutral' | 'pessimistic');

    const response = await this.modelClient.generate({
      model: this.model,
      systemInstruction: `You are a senior executive assessing the impact of a proposed action on ${area}. Respond ONLY with valid JSON — no markdown, no code fences, no preamble.`,
      contents: [{ role: 'user', content: prompt, timestamp: Date.now() }],
      temperature: 0.3,
    });

    return parseImpactDimension(response.text ?? '', area, role);
  }

  private async synthesize(
    req: SimulationRequest,
    dimensions: ImpactDimension[],
    cascadeChain: CascadeLink[],
  ): Promise<SimulationReport> {
    const weighted = dimensions.filter((d) => d.confidence > 0);
    const totalWeight = weighted.reduce((s, d) => s + d.confidence, 0);
    const overallScore = totalWeight > 0
      ? Math.round(weighted.reduce((s, d) => s + d.magnitude * d.confidence, 0) / totalWeight * 10) / 10
      : 0;

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

    let summary = `Impact simulation of "${req.action}" across ${dimensions.length} dimensions. Overall score: ${overallScore}/10.`;

    try {
      const synthesisPrompt = [
        `Summarize this T+1 impact simulation in 2-3 paragraphs.`,
        `Action: "${req.action}"`,
        `Perspective: ${req.perspective}`,
        `Overall score: ${overallScore}/10`,
        `Recommendation: ${recommendation}`,
        '',
        ...dimensions.map((d) =>
          `${d.area} (${d.perspective}): ${d.impact} impact, magnitude ${d.magnitude}/10, confidence ${Math.round(d.confidence * 100)}%\nReasoning: ${d.reasoning}`,
        ),
      ].join('\n');

      const response = await this.modelClient.generate({
        model: this.model,
        systemInstruction: 'You are a chief strategist writing an executive summary. Be direct and specific. Respond with plain text — no JSON, no markdown headers.',
        contents: [{ role: 'user', content: synthesisPrompt, timestamp: Date.now() }],
        temperature: 0.3,
        metadata: { engineSource: 'simulation' },
      });
      summary = response.text ?? summary;
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
    await systemQuery('UPDATE simulations SET status=$1 WHERE id=$2', [status, id]);
  }

  private async persistPredictions(id: string, report: SimulationReport): Promise<void> {
    const predictions = buildCascadePredictions(id, report);
    await systemQuery('DELETE FROM cascade_predictions WHERE simulation_id = $1', [id]);

    for (const prediction of predictions) {
      await systemQuery(
        `INSERT INTO cascade_predictions (simulation_id, prediction_type, predicted_value)
         VALUES ($1, $2, $3)`,
        [id, prediction.prediction_type, JSON.stringify(prediction.predicted_value)],
      );
    }
  }

  private async getPredictionsForSimulation(id: string): Promise<CascadePredictionRecord[]> {
    const rows = await systemQuery<CascadePredictionRecord>(
      `SELECT id, simulation_id, prediction_type, predicted_value, actual_value, accuracy_score, outcome_observed_at, created_at
       FROM cascade_predictions
       WHERE simulation_id = $1
       ORDER BY created_at ASC`,
      [id],
    );
    return rows ?? [];
  }

  private async attachPredictions(records: SimulationRecord[]): Promise<SimulationRecord[]> {
    if (records.length === 0) return records;
    const ids = records.map((record) => record.id);
    const rows = await systemQuery<CascadePredictionRecord>(
      `SELECT id, simulation_id, prediction_type, predicted_value, actual_value, accuracy_score, outcome_observed_at, created_at
       FROM cascade_predictions
       WHERE simulation_id = ANY($1::text[])
       ORDER BY created_at ASC`,
      [ids],
    );

    const bySimulation = new Map<string, CascadePredictionRecord[]>();
    for (const row of rows ?? []) {
      const list = bySimulation.get(row.simulation_id) ?? [];
      list.push(row);
      bySimulation.set(row.simulation_id, list);
    }

    return records.map((record) => ({
      ...record,
      predictions: bySimulation.get(record.id) ?? [],
    }));
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
    `Assess the impact of this proposed action on ${area}:`,
    `"${action}"`,
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
    reasoning: output.slice(0, 200) || 'No assessment produced.',
    secondOrderEffects: [],
  };
}

function buildCascadeChain(dimensions: ImpactDimension[]): CascadeLink[] {
  const chain: CascadeLink[] = [];

  for (const dim of dimensions) {
    for (const effect of dim.secondOrderEffects) {
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

function buildCascadePredictions(
  simulationId: string,
  report: SimulationReport,
): Array<{
  simulation_id: string;
  prediction_type: CascadePredictionType;
  predicted_value: Record<string, unknown>;
}> {
  const avgConfidence = report.dimensions.length > 0
    ? report.dimensions.reduce((sum, dimension) => sum + dimension.confidence, 0) / report.dimensions.length
    : 0.5;

  const predictions: Array<{
    simulation_id: string;
    prediction_type: CascadePredictionType;
    predicted_value: Record<string, unknown>;
  }> = [
    {
      simulation_id: simulationId,
      prediction_type: 'metric_change',
      predicted_value: {
        overallScore: report.overallScore,
        recommendation: report.recommendation,
        summary: report.summary,
        confidence: Math.max(0.35, avgConfidence),
      },
    },
  ];

  for (const dimension of report.dimensions) {
    predictions.push({
      simulation_id: simulationId,
      prediction_type: 'team_impact',
      predicted_value: {
        agentRole: dimension.perspective,
        area: dimension.area,
        impact: dimension.impact,
        magnitude: dimension.magnitude,
        confidence: dimension.confidence,
        reasoning: dimension.reasoning,
      },
    });

    if (dimension.impact === 'negative' || dimension.magnitude <= -2) {
      predictions.push({
        simulation_id: simulationId,
        prediction_type: 'risk_event',
        predicted_value: {
          agentRole: dimension.perspective,
          area: dimension.area,
          impact: dimension.impact,
          magnitude: dimension.magnitude,
          confidence: Math.max(0.4, dimension.confidence),
          reasoning: dimension.reasoning,
        },
      });
    }
  }

  return predictions;
}

function promiseWithTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}
