/**
 * Glyphor Strategic Deep Dive Engine
 *
 * A multi-phase research engine that produces executive-grade strategic analyses
 * with cross-model verification for maximum accuracy. Unlike the standard
 * AnalysisEngine (which asks LLMs to opine), this engine:
 *
 *   1. SCOPE   — Identify the target, build an issue tree, define research questions
 *   2. RESEARCH — Execute real web searches per research area in parallel
 *   3. ANALYZE  — Run specialist agents over search-enriched context
 *   4. VERIFY   — Cross-model evaluation of each research area's findings
 *   5. SYNTHESIZE — Produce a structured strategic deliverable with all sections
 *
 * The output is a tabbed report: Current State, Overview, Market Analysis,
 * Competitive Landscape, Strategic Recommendations, Implementation Path,
 * ROI Analysis, Risk Assessment — each backed by cited, cross-verified evidence.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ModelClient } from '@glyphor/agent-runtime';
import { searchWeb, searchNews, batchSearch, searchResultsToContext } from '@glyphor/integrations';

/* ── Cross-model verification config ──────── */

const VERIFICATION_MODELS = ['gemini-3-flash-preview', 'gpt-4.1-mini'] as const;
const VERIFICATION_CONFIDENCE_THRESHOLD = 0.7;

/**
 * Multi-agent research model assignments — each research area gets a different
 * primary model to ensure diverse perspectives and reduce single-model bias.
 * A second model challenges each area's findings.
 */
const RESEARCH_MODELS: Record<string, string> = {
  overview:    'gemini-3-flash-preview',
  financials:  'gpt-4.1-mini',
  technology:  'gemini-3-flash-preview',
  market:      'gpt-4.1-mini',
  competitive: 'gemini-3-flash-preview',
  leadership:  'gpt-4.1-mini',
  customers:   'gemini-3-flash-preview',
  risks:       'gpt-4.1-mini',
};

/** The challenger model critiques work done by the primary */
function getChallengerModel(primary: string): string {
  return primary === 'gemini-3-flash-preview' ? 'gpt-4.1-mini' : 'gemini-3-flash-preview';
}

/* ── Types ──────────────────────────────────── */

export type DeepDiveStatus =
  | 'scoping'
  | 'researching'
  | 'analyzing'
  | 'synthesizing'
  | 'completed'
  | 'failed';

export interface DeepDiveRequest {
  target: string;         // Company name, market, or topic
  context?: string;       // Optional additional context
  requestedBy: string;
}

export interface ResearchArea {
  id: string;
  label: string;
  perspective: string;
  searchQueries: string[];
  status: 'pending' | 'searching' | 'analyzing' | 'completed' | 'failed';
  sourcesFound: number;
  analysis?: string;
}

export interface Source {
  title: string;
  url?: string;
  type: 'web' | 'news' | 'sec' | 'patent' | 'report';
  snippet?: string;
  date?: string;
}

export interface FinancialSnapshot {
  revenue?: string;
  revenueGrowth?: string;
  headcount?: string;
  funding?: string;
  valuation?: string;
  profitability?: string;
}

export interface CurrentState {
  momentum: 'positive' | 'neutral' | 'negative';
  keyStrengths: { point: string; evidence: string }[];
  keyChallenges: { point: string; evidence: string }[];
  financialSnapshot: FinancialSnapshot;
}

export interface CompanyOverview {
  description: string;
  industry: string;
  founded?: string;
  headquarters?: string;
  leadership: { name: string; title: string }[];
  products: { name: string; description: string }[];
  businessModel: string;
}

export interface MarketAnalysis {
  tam: { value: string; methodology: string };
  sam: { value: string; methodology: string };
  som: { value: string; methodology: string };
  growthRate: string;
  keyDrivers: string[];
  keyTrends: string[];
  regulatoryFactors: string[];
}

export interface PorterForce {
  score: number;      // 1-5
  reasoning: string;
}

export interface Competitor {
  name: string;
  positioning: string;
  strengths: string[];
  weaknesses: string[];
  estimatedRevenue?: string;
  keyDifferentiator: string;
}

export interface CompetitiveLandscape {
  portersFiveForces: {
    threatOfNewEntrants: PorterForce;
    bargainingPowerBuyers: PorterForce;
    bargainingPowerSuppliers: PorterForce;
    threatOfSubstitutes: PorterForce;
    competitiveRivalry: PorterForce;
  };
  competitors: Competitor[];
  competitiveAdvantage: string;
}

export interface StrategicRecommendation {
  title: string;
  priority: 'immediate' | 'short-term' | 'medium-term';
  description: string;
  expectedImpact: string;
  investmentRequired: string;
  riskLevel: 'low' | 'medium' | 'high';
  implementationSteps: string[];
}

export interface RoadmapPhase {
  phase: string;
  timeline: string;
  milestones: string[];
  resources: string;
  cost: string;
}

export interface RoiScenario {
  scenario: 'conservative' | 'base' | 'optimistic';
  projections: { year: number; revenue: string; cost: string; netBenefit: string }[];
  paybackPeriod: string;
  irr?: string;
  npv?: string;
}

export interface RiskItem {
  risk: string;
  probability: 'low' | 'medium' | 'high';
  impact: 'low' | 'medium' | 'high';
  mitigation: string;
  owner: string;
}

export interface SourceCitation {
  id: number;            // [1], [2], etc. for in-text references
  title: string;
  url?: string;
  type: 'web' | 'news' | 'sec' | 'patent' | 'report';
  snippet?: string;
  date?: string;
}

export interface VerificationSummary {
  overallConfidence: number;        // 0.0-1.0
  areasVerified: number;
  flaggedClaims: string[];
  correctionsMade: string[];
  modelsUsed: string[];
}

export interface DeepDiveReport {
  targetName: string;
  targetType: string;             // 'Public Company' | 'Private Company' | 'Market' | 'Topic'
  analysisDate: string;
  documentCounts: {
    secFilings: number;
    newsArticles: number;
    patents: number;
    researchSources: number;
  };
  currentState: CurrentState;
  overview: CompanyOverview;
  marketAnalysis: MarketAnalysis;
  competitiveLandscape: CompetitiveLandscape;
  strategicRecommendations: StrategicRecommendation[];
  implementationRoadmap: RoadmapPhase[];
  roiAnalysis: RoiScenario[];
  riskAssessment: RiskItem[];
  sourceCitations: SourceCitation[];
  verificationSummary: VerificationSummary;
}

export interface DeepDiveRecord {
  id: string;
  target: string;
  context: string | null;
  status: DeepDiveStatus;
  requested_by: string;
  research_areas: ResearchArea[];
  sources: Source[];
  report: DeepDiveReport | null;
  created_at: string;
  completed_at: string | null;
  error: string | null;
}

/* ── Research Area Definitions ──────────────── */

function buildResearchAreas(target: string): ResearchArea[] {
  return [
    {
      id: 'overview',
      label: 'Company Overview & History',
      perspective: 'chief-of-staff',
      searchQueries: [
        `${target} company overview history founded`,
        `${target} leadership team CEO executives board`,
        `${target} products services business model`,
        `${target} company mission vision strategy`,
        `${target} recent announcements milestones 2024 2025`,
      ],
      status: 'pending',
      sourcesFound: 0,
    },
    {
      id: 'financials',
      label: 'Financial Performance',
      perspective: 'cfo',
      searchQueries: [
        `${target} revenue growth funding valuation`,
        `${target} financial performance earnings quarterly`,
        `${target} investors funding rounds series`,
        `${target} profitability margins unit economics`,
        `${target} financial outlook analyst estimates`,
      ],
      status: 'pending',
      sourcesFound: 0,
    },
    {
      id: 'technology',
      label: 'Products & Technology',
      perspective: 'cto',
      searchQueries: [
        `${target} technology stack platform architecture`,
        `${target} patents intellectual property innovations`,
        `${target} product features capabilities roadmap`,
        `${target} API developer ecosystem integrations`,
        `${target} engineering team technical blog infrastructure`,
      ],
      status: 'pending',
      sourcesFound: 0,
    },
    {
      id: 'market',
      label: 'Market & Industry',
      perspective: 'cmo',
      searchQueries: [
        `${target} market size TAM industry forecast`,
        `${target} industry trends growth drivers CAGR`,
        `${target} market positioning target segment`,
        `${target} addressable market opportunity expansion`,
        `${target} industry report analyst forecast`,
      ],
      status: 'pending',
      sourcesFound: 0,
    },
    {
      id: 'competitive',
      label: 'Competitive Landscape',
      perspective: 'competitive-intel',
      searchQueries: [
        `${target} competitors competitive analysis`,
        `${target} vs alternatives comparison review`,
        `${target} market share competitive position ranking`,
        `${target} competitive advantages moat differentiation`,
        `${target} competitor funding revenue comparison`,
      ],
      status: 'pending',
      sourcesFound: 0,
    },
    {
      id: 'leadership',
      label: 'Leadership & Culture',
      perspective: 'vp-customer-success',
      searchQueries: [
        `${target} company culture glassdoor reviews workplace`,
        `${target} leadership team management changes CEO`,
        `${target} hiring headcount growth layoffs`,
        `${target} executive appointments departures reorganization`,
        `${target} diversity inclusion employee satisfaction`,
      ],
      status: 'pending',
      sourcesFound: 0,
    },
    {
      id: 'customers',
      label: 'Customers & Go-to-Market',
      perspective: 'vp-sales',
      searchQueries: [
        `${target} customers case studies testimonials`,
        `${target} pricing plans tiers enterprise`,
        `${target} sales go-to-market distribution channels`,
        `${target} customer acquisition retention churn NPS`,
        `${target} partnerships strategic alliances channels`,
      ],
      status: 'pending',
      sourcesFound: 0,
    },
    {
      id: 'risks',
      label: 'Risks & Regulatory',
      perspective: 'ops',
      searchQueries: [
        `${target} risks lawsuits regulatory issues`,
        `${target} challenges controversy problems`,
        `${target} industry regulation compliance requirements`,
        `${target} cybersecurity data privacy incidents`,
        `${target} geopolitical supply chain risks vulnerabilities`,
      ],
      status: 'pending',
      sourcesFound: 0,
    },
  ];
}

/* ── Engine ─────────────────────────────────── */

export class DeepDiveEngine {
  constructor(
    private supabase: SupabaseClient,
    private modelClient: ModelClient,
    private model = 'gemini-3-flash-preview',
  ) {}

  /** Launch a deep dive. Returns the record ID. */
  async launch(req: DeepDiveRequest): Promise<string> {
    const id = `deepdive-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const researchAreas = buildResearchAreas(req.target);

    const record: DeepDiveRecord = {
      id,
      target: req.target,
      context: req.context ?? null,
      status: 'scoping',
      requested_by: req.requestedBy,
      research_areas: researchAreas,
      sources: [],
      report: null,
      created_at: new Date().toISOString(),
      completed_at: null,
      error: null,
    };

    await this.supabase.from('deep_dives').insert(record);

    // Run all phases inline
    this.runPhases(id, req, researchAreas).catch((err) => {
      console.error(`[DeepDiveEngine] Fatal error in ${id}:`, err);
      this.supabase.from('deep_dives').update({
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      }).eq('id', id);
    });

    return id;
  }

  async get(id: string): Promise<DeepDiveRecord | null> {
    const { data } = await this.supabase
      .from('deep_dives')
      .select('*')
      .eq('id', id)
      .single();
    return data as DeepDiveRecord | null;
  }

  async list(limit = 20): Promise<DeepDiveRecord[]> {
    const { data } = await this.supabase
      .from('deep_dives')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    return (data as DeepDiveRecord[]) ?? [];
  }

  async cancel(id: string): Promise<void> {
    await this.supabase.from('deep_dives').update({
      status: 'failed',
      error: 'Cancelled by user.',
    }).eq('id', id);
  }

  /* ── Phase Runner ───────────────────────── */

  private async runPhases(
    id: string,
    req: DeepDiveRequest,
    areas: ResearchArea[],
  ): Promise<void> {
    const allSources: Source[] = [];

    // ── Phase 1: RESEARCH — web search all areas in parallel (expanded) ──
    await this.updateStatus(id, 'researching');

    const searchResults = await Promise.allSettled(
      areas.map(async (area) => {
        area.status = 'searching';
        await this.updateAreas(id, areas);

        // Run web searches for this area — 5 queries × 10 results each
        const webResults = await batchSearch(area.searchQueries, { num: 10 });

        // Also search news for this area (2 news queries for depth)
        const newsResults = await searchNews(`${req.target} ${area.label}`, { num: 8 });

        const areaContext = searchResultsToContext(webResults);
        const newsSummary = newsResults.map((n) =>
          `- **${n.title}** (${n.source}, ${n.date}) — ${n.snippet}`,
        ).join('\n');

        // Track sources
        const webSources: Source[] = webResults.flatMap((b) =>
          b.results.map((r) => ({
            title: r.title,
            url: r.url,
            type: 'web' as const,
            snippet: r.snippet,
            date: r.date,
          })),
        );
        const newsSources: Source[] = newsResults.map((n) => ({
          title: n.title,
          url: n.url,
          type: 'news' as const,
          snippet: n.snippet,
          date: n.date,
        }));

        area.sourcesFound = webSources.length + newsSources.length;
        allSources.push(...webSources, ...newsSources);

        return { area, context: areaContext, news: newsSummary };
      }),
    );

    // ── Phase 2: ANALYZE — multi-model specialist analysis per area ──
    await this.updateStatus(id, 'analyzing');

    const areaAnalyses = new Map<string, { analysis: string; model: string }>();

    const analysisResults = await Promise.allSettled(
      searchResults.map(async (sr, i) => {
        if (sr.status === 'rejected') {
          areas[i].status = 'failed';
          areas[i].analysis = `Research failed: ${sr.reason?.message ?? String(sr.reason)}`;
          return;
        }

        const { area, context, news } = sr.value;
        area.status = 'analyzing';
        await this.updateAreas(id, areas);

        // Use area-specific model for diverse perspectives
        const primaryModel = RESEARCH_MODELS[area.id] ?? this.model;

        const analysisPrompt = [
          `You are a senior strategic consultant at Glyphor analyzing "${req.target}" from the perspective of ${area.label}.`,
          req.context ? `Additional context: ${req.context}` : '',
          ``,
          `Below are real search results gathered from the web. Use ONLY this data to form your analysis.`,
          `Mark any claims that aren't directly supported by the sources as [ESTIMATED].`,
          `When citing specific facts, reference the source like [Source: "article title"].`,
          ``,
          `## Web Search Results`,
          context || 'No web results found.',
          ``,
          `## Recent News`,
          news || 'No recent news found.',
          ``,
          `Provide a thorough, data-backed analysis covering:`,
          `1. Key findings with specific data points and evidence — CITE YOUR SOURCES for every fact`,
          `2. Notable trends or patterns — with supporting data`,
          `3. Gaps in available data — be explicit about what you couldn't find`,
          `4. Implications for strategic positioning — with evidence`,
          `5. Contradictions or uncertainties across sources`,
          `6. Quantitative data points (revenue, growth %, market size, headcount, etc.)`,
          ``,
          `Be specific. Quote numbers, dates, and sources. Don't hedge — if data is limited, say so explicitly.`,
          `This analysis should be at least 800 words with detailed evidence.`,
        ].join('\n');

        const response = await this.modelClient.generate({
          model: primaryModel,
          systemInstruction: `You are a senior strategic consultant producing research-grade analysis. Be precise, data-driven, and cite your sources. No filler or corporate boilerplate. Produce detailed, evidence-rich prose.`,
          contents: [{ role: 'user', content: analysisPrompt, timestamp: Date.now() }],
          temperature: 0.3,
        });

        area.analysis = response.text ?? 'No analysis produced.';
        area.status = 'completed';
        areaAnalyses.set(area.id, { analysis: area.analysis, model: primaryModel });
      }),
    );

    await this.updateAreas(id, areas);

    // ── Phase 2b: CHALLENGE — second model critiques each area (multi-agent) ──
    const challengeResults = new Map<string, string>();

    const completedAreas = areas.filter((a) => a.status === 'completed' && a.analysis);

    await Promise.allSettled(
      completedAreas.map(async (area) => {
        const primary = areaAnalyses.get(area.id);
        if (!primary) return;

        const challengerModel = getChallengerModel(primary.model);

        const challengePrompt = [
          `A colleague produced the following research analysis on "${req.target}" (${area.label}).`,
          `Your job is to critically evaluate it: identify gaps, unsupported claims, missing data,`,
          `alternative interpretations, and areas that need deeper investigation.`,
          ``,
          `== ANALYSIS TO CHALLENGE ==`,
          primary.analysis,
          ``,
          `Respond with:`,
          `1. STRENGTHS: What's well-supported and accurate`,
          `2. GAPS: What important data or perspectives are missing`,
          `3. CHALLENGES: Claims that may be wrong or oversimplified`,
          `4. ADDITIONAL INSIGHTS: What the analyst missed or should have included`,
          `5. REVISED CONCLUSIONS: Your refined view incorporating all of the above`,
          ``,
          `Be rigorous. Challenge assumptions. Provide alternative data interpretations.`,
        ].join('\n');

        const response = await this.modelClient.generate({
          model: challengerModel,
          systemInstruction: 'You are a devil\'s advocate analyst. Rigorously challenge research findings. Identify what\'s missing, wrong, or oversimplified.',
          contents: [{ role: 'user', content: challengePrompt, timestamp: Date.now() }],
          temperature: 0.3,
        });

        challengeResults.set(area.id, response.text ?? '');
      }),
    );

    // Merge challenge insights back into area analyses
    for (const area of completedAreas) {
      const challenge = challengeResults.get(area.id);
      if (challenge) {
        area.analysis = `${area.analysis}\n\n--- CROSS-MODEL CHALLENGE (${getChallengerModel(areaAnalyses.get(area.id)?.model ?? this.model)}) ---\n${challenge}`;
      }
    }

    await this.updateAreas(id, areas);

    // Deduplicate sources by URL
    const seenUrls = new Set<string>();
    const dedupedSources = allSources.filter((s) => {
      if (!s.url) return true;
      if (seenUrls.has(s.url)) return false;
      seenUrls.add(s.url);
      return true;
    });

    await this.supabase.from('deep_dives').update({ sources: dedupedSources }).eq('id', id);

    // Check that at least some areas completed
    if (completedAreas.length === 0) {
      await this.supabase.from('deep_dives').update({
        status: 'failed',
        error: 'All research areas failed. Check API keys and search availability.',
      }).eq('id', id);
      return;
    }

    // ── Phase 3: VERIFY — cross-model evaluation of area analyses ──
    const verificationResults = await this.crossModelVerify(req, completedAreas);

    // ── Phase 3b: RE-RESEARCH — deepen areas with low verification confidence ──
    const lowConfidenceAreas = completedAreas.filter((a) => {
      const v = verificationResults.get(a.id);
      return v && v.confidence < VERIFICATION_CONFIDENCE_THRESHOLD;
    });

    if (lowConfidenceAreas.length > 0) {
      // Do follow-up searches on flagged areas to fill gaps
      const followUpResults = await Promise.allSettled(
        lowConfidenceAreas.map(async (area) => {
          const verification = verificationResults.get(area.id)!;
          const gapQueries = verification.issues.slice(0, 3).map(
            (issue) => `${req.target} ${issue}`,
          );
          if (gapQueries.length === 0) return;

          const extraResults = await batchSearch(gapQueries, { num: 8 });
          const extraContext = searchResultsToContext(extraResults);

          // Track new sources
          const extraSources: Source[] = extraResults.flatMap((b) =>
            b.results.map((r) => ({
              title: r.title,
              url: r.url,
              type: 'web' as const,
              snippet: r.snippet,
              date: r.date,
            })),
          );
          allSources.push(...extraSources);

          // Re-analyze with additional context
          const challengerModel = getChallengerModel(RESEARCH_MODELS[area.id] ?? this.model);
          const reAnalyzePrompt = [
            `You previously analyzed "${req.target}" (${area.label}) but the verification flagged these issues:`,
            ...verification.issues.map((i) => `- ${i}`),
            ``,
            `Here is additional research to address those gaps:`,
            extraContext || 'No additional results found.',
            ``,
            `Provide a supplementary analysis addressing ONLY the flagged issues, with new evidence.`,
            `Cite all sources.`,
          ].join('\n');

          const response = await this.modelClient.generate({
            model: challengerModel,
            systemInstruction: 'Produce precise, evidence-backed supplementary analysis to fill research gaps.',
            contents: [{ role: 'user', content: reAnalyzePrompt, timestamp: Date.now() }],
            temperature: 0.3,
          });

          area.analysis += `\n\n--- SUPPLEMENTARY ANALYSIS (gap-fill) ---\n${response.text ?? ''}`;
          area.sourcesFound += extraSources.length;
        }),
      );

      // Re-deduplicate sources
      const reseenUrls = new Set<string>();
      const rededupedSources = allSources.filter((s) => {
        if (!s.url) return true;
        if (reseenUrls.has(s.url)) return false;
        reseenUrls.add(s.url);
        return true;
      });
      dedupedSources.length = 0;
      dedupedSources.push(...rededupedSources);
      await this.supabase.from('deep_dives').update({ sources: dedupedSources, research_areas: areas }).eq('id', id);
    }

    // ── Phase 4: SYNTHESIZE — produce the full strategic report ──
    await this.updateStatus(id, 'synthesizing');
    const report = await this.synthesize(req, areas, dedupedSources, verificationResults);

    await this.supabase.from('deep_dives').update({
      status: 'completed',
      report,
      sources: dedupedSources,
      research_areas: areas,
      completed_at: new Date().toISOString(),
    }).eq('id', id);

    await this.supabase.from('activity_log').insert({
      agent_id: 'system',
      action: 'deep_dive.completed',
      detail: `Strategic deep dive completed for "${req.target}": ${completedAreas.length}/${areas.length} areas researched, ${dedupedSources.length} sources analyzed, cross-model verified with challenge rounds`,
      created_at: new Date().toISOString(),
    });
  }

  /* ── Cross-Model Verification ─────────────── */

  private async crossModelVerify(
    req: DeepDiveRequest,
    completedAreas: ResearchArea[],
  ): Promise<Map<string, { confidence: number; issues: string[]; corrections: string[] }>> {
    const results = new Map<string, { confidence: number; issues: string[]; corrections: string[] }>();

    // Use a different model than the primary to verify each area's analysis
    const verifyModel = VERIFICATION_MODELS.find(m => m !== this.model) ?? VERIFICATION_MODELS[0];

    const verifications = await Promise.allSettled(
      completedAreas.map(async (area) => {
        const verifyPrompt = [
          `You are an independent verification analyst. A colleague produced the following research analysis on "${req.target}" (${area.label}).`,
          `Your job is to identify factual errors, unsupported claims, logical gaps, and biases.`,
          ``,
          `== ANALYSIS TO VERIFY ==`,
          area.analysis ?? '',
          ``,
          `Respond ONLY with valid JSON (no markdown fences):`,
          `{`,
          `  "confidence": <0.0-1.0 overall quality score>,`,
          `  "issues": ["<factual error or unsupported claim>", ...],`,
          `  "corrections": ["<suggested correction or nuance>", ...]`,
          `}`,
        ].join('\n');

        const response = await this.modelClient.generate({
          model: verifyModel,
          systemInstruction: 'You are a JSON-only verification engine. Evaluate research quality rigorously. Always respond with valid JSON.',
          contents: [{ role: 'user', content: verifyPrompt, timestamp: Date.now() }],
          temperature: 0.1,
        });

        const output = response.text ?? '';
        const jsonMatch = output.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return {
            areaId: area.id,
            confidence: Math.max(0, Math.min(1, parsed.confidence ?? 0.5)),
            issues: parsed.issues ?? [],
            corrections: parsed.corrections ?? [],
          };
        }
        return { areaId: area.id, confidence: 0.5, issues: ['Failed to parse verification'], corrections: [] };
      }),
    );

    for (const v of verifications) {
      if (v.status === 'fulfilled') {
        results.set(v.value.areaId, v.value);
      }
    }

    return results;
  }

  /* ── Synthesis — Produce the Full Report ──── */

  private async synthesize(
    req: DeepDiveRequest,
    areas: ResearchArea[],
    sources: Source[],
    verificationResults?: Map<string, { confidence: number; issues: string[]; corrections: string[] }>,
  ): Promise<DeepDiveReport> {
    const completedAreas = areas.filter((a) => a.status === 'completed' && a.analysis);

    // Build numbered source list for citation references
    const numberedSources = sources.slice(0, 60).map((s, i) => ({
      id: i + 1,
      title: s.title,
      url: s.url,
      type: s.type,
      snippet: s.snippet,
      date: s.date,
    }));
    const sourceIndex = numberedSources.map((s) =>
      `[${s.id}] ${s.title} (${s.type}${s.url ? `, ${s.url}` : ''})`,
    ).join('\n');

    // Build verification summary
    const verificationSummary: VerificationSummary = {
      overallConfidence: 0,
      areasVerified: 0,
      flaggedClaims: [],
      correctionsMade: [],
      modelsUsed: [...new Set(Object.values(RESEARCH_MODELS))],
    };
    if (verificationResults) {
      const confidences: number[] = [];
      for (const [, v] of verificationResults) {
        confidences.push(v.confidence);
        verificationSummary.areasVerified++;
        verificationSummary.flaggedClaims.push(...v.issues.slice(0, 3));
        verificationSummary.correctionsMade.push(...v.corrections.slice(0, 3));
      }
      verificationSummary.overallConfidence = confidences.length > 0
        ? confidences.reduce((a, b) => a + b, 0) / confidences.length
        : 0;
    }

    const researchContext = completedAreas.map((a) => {
      const verification = verificationResults?.get(a.id);
      const verifyNote = verification
        ? `\n[Cross-Model Verification: confidence=${verification.confidence.toFixed(2)}${verification.issues.length > 0 ? `, issues: ${verification.issues.join('; ')}` : ''}${verification.corrections.length > 0 ? `, corrections: ${verification.corrections.join('; ')}` : ''}]`
        : '';
      return `=== ${a.label.toUpperCase()} (${a.perspective}) ===\n${a.analysis}${verifyNote}\n`;
    }).join('\n');

    const sourceCounts = {
      secFilings: sources.filter((s) => s.type === 'sec').length,
      newsArticles: sources.filter((s) => s.type === 'news').length,
      patents: sources.filter((s) => s.type === 'patent').length,
      researchSources: sources.filter((s) => s.type === 'web' || s.type === 'report').length,
    };

    const synthesisPrompt = [
      `You are a senior strategist at Glyphor's Strategy Lab producing a comprehensive strategic deep dive on "${req.target}".`,
      req.context ? `Additional context: ${req.context}` : '',
      ``,
      `Below is research gathered by your multi-agent specialist team (using both Gemini and GPT models for diverse perspectives), including challenge critiques and supplementary gap-fill research. Synthesize ALL findings into a single structured report.`,
      ``,
      `IMPORTANT: Each research area includes [Cross-Model Verification] notes from an independent AI reviewer, plus a CROSS-MODEL CHALLENGE section from a second AI. Use these to:`,
      `- Discard or qualify any claims flagged as unsupported`,
      `- Incorporate suggested corrections into your synthesis`,
      `- Weight higher-confidence research areas more heavily`,
      `- Be explicit about confidence levels — distinguish verified facts from estimates`,
      ``,
      `== SOURCE INDEX (cite these by number, e.g. [1], [2]) ==`,
      sourceIndex,
      ``,
      `== RESEARCH FROM SPECIALIST AGENTS ==`,
      researchContext,
      ``,
      `Respond ONLY with valid JSON (no markdown fences, no commentary) matching this exact schema:`,
      `{`,
      `  "targetName": "Official company/topic name",`,
      `  "targetType": "Public Company" | "Private Company" | "Market" | "Topic",`,
      `  "currentState": {`,
      `    "momentum": "positive" | "neutral" | "negative",`,
      `    "keyStrengths": [{ "point": "...", "evidence": "..." }],`,
      `    "keyChallenges": [{ "point": "...", "evidence": "..." }],`,
      `    "financialSnapshot": {`,
      `      "revenue": "e.g. $2.1B (2025)",`,
      `      "revenueGrowth": "e.g. 23% YoY",`,
      `      "headcount": "e.g. ~5,000",`,
      `      "funding": "e.g. $350M Series D",`,
      `      "valuation": "e.g. $4.2B",`,
      `      "profitability": "e.g. Not yet profitable, -$40M net loss"`,
      `    }`,
      `  },`,
      `  "overview": {`,
      `    "description": "2-3 paragraph company description",`,
      `    "industry": "Primary industry",`,
      `    "founded": "Year",`,
      `    "headquarters": "City, State/Country",`,
      `    "leadership": [{ "name": "...", "title": "..." }],`,
      `    "products": [{ "name": "...", "description": "..." }],`,
      `    "businessModel": "Description of how they make money"`,
      `  },`,
      `  "marketAnalysis": {`,
      `    "tam": { "value": "e.g. $85B", "methodology": "How you estimated it" },`,
      `    "sam": { "value": "e.g. $12B", "methodology": "..." },`,
      `    "som": { "value": "e.g. $800M", "methodology": "..." },`,
      `    "growthRate": "e.g. 18% CAGR 2024-2029",`,
      `    "keyDrivers": ["Driver 1", "Driver 2"],`,
      `    "keyTrends": ["Trend 1", "Trend 2"],`,
      `    "regulatoryFactors": ["Factor 1"]`,
      `  },`,
      `  "competitiveLandscape": {`,
      `    "portersFiveForces": {`,
      `      "threatOfNewEntrants": { "score": 3, "reasoning": "..." },`,
      `      "bargainingPowerBuyers": { "score": 2, "reasoning": "..." },`,
      `      "bargainingPowerSuppliers": { "score": 3, "reasoning": "..." },`,
      `      "threatOfSubstitutes": { "score": 4, "reasoning": "..." },`,
      `      "competitiveRivalry": { "score": 4, "reasoning": "..." }`,
      `    },`,
      `    "competitors": [{`,
      `      "name": "...", "positioning": "...",`,
      `      "strengths": ["..."], "weaknesses": ["..."],`,
      `      "estimatedRevenue": "...", "keyDifferentiator": "..."`,
      `    }],`,
      `    "competitiveAdvantage": "What makes target unique"`,
      `  },`,
      `  "strategicRecommendations": [{`,
      `    "title": "...", "priority": "immediate" | "short-term" | "medium-term",`,
      `    "description": "...", "expectedImpact": "...",`,
      `    "investmentRequired": "...", "riskLevel": "low" | "medium" | "high",`,
      `    "implementationSteps": ["Step 1", "Step 2"]`,
      `  }],`,
      `  "implementationRoadmap": [{`,
      `    "phase": "Phase 1: ...", "timeline": "Q1 2026",`,
      `    "milestones": ["..."], "resources": "...", "cost": "..."`,
      `  }],`,
      `  "roiAnalysis": [{`,
      `    "scenario": "conservative" | "base" | "optimistic",`,
      `    "projections": [{ "year": 1, "revenue": "...", "cost": "...", "netBenefit": "..." }],`,
      `    "paybackPeriod": "e.g. 18 months",`,
      `    "irr": "e.g. 35%", "npv": "e.g. $2.4M"`,
      `  }],`,
      `  "riskAssessment": [{`,
      `    "risk": "...", "probability": "low" | "medium" | "high",`,
      `    "impact": "low" | "medium" | "high",`,
      `    "mitigation": "...", "owner": "CTO" | "CFO" | "CEO" | "COO" | etc.`,
      `  }]`,
      `}`,
      ``,
      `Rules:`,
      `- Use ONLY data from the research above. If data is missing, write "[Data not available]" or provide your best estimate marked as "[Estimated]".`,
      `- CITE SOURCES: Use [1], [2], etc. referencing the SOURCE INDEX. Every factual claim must have at least one source citation.`,
      `- Include 5-8 key strengths and challenges each, with specific evidence and source references.`,
      `- Include 5-8 competitors with real data — pricing, funding, differentiation, and estimated revenue where available.`,
      `- Include 6-10 strategic recommendations with detailed implementation steps (3-5 steps each).`,
      `- Include 3 ROI scenarios (conservative, base, optimistic) with multi-year projections.`,
      `- Include 8-12 risks with specific mitigation strategies and responsible owners.`,
      `- Include 4-6 implementation roadmap phases with concrete milestones.`,
      `- All financial figures should use proper formatting ($X.XB, $X.XM).`,
      `- Flag any claims that were disputed by cross-model verification with "[Verification note: ...]".`,
      `- Provide quantitative estimates wherever possible — avoid vague qualitative statements.`,
      `- Each Porter's Five Forces score must include 2-3 sentences of reasoning with specific evidence.`,
      `- The evidence fields in currentState should include source citation numbers like "[1][3]".`,
    ].join('\n');

    try {
      const response = await this.modelClient.generate({
        model: this.model,
        systemInstruction: 'You are producing an executive-grade strategic analysis for Glyphor Strategy Lab. Output ONLY the JSON requested — no markdown fences, no preamble, no commentary.',
        contents: [{ role: 'user', content: synthesisPrompt, timestamp: Date.now() }],
        temperature: 0.2,
      });

      const output = response.text ?? '';
      const jsonMatch = output.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          targetName: parsed.targetName ?? req.target,
          targetType: parsed.targetType ?? 'Company',
          analysisDate: new Date().toISOString(),
          documentCounts: sourceCounts,
          currentState: parsed.currentState ?? { momentum: 'neutral', keyStrengths: [], keyChallenges: [], financialSnapshot: {} },
          overview: parsed.overview ?? { description: '', industry: '', leadership: [], products: [], businessModel: '' },
          marketAnalysis: parsed.marketAnalysis ?? { tam: { value: '', methodology: '' }, sam: { value: '', methodology: '' }, som: { value: '', methodology: '' }, growthRate: '', keyDrivers: [], keyTrends: [], regulatoryFactors: [] },
          competitiveLandscape: parsed.competitiveLandscape ?? { portersFiveForces: { threatOfNewEntrants: { score: 3, reasoning: '' }, bargainingPowerBuyers: { score: 3, reasoning: '' }, bargainingPowerSuppliers: { score: 3, reasoning: '' }, threatOfSubstitutes: { score: 3, reasoning: '' }, competitiveRivalry: { score: 3, reasoning: '' } }, competitors: [], competitiveAdvantage: '' },
          strategicRecommendations: parsed.strategicRecommendations ?? [],
          implementationRoadmap: parsed.implementationRoadmap ?? [],
          roiAnalysis: parsed.roiAnalysis ?? [],
          riskAssessment: parsed.riskAssessment ?? [],
          sourceCitations: numberedSources.map((s) => ({
            id: s.id,
            title: s.title,
            url: s.url,
            type: s.type,
            snippet: s.snippet,
            date: s.date,
          })),
          verificationSummary,
        };
      }
    } catch (err) {
      console.error('[DeepDiveEngine] Synthesis failed:', err);
    }

    // Fallback
    return {
      targetName: req.target,
      targetType: 'Company',
      analysisDate: new Date().toISOString(),
      documentCounts: sourceCounts,
      currentState: { momentum: 'neutral', keyStrengths: [], keyChallenges: [], financialSnapshot: {} },
      overview: { description: `Analysis of ${req.target} — synthesis incomplete.`, industry: '', leadership: [], products: [], businessModel: '' },
      marketAnalysis: { tam: { value: '', methodology: '' }, sam: { value: '', methodology: '' }, som: { value: '', methodology: '' }, growthRate: '', keyDrivers: [], keyTrends: [], regulatoryFactors: [] },
      competitiveLandscape: { portersFiveForces: { threatOfNewEntrants: { score: 3, reasoning: '' }, bargainingPowerBuyers: { score: 3, reasoning: '' }, bargainingPowerSuppliers: { score: 3, reasoning: '' }, threatOfSubstitutes: { score: 3, reasoning: '' }, competitiveRivalry: { score: 3, reasoning: '' } }, competitors: [], competitiveAdvantage: '' },
      strategicRecommendations: [],
      implementationRoadmap: [],
      roiAnalysis: [],
      riskAssessment: [],
      sourceCitations: numberedSources.map((s) => ({
        id: s.id,
        title: s.title,
        url: s.url,
        type: s.type,
        snippet: s.snippet,
        date: s.date,
      })),
      verificationSummary,
    };
  }

  /* ── Helpers ────────────────────────────── */

  private async updateStatus(id: string, status: DeepDiveStatus): Promise<void> {
    await this.supabase.from('deep_dives').update({ status }).eq('id', id);
  }

  private async updateAreas(id: string, areas: ResearchArea[]): Promise<void> {
    await this.supabase.from('deep_dives').update({ research_areas: areas }).eq('id', id);
  }
}
