/**
 * Chain of Thought Planning Engine
 *
 * Decomposes complex strategic questions through structured reasoning:
 *   1. Problem Decomposition — Identify core problems and root causes
 *   2. Solution Space Mapping — Generate feasible solutions
 *   3. Strategic Options Analysis — Evaluate options with pros/cons
 *   4. Logical Validation — Validate assumptions and reasoning
 */

import { systemQuery } from '@glyphor/shared/db';
import type { ModelClient } from '@glyphor/agent-runtime';

/* ── Types ──────────────────────────────────── */

export type CotStatus =
  | 'planning'
  | 'decomposing'
  | 'mapping'
  | 'analyzing'
  | 'validating'
  | 'completed'
  | 'failed';

export interface CotProblem {
  title: string;
  severity: 'high' | 'medium' | 'low';
  description: string;
}

export interface CotRootCause {
  cause: string;
  linkedProblem: string;
  evidence: string;
}

export interface CotSolution {
  title: string;
  description: string;
  feasibility: number;
  timeframe: string;
  resources: string;
}

export interface CotOption {
  title: string;
  pros: string[];
  cons: string[];
  feasibilityScore: number;
  reasoning: string;
}

export interface CotValidation {
  assumption: string;
  status: 'valid' | 'questionable' | 'invalid';
  evidence: string;
}

export interface CotReport {
  summary: string;
  problems: CotProblem[];
  rootCauses: CotRootCause[];
  solutions: CotSolution[];
  options: CotOption[];
  validations: CotValidation[];
}

export interface CotRecord {
  id: string;
  query: string;
  status: CotStatus;
  requested_by: string;
  report: CotReport | null;
  created_at: string;
  completed_at: string | null;
  error: string | null;
}

/* ── Engine ─────────────────────────────────── */

export class CotEngine {
  constructor(
    private modelClient: ModelClient,
    private model = 'gpt-5-mini-2025-08-07',
  ) {}

  async launch(query: string, requestedBy: string): Promise<string> {
    const id = `cot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const record: CotRecord = {
      id,
      query,
      status: 'planning',
      requested_by: requestedBy,
      report: null,
      created_at: new Date().toISOString(),
      completed_at: null,
      error: null,
    };

    await systemQuery(
      'INSERT INTO cot_analyses (id,query,status,requested_by,report,created_at,completed_at,error) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [record.id, record.query, record.status, record.requested_by, JSON.stringify(record.report), record.created_at, record.completed_at, record.error],
    );

    this.runPhases(id, query).catch((err) => {
      console.error(`[CotEngine] Fatal error in CoT ${id}:`, err);
      systemQuery(
        'UPDATE cot_analyses SET status=$1, error=$2 WHERE id=$3',
        ['failed', err instanceof Error ? err.message : String(err), id],
      );
    });

    return id;
  }

  async get(id: string): Promise<CotRecord | null> {
    const rows = await systemQuery('SELECT * FROM cot_analyses WHERE id=$1', [id]);
    const [row] = rows;
    return (row as CotRecord) ?? null;
  }

  async list(limit = 20): Promise<CotRecord[]> {
    const rows = await systemQuery('SELECT * FROM cot_analyses ORDER BY created_at DESC LIMIT $1', [limit]);
    return (rows as CotRecord[]) ?? [];
  }

  /* ── Internal phase runner ──────────────── */

  private async runPhases(id: string, query: string): Promise<void> {
    const systemPrompt = 'You are a senior strategic planner performing structured chain-of-thought analysis. Respond ONLY with valid JSON — no markdown fences, no commentary.';

    // Phase 1: Decomposition
    await this.updateStatus(id, 'decomposing');
    const decomposition = await this.callModel(systemPrompt, [
      `Decompose this strategic question into core problems and root causes:`,
      `"${query}"`,
      ``,
      `Respond with JSON:`,
      `{`,
      `  "problems": [{ "title": "...", "severity": "high|medium|low", "description": "..." }],`,
      `  "rootCauses": [{ "cause": "...", "linkedProblem": "problem title", "evidence": "..." }]`,
      `}`,
    ].join('\n'));

    // Phase 2: Solution Space Mapping
    await this.updateStatus(id, 'mapping');
    const solutions = await this.callModel(systemPrompt, [
      `Given these problems and root causes for the question "${query}":`,
      JSON.stringify(decomposition),
      ``,
      `Map out the solution space. Respond with JSON:`,
      `{`,
      `  "solutions": [{ "title": "...", "description": "...", "feasibility": 0.0-1.0, "timeframe": "...", "resources": "..." }]`,
      `}`,
    ].join('\n'));

    // Phase 3: Strategic Options Analysis
    await this.updateStatus(id, 'analyzing');
    const options = await this.callModel(systemPrompt, [
      `Given these solutions for "${query}":`,
      JSON.stringify(solutions),
      ``,
      `Evaluate strategic options with pros, cons, and feasibility. Respond with JSON:`,
      `{`,
      `  "options": [{ "title": "...", "pros": ["..."], "cons": ["..."], "feasibilityScore": 1-10, "reasoning": "..." }]`,
      `}`,
    ].join('\n'));

    // Phase 4: Logical Validation
    await this.updateStatus(id, 'validating');
    const validations = await this.callModel(systemPrompt, [
      `Validate the logical assumptions in this analysis for "${query}":`,
      `Problems: ${JSON.stringify(decomposition.problems ?? [])}`,
      `Options: ${JSON.stringify(options.options ?? [])}`,
      ``,
      `Identify key assumptions and validate each. Respond with JSON:`,
      `{`,
      `  "validations": [{ "assumption": "...", "status": "valid|questionable|invalid", "evidence": "..." }]`,
      `}`,
    ].join('\n'));

    // Phase 5: Synthesis
    const summary = await this.callModel(systemPrompt, [
      `Synthesize this chain-of-thought analysis for "${query}" into a concise executive summary (2-3 paragraphs).`,
      `Problems: ${JSON.stringify(decomposition.problems ?? [])}`,
      `Solutions: ${JSON.stringify(solutions.solutions ?? [])}`,
      `Options: ${JSON.stringify(options.options ?? [])}`,
      `Validations: ${JSON.stringify(validations.validations ?? [])}`,
      ``,
      `Respond with JSON: { "summary": "..." }`,
    ].join('\n'), 'cot');

    const report: CotReport = {
      summary: (summary.summary as string) ?? 'Analysis complete.',
      problems: (decomposition.problems as CotProblem[]) ?? [],
      rootCauses: (decomposition.rootCauses as CotRootCause[]) ?? [],
      solutions: (solutions.solutions as CotSolution[]) ?? [],
      options: (options.options as CotOption[]) ?? [],
      validations: (validations.validations as CotValidation[]) ?? [],
    };

    await systemQuery(
      'UPDATE cot_analyses SET status=$1, report=$2, completed_at=$3 WHERE id=$4',
      ['completed', JSON.stringify(report), new Date().toISOString(), id],
    );

    await systemQuery(
      'INSERT INTO activity_log (agent_role, action, summary) VALUES ($1,$2,$3)',
      ['system', 'cot.completed', `Chain-of-thought analysis completed: ${query.slice(0, 100)}`],
    );
  }

  private async callModel(
    systemPrompt: string,
    userPrompt: string,
    engineSource?: 'cot',
  ): Promise<Record<string, unknown>> {
    const response = await this.modelClient.generate({
      model: this.model,
      systemInstruction: systemPrompt,
      contents: [{ role: 'user', content: userPrompt, timestamp: Date.now() }],
      temperature: 0.3,
      ...(engineSource ? { metadata: { engineSource } } : {}),
    });

    const text = response.text ?? '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return {};
  }

  private async updateStatus(id: string, status: CotStatus): Promise<void> {
    await systemQuery('UPDATE cot_analyses SET status=$1 WHERE id=$2', [status, id]);
  }
}
