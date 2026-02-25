/**
 * Strategy Lab v2 Engine — Multi-Wave Strategic Analysis Pipeline
 *
 * A three-layer architecture for producing consultant-grade strategic analyses:
 *
 *   WAVE 1: RESEARCH  — 4 research analysts gather data in parallel (web searches)
 *   WAVE 2: ANALYSIS  — Executives receive research and apply strategic frameworks
 *   WAVE 3: SYNTHESIS — Sarah synthesizes all executive analyses into a unified deliverable
 *
 * Depth tiers:
 *   quick:         Sarah alone, ~5 searches, 2-3 min
 *   standard:      2 researchers + 2 executives + Sarah, ~20 searches, 8-12 min
 *   deep:          4 researchers + 4 executives + Sarah, ~40-60 searches, 15-25 min
 *   comprehensive: deep + follow-up pass, ~80-120 searches, 30-45 min
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ModelClient } from '@glyphor/agent-runtime';
import type { AgentExecutionResult, CompanyAgentRole } from '@glyphor/agent-runtime';

/* ── Types ──────────────────────────────────── */

export type StrategyAnalysisStatus =
  | 'planning'
  | 'framing'
  | 'decomposing'
  | 'researching'
  | 'quality-check'
  | 'analyzing'
  | 'synthesizing'
  | 'deepening'
  | 'completed'
  | 'failed';

export type StrategyAnalysisDepth = 'quick' | 'standard' | 'deep' | 'comprehensive';

export type StrategyAnalysisType =
  | 'competitive_landscape'
  | 'market_opportunity'
  | 'product_strategy'
  | 'growth_diagnostic'
  | 'risk_assessment'
  | 'market_entry'
  | 'due_diligence';

export interface StrategyAnalysisRequest {
  query: string;
  analysisType?: StrategyAnalysisType;
  depth?: StrategyAnalysisDepth;
  requestedBy: string;
}

export interface ResearchBrief {
  analystRole: string;
  analystName: string;
  researchBrief: string;
  suggestedSearches: string[];
  expectedOutput: string;
  targetExecutives: string[];
}

export interface ExecutiveRouting {
  [execRole: string]: string[]; // exec role → array of research packet types they receive
}

export interface ResearchProgress {
  analystRole: string;
  analystName: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: string;
  completedAt?: string;
  searchCount?: number;
  sourceCount?: number;
  error?: string;
}

export interface ExecutiveProgress {
  execRole: string;
  execName: string;
  framework: string;
  status: 'waiting' | 'running' | 'completed' | 'failed';
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface StrategySource {
  url: string;
  title: string;
  relevance: 'primary' | 'supporting' | 'background';
  analystRole?: string;
}

export interface ExecutiveAnalysisOutput {
  execRole: string;
  execName: string;
  framework: string;
  analysis: Record<string, unknown>;
  duration?: number;
}

export interface SynthesisOutput {
  executiveSummary: string;
  unifiedSwot: {
    strengths: string[];
    weaknesses: string[];
    opportunities: string[];
    threats: string[];
  };
  crossFrameworkInsights: string[];
  strategicRecommendations: {
    title: string;
    description: string;
    impact: 'high' | 'medium' | 'low';
    feasibility: 'high' | 'medium' | 'low';
    owner: string;
    expectedOutcome: string;
    riskIfNot: string;
  }[];
  keyRisks: string[];
  openQuestionsForFounders: string[];
  sourceIndex: StrategySource[];
}

export interface StrategyAnalysisRecord {
  id: string;
  query: string;
  analysis_type: StrategyAnalysisType;
  depth: StrategyAnalysisDepth;
  status: StrategyAnalysisStatus;
  requested_by: string;
  research_briefs: ResearchBrief[];
  executive_routing: ExecutiveRouting;
  research_packets: Record<string, unknown>;
  research_progress: ResearchProgress[];
  executive_outputs: Record<string, ExecutiveAnalysisOutput>;
  executive_progress: ExecutiveProgress[];
  synthesis: SynthesisOutput | null;
  total_searches: number;
  total_sources: number;
  sources: StrategySource[];
  created_at: string;
  research_started_at: string | null;
  analysis_started_at: string | null;
  synthesis_started_at: string | null;
  completed_at: string | null;
  error: string | null;
  // Sophia Lin (VP Research) fields
  sarah_frame: Record<string, unknown> | null;
  sophia_decomposition: Record<string, unknown> | null;
  sophia_qc: Record<string, unknown> | null;
  cover_memos: Record<string, unknown> | null;
  qc_started_at: string | null;
  qc_completed_at: string | null;
  gaps_filled: string[];
  remaining_gaps: string[];
  overall_confidence: string | null;
}

/* ── Constants ──────────────────────────────── */

const RESEARCH_ANALYST_ROLES: Record<string, { name: string; packetType: string }> = {
  'competitive-research-analyst': { name: 'Lena Park', packetType: 'competitor_profiles' },
  'market-research-analyst': { name: 'Daniel Okafor', packetType: 'market_data' },
  'technical-research-analyst': { name: 'Kai Nakamura', packetType: 'technical_landscape' },
  'industry-research-analyst': { name: 'Amara Diallo', packetType: 'industry_trends' },
};

/** Normalise analyst role strings from LLM output to canonical role IDs */
function normalizeAnalystRole(raw: string): string {
  if (!raw) return '';
  const key = raw.toLowerCase().replace(/[_\s]+/g, '-').trim();
  if (RESEARCH_ANALYST_ROLES[key]) return key;
  // Match by keyword prefix
  if (/^compet/.test(key)) return 'competitive-research-analyst';
  if (/^market/.test(key)) return 'market-research-analyst';
  if (/^tech/.test(key)) return 'technical-research-analyst';
  if (/^industr/.test(key)) return 'industry-research-analyst';
  // Match by analyst name
  const lower = raw.toLowerCase();
  if (lower.includes('lena')) return 'competitive-research-analyst';
  if (lower.includes('daniel')) return 'market-research-analyst';
  if (lower.includes('kai')) return 'technical-research-analyst';
  if (lower.includes('amara')) return 'industry-research-analyst';
  return '';
}

const EXEC_FRAMEWORKS: Record<string, { name: string; framework: string }> = {
  'cpo': { name: 'Elena Vasquez', framework: 'Ansoff Matrix + Product Strategy' },
  'cfo': { name: 'Nadia Al-Rashid', framework: 'BCG Matrix + Financial Analysis' },
  'cmo': { name: 'Maya Brooks', framework: 'Blue Ocean Strategy + Positioning' },
  'cto': { name: 'Marcus Reeves', framework: "Porter's Five Forces + Technical Strategy" },
};

/** Default routing: which exec gets which research packets */
const DEFAULT_ROUTING: ExecutiveRouting = {
  'cpo': ['competitor_profiles', 'technical_landscape'],
  'cfo': ['market_data', 'competitor_profiles'],
  'cmo': ['competitor_profiles', 'market_data', 'industry_trends'],
  'cto': ['technical_landscape', 'competitor_profiles'],
};

/** Analysis type → which analysts and executives to use */
const ANALYSIS_CONFIGS: Record<StrategyAnalysisType, { analysts: string[]; executives: string[] }> = {
  competitive_landscape: {
    analysts: ['competitive-research-analyst', 'market-research-analyst', 'technical-research-analyst', 'industry-research-analyst'],
    executives: ['cpo', 'cfo', 'cmo', 'cto'],
  },
  market_opportunity: {
    analysts: ['market-research-analyst', 'industry-research-analyst', 'competitive-research-analyst'],
    executives: ['cmo', 'cfo', 'cpo'],
  },
  product_strategy: {
    analysts: ['competitive-research-analyst', 'technical-research-analyst', 'market-research-analyst'],
    executives: ['cpo', 'cto', 'cmo'],
  },
  growth_diagnostic: {
    analysts: ['market-research-analyst', 'competitive-research-analyst', 'industry-research-analyst'],
    executives: ['cmo', 'cfo', 'cpo'],
  },
  risk_assessment: {
    analysts: ['industry-research-analyst', 'competitive-research-analyst', 'technical-research-analyst'],
    executives: ['cto', 'cfo', 'cpo'],
  },
  market_entry: {
    analysts: ['market-research-analyst', 'competitive-research-analyst', 'industry-research-analyst', 'technical-research-analyst'],
    executives: ['cmo', 'cfo', 'cpo', 'cto'],
  },
  due_diligence: {
    analysts: ['competitive-research-analyst', 'market-research-analyst', 'technical-research-analyst', 'industry-research-analyst'],
    executives: ['cfo', 'cpo', 'cto', 'cmo'],
  },
};

/** Depth → how many analysts/execs to use, tool limits */
function getDepthConfig(depth: StrategyAnalysisDepth) {
  switch (depth) {
    case 'quick': return { maxAnalysts: 0, maxExecs: 0, maxToolCalls: 5, quickMode: true };
    case 'standard': return { maxAnalysts: 2, maxExecs: 2, maxToolCalls: 10, quickMode: false };
    case 'deep': return { maxAnalysts: 4, maxExecs: 4, maxToolCalls: 15, quickMode: false };
    case 'comprehensive': return { maxAnalysts: 4, maxExecs: 4, maxToolCalls: 20, quickMode: false };
  }
}

/* ── Executive Analysis Prompts ─────────────── */

function buildExecutivePrompt(execRole: string, query: string, packets: Record<string, unknown>, coverMemo?: string): string {
  const packetsJSON = JSON.stringify(packets, null, 2);
  const memoSection = coverMemo
    ? `\n\nCOVER MEMO FROM VP RESEARCH (Sophia Lin):\n${coverMemo}\n`
    : '';

  switch (execRole) {
    case 'cpo':
      return `You are Elena Vasquez, Chief Product Officer at Glyphor.

You are reviewing compiled competitive research to provide product strategy analysis.
You are NOT doing research — your research team has already done that. Your job is to THINK.
${memoSection}
RESEARCH PACKETS PROVIDED:
${packetsJSON}

ORIGINAL QUERY: "${query}"

YOUR ANALYSIS TASKS:

1. FEATURE GAP ANALYSIS
   Compare capabilities against each competitor. Where do we lead? Where do we lag? What's table stakes we're missing?

2. PRODUCT POSITIONING ASSESSMENT
   Based on the competitive landscape, where should we sit? What's our unique angle that no competitor owns?

3. COMPETITIVE MOAT EVALUATION
   Which capabilities are hard to replicate? Which competitors could close the gap fastest?

4. ANSOFF MATRIX APPLICATION
   - Market Penetration: how do we win in our current segment?
   - Market Development: what adjacent segments could we serve?
   - Product Development: what new capabilities would strengthen position?
   - Diversification: any opportunities outside current scope?

5. ROADMAP IMPLICATIONS
   Based on this analysis, what should we build next? What should we explicitly NOT build?

Be opinionated. You're the CPO — make product calls. Return your analysis as structured JSON with keys: featureGapAnalysis, positioningAssessment, moatEvaluation, ansoffMatrix, roadmapImplications, keyInsights.`;

    case 'cfo':
      return `You are Nadia Al-Rashid, Chief Financial Officer at Glyphor.

You are reviewing compiled market research to provide financial analysis.
You are NOT doing research — your research team has already done that. Your job is to MODEL and ASSESS.
${memoSection}
RESEARCH PACKETS PROVIDED:
${packetsJSON}

ORIGINAL QUERY: "${query}"

YOUR ANALYSIS TASKS:

1. MARKET SIZING VALIDATION
   Review TAM/SAM/SOM estimates. Do they pass the smell test? Cross-check against competitor revenue data.

2. PRICING STRATEGY
   Where should we price relative to competitors? What pricing model best fits our positioning?

3. UNIT ECONOMICS COMPARISON
   How do competitor economics compare? Where are the margin advantages?

4. BCG MATRIX
   Position products in the matrix. Where are the Stars, Cash Cows, Question Marks, Dogs?

5. REVENUE OPPORTUNITY
   Year 1 realistic revenue estimate. Path to $1M ARR — what does that require?

Show your math. Cite your assumptions. Return your analysis as structured JSON with keys: marketSizingValidation, pricingStrategy, unitEconomics, bcgMatrix, revenueOpportunity, keyInsights.`;

    case 'cmo':
      return `You are Maya Brooks, Chief Marketing Officer at Glyphor.

You are reviewing compiled competitive and market research for positioning and GTM analysis.
${memoSection}
RESEARCH PACKETS PROVIDED:
${packetsJSON}

ORIGINAL QUERY: "${query}"

YOUR ANALYSIS TASKS:

1. POSITIONING MAP
   Create a 2x2 positioning map. Define the two axes that best capture the competitive landscape.

2. BLUE OCEAN ANALYSIS
   What factors does the industry compete on? Which can we eliminate/reduce? Which raise/create?

3. GO-TO-MARKET COMPARISON
   How do competitors acquire customers? What channels work? Where is our GTM advantage?

4. MESSAGING DIFFERENTIATION
   What's the one-line positioning that no competitor can claim?

5. TARGET SEGMENT PRIORITIZATION
   Based on competitor gaps and market data, which customer segment should we target first?

Be creative but data-backed. Return your analysis as structured JSON with keys: positioningMap, blueOceanAnalysis, gtmComparison, messagingDifferentiation, segmentPrioritization, keyInsights.`;

    case 'cto':
      return `You are Marcus Reeves, Chief Technology Officer at Glyphor.

You are reviewing compiled technical research for technology strategy analysis.
${memoSection}
RESEARCH PACKETS PROVIDED:
${packetsJSON}

ORIGINAL QUERY: "${query}"

YOUR ANALYSIS TASKS:

1. TECHNICAL MOAT ASSESSMENT
   Which technical capabilities are genuinely defensible? Rate each: strong/moderate/weak.

2. PORTER'S FIVE FORCES (tech lens)
   - Threat of new entrants: how hard is it to build this?
   - Supplier power: AI model provider lock-in risk?
   - Buyer power: switching costs for customers?
   - Substitutes: what non-AI alternatives exist?
   - Rivalry: intensity of technical competition?

3. BUILD vs. PARTNER ANALYSIS
   Where should we build proprietary tech? Where integrate existing solutions?

4. TECHNICAL RISK ASSESSMENT
   What technical threats could erode our position? Model commoditization risk?

5. ARCHITECTURE ADVANTAGE
   What does our architecture enable that competitors can't match?

Be specific about technical details. Return your analysis as structured JSON with keys: technicalMoatAssessment, portersFiveForces, buildVsPartner, technicalRisks, architectureAdvantage, keyInsights.`;

    default:
      return `Analyze the following research packets for the query "${query}" and provide strategic insights.\n\n${packetsJSON}`;
  }
}

function buildSynthesisPrompt(
  query: string,
  executiveOutputs: Record<string, ExecutiveAnalysisOutput>,
  researchPackets: Record<string, unknown>,
  sources: StrategySource[],
  overallConfidence?: string,
  remainingGaps?: string[],
  sarahFrame?: Record<string, unknown>,
): string {
  const execAnalyses = Object.entries(executiveOutputs)
    .map(([role, output]) => `=== ${output.execName} (${output.framework}) ===\n${JSON.stringify(output.analysis, null, 2)}`)
    .join('\n\n');

  const sophiaSection = overallConfidence
    ? `\n\nSOPHIA'S QC ASSESSMENT:\n- Overall Confidence: ${overallConfidence}\n- Remaining Gaps: ${(remainingGaps || []).join(', ') || 'none'}\n`
    : '';

  const frameSection = sarahFrame && Object.keys(sarahFrame).length > 0
    ? `\n\nYOUR EARLIER FRAMING:\n${JSON.stringify(sarahFrame, null, 2)}\n`
    : '';

  return `You are Sarah Chen, Chief of Staff at Glyphor.

Your team has completed a strategic analysis. You now have:
${frameSection}${sophiaSection}
EXECUTIVE ANALYSES:
${execAnalyses}

TOTAL SOURCES: ${sources.length} sources across ${Object.keys(researchPackets).length} research areas

ORIGINAL QUERY: "${query}"

PRODUCE THE FINAL STRATEGIC ANALYSIS as a JSON object:

{
  "executiveSummary": "3-4 sentences. The 'so what' a CEO reads in 30 seconds.",
  "unifiedSwot": {
    "strengths": ["..."],
    "weaknesses": ["..."],
    "opportunities": ["..."],
    "threats": ["..."]
  },
  "crossFrameworkInsights": ["Where frameworks agree/disagree, what emerges from looking across all together"],
  "strategicRecommendations": [
    {
      "title": "...",
      "description": "...",
      "impact": "high|medium|low",
      "feasibility": "high|medium|low",
      "owner": "role or department",
      "expectedOutcome": "...",
      "riskIfNot": "what happens if we don't do this"
    }
  ],
  "keyRisks": ["What could invalidate this analysis? What assumptions?"],
  "openQuestionsForFounders": ["Decisions only Kristina and Andrew can make"]
}

Respond ONLY with valid JSON — no markdown fences, no commentary.
Synthesize, don't concatenate. Find the insights that emerge when you look across ALL executive analyses together.
Rank recommendations by impact × feasibility.`;
}

function buildQuickAnalysisPrompt(query: string): string {
  return `You are Sarah Chen, Chief of Staff at Glyphor.

A founder has requested a quick strategic analysis:
Query: "${query}"

This is a QUICK analysis — you have limited research capability. Do your own web searches (up to 5) and provide a concise analysis covering:

1. Top 3-5 competitors or relevant players
2. Key market dynamics
3. Quick SWOT assessment
4. 2-3 strategic recommendations
5. What would need deeper research

Be direct and practical. This is a 2-minute briefing, not a board presentation.

After researching, submit your findings using submit_research_packet with packet_type "competitor_profiles" and analysis_id from the brief.`;
}

/* ── Engine ─────────────────────────────────── */

export class StrategyLabEngine {
  constructor(
    private supabase: SupabaseClient,
    private modelClient: ModelClient,
    private agentExecutor: (role: CompanyAgentRole, task: string, payload: Record<string, unknown>) => Promise<AgentExecutionResult | void>,
    private model = 'gemini-3-flash-preview',
  ) {}

  /** Launch a strategy analysis. Returns the record ID. */
  async launch(req: StrategyAnalysisRequest): Promise<string> {
    const id = `strategy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const depth = req.depth || 'standard';
    const analysisType = req.analysisType || 'competitive_landscape';

    const record: Partial<StrategyAnalysisRecord> = {
      id,
      query: req.query,
      analysis_type: analysisType,
      depth,
      status: 'planning',
      requested_by: req.requestedBy,
      research_briefs: [],
      executive_routing: {},
      research_packets: {},
      research_progress: [],
      executive_outputs: {},
      executive_progress: [],
      synthesis: null,
      total_searches: 0,
      total_sources: 0,
      sources: [],
      sarah_frame: null,
      sophia_decomposition: null,
      sophia_qc: null,
      cover_memos: null,
      gaps_filled: [],
      remaining_gaps: [],
      overall_confidence: null,
      created_at: new Date().toISOString(),
    };

    await this.supabase.from('strategy_analyses').insert(record);

    // Run phases async
    this.runPipeline(id, req, depth, analysisType).catch((err) => {
      console.error(`[StrategyLab] Fatal error in ${id}:`, err);
      this.supabase.from('strategy_analyses').update({
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      }).eq('id', id);
    });

    return id;
  }

  async get(id: string): Promise<StrategyAnalysisRecord | null> {
    const { data } = await this.supabase
      .from('strategy_analyses')
      .select('*')
      .eq('id', id)
      .single();
    return data as StrategyAnalysisRecord | null;
  }

  async list(limit = 20): Promise<StrategyAnalysisRecord[]> {
    const { data } = await this.supabase
      .from('strategy_analyses')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    return (data as StrategyAnalysisRecord[]) ?? [];
  }

  async cancel(id: string): Promise<void> {
    await this.supabase.from('strategy_analyses').update({
      status: 'failed',
      error: 'Cancelled by user.',
    }).eq('id', id);
  }

  /* ── Pipeline Runner ────────────────────── */

  private async runPipeline(
    id: string,
    req: StrategyAnalysisRequest,
    depth: StrategyAnalysisDepth,
    analysisType: StrategyAnalysisType,
  ): Promise<void> {
    const depthCfg = getDepthConfig(depth);
    const analysisCfg = ANALYSIS_CONFIGS[analysisType];

    // ═══════════════════════════════════════════
    // QUICK MODE: Sarah does it all
    // ═══════════════════════════════════════════
    if (depthCfg.quickMode) {
      await this.runQuickAnalysis(id, req);
      return;
    }

    // ═══════════════════════════════════════════
    // PHASE 0: Sarah frames the request
    // ═══════════════════════════════════════════
    await this.updateStatus(id, 'framing');

    const sarahFrameResult = await this.agentExecutor('chief-of-staff' as CompanyAgentRole, 'on_demand', {
      message: `A founder has requested a strategic analysis. Frame this request with strategic context.

Query: "${req.query}"
Analysis Type: "${analysisType}"
Depth: "${depth}"

YOUR ROLE:
1. Determine the right analysis type and depth
2. Add strategic context from your knowledge of the company (what are the founders trying to decide? what's the subtext?)
3. Identify specific angles or priorities the founders care about
4. Note any internal context that should inform the research

YOU DO NOT decompose queries into research briefs (Sophia does this) or assign individual analysts (Sophia manages her team).

Return a JSON object with keys: strategicContext (string), founderPriorities (string[]), specificAngles (string[]), analysisNotes (string).
Return ONLY valid JSON — no markdown fences.`,
    });

    let sarahFrame: Record<string, unknown> = {};
    if (sarahFrameResult?.output) {
      const jsonMatch = sarahFrameResult.output.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try { sarahFrame = JSON.parse(jsonMatch[0]); } catch { sarahFrame = { strategicContext: sarahFrameResult.output }; }
      } else {
        sarahFrame = { strategicContext: sarahFrameResult.output };
      }
    }

    await this.supabase.from('strategy_analyses').update({ sarah_frame: sarahFrame }).eq('id', id);

    // ═══════════════════════════════════════════
    // PHASE 1: Sophia decomposes the research
    // ═══════════════════════════════════════════
    await this.updateStatus(id, 'decomposing');

    const sarahNotes = typeof sarahFrame.strategicContext === 'string'
      ? sarahFrame.strategicContext
      : JSON.stringify(sarahFrame);

    const sophiaDecompResult = await this.agentExecutor('vp-research' as CompanyAgentRole, 'decompose_research', {
      query: req.query,
      analysisType,
      depth,
      sarahNotes,
    });

    // Parse Sophia's decomposition to get briefs and routing
    let sophiaBriefs: ResearchBrief[] = [];
    let sophiaRouting: ExecutiveRouting = {};
    let sophiaDecomp: Record<string, unknown> = {};

    if (sophiaDecompResult?.output) {
      const jsonMatch = sophiaDecompResult.output.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          sophiaDecomp = parsed;

          // Extract briefs from Sophia's structured output
          if (Array.isArray(parsed.briefs)) {
            sophiaBriefs = parsed.briefs
              .map((b: Record<string, unknown>) => {
                const role = normalizeAnalystRole(
                  (b.analystRole ?? b.analyst_role ?? b.role ?? b.analyst ?? '') as string,
                );
                if (!role) return null;
                return {
                  analystRole: role,
                  analystName: RESEARCH_ANALYST_ROLES[role]?.name || b.analystName as string || '',
                  researchBrief: b.researchBrief as string || b.brief as string || '',
                  suggestedSearches: (b.suggestedSearches as string[] || b.searchQueries as string[] || []),
                  expectedOutput: RESEARCH_ANALYST_ROLES[role]?.packetType || b.expectedOutput as string || '',
                  targetExecutives: b.targetExecutives as string[] || [],
                };
              })
              .filter(Boolean) as ResearchBrief[];
          }

          // Extract routing
          if (parsed.executiveRouting && typeof parsed.executiveRouting === 'object') {
            sophiaRouting = parsed.executiveRouting as ExecutiveRouting;
          }
        } catch { /* fall through to default briefs */ }
      }
    }

    // Fallback: if Sophia's decomposition didn't produce valid briefs, use defaults
    const selectedAnalysts = analysisCfg.analysts.slice(0, depthCfg.maxAnalysts);
    const selectedExecs = analysisCfg.executives.slice(0, depthCfg.maxExecs);

    if (sophiaBriefs.length === 0) {
      sophiaBriefs = this.buildResearchBriefs(req.query, analysisType, selectedAnalysts);
    }
    if (Object.keys(sophiaRouting).length === 0) {
      sophiaRouting = this.buildRouting(selectedExecs);
    }

    const researchProgress: ResearchProgress[] = sophiaBriefs.map((brief) => ({
      analystRole: brief.analystRole,
      analystName: brief.analystName || RESEARCH_ANALYST_ROLES[brief.analystRole]?.name || brief.analystRole,
      status: 'pending' as const,
    }));

    // Determine which execs are actually being used from routing
    const activeExecs = Object.keys(sophiaRouting).length > 0
      ? Object.keys(sophiaRouting)
      : selectedExecs;

    const executiveProgress: ExecutiveProgress[] = activeExecs.map((role) => ({
      execRole: role,
      execName: EXEC_FRAMEWORKS[role]?.name || role,
      framework: EXEC_FRAMEWORKS[role]?.framework || 'Strategic Analysis',
      status: 'waiting' as const,
    }));

    await this.supabase.from('strategy_analyses').update({
      research_briefs: sophiaBriefs,
      executive_routing: sophiaRouting,
      research_progress: researchProgress,
      executive_progress: executiveProgress,
      sophia_decomposition: sophiaDecomp,
    }).eq('id', id);

    // ═══════════════════════════════════════════
    // WAVE 1: Research team (parallel)
    // ═══════════════════════════════════════════
    await this.updateStatus(id, 'researching', { research_started_at: new Date().toISOString() });

    const researchResults = await Promise.allSettled(
      sophiaBriefs.map(async (brief, i) => {
        // Mark this analyst as running
        researchProgress[i].status = 'running';
        researchProgress[i].startedAt = new Date().toISOString();
        await this.supabase.from('strategy_analyses').update({ research_progress: researchProgress }).eq('id', id);

        const result = await this.agentExecutor(
          brief.analystRole as CompanyAgentRole,
          'research',
          {
            analysisId: id,
            researchBrief: brief.researchBrief,
            searchQueries: brief.suggestedSearches,
            maxToolCalls: depthCfg.maxToolCalls,
          },
        );

        // Mark completed
        researchProgress[i].status = 'completed';
        researchProgress[i].completedAt = new Date().toISOString();
        if (result?.conversationHistory) {
          researchProgress[i].searchCount = result.conversationHistory
            .filter((t) => t.role === 'tool_call' && (t.toolName === 'web_search' || t.toolName === 'search_news'))
            .length;
          researchProgress[i].sourceCount = result.conversationHistory
            .filter((t) => t.role === 'tool_call' && t.toolName === 'web_fetch')
            .length;
        }
        await this.supabase.from('strategy_analyses').update({ research_progress: researchProgress }).eq('id', id);

        return result;
      }),
    );

    // Check for failed research
    researchResults.forEach((r, i) => {
      if (r.status === 'rejected') {
        researchProgress[i].status = 'failed';
        researchProgress[i].error = r.reason?.message ?? String(r.reason);
      }
    });
    await this.supabase.from('strategy_analyses').update({ research_progress: researchProgress }).eq('id', id);

    // Load research packets submitted by analysts
    const { data: currentRecord } = await this.supabase
      .from('strategy_analyses')
      .select('research_packets')
      .eq('id', id)
      .single();
    let researchPackets = (currentRecord?.research_packets as Record<string, unknown>) || {};

    // ── Fallback: extract packets from analyst text output ──
    // If analysts completed but didn't call submit_research_packet, their findings
    // are trapped in text output. Extract and submit them as fallback packets.
    if (Object.keys(researchPackets).length === 0) {
      const ROLE_TO_PACKET_TYPE: Record<string, string> = {
        'competitive-research-analyst': 'competitor_profiles',
        'market-research-analyst': 'market_data',
        'technical-research-analyst': 'technical_landscape',
        'industry-research-analyst': 'industry_trends',
      };

      let fallbackCount = 0;
      for (let i = 0; i < researchResults.length; i++) {
        const r = researchResults[i];
        if (r.status !== 'fulfilled' || !r.value?.output) continue;

        const role = sophiaBriefs[i]?.analystRole as string;
        const packetType = ROLE_TO_PACKET_TYPE[role];
        if (!packetType) continue;

        const fallbackPacket = {
          data: { rawFindings: r.value.output },
          sources: [],
          confidenceLevel: 'low',
          dataGaps: ['Packet auto-extracted from text output — structured data may be missing'],
          conflictingData: [],
          submittedAt: new Date().toISOString(),
          fallback: true,
        };

        try {
          await this.supabase.rpc('merge_research_packet', {
            p_analysis_id: id,
            p_packet_type: packetType,
            p_packet_data: fallbackPacket,
          });
          fallbackCount++;
        } catch { /* best-effort */ }
      }

      if (fallbackCount > 0) {
        // Re-read packets after fallback insertion
        const { data: fallbackRecord } = await this.supabase
          .from('strategy_analyses')
          .select('research_packets')
          .eq('id', id)
          .single();
        researchPackets = (fallbackRecord?.research_packets as Record<string, unknown>) || {};
      }
    }

    if (Object.keys(researchPackets).length === 0) {
      await this.supabase.from('strategy_analyses').update({
        status: 'failed',
        error: 'No research packets were submitted. All research analysts may have failed.',
      }).eq('id', id);
      return;
    }

    // ═══════════════════════════════════════════
    // WAVE 1.5: Sophia QC's and packages
    // ═══════════════════════════════════════════
    await this.updateStatus(id, 'quality-check', { qc_started_at: new Date().toISOString() });

    const sophiaQCResult = await this.agentExecutor('vp-research' as CompanyAgentRole, 'qc_and_package_research', {
      analysisId: id,
      query: req.query,
      rawPackets: researchPackets,
      executiveRouting: sophiaRouting,
    });

    let sophiaQC: Record<string, unknown> = {};
    let coverMemos: Record<string, unknown> = {};
    let gapsFilled: string[] = [];
    let remainingGaps: string[] = [];
    let overallConfidence = 'medium';

    if (sophiaQCResult?.output) {
      const jsonMatch = sophiaQCResult.output.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          sophiaQC = parsed;
          coverMemos = parsed.coverMemos || {};
          gapsFilled = parsed.gapsFilled || [];
          remainingGaps = parsed.remainingGaps || [];
          overallConfidence = parsed.overallConfidence || 'medium';
        } catch { /* use raw output */ }
      }
    }

    // Re-read research packets (Sophia may have added via web_search + submit_research_packet)
    const { data: postQCRecord } = await this.supabase
      .from('strategy_analyses')
      .select('research_packets')
      .eq('id', id)
      .single();
    const qcPackets = (postQCRecord?.research_packets as Record<string, unknown>) || researchPackets;

    // Collect all sources
    const allSources: StrategySource[] = [];
    let totalSearches = 0;
    for (const [packetType, packet] of Object.entries(qcPackets)) {
      const p = packet as { sources?: StrategySource[]; data?: unknown };
      if (p.sources) {
        allSources.push(...p.sources.map((s: StrategySource) => ({ ...s, analystRole: packetType })));
      }
    }
    researchProgress.forEach((rp) => {
      totalSearches += rp.searchCount || 0;
    });

    await this.supabase.from('strategy_analyses').update({
      sophia_qc: sophiaQC,
      cover_memos: coverMemos,
      gaps_filled: gapsFilled,
      remaining_gaps: remainingGaps,
      overall_confidence: overallConfidence,
      qc_completed_at: new Date().toISOString(),
      sources: allSources,
      total_searches: totalSearches,
      total_sources: allSources.length,
    }).eq('id', id);

    // ═══════════════════════════════════════════
    // WAVE 2: Executive analysis (parallel)
    // ═══════════════════════════════════════════
    await this.updateStatus(id, 'analyzing', { analysis_started_at: new Date().toISOString() });

    const executiveOutputs: Record<string, ExecutiveAnalysisOutput> = {};

    const execResults = await Promise.allSettled(
      activeExecs.map(async (execRole, i) => {
        // Mark running
        executiveProgress[i].status = 'running';
        executiveProgress[i].startedAt = new Date().toISOString();
        await this.supabase.from('strategy_analyses').update({ executive_progress: executiveProgress }).eq('id', id);

        // Build exec's packet subset based on routing
        const routing = sophiaRouting[execRole] || [];
        const execPackets: Record<string, unknown> = {};
        for (const packetType of routing) {
          if (qcPackets[packetType]) {
            execPackets[packetType] = qcPackets[packetType];
          }
        }
        if (Object.keys(execPackets).length === 0) {
          Object.assign(execPackets, qcPackets);
        }

        // Inject Sophia's cover memo for this executive
        const execCoverMemo = coverMemos[execRole] as string || '';
        const prompt = buildExecutivePrompt(execRole, req.query, execPackets, execCoverMemo);
        const startMs = Date.now();

        const response = await this.modelClient.generate({
          model: this.model,
          systemInstruction: `You are a strategic executive at Glyphor. Analyze the research provided and produce structured strategic analysis. Output ONLY valid JSON — no markdown fences, no preamble.`,
          contents: [{ role: 'user', content: prompt, timestamp: Date.now() }],
          temperature: 0.3,
        });

        const output = response.text ?? '';
        let analysis: Record<string, unknown> = {};
        const jsonMatch = output.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try { analysis = JSON.parse(jsonMatch[0]); } catch { analysis = { rawOutput: output }; }
        } else {
          analysis = { rawOutput: output };
        }

        const execOutput: ExecutiveAnalysisOutput = {
          execRole,
          execName: EXEC_FRAMEWORKS[execRole]?.name || execRole,
          framework: EXEC_FRAMEWORKS[execRole]?.framework || 'Strategic Analysis',
          analysis,
          duration: Date.now() - startMs,
        };

        executiveOutputs[execRole] = execOutput;

        executiveProgress[i].status = 'completed';
        executiveProgress[i].completedAt = new Date().toISOString();
        await this.supabase.from('strategy_analyses').update({
          executive_progress: executiveProgress,
          executive_outputs: executiveOutputs,
        }).eq('id', id);

        return execOutput;
      }),
    );

    // Mark failed execs
    execResults.forEach((r, i) => {
      if (r.status === 'rejected') {
        executiveProgress[i].status = 'failed';
        executiveProgress[i].error = r.reason?.message ?? String(r.reason);
      }
    });
    await this.supabase.from('strategy_analyses').update({
      executive_progress: executiveProgress,
      executive_outputs: executiveOutputs,
    }).eq('id', id);

    // ═══════════════════════════════════════════
    // WAVE 3: Sarah synthesizes
    // ═══════════════════════════════════════════
    await this.updateStatus(id, 'synthesizing', { synthesis_started_at: new Date().toISOString() });

    const synthesisPrompt = buildSynthesisPrompt(req.query, executiveOutputs, qcPackets, allSources, overallConfidence, remainingGaps, sarahFrame);

    const synthesisResponse = await this.modelClient.generate({
      model: this.model,
      systemInstruction: 'You are producing a McKinsey-grade strategic synthesis. Output ONLY the JSON requested — no markdown fences, no preamble, no commentary.',
      contents: [{ role: 'user', content: synthesisPrompt, timestamp: Date.now() }],
      temperature: 0.2,
    });

    let synthesis: SynthesisOutput | null = null;
    const synthText = synthesisResponse.text ?? '';
    const synthMatch = synthText.match(/\{[\s\S]*\}/);
    if (synthMatch) {
      try {
        const parsed = JSON.parse(synthMatch[0]);
        synthesis = {
          executiveSummary: parsed.executiveSummary || '',
          unifiedSwot: parsed.unifiedSwot || { strengths: [], weaknesses: [], opportunities: [], threats: [] },
          crossFrameworkInsights: parsed.crossFrameworkInsights || [],
          strategicRecommendations: parsed.strategicRecommendations || [],
          keyRisks: parsed.keyRisks || [],
          openQuestionsForFounders: parsed.openQuestionsForFounders || [],
          sourceIndex: allSources,
        };
      } catch {
        synthesis = {
          executiveSummary: synthText,
          unifiedSwot: { strengths: [], weaknesses: [], opportunities: [], threats: [] },
          crossFrameworkInsights: [],
          strategicRecommendations: [],
          keyRisks: [],
          openQuestionsForFounders: [],
          sourceIndex: allSources,
        };
      }
    }

    // ═══════════════════════════════════════════
    // WAVE 4: Follow-up (comprehensive only)
    // ═══════════════════════════════════════════
    if (depth === 'comprehensive' && synthesis) {
      await this.runFollowUp(id, req, synthesis, sophiaBriefs, qcPackets, executiveOutputs, allSources);
    }

    await this.supabase.from('strategy_analyses').update({
      status: 'completed',
      synthesis,
      completed_at: new Date().toISOString(),
    }).eq('id', id);

    // Log activity
    await this.supabase.from('activity_log').insert({
      agent_id: 'system',
      action: 'strategy_analysis.completed',
      detail: `Strategy Lab v2 analysis completed for "${req.query}" (${depth}): ${Object.keys(qcPackets).length} research packets, ${Object.keys(executiveOutputs).length} executive analyses, ${allSources.length} sources. Confidence: ${overallConfidence}. Gaps filled by Sophia: ${gapsFilled.length}`,
      created_at: new Date().toISOString(),
    });
  }

  /* ── Quick Analysis ─────────────────────── */

  private async runQuickAnalysis(id: string, req: StrategyAnalysisRequest): Promise<void> {
    await this.updateStatus(id, 'researching', { research_started_at: new Date().toISOString() });

    // Sarah does quick research + analysis herself
    const result = await this.agentExecutor('chief-of-staff' as CompanyAgentRole, 'on_demand', {
      message: buildQuickAnalysisPrompt(req.query),
      analysisId: id,
    });

    // Build a quick synthesis from Sarah's output
    const synthesis: SynthesisOutput = {
      executiveSummary: result?.output || 'Quick analysis completed.',
      unifiedSwot: { strengths: [], weaknesses: [], opportunities: [], threats: [] },
      crossFrameworkInsights: [],
      strategicRecommendations: [],
      keyRisks: [],
      openQuestionsForFounders: ['Would a deeper analysis be valuable here?'],
      sourceIndex: [],
    };

    // Try to parse structured content from output
    if (result?.output) {
      const jsonMatch = result.output.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          Object.assign(synthesis, parsed);
        } catch { /* use raw output */ }
      }
    }

    await this.supabase.from('strategy_analyses').update({
      status: 'completed',
      synthesis,
      completed_at: new Date().toISOString(),
    }).eq('id', id);
  }

  /* ── Follow-Up Research (Comprehensive) ── */

  private async runFollowUp(
    id: string,
    req: StrategyAnalysisRequest,
    synthesis: SynthesisOutput,
    originalBriefs: ResearchBrief[],
    researchPackets: Record<string, unknown>,
    executiveOutputs: Record<string, ExecutiveAnalysisOutput>,
    sources: StrategySource[],
  ): Promise<void> {
    await this.updateStatus(id, 'deepening');

    // Ask Sarah to identify gaps
    const gapPrompt = `You are Sarah Chen. Review this strategic analysis and identify 1-3 research gaps that would significantly strengthen the analysis. For each gap, specify which research analyst should investigate and what search queries to use.

CURRENT SYNTHESIS:
${JSON.stringify(synthesis, null, 2)}

AVAILABLE ANALYSTS:
- competitive-research-analyst (Lena): competitive intelligence
- market-research-analyst (Daniel): market data, financials
- technical-research-analyst (Kai): tech stacks, architecture
- industry-research-analyst (Amara): regulation, trends

Return JSON array: [{ "analystRole": "...", "researchBrief": "...", "searchQueries": ["..."] }]
Return an empty array [] if the analysis is sufficiently thorough.`;

    const gapResponse = await this.modelClient.generate({
      model: this.model,
      systemInstruction: 'Output ONLY valid JSON — no markdown fences, no commentary.',
      contents: [{ role: 'user', content: gapPrompt, timestamp: Date.now() }],
      temperature: 0.2,
    });

    let gaps: { analystRole: string; researchBrief: string; searchQueries: string[] }[] = [];
    const gapText = gapResponse.text ?? '';
    const gapMatch = gapText.match(/\[[\s\S]*\]/);
    if (gapMatch) {
      try {
        const rawGaps = JSON.parse(gapMatch[0]) as { analystRole: string; researchBrief: string; searchQueries: string[] }[];
        gaps = rawGaps
          .map((g) => ({ ...g, analystRole: normalizeAnalystRole(g.analystRole) }))
          .filter((g) => g.analystRole !== '');
      } catch { /* no gaps */ }
    }

    if (gaps.length === 0) return;

    // Run follow-up research
    const followUpResults = await Promise.allSettled(
      gaps.map((gap) =>
        this.agentExecutor(gap.analystRole as CompanyAgentRole, 'research', {
          analysisId: id,
          researchBrief: gap.researchBrief,
          searchQueries: gap.searchQueries,
          maxToolCalls: 8,
        }),
      ),
    );

    // Re-read research packets (analysts added to them)
    const { data: updatedRecord } = await this.supabase
      .from('strategy_analyses')
      .select('research_packets')
      .eq('id', id)
      .single();
    const updatedPackets = (updatedRecord?.research_packets as Record<string, unknown>) || researchPackets;

    // Re-synthesize with new data
    const updatedSynthesisPrompt = buildSynthesisPrompt(
      req.query,
      executiveOutputs,
      updatedPackets,
      sources,
    );

    const reSynthResponse = await this.modelClient.generate({
      model: this.model,
      systemInstruction: 'Update and enhance the strategic synthesis with additional research data. Output ONLY valid JSON.',
      contents: [{ role: 'user', content: updatedSynthesisPrompt, timestamp: Date.now() }],
      temperature: 0.2,
    });

    const reText = reSynthResponse.text ?? '';
    const reMatch = reText.match(/\{[\s\S]*\}/);
    if (reMatch) {
      try {
        const parsed = JSON.parse(reMatch[0]);
        Object.assign(synthesis, {
          executiveSummary: parsed.executiveSummary || synthesis.executiveSummary,
          unifiedSwot: parsed.unifiedSwot || synthesis.unifiedSwot,
          crossFrameworkInsights: parsed.crossFrameworkInsights || synthesis.crossFrameworkInsights,
          strategicRecommendations: parsed.strategicRecommendations || synthesis.strategicRecommendations,
          keyRisks: parsed.keyRisks || synthesis.keyRisks,
          openQuestionsForFounders: parsed.openQuestionsForFounders || synthesis.openQuestionsForFounders,
        });
      } catch { /* keep original synthesis */ }
    }
  }

  /* ── Research Brief Builder ─────────────── */

  private buildResearchBriefs(
    query: string,
    analysisType: StrategyAnalysisType,
    analysts: string[],
  ): ResearchBrief[] {
    return analysts.map((role) => {
      const analyst = RESEARCH_ANALYST_ROLES[role];
      if (!analyst) return null;

      let researchBrief: string;
      let suggestedSearches: string[];

      switch (role) {
        case 'competitive-research-analyst':
          researchBrief = `Research the competitive landscape for: ${query}\n\nFind and profile all relevant competitors. For each competitor, gather: company overview, founding date, funding history, pricing tiers, key features, customer reviews (G2, Capterra), target market, and market position. Build a feature comparison matrix. Assess threat levels.`;
          suggestedSearches = [
            `${query} competitors comparison`,
            `${query} alternatives best tools`,
            `${query} market comparison G2 reviews`,
            `${query} competitor pricing plans`,
            `${query} startup funding crunchbase`,
            `best ${query} tools 2026 review`,
            `${query} vs comparison`,
            `${query} capterra reviews ratings`,
          ];
          break;

        case 'market-research-analyst':
          researchBrief = `Research market data for: ${query}\n\nFind TAM/SAM/SOM estimates with sources. Track competitor revenue data (confirmed and estimated). Compile pricing benchmarks across the market. Map funding landscape and investment trends. Identify growth rates and market trajectory.`;
          suggestedSearches = [
            `${query} market size TAM 2026`,
            `${query} market growth rate CAGR forecast`,
            `${query} industry revenue data`,
            `${query} funding investment landscape 2025 2026`,
            `${query} pricing benchmark analysis`,
            `${query} market research report Statista Gartner`,
          ];
          break;

        case 'technical-research-analyst':
          researchBrief = `Research the technical landscape for: ${query}\n\nMap competitor tech stacks, AI models used, API capabilities, and architecture patterns. Identify open source vs proprietary components. Assess technical barriers to entry and competitive moats. Evaluate developer experience and platform extensibility.`;
          suggestedSearches = [
            `${query} technology stack architecture`,
            `${query} API documentation developer`,
            `${query} AI model GPT machine learning`,
            `${query} engineering blog technical`,
            `${query} open source github`,
            `${query} technical comparison platform`,
            `${query} developer experience SDK`,
          ];
          break;

        case 'industry-research-analyst':
          researchBrief = `Research industry trends and macro environment for: ${query}\n\nTrack regulatory developments (AI Act, data privacy, content regulation). Analyze technology trends (model improvements, cost curves). Monitor enterprise adoption patterns. Assess economic factors. Organize into PESTLE framework.`;
          suggestedSearches = [
            `${query} regulation policy 2026`,
            `${query} industry trends forecast`,
            `${query} enterprise adoption survey`,
            `AI regulation EU AI Act impact ${query}`,
            `${query} economic outlook market dynamics`,
            `${query} emerging technology trends 2026`,
            `${query} consumer behavior adoption curve`,
          ];
          break;

        default:
          researchBrief = `Research: ${query}`;
          suggestedSearches = [query];
      }

      // Determine which executives this research feeds
      const targetExecutives = Object.entries(DEFAULT_ROUTING)
        .filter(([_, packets]) => packets.includes(analyst.packetType))
        .map(([exec]) => exec);

      return {
        analystRole: role,
        analystName: analyst.name,
        researchBrief,
        suggestedSearches,
        expectedOutput: analyst.packetType,
        targetExecutives,
      };
    }).filter(Boolean) as ResearchBrief[];
  }

  private buildRouting(executives: string[]): ExecutiveRouting {
    const routing: ExecutiveRouting = {};
    for (const exec of executives) {
      routing[exec] = DEFAULT_ROUTING[exec] || ['competitor_profiles'];
    }
    return routing;
  }

  /* ── Helpers ────────────────────────────── */

  private async updateStatus(id: string, status: StrategyAnalysisStatus, extra?: Record<string, unknown>): Promise<void> {
    await this.supabase.from('strategy_analyses').update({ status, ...extra }).eq('id', id);
  }
}
