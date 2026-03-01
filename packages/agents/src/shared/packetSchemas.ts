/**
 * Research Packet Schemas — TypeScript interfaces for all 15 packet types
 * submitted by the analyst team via submit_research_packet.
 */

/* ── Original 4 packet types (enhanced) ─────── */

export interface CompetitorProfile {
  name: string;
  url?: string;
  description: string;
  founded?: string;
  headquarters?: string;
  funding?: string;
  valuation?: string;
  estimatedRevenue?: string;
  marketShareEstimate?: string;
  pricing: string;
  features: string[];
  targetCustomer: string;
  reviews?: { platform: string; rating: number; count: number }[];
  keyStrengths: string[];
  keyWeaknesses: string[];
  threatLevel: 'high' | 'medium' | 'low';
  positioningAssessment?: string;
}

export interface CompetitorProfilesPacket {
  competitors: CompetitorProfile[];
  featureComparisonMatrix?: Record<string, Record<string, 'full' | 'partial' | 'none' | 'unknown'>>;
  marketShareSummary?: string;
}

export interface MarketDataPacket {
  tam: { value: string; methodology: string };
  sam: { value: string; methodology: string };
  som: { value: string; methodology: string };
  growthRate: string;
  keyDrivers: string[];
  keyTrends: string[];
  regulatoryFactors: string[];
  pricingBenchmarks?: { segment: string; range: string }[];
}

export interface TechnicalLandscapePacket {
  techStack: { category: string; technologies: string[] }[];
  patents: { title: string; id?: string; date?: string; relevance: string }[];
  openSourceActivity?: { repos: string; stars?: number; contributors?: number };
  apiCapabilities: string[];
  architectureInsights: string[];
  moatAssessment: { capability: string; defensibility: 'strong' | 'moderate' | 'weak'; rationale: string }[];
}

export interface IndustryTrendsPacket {
  megatrends: Megatrend[];
  overallTrendScore?: number;
  overallAssessment?: 'highly_favorable' | 'favorable' | 'neutral' | 'unfavorable' | 'hostile';
  demandOutlook?: string;
  regulatoryEnvironment: string;
  emergingTechnologies: string[];
  marketConsolidation: string;
}

export interface Megatrend {
  name: string;
  description: string;
  headlineMetric?: string;
  growthRate?: string;
  impactScore?: number;
  direction: 'accelerating' | 'stable' | 'decelerating';
  timeHorizon: string;
  evidence: string[];
}

/* ── New packet types (Sprint 2) ────────────── */

export interface CompanyProfilePacket {
  officialName: string;
  description: string;
  founded?: string;
  headquarters?: string;
  industry: string;
  subIndustry?: string;
  businessModel: string;
  revenueModel: string;
  products: { name: string; description: string; launchDate?: string; status: string }[];
  keyMetrics: { metric: string; value: string; period: string; source: string }[];
  missionStatement?: string;
  recentMilestones: { event: string; date: string; significance: string }[];
}

export interface StrategicDirectionPacket {
  statedStrategy: string;
  strategicPriorities: { priority: string; evidence: string; status: 'active' | 'emerging' | 'de-emphasized' }[];
  recentPivots: { description: string; date: string; rationale: string }[];
  investmentAreas: { area: string; evidence: string; estimatedInvestment?: string }[];
  partnershipStrategy: string;
  expansionPlans: { market: string; timeline?: string; type: 'geographic' | 'vertical' | 'horizontal' }[];
  exitSignals?: string[];
}

export interface LeadershipProfilePacket {
  executives: {
    name: string;
    title: string;
    tenure?: string;
    background: string;
    linkedinUrl?: string;
    notableAchievements: string[];
    leadershipStyle?: string;
  }[];
  boardMembers: { name: string; affiliation: string; role: string }[];
  recentChanges: { person: string; change: string; date: string; significance: string }[];
  cultureIndicators: { signal: string; source: string; sentiment: 'positive' | 'neutral' | 'negative' }[];
  glassdoorRating?: number;
  employeeCount?: string;
  hiringVelocity?: string;
}

export interface SegmentAnalysisPacket {
  segments: {
    name: string;
    description: string;
    estimatedRevenue?: string;
    revenueSharePct?: number;
    growthRate?: string;
    customerCount?: string;
    avgDealSize?: string;
    churnRate?: string;
    competitiveIntensity: 'high' | 'medium' | 'low';
    keyCompetitors: string[];
  }[];
  primarySegment: string;
  fastestGrowingSegment: string;
  underservedSegments: string[];
}

export interface FinancialAnalysisPacket {
  revenue?: string;
  revenueGrowthYoY?: string;
  grossMargin?: string;
  operatingMargin?: string;
  netIncome?: string;
  cashPosition?: string;
  burnRate?: string;
  runway?: string;
  fundingHistory: { round: string; amount: string; date: string; leadInvestor?: string; valuation?: string }[];
  revenueBreakdown?: { source: string; amount: string; pctOfTotal: number }[];
  unitEconomics?: { metric: string; value: string }[];
  financialHealth: 'strong' | 'stable' | 'concerning' | 'critical';
  analystConsensus?: string;
}

export interface MAActivityPacket {
  recentAcquisitions: { target: string; acquirer: string; date: string; amount?: string; rationale: string; status: string }[];
  recentDivestitures: { asset: string; buyer?: string; date: string; amount?: string; rationale: string }[];
  rumoredDeals: { description: string; likelihood: 'high' | 'medium' | 'low'; source: string }[];
  strategicPartnerships: { partner: string; type: string; date: string; significance: string }[];
  consolidationTrend: string;
  potentialTargets?: { company: string; rationale: string; estimatedValue?: string }[];
}

export interface AIImpactPacket {
  aiAdoptionLevel: 'leader' | 'fast_follower' | 'mainstream' | 'laggard' | 'resistant';
  aiCapabilities: { capability: string; maturity: 'production' | 'pilot' | 'experimental' | 'planned'; impact: string }[];
  aiThreats: { threat: string; timeline: string; severity: 'high' | 'medium' | 'low'; mitigation?: string }[];
  aiOpportunities: { opportunity: string; estimatedImpact: string; timeToValue: string; investmentRequired: string }[];
  automationRisk: { process: string; automationPotential: 'high' | 'medium' | 'low'; timeline: string }[];
  aiTalentGap?: string;
  competitorAIStrategy?: string;
  regulatoryAIRisks: string[];
}

export interface TalentAssessmentPacket {
  totalHeadcount?: string;
  headcountGrowthYoY?: string;
  keyRoles: { role: string; count?: number; openPositions?: number; criticality: 'critical' | 'important' | 'standard' }[];
  talentConcentration: { skill: string; depth: 'deep' | 'moderate' | 'thin'; riskLevel: 'high' | 'medium' | 'low' }[];
  hiringTrends: { area: string; direction: 'aggressive_hiring' | 'moderate_hiring' | 'stable' | 'reducing'; evidence: string }[];
  culturalSignals: { signal: string; source: string; impact: 'positive' | 'neutral' | 'negative' }[];
  leadershipBench: { strength: 'strong' | 'adequate' | 'thin'; successionRisks: string[] }[];
  orgStructure?: string;
  attritionIndicators: string[];
  compensationBenchmark?: string;
}

export interface RegulatoryLandscapePacket {
  currentRegulations: { regulation: string; jurisdiction: string; impact: 'high' | 'medium' | 'low'; complianceStatus: string }[];
  pendingLegislation: { legislation: string; jurisdiction: string; status: string; expectedDate?: string; potentialImpact: string }[];
  complianceBurden: { area: string; costEstimate?: string; complexity: 'high' | 'medium' | 'low' }[];
  regulatoryRisks: { risk: string; probability: 'high' | 'medium' | 'low'; impact: string }[];
  industryStandards: { standard: string; adoption: string; relevance: string }[];
}

export interface RiskAssessmentPacket {
  risks: {
    category: 'market' | 'technology' | 'regulatory' | 'operational' | 'financial' | 'competitive' | 'reputational';
    risk: string;
    description: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    probability: 'high' | 'medium' | 'low';
    priorityScore: number;
    timeHorizon: string;
    mitigation: string;
    earlyWarningSignals: string[];
  }[];
  overallRiskLevel: 'high' | 'moderate' | 'low';
  topRisks: string[];
}

export interface OpportunityMapPacket {
  opportunities: {
    opportunity: string;
    category: 'market_gap' | 'unserved_segment' | 'adjacency' | 'disruption' | 'partnership';
    description: string;
    estimatedValue: string;
    timeToCapture: string;
    competitiveAdvantage: string;
    requiredCapabilities: string[];
    evidenceSources: string[];
  }[];
  adjacentMarkets: { market: string; relevance: string; entryBarrier: 'high' | 'medium' | 'low' }[];
  whiteSpaces: string[];
  prioritizedOpportunities: string[];
}

/* ── Packet type union ──────────────────────── */

export type PacketType =
  | 'competitor_profiles'
  | 'market_data'
  | 'technical_landscape'
  | 'industry_trends'
  | 'company_profile'
  | 'strategic_direction'
  | 'leadership_profile'
  | 'segment_analysis'
  | 'financial_analysis'
  | 'ma_activity'
  | 'ai_impact'
  | 'talent_assessment'
  | 'regulatory_landscape'
  | 'risk_assessment'
  | 'opportunity_map';
