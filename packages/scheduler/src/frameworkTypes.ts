/**
 * Framework Analysis Types — Deep Dive Pipeline Expansion
 *
 * Defines output schemas for 6 strategic framework agents:
 *   1. Ansoff Growth Matrix
 *   2. BCG Growth-Share Matrix
 *   3. Blue Ocean Strategy
 *   4. Porter's Five Forces
 *   5. PESTLE Analysis
 *   6. Enhanced SWOT
 *
 * Plus the Framework Convergence Narrative — the highest-value synthesis output.
 */

/* ── Shared sub-types ─────────────────────── */

export type FrameworkId =
  | 'framework-ansoff'
  | 'framework-bcg'
  | 'framework-blue-ocean'
  | 'framework-porters'
  | 'framework-pestle'
  | 'framework-swot';

export interface FrameworkResult {
  frameworkId: FrameworkId;
  analysis: FrameworkAnalysis;
  confidenceScore: number;              // 0.0-1.0
  duration?: number;                    // ms
}

export type FrameworkAnalysis =
  | AnsoffAnalysis
  | BCGAnalysis
  | BlueOceanAnalysis
  | PortersFiveForces
  | PESTLEAnalysis
  | EnhancedSWOT;

/* ── 1. Ansoff Growth Matrix ──────────────── */

export interface AnsoffAnalysis {
  summary: string;
  primary_quadrant: AnsoffQuadrant;
  quadrants: {
    market_penetration: AnsoffQuadrantDetail;
    market_development: AnsoffQuadrantDetail;
    product_development: AnsoffQuadrantDetail;
    diversification: AnsoffQuadrantDetail;
  };
  key_insight: string;
  growth_balance_assessment: string;
}

export type AnsoffQuadrant =
  | 'market_penetration'
  | 'market_development'
  | 'product_development'
  | 'diversification';

export interface AnsoffQuadrantDetail {
  description: string;
  initiatives: Initiative[];
  revenue_impact: string;
  evidence: string[];
}

export interface Initiative {
  name: string;
  status: 'active' | 'planned' | 'potential';
  detail: string;
  estimated_impact: string;
}

/* ── 2. BCG Growth-Share Matrix ───────────── */

export interface BCGAnalysis {
  summary: string;
  portfolio_balance: 'healthy' | 'top-heavy' | 'aging' | 'unbalanced';
  portfolio_rating: string;
  segments: BCGSegment[];
  capital_allocation_recommendation: string;
  key_insight: string;
}

export interface BCGSegment {
  name: string;
  classification: 'star' | 'cash_cow' | 'question_mark' | 'dog';
  market_growth_rate: string;
  relative_market_share: string;
  revenue: string;
  revenue_share_pct: number;
  margin: string;
  trajectory: 'improving' | 'stable' | 'declining';
  rationale: string;
  recommendation: 'invest' | 'hold' | 'harvest' | 'divest';
}

/* ── 3. Blue Ocean Strategy ───────────────── */

export interface BlueOceanAnalysis {
  summary: string;
  uncontested_spaces: BlueOceanSpace[];
  four_actions_framework: {
    eliminate: ActionItem[];
    reduce: ActionItem[];
    raise: ActionItem[];
    create: ActionItem[];
  };
  strategy_canvas: {
    competing_factors: string[];
    company_curve: number[];
    industry_average_curve: number[];
    key_divergence_points: string[];
  };
  primary_blue_ocean: string;
  defensibility: string;
  key_insight: string;
}

export interface BlueOceanSpace {
  space: string;
  description: string;
  current_competitors: string;
  moat_source: string;
  evidence: string[];
}

export interface ActionItem {
  factor: string;
  rationale: string;
  impact: 'high' | 'medium' | 'low';
}

/* ── 4. Porter's Five Forces ──────────────── */

export interface PortersFiveForces {
  summary: string;
  overall_attractiveness: 'high' | 'moderate-high' | 'moderate' | 'moderate-low' | 'low';
  overall_attractiveness_score: number;
  forces: {
    competitive_rivalry: ForceAssessment;
    threat_of_new_entrants: ForceAssessment;
    threat_of_substitutes: ForceAssessment;
    bargaining_power_suppliers: ForceAssessment;
    bargaining_power_buyers: ForceAssessment;
  };
  most_critical_force: string;
  strategic_implications: string[];
  key_insight: string;
}

export interface ForceAssessment {
  intensity: 'high' | 'moderate-high' | 'moderate' | 'moderate-low' | 'low';
  intensity_score: number;
  trend: 'intensifying' | 'stable' | 'weakening';
  key_drivers: string[];
  evidence: string[];
  company_position: string;
  recommendation: string;
}

/* ── 5. PESTLE Analysis ───────────────────── */

export interface PESTLEAnalysis {
  summary: string;
  overall_environment: 'highly_favorable' | 'favorable' | 'mixed' | 'challenging' | 'hostile';
  dimensions: {
    political: PESTLEDimension;
    economic: PESTLEDimension;
    social: PESTLEDimension;
    technological: PESTLEDimension;
    legal: PESTLEDimension;
    environmental: PESTLEDimension;
  };
  top_3_tailwinds: PESTLEFactor[];
  top_3_headwinds: PESTLEFactor[];
  key_insight: string;
}

export interface PESTLEDimension {
  assessment: 'favorable' | 'neutral' | 'unfavorable';
  factors: PESTLEFactor[];
}

export interface PESTLEFactor {
  factor: string;
  description: string;
  impact: 'high_positive' | 'moderate_positive' | 'neutral' | 'moderate_negative' | 'high_negative';
  impact_score: number;
  quantification: string;
  status: 'confirmed' | 'emerging' | 'speculative';
  timeline: string;
  company_specific_impact: string;
  evidence: string[];
}

/* ── 6. Enhanced SWOT ─────────────────────── */

export interface EnhancedSWOT {
  summary: string;
  items: SWOTItem[];
  interaction_matrix: {
    so_strategies: SOStrategy[];
    wt_vulnerabilities: WTVulnerability[];
    st_defenses: STDefense[];
    wo_gaps: WOGap[];
  };
  strategic_priority: string;
  key_insight: string;
  overall_strategic_position?: 'favorable' | 'neutral' | 'vulnerable';
}

export interface SWOTItem {
  category: 'strength' | 'weakness' | 'opportunity' | 'threat';
  item: string;
  detail: string;
  impact_score: number;
  probability: number;
  priority_score: number;
  quantification: string;
  confidence: 'high' | 'medium' | 'low';
  evidence: string[];
}

export interface SOStrategy {
  strength: string;
  opportunity: string;
  strategy: string;
  priority_score: number;
  confidence: 'high' | 'medium' | 'low';
  expected_impact: string;
}

export interface WTVulnerability {
  weakness: string;
  threat: string;
  vulnerability: string;
  priority_score: number;
  confidence: 'high' | 'medium' | 'low';
  urgency: 'immediate' | 'short_term' | 'medium_term';
}

export interface STDefense {
  strength: string;
  threat: string;
  defense: string;
  priority_score: number;
  confidence: 'high' | 'medium' | 'low';
  defensive_action: string;
}

export interface WOGap {
  weakness: string;
  opportunity: string;
  gap: string;
  priority_score: number;
  confidence: 'high' | 'medium' | 'low';
  development_priority: string;
}

/* ── Framework Convergence Narrative ──────── */

export interface FrameworkConvergence {
  narrative: string;                    // 3-5 paragraph convergence analysis
  agreement_points: string[];           // Where frameworks agree
  divergence_points: string[];          // Where frameworks diverge
  combined_thesis: string;              // The overarching strategic thesis
}

/* ── Watchlist (Sprint 4 placeholder) ─────── */

export interface WatchlistItem {
  item: string;
  category: 'risk' | 'catalyst' | 'transaction' | 'leadership' | 'regulatory';
  source_packet: string;
  trigger_signals: string[];
  current_status: string;
  last_updated: string;
  priority: 'high' | 'medium' | 'low';
}
