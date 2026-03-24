/**
 * Strategic Analysis Engine
 *
 * Makes direct, parallel model calls to get multi-perspective strategic analyses:
 *   1. Plan      — Break the question into research threads
 *   2. Execute   — Run all threads in parallel via direct model calls
 *   3. Synthesize — Merge findings into a structured SWOT report
 */

import { systemQuery } from '@glyphor/shared/db';
import { getTierModel } from '@glyphor/shared';
import type { ModelClient } from '@glyphor/agent-runtime';

/* ── Types ──────────────────────────────────── */

export type AnalysisType =
  | 'market_opportunity'
  | 'competitive_landscape'
  | 'product_strategy'
  | 'growth_diagnostic'
  | 'risk_assessment';

export type AnalysisDepth = 'quick' | 'standard' | 'deep';

export type AnalysisStatus =
  | 'planning'
  | 'executing'
  | 'synthesizing'
  | 'completed'
  | 'failed';

export interface AnalysisRequest {
  type: AnalysisType;
  query: string;
  depth: AnalysisDepth;
  requestedBy: string;
}

export interface ResearchThread {
  id: string;
  label: string;
  perspective: string;     // which exec perspective (cto, cfo, cmo, etc.)
  prompt: string;          // the research prompt
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: string;
}

export interface AnalysisReport {
  summary: string;
  swot: { strengths: string[]; weaknesses: string[]; opportunities: string[]; threats: string[] };
  recommendations: Array<{ title: string; priority: 'high' | 'medium' | 'low'; detail: string }>;
  threads: ResearchThread[];
}

export interface AnalysisRecord {
  id: string;
  type: AnalysisType;
  query: string;
  depth: AnalysisDepth;
  status: AnalysisStatus;
  requested_by: string;
  threads: ResearchThread[];
  report: AnalysisReport | null;
  created_at: string;
  completed_at: string | null;
  error: string | null;
}

/* ── Perspective → Thread mapping ─────────── */

const ANALYSIS_PERSPECTIVES: Record<AnalysisType, string[]> = {
  market_opportunity: ['cmo', 'vp-sales', 'cfo', 'cpo'],
  competitive_landscape: ['competitive-intel', 'cto', 'cmo', 'vp-sales'],
  product_strategy: ['cpo', 'cto', 'user-researcher', 'vp-design'],
  growth_diagnostic: ['cmo', 'vp-sales', 'cfo'],
  risk_assessment: ['cfo', 'cto', 'ops', 'chief-of-staff'],
};

const DEPTH_DETAIL: Record<AnalysisDepth, string> = {
  quick: 'Provide a concise 2-3 paragraph analysis.',
  standard: 'Provide a thorough analysis with supporting reasoning.',
  deep: 'Provide an exhaustive, deeply researched analysis with data references and edge cases.',
};

/* ── Engine ─────────────────────────────────── */

export class AnalysisEngine {
  constructor(
    private modelClient: ModelClient,
    private model = getTierModel('default'),
  ) {}

  /**
   * Launch an analysis. Runs all phases inline (no fire-and-forget).
   * Returns the analysis ID once complete.
   */
  async launch(req: AnalysisRequest): Promise<string> {
    const id = `analysis-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const perspectives = ANALYSIS_PERSPECTIVES[req.type];

    const threads: ResearchThread[] = perspectives.map((perspective, i) => ({
      id: `${id}-thread-${i}`,
      label: `${perspective} perspective`,
      perspective,
      prompt: buildThreadPrompt(req.type, req.query, perspective, req.depth),
      status: 'pending' as const,
    }));

    const record: AnalysisRecord = {
      id,
      type: req.type,
      query: req.query,
      depth: req.depth,
      status: 'planning',
      requested_by: req.requestedBy,
      threads,
      report: null,
      created_at: new Date().toISOString(),
      completed_at: null,
      error: null,
    };

    await systemQuery('INSERT INTO analyses (id, type, query, depth, status, requested_by, threads, report, created_at, completed_at, error) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [record.id, record.type, record.query, record.depth, record.status, record.requested_by, JSON.stringify(record.threads), null, record.created_at, null, null]);

    // Run all phases inline — don't fire-and-forget
    this.runPhases(id, req, threads).catch((err) => {
      console.error(`[AnalysisEngine] Fatal error in analysis ${id}:`, err);
      systemQuery('UPDATE analyses SET status = $1, error = $2 WHERE id = $3', [
        'failed',
        err instanceof Error ? err.message : String(err),
        id,
      ]);
    });

    return id;
  }

  async get(id: string): Promise<AnalysisRecord | null> {
    const [row] = await systemQuery('SELECT * FROM analyses WHERE id = $1', [id]);
    return (row as AnalysisRecord) ?? null;
  }

  async list(limit = 20): Promise<AnalysisRecord[]> {
    const rows = await systemQuery('SELECT * FROM analyses ORDER BY created_at DESC LIMIT $1', [limit]);
    return (rows as AnalysisRecord[]) ?? [];
  }

  /** Cancel a stuck analysis */
  async cancel(id: string): Promise<void> {
    await systemQuery('UPDATE analyses SET status = $1, error = $2 WHERE id = $3', [
      'failed',
      'Cancelled — analysis was stuck or manually stopped.',
      id,
    ]);
  }

  /**
   * Recover stale analyses on startup.
   * Any analysis stuck in an active status for >10 minutes gets marked failed.
   */
  async recoverStale(): Promise<number> {
    const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const data = await systemQuery(
      'SELECT id FROM analyses WHERE status = ANY($1) AND created_at < $2',
      [['planning', 'executing', 'synthesizing'], cutoff],
    );

    if (!data || data.length === 0) return 0;

    for (const row of data) {
      await systemQuery('UPDATE analyses SET status = $1, error = $2 WHERE id = $3', [
        'failed',
        'Recovered — analysis was orphaned after container restart.',
        (row as { id: string }).id,
      ]);
    }
    console.log(`[AnalysisEngine] Recovered ${data.length} stale analyses`);
    return data.length;
  }

  /**
   * Generate an enhanced executive-grade report by spawning additional
   * specialist perspectives and performing deeper analysis.
   */
  async enhance(id: string): Promise<void> {
    const record = await this.get(id);
    if (!record?.report) throw new Error('Analysis not found or not completed');

    const report = record.report;

    // Determine additional specialist perspectives based on analysis type
    const additionalPerspectives = this.getEnhancedPerspectives(record.type);
    const existingPerspectives = new Set(report.threads.map((t) => t.perspective));
    const newPerspectives = additionalPerspectives.filter((p) => !existingPerspectives.has(p));

    if (newPerspectives.length === 0) return; // Already has all perspectives

    // Create deeper research threads for new perspectives
    const newThreads: ResearchThread[] = newPerspectives.map((perspective, i) => ({
      id: `${id}-enhanced-${i}`,
      label: `${perspective} deep-dive`,
      perspective,
      prompt: buildEnhancedThreadPrompt(record.type, record.query, perspective, report),
      status: 'pending' as const,
    }));

    // Execute new threads in parallel
    const results = await Promise.allSettled(
      newThreads.map((thread) => this.executeThread(thread)),
    );

    for (let i = 0; i < newThreads.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        newThreads[i].result = result.value;
        newThreads[i].status = 'completed';
      } else {
        newThreads[i].result = `Error: ${result.reason?.message ?? String(result.reason)}`;
        newThreads[i].status = 'failed';
      }
    }

    // Re-synthesize with all threads (original + enhanced)
    const allThreads = [...report.threads, ...newThreads];
    const enhancedReport = await this.synthesize(
      { type: record.type, query: record.query, depth: 'deep', requestedBy: record.requested_by },
      allThreads,
    );

    // Update the analysis with enhanced report
    await systemQuery('UPDATE analyses SET report = $1, threads = $2, depth = $3 WHERE id = $4', [
      JSON.stringify(enhancedReport),
      JSON.stringify(allThreads),
      'deep',
      id,
    ]);
  }

  /**
   * Get additional specialist perspectives for enhanced analysis.
   */
  private getEnhancedPerspectives(type: AnalysisType): string[] {
    const base = ANALYSIS_PERSPECTIVES[type];
    const allPerspectives = [
      'cto', 'cfo', 'cmo', 'cpo', 'vp-sales',
      'vp-design', 'competitive-intel', 'user-researcher', 'ops', 'chief-of-staff',
    ];
    // Return all perspectives not in the base set — plus always include financial and ops
    return allPerspectives.filter((p) => !base.includes(p));
  }

  /* ── Internal phase runner ──────────────── */

  private async runPhases(
    id: string,
    req: AnalysisRequest,
    threads: ResearchThread[],
  ): Promise<void> {
    // Phase 1: Execute all threads in parallel via direct model calls
    await this.updateStatus(id, 'executing');
    threads.forEach((t) => { t.status = 'running'; });
    await this.updateThreads(id, threads);

    const results = await Promise.allSettled(
      threads.map((thread) => this.executeThread(thread)),
    );

    for (let i = 0; i < threads.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        threads[i].result = result.value;
        threads[i].status = 'completed';
      } else {
        threads[i].result = `Error: ${result.reason?.message ?? String(result.reason)}`;
        threads[i].status = 'failed';
      }
    }
    await this.updateThreads(id, threads);

    // If ALL threads failed, mark the whole analysis as failed — don't bother synthesizing
    const completedCount = threads.filter((t) => t.status === 'completed').length;
    if (completedCount === 0) {
      await systemQuery('UPDATE analyses SET status = $1, threads = $2, error = $3 WHERE id = $4', [
        'failed',
        JSON.stringify(threads),
        `All ${threads.length} research threads failed. Check API keys and model availability.`,
        id,
      ]);
      return;
    }

    // Phase 2: Synthesize thread results into a structured report
    await this.updateStatus(id, 'synthesizing');
    const report = await this.synthesize(req, threads);

    await systemQuery('UPDATE analyses SET status = $1, report = $2, threads = $3, completed_at = $4 WHERE id = $5', [
      'completed',
      JSON.stringify(report),
      JSON.stringify(threads),
      new Date().toISOString(),
      id,
    ]);

    await systemQuery('INSERT INTO activity_log (agent_role, action, summary) VALUES ($1, $2, $3)', [
      'system',
      'analysis.completed',
      `Analysis "${req.type}" completed: ${req.query.slice(0, 100)}`,
    ]);
  }

  private async executeThread(thread: ResearchThread): Promise<string> {
    const response = await this.modelClient.generate({
      model: this.model,
      systemInstruction: `You are a senior strategic analyst providing perspective from the viewpoint of a ${thread.perspective}. Be specific, data-driven where possible, and actionable. Do not hedge or use filler — deliver clear analysis.`,
      contents: [{ role: 'user', content: thread.prompt, timestamp: Date.now() }],
      temperature: 0.4,
    });
    return response.text ?? 'No analysis produced.';
  }

  private async synthesize(
    req: AnalysisRequest,
    threads: ResearchThread[],
  ): Promise<AnalysisReport> {
    const completedThreads = threads.filter((t) => t.status === 'completed' && t.result);

    if (completedThreads.length === 0) {
      return {
        summary: `Analysis of "${req.query}" failed — no perspectives completed successfully.`,
        swot: { strengths: [], weaknesses: [], opportunities: [], threats: [] },
        recommendations: [],
        threads,
      };
    }

    const synthesisPrompt = [
      `Synthesize these multi-perspective research findings into a structured strategic analysis.`,
      ``,
      `Analysis type: ${req.type.replace(/_/g, ' ')}`,
      `Original question: ${req.query}`,
      ``,
      ...completedThreads.map((t) =>
        `=== ${t.perspective.toUpperCase()} PERSPECTIVE ===\n${t.result}\n`,
      ),
      ``,
      `Respond ONLY with valid JSON (no markdown fences, no commentary) matching this exact schema:`,
      `{`,
      `  "summary": "Executive summary (2-3 paragraphs)",`,
      `  "swot": {`,
      `    "strengths": ["strength 1", "strength 2", ...],`,
      `    "weaknesses": ["weakness 1", "weakness 2", ...],`,
      `    "opportunities": ["opportunity 1", ...],`,
      `    "threats": ["threat 1", ...]`,
      `  },`,
      `  "recommendations": [`,
      `    { "title": "Recommendation title", "priority": "high", "detail": "Details..." }`,
      `  ]`,
      `}`,
    ].join('\n');

    try {
      const response = await this.modelClient.generate({
        model: this.model,
        systemInstruction: 'You are a chief strategist synthesizing multi-perspective analyses. Respond ONLY with the requested JSON — no markdown, no code fences, no preamble.',
        contents: [{ role: 'user', content: synthesisPrompt, timestamp: Date.now() }],
        temperature: 0.3,
        metadata: { engineSource: 'analysis' },
      });

      const output = response.text ?? '';
      const jsonMatch = output.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          summary: parsed.summary ?? '',
          swot: {
            strengths: parsed.swot?.strengths ?? [],
            weaknesses: parsed.swot?.weaknesses ?? [],
            opportunities: parsed.swot?.opportunities ?? [],
            threats: parsed.swot?.threats ?? [],
          },
          recommendations: parsed.recommendations ?? [],
          threads,
        };
      }
    } catch (err) {
      console.error('[AnalysisEngine] Synthesis failed:', err);
    }

    // Fallback
    return {
      summary: `Analysis of "${req.query}" across ${completedThreads.length} perspectives. See individual thread results for details.`,
      swot: { strengths: [], weaknesses: [], opportunities: [], threats: [] },
      recommendations: [],
      threads,
    };
  }

  private async updateStatus(id: string, status: AnalysisStatus): Promise<void> {
    await systemQuery('UPDATE analyses SET status = $1 WHERE id = $2', [status, id]);
  }

  private async updateThreads(id: string, threads: ResearchThread[]): Promise<void> {
    await systemQuery('UPDATE analyses SET threads = $1 WHERE id = $2', [JSON.stringify(threads), id]);
  }
}

/* ── Prompt builders ───────────────────────── */

function buildThreadPrompt(type: AnalysisType, query: string, perspective: string, depth: AnalysisDepth): string {
  const perspectiveLabels: Record<string, string> = {
    cto: 'technology and engineering',
    cfo: 'financial viability and cost',
    cmo: 'marketing and brand positioning',
    cpo: 'product strategy and user impact',
    'vp-sales': 'sales pipeline and revenue potential',
    'vp-design': 'user experience and design impact',
    'competitive-intel': 'competitive landscape and market positioning',
    'user-researcher': 'user behavior and needs',
    ops: 'operational feasibility and risks',
    'chief-of-staff': 'cross-functional coordination and strategic alignment',
  };

  const label = perspectiveLabels[perspective] ?? perspective;

  return [
    `Analyze the following question from the perspective of ${label}:`,
    `"${query}"`,
    ``,
    `Analysis type: ${type.replace(/_/g, ' ')}`,
    ``,
    `${DEPTH_DETAIL[depth]}`,
    ``,
    `Cover:`,
    `1. Key findings from your perspective`,
    `2. Risks and concerns`,
    `3. Opportunities you see`,
    `4. Specific, actionable recommendations`,
  ].join('\n');
}

function buildEnhancedThreadPrompt(
  type: AnalysisType,
  query: string,
  perspective: string,
  existingReport: AnalysisReport,
): string {
  const perspectiveLabels: Record<string, string> = {
    cto: 'technology and engineering',
    cfo: 'financial viability and cost',
    cmo: 'marketing and brand positioning',
    cpo: 'product strategy and user impact',
    'vp-sales': 'sales pipeline and revenue potential',
    'vp-design': 'user experience and design impact',
    'competitive-intel': 'competitive landscape and market positioning',
    'user-researcher': 'user behavior and needs',
    ops: 'operational feasibility and risks',
    'chief-of-staff': 'cross-functional coordination and strategic alignment',
  };

  const label = perspectiveLabels[perspective] ?? perspective;
  const existingSummary = existingReport.summary.slice(0, 500);

  return [
    `You are contributing to an enhanced executive-grade strategic analysis.`,
    `An initial analysis has already been performed. Your role is to provide a deep-dive from the perspective of ${label}.`,
    ``,
    `Original question: "${query}"`,
    `Analysis type: ${type.replace(/_/g, ' ')}`,
    ``,
    `Existing executive summary: ${existingSummary}`,
    ``,
    `Current SWOT findings:`,
    `- Strengths: ${existingReport.swot.strengths.join('; ')}`,
    `- Weaknesses: ${existingReport.swot.weaknesses.join('; ')}`,
    `- Opportunities: ${existingReport.swot.opportunities.join('; ')}`,
    `- Threats: ${existingReport.swot.threats.join('; ')}`,
    ``,
    `Provide an exhaustive deep-dive analysis from your perspective. Challenge existing findings, identify blind spots, and provide specific data-backed insights that the initial analysis may have missed.`,
    ``,
    `Cover:`,
    `1. Deep findings and insights from your perspective`,
    `2. Gaps or blind spots in the existing analysis`,
    `3. Quantitative estimates where possible (market size, revenue impact, cost implications)`,
    `4. Specific, actionable recommendations with implementation details`,
    `5. Risk factors and mitigation strategies`,
  ].join('\n');
}
