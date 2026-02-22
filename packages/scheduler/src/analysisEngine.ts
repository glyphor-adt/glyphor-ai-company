/**
 * Strategic Analysis Engine
 *
 * 5-phase engine that orchestrates multi-agent strategic analyses:
 *   1. Plan     — Break the question into research threads
 *   2. Spawn    — Create temporary specialist agents
 *   3. Execute  — Run each agent on its thread
 *   4. Synthesize — Merge findings into a structured report
 *   5. Cleanup  — Retire temporary agents
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CompanyAgentRole, AgentExecutionResult } from '@glyphor/agent-runtime';
import { createTemporaryAgent, retireTemporaryAgent } from './agentLifecycle.js';

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
  | 'spawning'
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
  prompt: string;          // the research prompt for the spawned agent
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
  growth_diagnostic: ['cmo', 'vp-sales', 'vp-customer-success', 'cfo'],
  risk_assessment: ['cfo', 'cto', 'ops', 'chief-of-staff'],
};

const DEPTH_TURNS: Record<AnalysisDepth, number> = {
  quick: 4,
  standard: 8,
  deep: 12,
};

/* ── Engine ─────────────────────────────────── */

export class AnalysisEngine {
  constructor(
    private supabase: SupabaseClient,
    private agentExecutor: (
      role: CompanyAgentRole,
      task: string,
      payload: Record<string, unknown>,
    ) => Promise<AgentExecutionResult | void>,
  ) {}

  /**
   * Launch an analysis. Creates the DB record and drives all 5 phases.
   * Returns the analysis ID immediately so the dashboard can poll for status.
   */
  async launch(req: AnalysisRequest): Promise<string> {
    const id = `analysis-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const perspectives = ANALYSIS_PERSPECTIVES[req.type];

    // Build research threads
    const threads: ResearchThread[] = perspectives.map((perspective, i) => ({
      id: `${id}-thread-${i}`,
      label: `${perspective} perspective`,
      perspective,
      prompt: buildThreadPrompt(req.type, req.query, perspective),
      status: 'pending' as const,
    }));

    // Phase 1: Plan — persist the analysis record
    const record: Omit<AnalysisRecord, 'id'> & { id: string } = {
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

    await this.supabase.from('analyses').insert(record);

    // Run remaining phases async (don't block the HTTP response)
    this.runPhases(id, req, threads).catch((err) => {
      console.error(`[AnalysisEngine] Fatal error in analysis ${id}:`, err);
      this.supabase.from('analyses').update({
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      }).eq('id', id);
    });

    return id;
  }

  /**
   * Get the current state of an analysis.
   */
  async get(id: string): Promise<AnalysisRecord | null> {
    const { data } = await this.supabase
      .from('analyses')
      .select('*')
      .eq('id', id)
      .single();
    return data as AnalysisRecord | null;
  }

  /**
   * List recent analyses.
   */
  async list(limit = 20): Promise<AnalysisRecord[]> {
    const { data } = await this.supabase
      .from('analyses')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    return (data as AnalysisRecord[]) ?? [];
  }

  /* ── Internal phase runner ──────────────── */

  private async runPhases(
    id: string,
    req: AnalysisRequest,
    threads: ResearchThread[],
  ): Promise<void> {
    const maxTurns = DEPTH_TURNS[req.depth];

    // Phase 2: Spawn temporary agents
    await this.updateStatus(id, 'spawning');
    const spawnedAgentIds: string[] = [];

    for (const thread of threads) {
      try {
        const agent = await createTemporaryAgent(this.supabase, {
          name: `${thread.perspective}-analyst-${id.slice(-6)}`,
          role: `${thread.perspective}-analyst-${id.slice(-6)}`,
          department: 'Analysis',
          reportsTo: 'chief-of-staff',
          systemPrompt: thread.prompt,
          maxTurns,
          ttlDays: 1,
          spawnedBy: id,
          spawnedFor: `Analysis: ${req.type} — ${thread.label}`,
        });
        spawnedAgentIds.push(agent.id);
      } catch (err) {
        console.error(`[AnalysisEngine] Failed to spawn agent for thread ${thread.id}:`, err);
        thread.status = 'failed';
      }
    }

    await this.updateThreads(id, threads);

    // Phase 3: Execute — run each thread's agent
    await this.updateStatus(id, 'executing');

    for (let i = 0; i < threads.length; i++) {
      const thread = threads[i];
      if (thread.status === 'failed') continue;

      thread.status = 'running';
      await this.updateThreads(id, threads);

      try {
        const result = await this.agentExecutor(
          thread.perspective as CompanyAgentRole,
          'on_demand',
          { message: thread.prompt },
        );
        thread.result = (result as AgentExecutionResult)?.output ?? 'No output';
        thread.status = 'completed';
      } catch (err) {
        thread.result = `Error: ${err instanceof Error ? err.message : String(err)}`;
        thread.status = 'failed';
      }

      await this.updateThreads(id, threads);
    }

    // Phase 4: Synthesize — merge thread results into report
    await this.updateStatus(id, 'synthesizing');

    const report = await this.synthesize(req, threads);
    await this.supabase.from('analyses').update({
      status: 'completed',
      report,
      threads,
      completed_at: new Date().toISOString(),
    }).eq('id', id);

    // Phase 5: Cleanup — retire spawned agents
    for (const agentId of spawnedAgentIds) {
      await retireTemporaryAgent(this.supabase, agentId, 'Analysis complete').catch(() => {});
    }

    // Log completion
    await this.supabase.from('activity_log').insert({
      agent_id: 'system',
      action: 'analysis.completed',
      detail: `Analysis "${req.type}" completed: ${req.query.slice(0, 100)}`,
      created_at: new Date().toISOString(),
    });
  }

  private async synthesize(
    req: AnalysisRequest,
    threads: ResearchThread[],
  ): Promise<AnalysisReport> {
    const completedThreads = threads.filter((t) => t.status === 'completed' && t.result);

    // Build synthesis prompt and run through chief-of-staff
    const synthesisPrompt = [
      `Synthesize these research findings into a structured strategic analysis.`,
      `Analysis type: ${req.type}`,
      `Original question: ${req.query}`,
      '',
      ...completedThreads.map((t) =>
        `=== ${t.perspective.toUpperCase()} PERSPECTIVE ===\n${t.result}\n`
      ),
      '',
      `Respond with valid JSON matching this schema:`,
      `{`,
      `  "summary": "Executive summary (2-3 paragraphs)",`,
      `  "swot": { "strengths": [...], "weaknesses": [...], "opportunities": [...], "threats": [...] },`,
      `  "recommendations": [{ "title": "...", "priority": "high|medium|low", "detail": "..." }]`,
      `}`,
    ].join('\n');

    try {
      const result = await this.agentExecutor(
        'chief-of-staff',
        'on_demand',
        { message: synthesisPrompt },
      );

      const output = (result as AgentExecutionResult)?.output ?? '';
      // Try to parse JSON from the output
      const jsonMatch = output.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return { ...parsed, threads };
      }
    } catch (err) {
      console.error('[AnalysisEngine] Synthesis failed:', err);
    }

    // Fallback: build report from raw thread data
    return {
      summary: `Analysis of "${req.query}" across ${completedThreads.length} perspectives.`,
      swot: { strengths: [], weaknesses: [], opportunities: [], threats: [] },
      recommendations: [],
      threads,
    };
  }

  private async updateStatus(id: string, status: AnalysisStatus): Promise<void> {
    await this.supabase.from('analyses').update({ status }).eq('id', id);
  }

  private async updateThreads(id: string, threads: ResearchThread[]): Promise<void> {
    await this.supabase.from('analyses').update({ threads }).eq('id', id);
  }
}

/* ── Prompt builders ───────────────────────── */

function buildThreadPrompt(type: AnalysisType, query: string, perspective: string): string {
  const perspectiveLabels: Record<string, string> = {
    cto: 'technology and engineering',
    cfo: 'financial viability and cost',
    cmo: 'marketing and brand positioning',
    cpo: 'product strategy and user impact',
    'vp-sales': 'sales pipeline and revenue potential',
    'vp-customer-success': 'customer retention and satisfaction',
    'vp-design': 'user experience and design impact',
    'competitive-intel': 'competitive landscape and market positioning',
    'user-researcher': 'user behavior and needs',
    ops: 'operational feasibility and risks',
    'chief-of-staff': 'cross-functional coordination and strategic alignment',
  };

  const label = perspectiveLabels[perspective] ?? perspective;

  return [
    `You are a strategic analyst specializing in ${label}.`,
    ``,
    `Analyze the following question from your area of expertise:`,
    `"${query}"`,
    ``,
    `Analysis type: ${type.replace(/_/g, ' ')}`,
    ``,
    `Provide a thorough analysis covering:`,
    `1. Key findings from your perspective`,
    `2. Risks and concerns`,
    `3. Opportunities`,
    `4. Specific, actionable recommendations`,
    ``,
    `Be data-driven where possible. Reference company context.`,
  ].join('\n');
}
