/**
 * McKinsey-Style Deep Dive Engine
 *
 * A multi-phase research engine that produces consultant-grade strategic analyses.
 * Unlike the standard AnalysisEngine (which asks LLMs to opine), this engine:
 *
 *   1. SCOPE   — Identify the target, build an issue tree, define research questions
 *   2. RESEARCH — Execute real web searches per research area in parallel
 *   3. ANALYZE  — Run specialist agents over search-enriched context
 *   4. SYNTHESIZE — Produce a structured McKinsey deliverable with all sections
 *
 * The output is a tabbed report: Current State, Overview, Market Analysis,
 * Competitive Landscape, Strategic Recommendations, Implementation Path,
 * ROI Analysis, Risk Assessment — each backed by cited evidence.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ModelClient } from '@glyphor/agent-runtime';
import { searchWeb, searchNews, batchSearch, searchResultsToContext } from '@glyphor/integrations';

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
        `${target} leadership team CEO executives`,
        `${target} products services business model`,
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
        `${target} financial performance earnings`,
        `${target} investors funding rounds`,
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
        `${target} patents intellectual property`,
        `${target} product features capabilities`,
      ],
      status: 'pending',
      sourcesFound: 0,
    },
    {
      id: 'market',
      label: 'Market & Industry',
      perspective: 'cmo',
      searchQueries: [
        `${target} market size TAM industry`,
        `${target} industry trends growth forecast`,
        `${target} market positioning segment`,
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
        `${target} vs alternatives comparison`,
        `${target} market share competitive position`,
      ],
      status: 'pending',
      sourcesFound: 0,
    },
    {
      id: 'leadership',
      label: 'Leadership & Culture',
      perspective: 'vp-customer-success',
      searchQueries: [
        `${target} company culture glassdoor reviews`,
        `${target} leadership team management changes`,
        `${target} hiring headcount growth`,
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
        `${target} pricing plans tiers`,
        `${target} sales go-to-market distribution channels`,
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
        `${target} industry regulation compliance`,
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

    // ── Phase 1: RESEARCH — web search all areas in parallel ──
    await this.updateStatus(id, 'researching');

    const searchResults = await Promise.allSettled(
      areas.map(async (area) => {
        area.status = 'searching';
        await this.updateAreas(id, areas);

        // Run web searches for this area
        const webResults = await batchSearch(area.searchQueries, { num: 8 });

        // Also search news for this area
        const newsResults = await searchNews(`${req.target} ${area.label}`, { num: 5 });

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

    // ── Phase 2: ANALYZE — specialist analysis per area ──
    await this.updateStatus(id, 'analyzing');

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

        const analysisPrompt = [
          `You are a senior McKinsey consultant analyzing "${req.target}" from the perspective of ${area.label}.`,
          req.context ? `Additional context: ${req.context}` : '',
          ``,
          `Below are real search results gathered from the web. Use ONLY this data to form your analysis.`,
          `Mark any claims that aren't directly supported by the sources as [ESTIMATED].`,
          ``,
          `## Web Search Results`,
          context || 'No web results found.',
          ``,
          `## Recent News`,
          news || 'No recent news found.',
          ``,
          `Provide a thorough, data-backed analysis covering:`,
          `1. Key findings with specific data points and evidence`,
          `2. Notable trends or patterns`,
          `3. Gaps in available data`,
          `4. Implications for strategic positioning`,
          ``,
          `Be specific. Quote numbers, dates, and sources. Don't hedge — if data is limited, say so explicitly.`,
        ].join('\n');

        const response = await this.modelClient.generate({
          model: this.model,
          systemInstruction: `You are a senior strategic consultant producing research-grade analysis. Be precise, data-driven, and cite your sources. No filler or corporate boilerplate.`,
          contents: [{ role: 'user', content: analysisPrompt, timestamp: Date.now() }],
          temperature: 0.3,
        });

        area.analysis = response.text ?? 'No analysis produced.';
        area.status = 'completed';
      }),
    );

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
    const completedAreas = areas.filter((a) => a.status === 'completed' && a.analysis);
    if (completedAreas.length === 0) {
      await this.supabase.from('deep_dives').update({
        status: 'failed',
        error: 'All research areas failed. Check API keys and search availability.',
      }).eq('id', id);
      return;
    }

    // ── Phase 3: SYNTHESIZE — produce the full McKinsey report ──
    await this.updateStatus(id, 'synthesizing');
    const report = await this.synthesize(req, areas, dedupedSources);

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
      detail: `McKinsey deep dive completed for "${req.target}": ${completedAreas.length}/${areas.length} areas researched, ${dedupedSources.length} sources analyzed`,
      created_at: new Date().toISOString(),
    });
  }

  /* ── Synthesis — Produce the Full Report ──── */

  private async synthesize(
    req: DeepDiveRequest,
    areas: ResearchArea[],
    sources: Source[],
  ): Promise<DeepDiveReport> {
    const completedAreas = areas.filter((a) => a.status === 'completed' && a.analysis);

    const researchContext = completedAreas.map((a) =>
      `=== ${a.label.toUpperCase()} (${a.perspective}) ===\n${a.analysis}\n`,
    ).join('\n');

    const sourceCounts = {
      secFilings: sources.filter((s) => s.type === 'sec').length,
      newsArticles: sources.filter((s) => s.type === 'news').length,
      patents: sources.filter((s) => s.type === 'patent').length,
      researchSources: sources.filter((s) => s.type === 'web' || s.type === 'report').length,
    };

    const synthesisPrompt = [
      `You are a senior partner at McKinsey & Company producing a comprehensive strategic deep dive on "${req.target}".`,
      req.context ? `Additional context: ${req.context}` : '',
      ``,
      `Below is research gathered by your specialist team from real web sources. Synthesize ALL findings into a single structured report.`,
      ``,
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
      `- Include 3-5 key strengths and challenges each.`,
      `- Include 3-5 competitors with real data.`,
      `- Include 4-6 strategic recommendations.`,
      `- Include 3 ROI scenarios (conservative, base, optimistic).`,
      `- Include 5-8 risks.`,
      `- All financial figures should use proper formatting ($X.XB, $X.XM).`,
    ].join('\n');

    try {
      const response = await this.modelClient.generate({
        model: this.model,
        systemInstruction: 'You are producing a McKinsey-grade strategic analysis. Output ONLY the JSON requested — no markdown fences, no preamble, no commentary.',
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
