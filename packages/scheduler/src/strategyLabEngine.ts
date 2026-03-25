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

import { systemQuery } from '@glyphor/shared/db';
import { getTierModel, getSpecialized } from '@glyphor/shared';
import type { ModelClient } from '@glyphor/agent-runtime';
import type { AgentExecutionResult, CompanyAgentRole } from '@glyphor/agent-runtime';
import { WorkflowOrchestrator } from '@glyphor/agent-runtime';
import type { FrameworkId, FrameworkResult, FrameworkConvergence, WatchlistItem } from './frameworkTypes.js';

/* ── Types ──────────────────────────────────── */

export type StrategyAnalysisStatus =
  | 'planning'
  | 'framing'
  | 'decomposing'
  | 'researching'
  | 'quality-check'
  | 'framework-analysis'
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
  visual_image?: string | null;
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
  // Framework analysis fields
  framework_outputs: Record<string, unknown>;
  framework_convergence: string | null;
  framework_progress: FrameworkProgress[];
}

export interface FrameworkProgress {
  frameworkId: FrameworkId;
  frameworkName: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

function hasStringOutput(result: void | AgentExecutionResult): result is AgentExecutionResult & { output: string } {
  return Boolean(result) && typeof (result as AgentExecutionResult).output === 'string';
}

function extractFirstJsonObject(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;

  const fencedMatch = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```\s*([\s\S]*?)```/i);
  const candidate = fencedMatch?.[1]?.trim() || text;

  try {
    const parsed = JSON.parse(candidate) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return candidate;
    }
  } catch {
    // Continue to balanced-brace extraction.
  }

  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < candidate.length; i += 1) {
    const ch = candidate[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (ch === '}') {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const objectText = candidate.slice(start, i + 1);
        try {
          const parsed = JSON.parse(objectText) as unknown;
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return objectText;
          }
        } catch {
          // Keep scanning for a later valid object.
        }
      }
    }
  }

  return null;
}

function parseObjectFromModelOutput(raw: string): Record<string, unknown> | null {
  const jsonBlob = extractFirstJsonObject(raw);
  if (!jsonBlob) return null;
  try {
    const parsed = JSON.parse(jsonBlob) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/* ── Constants ──────────────────────────────── */

const RESEARCH_ANALYST_ROLES: Record<string, { name: string; packetType: string }> = {
  'competitive-research-analyst': { name: 'Lena Park', packetType: 'competitor_profiles' },
  'market-research-analyst': { name: 'Daniel Okafor', packetType: 'market_data' },
};

/** Normalise analyst role strings from LLM output to canonical role IDs */
function normalizeAnalystRole(raw: string): string {
  if (!raw) return '';
  const key = raw.toLowerCase().replace(/[_\s]+/g, '-').trim();
  if (RESEARCH_ANALYST_ROLES[key]) return key;
  // Match by keyword prefix
  if (/^compet/.test(key)) return 'competitive-research-analyst';
  if (/^market/.test(key)) return 'market-research-analyst';
  // Match by analyst name
  const lower = raw.toLowerCase();
  if (lower.includes('lena')) return 'competitive-research-analyst';
  if (lower.includes('daniel')) return 'market-research-analyst';
  return '';
}

const EXEC_FRAMEWORKS: Record<string, { name: string; framework: string }> = {
  'cpo': { name: 'Elena Vasquez', framework: 'Ansoff Matrix + Product Strategy' },
  'cfo': { name: 'Nadia Al-Rashid', framework: 'BCG Matrix + Financial Analysis' },
  'cmo': { name: 'Maya Brooks', framework: 'Blue Ocean Strategy + Positioning' },
  'cto': { name: 'Marcus Reeves', framework: "Porter's Five Forces + Technical Strategy" },
};

/** Framework analysis configs — 6 strategic frameworks applied to validated research data */
export const FRAMEWORK_CONFIGS: Record<FrameworkId, { name: string; outputKeys: string[] }> = {
  'framework-ansoff': {
    name: 'Ansoff Growth Matrix',
    outputKeys: ['summary', 'primary_quadrant', 'quadrants', 'key_insight', 'growth_balance_assessment'],
  },
  'framework-bcg': {
    name: 'BCG Growth-Share Matrix',
    outputKeys: ['summary', 'portfolio_balance', 'portfolio_rating', 'segments', 'capital_allocation_recommendation', 'key_insight'],
  },
  'framework-blue-ocean': {
    name: 'Blue Ocean Strategy',
    outputKeys: ['summary', 'uncontested_spaces', 'four_actions_framework', 'strategy_canvas', 'primary_blue_ocean', 'defensibility', 'key_insight'],
  },
  'framework-porters': {
    name: "Porter's Five Forces",
    outputKeys: ['summary', 'overall_attractiveness', 'overall_attractiveness_score', 'forces', 'most_critical_force', 'strategic_implications', 'key_insight'],
  },
  'framework-pestle': {
    name: 'PESTLE Analysis',
    outputKeys: ['summary', 'overall_environment', 'dimensions', 'top_3_tailwinds', 'top_3_headwinds', 'key_insight'],
  },
  'framework-swot': {
    name: 'Enhanced SWOT',
    outputKeys: ['summary', 'items', 'interaction_matrix', 'strategic_priority', 'key_insight'],
  },
};

/** Default routing: which exec gets which research packets */
const DEFAULT_ROUTING: ExecutiveRouting = {
  'cpo': ['competitor_profiles', 'technical_landscape', 'segment_analysis', 'strategic_direction'],
  'cfo': ['market_data', 'competitor_profiles', 'financial_analysis', 'segment_analysis', 'ma_activity'],
  'cmo': ['competitor_profiles', 'market_data', 'industry_trends', 'opportunity_map', 'ai_impact'],
  'cto': ['technical_landscape', 'competitor_profiles', 'ai_impact', 'talent_assessment'],
};

/** Analysis type → which analysts and executives to use */
const ANALYSIS_CONFIGS: Record<StrategyAnalysisType, { analysts: string[]; executives: string[] }> = {
  competitive_landscape: {
    analysts: ['competitive-research-analyst', 'market-research-analyst'],
    executives: ['cpo', 'cfo', 'cmo', 'cto'],
  },
  market_opportunity: {
    analysts: ['market-research-analyst', 'competitive-research-analyst'],
    executives: ['cmo', 'cfo', 'cpo'],
  },
  product_strategy: {
    analysts: ['competitive-research-analyst', 'market-research-analyst'],
    executives: ['cpo', 'cto', 'cmo'],
  },
  growth_diagnostic: {
    analysts: ['market-research-analyst', 'competitive-research-analyst'],
    executives: ['cmo', 'cfo', 'cpo'],
  },
  risk_assessment: {
    analysts: ['competitive-research-analyst', 'market-research-analyst'],
    executives: ['cto', 'cfo', 'cpo'],
  },
  market_entry: {
    analysts: ['market-research-analyst', 'competitive-research-analyst'],
    executives: ['cmo', 'cfo', 'cpo', 'cto'],
  },
  due_diligence: {
    analysts: ['competitive-research-analyst', 'market-research-analyst'],
    executives: ['cfo', 'cpo', 'cto', 'cmo'],
  },
};

/** Depth → how many analysts/execs to use, tool limits */
function getDepthConfig(depth: StrategyAnalysisDepth) {
  switch (depth) {
    case 'quick': return { maxAnalysts: 0, maxExecs: 0, maxToolCalls: 5, quickMode: true };
    case 'standard': return { maxAnalysts: 3, maxExecs: 2, maxToolCalls: 10, quickMode: false };
    case 'deep': return { maxAnalysts: 6, maxExecs: 4, maxToolCalls: 15, quickMode: false };
    case 'comprehensive': return { maxAnalysts: 6, maxExecs: 4, maxToolCalls: 20, quickMode: false };
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
  frameworkOutputs?: Record<string, unknown>,
  frameworkConvergence?: string,
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

  const frameworkSection = frameworkOutputs && Object.keys(frameworkOutputs).length > 0
    ? `\n\nFRAMEWORK ANALYSES (Ansoff, BCG, Blue Ocean, Porter's, PESTLE, Enhanced SWOT):\n${JSON.stringify(frameworkOutputs, null, 2)}\n`
    : '';

  const convergenceSection = frameworkConvergence
    ? `\n\nFRAMEWORK CONVERGENCE NARRATIVE:\n${frameworkConvergence}\n`
    : '';

  return `You are Sarah Chen, Chief of Staff at Glyphor.

Your team has completed a strategic analysis. You now have:
${frameSection}${sophiaSection}${frameworkSection}${convergenceSection}
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
  "openQuestionsForFounders": ["Decisions only Kristina and Andrew can make"],
  "monitoringRecommendations": ["Items that should be tracked on an ongoing basis — key risks to watch, catalysts that could accelerate, pending transactions, leadership changes, regulatory developments. Be specific and actionable."]
}

Respond ONLY with valid JSON — no markdown fences, no commentary.
Synthesize, don't concatenate. Find the insights that emerge when you look across ALL executive analyses together.
Rank recommendations by impact × feasibility.`;
}

function buildQuickAnalysisPrompt(query: string): string {
  return `You are Sarah Chen, Chief of Staff at Glyphor.

A founder has requested a quick strategic analysis:
Query: "${query}"

IMPORTANT: This is a STRATEGY LAB task. Focus ONLY on the strategic analysis. Do NOT check email, Teams, or any communication tools. Do NOT report on infrastructure issues or missing credentials. Your ONLY job is strategic research and analysis.

This is a QUICK analysis — you have limited research capability. Do your own web searches (up to 5) and provide a concise analysis covering:

1. Top 3-5 competitors or relevant players
2. Key market dynamics
3. Quick SWOT assessment
4. 2-3 strategic recommendations
5. What would need deeper research

Be direct and practical. This is a 2-minute briefing, not a board presentation.

After researching, submit your findings using submit_research_packet with packet_type "competitor_profiles" and analysis_id from the brief.`;
}

/* ── Framework Analysis Prompts ─────────────── */

export function buildFrameworkPrompt(frameworkId: FrameworkId, target: string, researchPackets: Record<string, unknown>): string {
  const packetsJSON = JSON.stringify(researchPackets, null, 2);

  switch (frameworkId) {
    case 'framework-ansoff':
      return `You are a growth strategy analyst applying the Ansoff Growth Matrix.
Given the research data on ${target}, classify and analyze growth initiatives across all four quadrants.
For each quadrant, identify specific current and potential initiatives with revenue impact estimates.
Your output must include concrete examples with financial evidence, not abstract descriptions.

QUALITY REQUIREMENTS:
- Each quadrant must have at least one initiative with evidence
- If a quadrant is genuinely empty, explain WHY rather than leaving it blank
- Every initiative must have a status (active/planned/potential) and estimated impact

RESEARCH DATA:
${packetsJSON}

Return a JSON object with these exact keys:
{
  "summary": "2-3 sentence synthesis of primary growth path",
  "primary_quadrant": "market_penetration|market_development|product_development|diversification",
  "quadrants": {
    "market_penetration": { "description": "...", "initiatives": [{"name":"...", "status":"active|planned|potential", "detail":"...", "estimated_impact":"..."}], "revenue_impact": "...", "evidence": ["..."] },
    "market_development": { ... },
    "product_development": { ... },
    "diversification": { ... }
  },
  "key_insight": "Single most important strategic takeaway",
  "growth_balance_assessment": "Whether the portfolio is well-balanced or over-indexed"
}
Respond ONLY with valid JSON — no markdown fences, no commentary.`;

    case 'framework-bcg':
      return `You are a portfolio strategy analyst applying the BCG Growth-Share Matrix.
Given the research data on ${target}, classify each business segment or product line into the appropriate BCG quadrant.
Use actual market growth rates and competitive position data. Calculate or estimate relative market share where possible.
Identify portfolio balance and recommended capital allocation shifts.

QUALITY REQUIREMENTS:
- Every segment must have a market growth rate (estimated ranges acceptable)
- Every segment must have a competitive position justification
- Flag segments where data is insufficient for confident classification

RESEARCH DATA:
${packetsJSON}

Return a JSON object with these exact keys:
{
  "summary": "2-3 sentence portfolio health assessment",
  "portfolio_balance": "healthy|top-heavy|aging|unbalanced",
  "portfolio_rating": "e.g. '100% Star Portfolio' or '3 Stars, 1 Cash Cow, 1 Question Mark'",
  "segments": [{"name":"...", "classification":"star|cash_cow|question_mark|dog", "market_growth_rate":"...", "relative_market_share":"...", "revenue":"...", "revenue_share_pct":0, "margin":"...", "trajectory":"improving|stable|declining", "rationale":"...", "recommendation":"invest|hold|harvest|divest"}],
  "capital_allocation_recommendation": "...",
  "key_insight": "..."
}
Respond ONLY with valid JSON — no markdown fences, no commentary.`;

    case 'framework-blue-ocean':
      return `You are a Blue Ocean strategy analyst.
Given the research data on ${target}, identify areas where the company is creating or could create uncontested market space.
Apply the Four Actions Framework (Eliminate, Reduce, Raise, Create) to the company's value proposition.
Map the strategy canvas showing how the company differentiates from industry norms.
Identify the most promising blue ocean opportunity with supporting evidence.

QUALITY REQUIREMENTS:
- Strategy canvas must have at least 6 competing factors
- Blue ocean spaces must have explicit evidence from research data — no speculative spaces without grounding
- Each action item must have an impact rating

RESEARCH DATA:
${packetsJSON}

Return a JSON object with these exact keys:
{
  "summary": "...",
  "uncontested_spaces": [{"space":"...", "description":"...", "current_competitors":"None identified or specific names", "moat_source":"...", "evidence":["..."]}],
  "four_actions_framework": {
    "eliminate": [{"factor":"...", "rationale":"...", "impact":"high|medium|low"}],
    "reduce": [...],
    "raise": [...],
    "create": [...]
  },
  "strategy_canvas": {
    "competing_factors": ["factor1", "factor2", ...at least 6],
    "company_curve": [1-10 scores],
    "industry_average_curve": [1-10 scores],
    "key_divergence_points": ["..."]
  },
  "primary_blue_ocean": "The single most promising uncontested space",
  "defensibility": "How defensible this blue ocean is",
  "key_insight": "..."
}
Respond ONLY with valid JSON — no markdown fences, no commentary.`;

    case 'framework-porters':
      return `You are an industry structure analyst applying Porter's Five Forces.
Given the research data on ${target}'s industry, assess each of the five forces with a quantified intensity rating and specific evidence.
Determine overall industry attractiveness and identify which forces most constrain or enable profitability.
Provide specific recommendations for how the company should position against each force.

QUALITY REQUIREMENTS:
- Each force must have at least 3 named key drivers with evidence
- No force can be rated without a trend direction
- Distinguish between the industry-level force and the specific company's position against it

RESEARCH DATA:
${packetsJSON}

Return a JSON object with these exact keys:
{
  "summary": "...",
  "overall_attractiveness": "high|moderate-high|moderate|moderate-low|low",
  "overall_attractiveness_score": 1-10,
  "forces": {
    "competitive_rivalry": {"intensity":"high|moderate-high|moderate|moderate-low|low", "intensity_score":1-10, "trend":"intensifying|stable|weakening", "key_drivers":["...","...","..."], "evidence":["..."], "company_position":"...", "recommendation":"..."},
    "threat_of_new_entrants": {...},
    "threat_of_substitutes": {...},
    "bargaining_power_suppliers": {...},
    "bargaining_power_buyers": {...}
  },
  "most_critical_force": "Which force matters most right now",
  "strategic_implications": ["How should the company position given these forces"],
  "key_insight": "..."
}
Respond ONLY with valid JSON — no markdown fences, no commentary.`;

    case 'framework-pestle':
      return `You are a macro-environment analyst applying the PESTLE framework.
Given the research data on ${target}, analyze each of the six dimensions with specific, current factors.
Every factor must include a quantified impact score and timeline.
Distinguish between factors that are confirmed/in-effect versus emerging/anticipated.
Prioritize factors by their actual financial impact on the company, not general relevance to the industry.

QUALITY REQUIREMENTS:
- Each dimension must have at least 2 factors
- Every factor must have a quantification attempt — if no hard number exists, state "quantification unavailable"
- Factors rated "speculative" must be labeled as such

RESEARCH DATA:
${packetsJSON}

Return a JSON object with these exact keys:
{
  "summary": "...",
  "overall_environment": "highly_favorable|favorable|mixed|challenging|hostile",
  "dimensions": {
    "political": {"assessment":"favorable|neutral|unfavorable", "factors":[{"factor":"...", "description":"...", "impact":"high_positive|moderate_positive|neutral|moderate_negative|high_negative", "impact_score":-10 to +10, "quantification":"hard number or 'quantification unavailable'", "status":"confirmed|emerging|speculative", "timeline":"...", "company_specific_impact":"...", "evidence":["..."]}]},
    "economic": {...},
    "social": {...},
    "technological": {...},
    "legal": {...},
    "environmental": {...}
  },
  "top_3_tailwinds": [top 3 most favorable factors from any dimension],
  "top_3_headwinds": [top 3 most threatening factors from any dimension],
  "key_insight": "..."
}
Respond ONLY with valid JSON — no markdown fences, no commentary.`;

    case 'framework-swot':
      return `You are an enhanced SWOT analyst producing a prioritized, quantified SWOT analysis.
Given the research data on ${target}, produce a SWOT analysis where every item includes:
- A quantified impact estimate
- A confidence level
- Evidence references

Then build a complete interaction matrix showing strategic implications of each pair:
- SO strategies: how strengths can exploit opportunities (offensive moves)
- WT vulnerabilities: where weaknesses amplify threats (urgent fixes)
- ST defenses: how strengths can counter threats (defensive moves)
- WO gaps: where weaknesses prevent capturing opportunities (development priorities)

Rank all items by priority_score = impact_score × probability.

QUALITY REQUIREMENTS:
- At least 5 items per category (S/W/O/T)
- Every item must have a quantification attempt (revenue impact, growth potential, or risk exposure)
- Interaction matrix must have at least 3 pairs per quadrant (SO, WT, ST, WO)
- Each interaction pair must have a priority_score (1-100) and confidence level

RESEARCH DATA:
${packetsJSON}

Return a JSON object with these exact keys:
{
  "summary": "...",
  "items": [{"category":"strength|weakness|opportunity|threat", "item":"...", "detail":"...", "impact_score":1-10, "probability":0.0-1.0, "priority_score": impact_score * probability * 10, "quantification":"$X revenue or +Y% growth or similar", "confidence":"high|medium|low", "evidence":["..."]}],
  "interaction_matrix": {
    "so_strategies": [{"strength":"...", "opportunity":"...", "strategy":"how to exploit this combination", "priority_score":1-100, "confidence":"high|medium|low", "expected_impact":"quantified expected outcome"}],
    "wt_vulnerabilities": [{"weakness":"...", "threat":"...", "vulnerability":"how weakness amplifies threat", "priority_score":1-100, "confidence":"high|medium|low", "urgency":"immediate|short_term|medium_term"}],
    "st_defenses": [{"strength":"...", "threat":"...", "defense":"how strength counters threat", "priority_score":1-100, "confidence":"high|medium|low", "defensive_action":"specific action to take"}],
    "wo_gaps": [{"weakness":"...", "opportunity":"...", "gap":"how weakness prevents capturing opportunity", "priority_score":1-100, "confidence":"high|medium|low", "development_priority":"what capability to build"}]
  },
  "strategic_priority": "The single most important SWOT-derived action",
  "key_insight": "...",
  "overall_strategic_position": "favorable|neutral|vulnerable"
}
Respond ONLY with valid JSON — no markdown fences, no commentary.`;
  }
}

export function buildConvergencePrompt(frameworkOutputs: Record<string, unknown>, target: string): string {
  const frameworksJSON = JSON.stringify(frameworkOutputs, null, 2);
  return `You are a senior strategic analyst synthesizing findings from six strategic frameworks applied to ${target}.

FRAMEWORK ANALYSES:
${frameworksJSON}

Write a 3-5 paragraph FRAMEWORK CONVERGENCE NARRATIVE that:
1. Identifies where the frameworks AGREE — what thesis do they converge on?
2. Identifies where the frameworks DIVERGE — what contradictions or tensions exist?
3. Synthesizes a combined strategic picture that goes beyond any single framework
4. Highlights the single most important strategic insight that emerges from looking across all six

This is what executives actually read. Be specific, cite framework names and their key findings, and draw connections between them.

Return a JSON object:
{
  "narrative": "3-5 paragraph convergence analysis",
  "agreement_points": ["Where frameworks converge"],
  "divergence_points": ["Where frameworks disagree or show tension"],
  "combined_thesis": "The overarching strategic thesis in 2-3 sentences"
}
Respond ONLY with valid JSON — no markdown fences, no commentary.`;
}

/* ── Engine ─────────────────────────────────── */

export class StrategyLabEngine {
  private readonly deepResearchAgent = getSpecialized('deep_research');
  private readonly deepResearchPollMs = 10_000;
  private readonly deepResearchTimeoutMs = 60 * 60 * 1000;

  constructor(
    private modelClient: ModelClient,
    private agentExecutor: (role: CompanyAgentRole, task: string, payload: Record<string, unknown>) => Promise<AgentExecutionResult | void>,
    private model = getTierModel('default'),
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
      framework_outputs: {},
      framework_convergence: null,
      framework_progress: [],
      created_at: new Date().toISOString(),
    };

    await systemQuery(
      `INSERT INTO strategy_analyses (id, query, analysis_type, depth, status, requested_by, research_briefs, executive_routing, research_packets, research_progress, executive_outputs, executive_progress, synthesis, total_searches, total_sources, sources, sarah_frame, sophia_decomposition, sophia_qc, cover_memos, gaps_filled, remaining_gaps, overall_confidence, framework_outputs, framework_convergence, framework_progress, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`,
      [
        record.id, record.query, record.analysis_type, record.depth, record.status, record.requested_by,
        JSON.stringify(record.research_briefs), JSON.stringify(record.executive_routing),
        JSON.stringify(record.research_packets), JSON.stringify(record.research_progress),
        JSON.stringify(record.executive_outputs), JSON.stringify(record.executive_progress),
        JSON.stringify(record.synthesis), record.total_searches, record.total_sources,
        JSON.stringify(record.sources), JSON.stringify(record.sarah_frame),
        JSON.stringify(record.sophia_decomposition), JSON.stringify(record.sophia_qc),
        JSON.stringify(record.cover_memos), JSON.stringify(record.gaps_filled),
        JSON.stringify(record.remaining_gaps), record.overall_confidence,
        JSON.stringify(record.framework_outputs), record.framework_convergence,
        JSON.stringify(record.framework_progress), record.created_at,
      ],
    );

    // Run phases async
    this.runPipeline(id, req, depth, analysisType).catch((err) => {
      console.error(`[StrategyLab] Fatal error in ${id}:`, err);
      systemQuery(
        'UPDATE strategy_analyses SET status=$1, error=$2 WHERE id=$3',
        ['failed', err instanceof Error ? err.message : String(err), id],
      );
    });

    return id;
  }

  /** Ensure JSONB array columns are always arrays (may be stored as {} when empty). */
  private normalizeRecord(row: StrategyAnalysisRecord): StrategyAnalysisRecord {
    const asArray = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
    return {
      ...row,
      research_progress: asArray(row.research_progress) as ResearchProgress[],
      executive_progress: asArray(row.executive_progress) as ExecutiveProgress[],
      gaps_filled: asArray(row.gaps_filled) as string[],
      remaining_gaps: asArray(row.remaining_gaps) as string[],
    };
  }

  async get(id: string): Promise<StrategyAnalysisRecord | null> {
    const [row] = await systemQuery<StrategyAnalysisRecord>(
      'SELECT * FROM strategy_analyses WHERE id=$1',
      [id],
    );
    return row ? this.normalizeRecord(row) : null;
  }

  async list(limit = 20): Promise<StrategyAnalysisRecord[]> {
    const rows = await systemQuery<StrategyAnalysisRecord>(
      'SELECT * FROM strategy_analyses ORDER BY created_at DESC LIMIT $1',
      [limit],
    );
    return rows.map((r) => this.normalizeRecord(r));
  }

  async cancel(id: string): Promise<void> {
    await systemQuery(
      'UPDATE strategy_analyses SET status=$1, error=$2 WHERE id=$3',
      ['failed', 'Cancelled by user.', id],
    );
  }

  /**
   * Launch a strategy analysis via workflow orchestration for deep/comprehensive analyses.
   * Used when depth is 'deep' or 'comprehensive' with multiple waves.
   * Returns a workflow_id instead of running the pipeline inline.
   */
  async launchWorkflow(req: StrategyAnalysisRequest): Promise<{ workflow_id: string; status: string }> {
    const id = await this.launch(req);
    return { workflow_id: id, status: 'started' };
  }

  /* ── Pipeline Runner ────────────────────── */

  private async runPipeline(
    id: string,
    req: StrategyAnalysisRequest,
    depth: StrategyAnalysisDepth,
    analysisType: StrategyAnalysisType,
  ): Promise<void> {
    await this.runSingleAgentDeepResearch(id, req, depth, analysisType);
    return;

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
    // Uses modelClient.generate() directly — Sarah only needs to THINK here,
    // not use tools. Running the full chief-of-staff agent would load all
    // operational tools (Teams, email, etc.) whose missing env vars cause
    // Sarah to derail into complaining about infrastructure instead of framing.
    await this.updateStatus(id, 'framing');

    const sarahFrameResponse = await this.modelClient.generate({
      model: this.model,
      systemInstruction: `You are Sarah Chen, Chief of Staff at Glyphor, an AI company building autonomous software (Fuse) and creative (Pulse) platforms.
You bridge the AI executive team and the two human founders:
- Kristina (CEO) — Vision, strategy, product intuition, partnerships, enterprise sales
- Andrew (COO) — Financial discipline, operational soundness, risk management
Both founders are full-time at Microsoft with ~5-10 hours/week combined for Glyphor.

Your job RIGHT NOW is strategic framing only. Do NOT discuss operational issues, tool availability, or infrastructure. Focus entirely on the strategic question.
Output ONLY valid JSON — no markdown fences, no preamble, no commentary.`,
      contents: [{ role: 'user', content: `A founder has requested a strategic analysis. Frame this request with strategic context.

Query: "${req.query}"
Analysis Type: "${analysisType}"
Depth: "${depth}"

YOUR ROLE:
1. Determine the right analysis type and depth
2. Add strategic context from your knowledge of the company (what are the founders trying to decide? what's the subtext?)
3. Identify specific angles or priorities the founders care about
4. Note any internal context that should inform the research

YOU DO NOT decompose queries into research briefs (Sophia does this) or assign individual analysts (Sophia manages her team).

Return a JSON object with keys: strategicContext (string), founderPriorities (string[]), specificAngles (string[]), analysisNotes (string).`, timestamp: Date.now() }],
      temperature: 0.3,
    });

    let sarahFrame: Record<string, unknown> = {};
    const sarahFrameText = sarahFrameResponse.text ?? '';
    if (sarahFrameText) {
      const parsed = parseObjectFromModelOutput(sarahFrameText);
      if (parsed !== null) {
        sarahFrame = parsed!;
      } else {
        sarahFrame = { strategicContext: sarahFrameText };
      }
    }

    await systemQuery('UPDATE strategy_analyses SET sarah_frame=$1 WHERE id=$2', [JSON.stringify(sarahFrame), id]);

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

    const sophiaDecompOutput = (sophiaDecompResult as AgentExecutionResult | undefined)?.output;
    if (sophiaDecompOutput) {
      const decompText = String(sophiaDecompOutput);
      const parsed = parseObjectFromModelOutput(decompText);
      if (parsed !== null) {
        const parsedObj = parsed as Record<string, unknown>;
        sophiaDecomp = parsedObj;

        // Extract briefs from Sophia's structured output
        const briefsRaw = parsedObj['briefs'];
        const briefs = Array.isArray(briefsRaw) ? briefsRaw as unknown[] : [];
        if (briefs.length > 0) {
          sophiaBriefs = briefs
            .map((b: unknown) => {
              if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
              const brief = b as Record<string, unknown>;
              const role = normalizeAnalystRole(
                String(brief.analystRole ?? brief.analyst_role ?? brief.role ?? brief.analyst ?? ''),
              );
              if (!role) return null;
              const suggestedSearchesRaw = brief.suggestedSearches ?? brief.searchQueries;
              const targetExecutivesRaw = brief.targetExecutives;
              return {
                analystRole: role,
                analystName: RESEARCH_ANALYST_ROLES[role]?.name || String(brief.analystName ?? ''),
                researchBrief: String(brief.researchBrief ?? brief.brief ?? ''),
                suggestedSearches: Array.isArray(suggestedSearchesRaw)
                  ? suggestedSearchesRaw.map((item: unknown) => String(item))
                  : [],
                expectedOutput: RESEARCH_ANALYST_ROLES[role]?.packetType || String(brief.expectedOutput ?? ''),
                targetExecutives: Array.isArray(targetExecutivesRaw)
                  ? targetExecutivesRaw.map((item: unknown) => String(item))
                  : [],
              };
            })
            .filter(Boolean) as ResearchBrief[];
        }

        // Extract routing
        const routingRaw = parsedObj['executiveRouting'];
        if (routingRaw && typeof routingRaw === 'object' && !Array.isArray(routingRaw)) {
          sophiaRouting = routingRaw as ExecutiveRouting;
        }
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

    await systemQuery(
      'UPDATE strategy_analyses SET research_briefs=$1, executive_routing=$2, research_progress=$3, executive_progress=$4, sophia_decomposition=$5 WHERE id=$6',
      [JSON.stringify(sophiaBriefs), JSON.stringify(sophiaRouting), JSON.stringify(researchProgress), JSON.stringify(executiveProgress), JSON.stringify(sophiaDecomp), id],
    );

    // ═══════════════════════════════════════════
    // WAVE 1: Research team (parallel)
    // ═══════════════════════════════════════════
    await this.updateStatus(id, 'researching', { research_started_at: new Date().toISOString() });

    const researchResults = await Promise.allSettled(
      sophiaBriefs.map(async (brief, i) => {
        // Mark this analyst as running
        researchProgress[i].status = 'running';
        researchProgress[i].startedAt = new Date().toISOString();
        await systemQuery('UPDATE strategy_analyses SET research_progress=$1 WHERE id=$2', [JSON.stringify(researchProgress), id]);

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
        await systemQuery('UPDATE strategy_analyses SET research_progress=$1 WHERE id=$2', [JSON.stringify(researchProgress), id]);

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
    await systemQuery('UPDATE strategy_analyses SET research_progress=$1 WHERE id=$2', [JSON.stringify(researchProgress), id]);

    // Load research packets submitted by analysts
    const [currentRecord] = await systemQuery<{ research_packets: Record<string, unknown> }>(
      'SELECT research_packets FROM strategy_analyses WHERE id=$1',
      [id],
    );
    let researchPackets = (currentRecord?.research_packets as Record<string, unknown>) || {};

    // ── Fallback: extract packets from analyst text output ──
    // If analysts completed but didn't call submit_research_packet, their findings
    // are trapped in text output. Extract and submit them as fallback packets.
    if (Object.keys(researchPackets).length === 0) {
      const ROLE_TO_PACKET_TYPE: Record<string, string> = {
        'competitive-research-analyst': 'competitor_profiles',
        'market-research-analyst': 'market_data',
      };

      let fallbackCount = 0;
      for (let i = 0; i < researchResults.length; i++) {
        const r = researchResults[i];
        if (r.status !== 'fulfilled') continue;
        const settledValue = (r as PromiseFulfilledResult<void | AgentExecutionResult>).value;
        const settledOutput = (settledValue as AgentExecutionResult | undefined)?.output;
        if (typeof settledOutput !== 'string') {
          continue;
        }

        const role = sophiaBriefs[i]?.analystRole as string;
        const packetType = ROLE_TO_PACKET_TYPE[role];
        if (!packetType) continue;

        const fallbackPacket = {
          data: { rawFindings: settledOutput },
          sources: [],
          confidenceLevel: 'low',
          dataGaps: ['Packet auto-extracted from text output — structured data may be missing'],
          conflictingData: [],
          submittedAt: new Date().toISOString(),
          fallback: true,
        };

        try {
          await systemQuery('SELECT * FROM merge_research_packet($1, $2, $3)', [id, packetType, JSON.stringify(fallbackPacket)]);
          fallbackCount++;
        } catch { /* best-effort */ }
      }

      if (fallbackCount > 0) {
        // Re-read packets after fallback insertion
        const [fallbackRecord] = await systemQuery<{ research_packets: Record<string, unknown> }>(
          'SELECT research_packets FROM strategy_analyses WHERE id=$1',
          [id],
        );
        researchPackets = (fallbackRecord?.research_packets as Record<string, unknown>) || {};
      }
    }

    if (Object.keys(researchPackets).length === 0) {
      await systemQuery(
        'UPDATE strategy_analyses SET status=$1, error=$2 WHERE id=$3',
        ['failed', 'No research packets were submitted. All research analysts may have failed.', id],
      );
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

    const sophiaQCOutput = (sophiaQCResult as AgentExecutionResult | undefined)?.output;
    if (sophiaQCOutput) {
      const qcText = String(sophiaQCOutput);
      const parsed = parseObjectFromModelOutput(qcText);
      if (parsed !== null) {
        const parsedObj = parsed as Record<string, unknown>;
        sophiaQC = parsedObj;
        const coverMemosRaw = parsedObj['coverMemos'];
        const gapsFilledRaw = parsedObj['gapsFilled'];
        const remainingGapsRaw = parsedObj['remainingGaps'];
        const confidenceRaw = parsedObj['overallConfidence'];
        coverMemos = coverMemosRaw && typeof coverMemosRaw === 'object' && !Array.isArray(coverMemosRaw)
          ? coverMemosRaw as Record<string, unknown>
          : {};
        const gapsFilledList = Array.isArray(gapsFilledRaw) ? gapsFilledRaw as unknown[] : [];
        const remainingGapsList = Array.isArray(remainingGapsRaw) ? remainingGapsRaw as unknown[] : [];
        gapsFilled = gapsFilledList.map((item: unknown) => String(item));
        remainingGaps = remainingGapsList.map((item: unknown) => String(item));
        const confidenceText = typeof confidenceRaw === 'string' ? confidenceRaw : '';
        const normalizedConfidence = String(confidenceText).trim();
        overallConfidence = normalizedConfidence || 'medium';
      }
    }

    // Re-read research packets (Sophia may have added via web_search + submit_research_packet)
    const [postQCRecord] = await systemQuery<{ research_packets: Record<string, unknown> }>(
      'SELECT research_packets FROM strategy_analyses WHERE id=$1',
      [id],
    );
    const qcPackets = (postQCRecord?.research_packets as Record<string, unknown>) || researchPackets;

    // Collect all sources
    const allSources: StrategySource[] = [];
    let totalSearches = 0;
    for (const [packetType, packet] of Object.entries(qcPackets)) {
      const p = packet as { sources?: StrategySource[]; data?: unknown };
      const packetSources: StrategySource[] = (Array.isArray(p.sources) ? p.sources : []) as StrategySource[];
      allSources.push(...packetSources.map((s: StrategySource) => ({ ...s, analystRole: packetType })));
    }
    researchProgress.forEach((rp) => {
      totalSearches += rp.searchCount || 0;
    });

    await systemQuery(
      'UPDATE strategy_analyses SET sophia_qc=$1, cover_memos=$2, gaps_filled=$3, remaining_gaps=$4, overall_confidence=$5, qc_completed_at=$6, sources=$7, total_searches=$8, total_sources=$9 WHERE id=$10',
      [JSON.stringify(sophiaQC), JSON.stringify(coverMemos), JSON.stringify(gapsFilled), JSON.stringify(remainingGaps), overallConfidence, new Date().toISOString(), JSON.stringify(allSources), totalSearches, allSources.length, id],
    );

    // ═══════════════════════════════════════════
    // WAVE 1.75: Framework Analysis (parallel)
    // ═══════════════════════════════════════════
    await this.updateStatus(id, 'framework-analysis');

    const { frameworkOutputs, convergenceNarrative } = await this.runFrameworkAnalysis(
      id, req.query, qcPackets,
    );

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
        await systemQuery('UPDATE strategy_analyses SET executive_progress=$1 WHERE id=$2', [JSON.stringify(executiveProgress), id]);

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

        // Inject framework analysis context for the executive
        const frameworkContext = Object.keys(frameworkOutputs).length > 0
          ? `\n\nFRAMEWORK ANALYSES (from Wave 1.75 — use as additional strategic context):\n${JSON.stringify(frameworkOutputs, null, 2)}\n\n${convergenceNarrative ? `FRAMEWORK CONVERGENCE:\n${convergenceNarrative}\n` : ''}`
          : '';

        const prompt = buildExecutivePrompt(execRole, req.query, execPackets, execCoverMemo + frameworkContext);
        const startMs = Date.now();

        const response = await this.modelClient.generate({
          model: this.model,
          systemInstruction: `You are a strategic executive at Glyphor. Analyze the research provided and produce structured strategic analysis. Output ONLY valid JSON — no markdown fences, no preamble.`,
          contents: [{ role: 'user', content: prompt, timestamp: Date.now() }],
          temperature: 0.3,
        });

        const output = response.text ?? '';
        let analysis: Record<string, unknown> = {};
        analysis = parseObjectFromModelOutput(output) ?? { rawOutput: output };

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
        await systemQuery(
          'UPDATE strategy_analyses SET executive_progress=$1, executive_outputs=$2 WHERE id=$3',
          [JSON.stringify(executiveProgress), JSON.stringify(executiveOutputs), id],
        );

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
    await systemQuery(
      'UPDATE strategy_analyses SET executive_progress=$1, executive_outputs=$2 WHERE id=$3',
      [JSON.stringify(executiveProgress), JSON.stringify(executiveOutputs), id],
    );

    // ═══════════════════════════════════════════
    // WAVE 3: Sarah synthesizes
    // ═══════════════════════════════════════════
    await this.updateStatus(id, 'synthesizing', { synthesis_started_at: new Date().toISOString() });

    const synthesisPrompt = buildSynthesisPrompt(req.query, executiveOutputs, qcPackets, allSources, overallConfidence, remainingGaps, sarahFrame, frameworkOutputs, convergenceNarrative);

    const synthesisResponse = await this.modelClient.generate({
      model: this.model,
      systemInstruction: 'You are producing a executive-grade strategic synthesis. Output ONLY the JSON requested — no markdown fences, no preamble, no commentary.',
      contents: [{ role: 'user', content: synthesisPrompt, timestamp: Date.now() }],
      temperature: 0.2,
      metadata: { engineSource: 'strategy_lab' },
    });

    let synthesis: SynthesisOutput | null = null;
    const synthText = synthesisResponse.text ?? '';
    const parsedSynthesis = parseObjectFromModelOutput(synthText);
    if (parsedSynthesis !== null) {
      const parsedSynthesisObj = parsedSynthesis as Record<string, unknown>;
      const unifiedSwotRaw = parsedSynthesisObj['unifiedSwot'];
      const crossFrameworkInsightsRaw = parsedSynthesisObj['crossFrameworkInsights'];
      const strategicRecommendationsRaw = parsedSynthesisObj['strategicRecommendations'];
      const keyRisksRaw = parsedSynthesisObj['keyRisks'];
      const openQuestionsRaw = parsedSynthesisObj['openQuestionsForFounders'];
      const crossFrameworkInsights = Array.isArray(crossFrameworkInsightsRaw)
        ? (crossFrameworkInsightsRaw as unknown[]).map((item: unknown) => String(item))
        : [];
      const keyRisks = Array.isArray(keyRisksRaw)
        ? (keyRisksRaw as unknown[]).map((item: unknown) => String(item))
        : [];
      const openQuestions = Array.isArray(openQuestionsRaw)
        ? (openQuestionsRaw as unknown[]).map((item: unknown) => String(item))
        : [];
      const executiveSummaryRaw = parsedSynthesisObj['executiveSummary'];
      const executiveSummary = typeof executiveSummaryRaw === 'string' ? executiveSummaryRaw : '';
      synthesis = {
        executiveSummary: String(executiveSummary),
        unifiedSwot: unifiedSwotRaw && typeof unifiedSwotRaw === 'object' && !Array.isArray(unifiedSwotRaw)
          ? unifiedSwotRaw as SynthesisOutput['unifiedSwot']
          : { strengths: [], weaknesses: [], opportunities: [], threats: [] },
        crossFrameworkInsights,
        strategicRecommendations: Array.isArray(strategicRecommendationsRaw)
          ? strategicRecommendationsRaw as SynthesisOutput['strategicRecommendations']
          : [],
        keyRisks,
        openQuestionsForFounders: openQuestions,
        sourceIndex: allSources,
      };
    } else if (synthText) {
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

    // ═══════════════════════════════════════════
    // WAVE 4: Follow-up (comprehensive only)
    // ═══════════════════════════════════════════
    const finalizedSynthesis: SynthesisOutput = synthesis ?? {
      executiveSummary: synthText || 'Strategy analysis completed.',
      unifiedSwot: { strengths: [], weaknesses: [], opportunities: [], threats: [] },
      crossFrameworkInsights: [],
      strategicRecommendations: [],
      keyRisks: [],
      openQuestionsForFounders: [],
      sourceIndex: allSources,
    };

    if (depth === 'comprehensive') {
      await this.runFollowUp(id, req, finalizedSynthesis, sophiaBriefs, qcPackets, executiveOutputs, allSources);
    }

    // ═══════════════════════════════════════════
    // POST-SYNTHESIS: Extract monitoring watchlist
    // ═══════════════════════════════════════════
    await this.extractAndStoreWatchlist(id, 'strategy_analysis', finalizedSynthesis, frameworkOutputs, executiveOutputs);

    await systemQuery(
      'UPDATE strategy_analyses SET status=$1, synthesis=$2, completed_at=$3 WHERE id=$4',
      ['completed', JSON.stringify(finalizedSynthesis), new Date().toISOString(), id],
    );

    // Log activity
    await systemQuery(
      'INSERT INTO activity_log (agent_role, action, summary) VALUES ($1, $2, $3)',
      ['system', 'strategy_analysis.completed', `Strategy Lab v2 analysis completed for "${req.query}" (${depth}): ${Object.keys(qcPackets).length} research packets, ${Object.keys(executiveOutputs).length} executive analyses, ${allSources.length} sources. Confidence: ${overallConfidence}. Gaps filled by Sophia: ${gapsFilled.length}`],
    );
  }

  private async runSingleAgentDeepResearch(
    id: string,
    req: StrategyAnalysisRequest,
    depth: StrategyAnalysisDepth,
    analysisType: StrategyAnalysisType,
  ): Promise<void> {
    await this.updateStatus(id, 'researching', { research_started_at: new Date().toISOString() });

    const prompt = this.buildDeepResearchPrompt(req.query, analysisType, depth);
    const interactionId = await this.startDeepResearchInteraction(prompt);

    await systemQuery(
      'UPDATE strategy_analyses SET research_progress=$1 WHERE id=$2',
      [
        JSON.stringify([
          {
            analystRole: 'deep-research-agent',
            analystName: 'Gemini Deep Research Agent',
            status: 'running',
            startedAt: new Date().toISOString(),
          },
        ]),
        id,
      ],
    );

    await this.updateStatus(id, 'synthesizing', { synthesis_started_at: new Date().toISOString() });

    const finalOutput = await this.pollDeepResearchResult(interactionId);
    const synthesis = this.parseDeepResearchSynthesis(finalOutput.text);
    const sourceIndex = this.extractSourcesFromDeepResearchOutput(finalOutput.raw);
    synthesis.sourceIndex = sourceIndex;

    await systemQuery(
      'UPDATE strategy_analyses SET status=$1, synthesis=$2, sources=$3, total_sources=$4, total_searches=$5, research_progress=$6, completed_at=$7 WHERE id=$8',
      [
        'completed',
        JSON.stringify(synthesis),
        JSON.stringify(sourceIndex),
        sourceIndex.length,
        0,
        JSON.stringify([
          {
            analystRole: 'deep-research-agent',
            analystName: 'Gemini Deep Research Agent',
            status: 'completed',
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            sourceCount: sourceIndex.length,
          },
        ]),
        new Date().toISOString(),
        id,
      ],
    );

    await systemQuery(
      'INSERT INTO activity_log (agent_role, action, summary) VALUES ($1, $2, $3)',
      ['system', 'strategy_analysis.completed', `Strategy Lab analysis completed via Gemini Deep Research Agent for "${req.query}" (${depth}).`],
    );
  }

  private buildDeepResearchPrompt(
    query: string,
    analysisType: StrategyAnalysisType,
    depth: StrategyAnalysisDepth,
  ): string {
    const depthGuidance: Record<StrategyAnalysisDepth, string> = {
      quick: 'Perform a concise but evidence-backed research pass and keep recommendations focused.',
      standard: 'Perform moderate-depth web research with strong source triangulation.',
      deep: 'Perform deep web research and cross-validate key claims with multiple high-quality sources.',
      comprehensive: 'Perform comprehensive web research with extensive source triangulation and explicit uncertainty tracking.',
    };

    return `You are the Gemini Deep Research Agent producing a founder-grade strategy report for Glyphor.

TASK
- Query: ${query}
- Analysis Type: ${analysisType}
- Requested Depth: ${depth}

INSTRUCTIONS
- Use iterative planning, searching, and reading before concluding.
- Prioritize current and credible sources.
- If a key metric is unavailable, explicitly say unavailable; do not fabricate.
- ${depthGuidance[depth]}

REQUIRED OUTPUT FORMAT
Return ONLY valid JSON with this exact shape:
{
  "executiveSummary": "string",
  "unifiedSwot": {
    "strengths": ["string"],
    "weaknesses": ["string"],
    "opportunities": ["string"],
    "threats": ["string"]
  },
  "crossFrameworkInsights": ["string"],
  "strategicRecommendations": [
    {
      "title": "string",
      "description": "string",
      "impact": "high|medium|low",
      "feasibility": "high|medium|low",
      "owner": "string",
      "expectedOutcome": "string",
      "riskIfNot": "string"
    }
  ],
  "keyRisks": ["string"],
  "openQuestionsForFounders": ["string"]
}`;
  }

  private getGeminiApiKey(): string {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || '';
    if (!apiKey) {
      throw new Error('Missing GEMINI_API_KEY or GOOGLE_AI_API_KEY for Deep Research interactions.');
    }
    return apiKey;
  }

  private async startDeepResearchInteraction(prompt: string): Promise<string> {
    const apiKey = this.getGeminiApiKey();
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        input: prompt,
        agent: this.deepResearchAgent,
        background: true,
        store: true,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Deep Research interaction create failed (${response.status}): ${text}`);
    }

    const payload = (await response.json()) as { id?: string };
    if (!payload.id) {
      throw new Error('Deep Research interaction create returned no interaction id.');
    }
    return payload.id;
  }

  private async pollDeepResearchResult(interactionId: string): Promise<{ text: string; raw: unknown }> {
    const apiKey = this.getGeminiApiKey();
    const start = Date.now();

    while (Date.now() - start < this.deepResearchTimeoutMs) {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/interactions/${interactionId}`, {
        method: 'GET',
        headers: { 'x-goog-api-key': apiKey },
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Deep Research interaction poll failed (${response.status}): ${text}`);
      }

      const payload = (await response.json()) as {
        status?: string;
        error?: unknown;
        outputs?: Array<{ text?: string; content?: { text?: string } }>;
      };

      if (payload.status === 'completed') {
        const last = payload.outputs?.[payload.outputs.length - 1];
        const text = last?.text || last?.content?.text || '';
        if (!text) {
          throw new Error('Deep Research interaction completed without textual output.');
        }
        return { text, raw: payload };
      }

      if (payload.status === 'failed') {
        throw new Error(`Deep Research interaction failed: ${JSON.stringify(payload.error)}`);
      }

      await new Promise((resolve) => setTimeout(resolve, this.deepResearchPollMs));
    }

    throw new Error('Deep Research interaction timed out before completion.');
  }

  private parseDeepResearchSynthesis(rawText: string): SynthesisOutput {
    const empty: SynthesisOutput = {
      executiveSummary: rawText,
      unifiedSwot: { strengths: [], weaknesses: [], opportunities: [], threats: [] },
      crossFrameworkInsights: [],
      strategicRecommendations: [],
      keyRisks: [],
      openQuestionsForFounders: [],
      sourceIndex: [],
    };

    const candidates: string[] = [];
    const trimmed = rawText.trim();
    if (trimmed) candidates.push(trimmed);

    // Prefer explicit JSON code fences when present.
    const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const fencedPayload = fenced?.[1]?.trim();
    if (fencedPayload) candidates.push(fencedPayload);

    // Fallback to best-effort balanced JSON object extraction.
    const balanced = this.extractBalancedJsonObject(rawText);
    if (balanced) candidates.push(balanced);

    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate) as Partial<SynthesisOutput>;
        return this.coerceDeepResearchSynthesis(parsed, rawText);
      } catch {
        // Keep trying additional extraction candidates.
      }
    }

    return empty;
  }

  private extractBalancedJsonObject(text: string): string | null {
    const start = text.indexOf('{');
    if (start < 0) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i++) {
      const ch = text[i];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') {
        depth++;
        continue;
      }
      if (ch === '}') {
        depth--;
        if (depth === 0) {
          return text.slice(start, i + 1);
        }
      }
    }

    return null;
  }

  private coerceDeepResearchSynthesis(parsed: Partial<SynthesisOutput>, rawText: string): SynthesisOutput {
    const toStringArray = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean) : [];

    const toPriority = (value: unknown): 'high' | 'medium' | 'low' =>
      value === 'high' || value === 'medium' || value === 'low' ? value : 'medium';

    const swotRaw = parsed.unifiedSwot as Record<string, unknown> | undefined;
    const swot = {
      strengths: toStringArray(swotRaw?.strengths),
      weaknesses: toStringArray(swotRaw?.weaknesses),
      opportunities: toStringArray(swotRaw?.opportunities),
      threats: toStringArray(swotRaw?.threats),
    };

    const recommendationInput = Array.isArray(parsed.strategicRecommendations)
      ? (parsed.strategicRecommendations as unknown[])
      : [];

    const recommendations = recommendationInput.length > 0
      ? recommendationInput
          .filter((rec): rec is Record<string, unknown> => typeof rec === 'object' && rec !== null)
          .map((rec) => ({
            title: typeof rec.title === 'string' ? rec.title : '',
            description: typeof rec.description === 'string' ? rec.description : '',
            impact: toPriority(rec.impact),
            feasibility: toPriority(rec.feasibility),
            owner: typeof rec.owner === 'string' ? rec.owner : '',
            expectedOutcome: typeof rec.expectedOutcome === 'string' ? rec.expectedOutcome : '',
            riskIfNot: typeof rec.riskIfNot === 'string' ? rec.riskIfNot : '',
          }))
          .filter((rec) => rec.title || rec.description)
      : [];

    return {
      executiveSummary: typeof parsed.executiveSummary === 'string' && parsed.executiveSummary.trim().length > 0
        ? parsed.executiveSummary
        : rawText,
      unifiedSwot: swot,
      crossFrameworkInsights: toStringArray(parsed.crossFrameworkInsights),
      strategicRecommendations: recommendations,
      keyRisks: toStringArray(parsed.keyRisks),
      openQuestionsForFounders: toStringArray(parsed.openQuestionsForFounders),
      sourceIndex: [],
    };
  }

  private extractSourcesFromDeepResearchOutput(raw: unknown): StrategySource[] {
    const payload = raw as {
      outputs?: Array<{ citations?: Array<{ uri?: string; title?: string; url?: string }> }>;
    };
    const citations = payload.outputs?.flatMap((o) => o.citations || []) || [];

    const dedup = new Map<string, StrategySource>();
    for (const citation of citations) {
      const url = citation.uri || citation.url;
      if (!url || dedup.has(url)) continue;
      dedup.set(url, {
        url,
        title: citation.title || url,
        relevance: 'supporting',
      });
    }
    return Array.from(dedup.values());
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

    await systemQuery(
      'UPDATE strategy_analyses SET status=$1, synthesis=$2, completed_at=$3 WHERE id=$4',
      ['completed', JSON.stringify(synthesis), new Date().toISOString(), id],
    );
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
    const [updatedRecord] = await systemQuery<{ research_packets: Record<string, unknown> }>(
      'SELECT research_packets FROM strategy_analyses WHERE id=$1',
      [id],
    );
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

  /* ── Framework Analysis ─────────────────── */

  /**
   * Run all 6 strategic framework analyses in parallel against validated research packets.
   * Framework agents consume research data only — no web searches.
   * Returns structured framework outputs + convergence narrative.
   */
  private async runFrameworkAnalysis(
    id: string,
    query: string,
    researchPackets: Record<string, unknown>,
  ): Promise<{ frameworkOutputs: Record<string, unknown>; convergenceNarrative: string }> {
    const frameworkIds = Object.keys(FRAMEWORK_CONFIGS) as FrameworkId[];

    // Initialize framework progress tracking
    const frameworkProgress: FrameworkProgress[] = frameworkIds.map((fId) => ({
      frameworkId: fId,
      frameworkName: FRAMEWORK_CONFIGS[fId].name,
      status: 'pending' as const,
    }));

    await systemQuery(
      'UPDATE strategy_analyses SET framework_progress=$1 WHERE id=$2',
      [JSON.stringify(frameworkProgress), id],
    );

    // Extract target name from query for framework prompts
    const target = query;

    // Run all 6 frameworks in parallel
    const frameworkOutputs: Record<string, unknown> = {};

    const results = await Promise.allSettled(
      frameworkIds.map(async (frameworkId, i) => {
        // Mark running
        frameworkProgress[i].status = 'running';
        frameworkProgress[i].startedAt = new Date().toISOString();
        await systemQuery(
          'UPDATE strategy_analyses SET framework_progress=$1 WHERE id=$2',
          [JSON.stringify(frameworkProgress), id],
        );

        const prompt = buildFrameworkPrompt(frameworkId, target, researchPackets);
        const startMs = Date.now();

        const response = await this.modelClient.generate({
          model: this.model,
          systemInstruction: `You are a strategic framework analyst. Analyze the research data and produce structured analysis. Output ONLY valid JSON — no markdown fences, no preamble.`,
          contents: [{ role: 'user', content: prompt, timestamp: Date.now() }],
          temperature: 0.2,
        });

        const output = response.text ?? '';
        let analysis: Record<string, unknown> = {};
        const jsonMatch = output.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try { analysis = JSON.parse(jsonMatch[0]); } catch { analysis = { rawOutput: output }; }
        } else {
          analysis = { rawOutput: output };
        }

        frameworkOutputs[frameworkId] = analysis;

        // Mark completed
        frameworkProgress[i].status = 'completed';
        frameworkProgress[i].completedAt = new Date().toISOString();
        await systemQuery(
          'UPDATE strategy_analyses SET framework_progress=$1, framework_outputs=$2 WHERE id=$3',
          [JSON.stringify(frameworkProgress), JSON.stringify(frameworkOutputs), id],
        );

        return { frameworkId, analysis, duration: Date.now() - startMs };
      }),
    );

    // Mark failed frameworks
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        frameworkProgress[i].status = 'failed';
        frameworkProgress[i].error = r.reason?.message ?? String(r.reason);
      }
    });

    await systemQuery(
      'UPDATE strategy_analyses SET framework_progress=$1, framework_outputs=$2 WHERE id=$3',
      [JSON.stringify(frameworkProgress), JSON.stringify(frameworkOutputs), id],
    );

    // Generate convergence narrative (includes consistency check results)
    let convergenceNarrative = '';
    if (Object.keys(frameworkOutputs).length >= 3) {
      const consistencyReport = await this.validateFrameworkConsistency(frameworkOutputs);
      convergenceNarrative = await this.generateConvergenceNarrative(id, target, frameworkOutputs, consistencyReport);
    }

    return { frameworkOutputs, convergenceNarrative };
  }

  /**
   * Validate consistency across framework outputs.
   * Cross-checks: BCG Stars ↔ SWOT Strengths, Porter's threats ↔ SWOT Threats,
   * Ansoff primary quadrant ↔ strategic direction, PESTLE favorable ↔ Blue Ocean spaces.
   */
  private async validateFrameworkConsistency(
    frameworkOutputs: Record<string, unknown>,
  ): Promise<string> {
    const prompt = `You are a senior strategy consultant reviewing 6 framework analyses for internal consistency. Cross-check these frameworks against each other and identify alignments and contradictions.

FRAMEWORK OUTPUTS:
${JSON.stringify(frameworkOutputs, null, 2)}

Perform these specific consistency checks:

1. BCG Stars ↔ SWOT Strengths: Do the "Star" products/segments align with identified strengths? Are any Stars not supported by strengths?
2. Porter's high-force threats ↔ SWOT Threats: Do Porter's Five Forces high-intensity forces appear as SWOT threats? Are there threats in SWOT not covered by Porter's?
3. Ansoff primary quadrant ↔ Strategic Direction: Does the recommended Ansoff quadrant align with the overall strategic direction from other frameworks?
4. PESTLE favorable dimensions ↔ Blue Ocean spaces: Do favorable PESTLE factors support identified Blue Ocean opportunities? Are there Blue Ocean recommendations in unfavorable PESTLE environments?
5. SWOT Opportunities ↔ Ansoff growth vectors: Are SWOT opportunities consistent with Ansoff growth recommendations?
6. BCG resource allocation ↔ SWOT feasibility: Do BCG investment recommendations align with resource constraints identified elsewhere?

For each check, report:
- alignment_score: 0-10 (10 = perfectly aligned)
- findings: specific alignment or contradiction details
- implications: what the alignment/contradiction means for strategy

Also provide:
- overall_consistency_score: 0-10
- critical_contradictions: any contradictions that need resolution before acting on recommendations
- reinforced_themes: themes that multiple frameworks consistently support

Return valid JSON: { "checks": [...], "overall_consistency_score": N, "critical_contradictions": [...], "reinforced_themes": [...] }`;

    const response = await this.modelClient.generate({
      model: this.model,
      systemInstruction: 'Perform framework consistency validation. Output ONLY valid JSON.',
      contents: [{ role: 'user', content: prompt, timestamp: Date.now() }],
      temperature: 0.1,
    });

    return response.text ?? '';
  }

  /**
   * Generate the Framework Convergence Narrative — the highest-value output
   * of the framework phase. Identifies where frameworks agree, diverge,
   * and what the combined picture says about strategic position.
   */
  private async generateConvergenceNarrative(
    id: string,
    target: string,
    frameworkOutputs: Record<string, unknown>,
    consistencyReport?: string,
  ): Promise<string> {
    let prompt = buildConvergencePrompt(frameworkOutputs, target);
    if (consistencyReport) {
      prompt += `\n\nFRAMEWORK CONSISTENCY CHECK RESULTS:\n${consistencyReport}\n\nIncorporate these consistency findings into your convergence narrative. Note where frameworks align, where they conflict, and what the conflicts suggest about strategic ambiguity.`;
    }

    const response = await this.modelClient.generate({
      model: this.model,
      systemInstruction: 'Produce a senior-level strategic convergence narrative. Output ONLY valid JSON — no markdown fences.',
      contents: [{ role: 'user', content: prompt, timestamp: Date.now() }],
      temperature: 0.3,
    });

    const text = response.text ?? '';
    let narrative = '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        narrative = parsed.narrative || text;
      } catch {
        narrative = text;
      }
    } else {
      narrative = text;
    }

    await systemQuery(
      'UPDATE strategy_analyses SET framework_convergence=$1 WHERE id=$2',
      [narrative, id],
    );

    return narrative;
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
    const fields = ['status'];
    const values: unknown[] = [status];
    let paramIdx = 2;
    if (extra) {
      for (const [key, value] of Object.entries(extra)) {
        fields.push(key);
        values.push(value);
        paramIdx++;
      }
    }
    const setClause = fields.map((f, i) => `${f}=$${i + 1}`).join(', ');
    values.push(id);
    await systemQuery(`UPDATE strategy_analyses SET ${setClause} WHERE id=$${paramIdx}`, values);
  }

  /* ── Watchlist Extraction ───────────────── */

  private async extractAndStoreWatchlist(
    id: string,
    sourceType: 'strategy_analysis' | 'deep_dive',
    synthesis: SynthesisOutput | null,
    frameworkOutputs: Record<string, unknown>,
    executiveOutputs: Record<string, ExecutiveAnalysisOutput>,
  ): Promise<WatchlistItem[]> {
    const prompt = `You are an expert strategic analyst. Review the following analysis outputs and extract items that should be monitored on an ongoing basis.

SYNTHESIS:
${JSON.stringify(synthesis, null, 2)}

FRAMEWORK OUTPUTS:
${JSON.stringify(frameworkOutputs, null, 2)}

EXECUTIVE ANALYSES:
${JSON.stringify(executiveOutputs, null, 2)}

Extract monitoring watchlist items. Focus on:
1. RISKS — threats that could materialize (from risk assessment, SWOT threats, Porter's forces)
2. CATALYSTS — potential positive triggers (from opportunities, Blue Ocean spaces, Ansoff growth vectors)
3. TRANSACTIONS — pending M&A, partnerships, or deals that could shift dynamics
4. LEADERSHIP — key person changes, succession risks, executive moves
5. REGULATORY — upcoming regulations, policy changes, compliance deadlines

For each item, provide:
- item: concise description (one sentence)
- category: "risk" | "catalyst" | "transaction" | "leadership" | "regulatory"
- source_packet: which analysis area this came from
- trigger_signals: array of specific observable signals that would indicate this item is materializing
- current_status: current state of this item
- priority: "high" | "medium" | "low"

Return JSON: { "watchlist": [...] }
Extract 5-15 items. Focus on actionable, monitorable items — not vague concerns.`;

    const response = await this.modelClient.generate({
      model: this.model,
      systemInstruction: 'Extract monitoring watchlist items from strategic analysis. Output ONLY valid JSON.',
      contents: [{ role: 'user', content: prompt, timestamp: Date.now() }],
      temperature: 0.1,
    });

    const text = response.text ?? '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return [];

    try {
      const parsed = JSON.parse(match[0]);
      const items: WatchlistItem[] = (parsed.watchlist || []).map((w: Record<string, unknown>) => ({
        item: w.item || '',
        category: w.category || 'risk',
        source_packet: w.source_packet || '',
        trigger_signals: Array.isArray(w.trigger_signals) ? w.trigger_signals : [],
        current_status: w.current_status || '',
        last_updated: new Date().toISOString(),
        priority: w.priority || 'medium',
      }));

      const tableName = sourceType === 'strategy_analysis' ? 'strategy_analysis_watchlist' : 'deep_dive_watchlist';
      const fkColumn = sourceType === 'strategy_analysis' ? 'strategy_analysis_id' : 'deep_dive_id';

      if (items.length > 0) {
        for (const item of items) {
          await systemQuery(
            `INSERT INTO ${tableName} (${fkColumn}, item, category, trigger_signals, current_status, priority, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [id, item.item, item.category, JSON.stringify(item.trigger_signals), item.current_status, item.priority, new Date().toISOString()],
          );
        }
      }

      return items;
    } catch {
      return [];
    }
  }
}
