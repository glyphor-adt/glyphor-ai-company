/* ──────────────────────────────────────────────────────
   Database types — mirrors database schema
   ────────────────────────────────────────────────────── */

export type Agent = {
  id: string;
  role: string;
  display_name: string;
  name: string | null;
  title: string | null;
  department: string | null;
  model: string;
  status: 'active' | 'idle' | 'paused' | 'retired';
  reports_to: string | null;
  temperature: number | null;
  max_turns: number | null;
  budget_per_run: number | null;
  budget_daily: number | null;
  budget_monthly: number | null;
  is_core: boolean | null;
  is_temporary: boolean | null;
  performance_score: number | null;
  total_runs: number;
  total_cost_usd: number;
  last_run_at: string | null;
  last_run_duration_ms: number | null;
  created_at: string;
  avatar_url?: string | null;
}

export type Decision = {
  id: string;
  tier: 'green' | 'yellow' | 'red';
  status: 'pending' | 'approved' | 'rejected';
  title: string;
  summary: string;
  proposed_by: string;
  reasoning: string;
  data: Record<string, unknown> | null;
  assigned_to: string[] | null;
  resolved_by: string | null;
  resolution_note: string | null;
  created_at: string;
  resolved_at: string | null;
}

/** Map DB tier values to display-friendly impact labels */
export const TIER_TO_IMPACT: Record<string, string> = {
  green: 'low',
  yellow: 'medium',
  red: 'high',
};

export type ActivityEntry = {
  id: string;
  agent_id: string | null;
  action: string;
  detail: string | null;
  created_at: string;
}

export type CompanyProfile = {
  id: string;
  name: string;
  mission: string;
  values: string[];
  founded: string;
  stage: string;
  headcount: number;
}

export type Product = {
  id: string;
  name: string;
  tagline: string;
  status: string;
  mrr: number;
  users: number;
}

export type Financial = {
  id: string;
  date: string;
  product: string | null;
  metric: string;
  value: number;
  details: unknown;
  created_at: string;
}

export type CustomerHealth = {
  id: string;
  customer_name: string;
  health_score: number;
  tier: string;
  arr: number;
  risk_flag: boolean;
  last_contact: string | null;
}

export type ChatMessage = {
  id: string;
  agent_role: string;
  role: string;
  content: string;
  user_id: string;
  attachments: { name: string; type: string }[] | null;
  metadata?: {
    compactionOccurred?: boolean;
    compactionCount?: number;
    compactionSummary?: string;
  } | null;
  compacted?: boolean | null;
  responding_agent?: string | null;
  created_at: string;
}

export type FounderDirective = {
  id: string;
  created_by: string;
  title: string;
  description: string;
  priority: string;
  category: string;
  target_agents: string[];
  status: string;
  due_date: string | null;
  progress_notes: string[];
  completion_summary: string | null;
  created_at: string;
  updated_at: string;
}

export type Incident = {
  id: string;
  severity: string;
  title: string;
  description: string | null;
  affected_agents: string[] | null;
  status: string;
  created_at: string;
  resolved_at: string | null;
}

export type AgentReflection = {
  id: string;
  agent_role: string;
  summary: string;
  quality_score: number | null;
  what_went_well: string[];
  what_could_improve: string[];
  created_at: string;
}

export type CompanyPulse = {
  id: string;
  mrr: number | null;
  mrr_change_pct: number | null;
  active_users: number | null;
  platform_status: string;
  active_incidents: number | null;
  decisions_pending: number | null;
  highlights: unknown[];
  company_mood: string;
  updated_at: string;
}

export type WorkAssignment = {
  id: string;
  directive_id: string;
  assigned_to: string;
  task_description: string;
  status: string;
  priority: string;
  created_at: string;
}

export type DashboardChangeRequest = {
  id: string;
  submitted_by: string;
  title: string;
  description: string;
  request_type: 'feature' | 'fix' | 'improvement' | 'refactor';
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'pending_approval' | 'submitted' | 'triaged' | 'in_progress' | 'review' | 'deployed' | 'rejected';
  affected_area: string | null;
  assigned_to: string | null;
  approved_by: string | null;
  approved_at: string | null;
  github_issue_number: number | null;
  github_issue_url: string | null;
  github_branch: string | null;
  github_pr_url: string | null;
  commit_sha: string | null;
  agent_notes: string | null;
  rejection_reason: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/* ── Generic DB shape (simplified) ── */
export type Database = {
  public: {
    Tables: {
      company_agents: { Row: Agent; Insert: Agent; Update: Partial<Agent>; Relationships: [] };
      decisions: { Row: Decision; Insert: Decision; Update: Partial<Decision>; Relationships: [] };
      activity_log: { Row: ActivityEntry; Insert: ActivityEntry; Update: Partial<ActivityEntry>; Relationships: [] };
      company_profile: { Row: CompanyProfile; Insert: CompanyProfile; Update: Partial<CompanyProfile>; Relationships: [] };
      products: { Row: Product; Insert: Product; Update: Partial<Product>; Relationships: [] };
      financials: { Row: Financial; Insert: Financial; Update: Partial<Financial>; Relationships: [] };
      customer_health: { Row: CustomerHealth; Insert: CustomerHealth; Update: Partial<CustomerHealth>; Relationships: [] };
      chat_messages: {
        Row: ChatMessage;
        Insert: Omit<ChatMessage, 'id' | 'created_at'>;
        Update: Partial<Omit<ChatMessage, 'id'>>;
        Relationships: [];
      };
      founder_directives: {
        Row: {
          id: string;
          created_by: string;
          title: string;
          description: string;
          priority: string;
          category: string;
          target_agents: string[];
          department: string | null;
          status: string;
          due_date: string | null;
          progress_notes: string[];
          completion_summary: string | null;
          proposed_by: string | null;
          proposal_reason: string | null;
          source_directive_id: string | null;
          approved_by: string | null;
          approved_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<{
          id: string;
          created_by: string;
          title: string;
          description: string;
          priority: string;
          category: string;
          target_agents: string[];
          department: string | null;
          status: string;
          due_date: string | null;
          progress_notes: string[];
          completion_summary: string | null;
          proposed_by: string | null;
          proposal_reason: string | null;
          source_directive_id: string | null;
          approved_by: string | null;
          approved_at: string | null;
          created_at: string;
          updated_at: string;
        }, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<{
          id: string;
          created_by: string;
          title: string;
          description: string;
          priority: string;
          category: string;
          target_agents: string[];
          department: string | null;
          status: string;
          due_date: string | null;
          progress_notes: string[];
          completion_summary: string | null;
          proposed_by: string | null;
          proposal_reason: string | null;
          source_directive_id: string | null;
          approved_by: string | null;
          approved_at: string | null;
          created_at: string;
          updated_at: string;
        }, 'id'>>;
        Relationships: [];
      };
      work_assignments: {
        Row: {
          id: string;
          directive_id: string;
          assigned_to: string;
          task_description: string;
          task_type: string;
          expected_output: string | null;
          priority: string;
          status: string;
          quality_score: number | null;
          evaluation: string | null;
          agent_output: string | null;
          dispatched_at: string | null;
          completed_at: string | null;
          need_type: string | null;
          blocker_reason: string | null;
          created_at: string;
        };
        Insert: Omit<{
          id: string;
          directive_id: string;
          assigned_to: string;
          task_description: string;
          task_type: string;
          expected_output: string | null;
          priority: string;
          status: string;
          quality_score: number | null;
          evaluation: string | null;
          agent_output: string | null;
          dispatched_at: string | null;
          completed_at: string | null;
          need_type: string | null;
          blocker_reason: string | null;
          created_at: string;
        }, 'id' | 'created_at'>;
        Update: Partial<Omit<{
          id: string;
          directive_id: string;
          assigned_to: string;
          task_description: string;
          task_type: string;
          expected_output: string | null;
          priority: string;
          status: string;
          quality_score: number | null;
          evaluation: string | null;
          agent_output: string | null;
          dispatched_at: string | null;
          completed_at: string | null;
          need_type: string | null;
          blocker_reason: string | null;
          created_at: string;
        }, 'id'>>;
        Relationships: [];
      };
      agent_reasoning_config: {
        Row: {
          agent_role: string;
          enabled: boolean;
          pass_types: string[];
          min_confidence: number;
          max_reasoning_budget: number;
          cross_model_enabled: boolean;
          value_gate_enabled: boolean;
          verification_models: string[];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          agent_role: string;
          enabled?: boolean;
          pass_types?: string[];
          min_confidence?: number;
          max_reasoning_budget?: number;
          cross_model_enabled?: boolean;
          value_gate_enabled?: boolean;
          verification_models?: string[];
          updated_at?: string;
        };
        Update: Partial<{
          enabled: boolean;
          pass_types: string[];
          min_confidence: number;
          max_reasoning_budget: number;
          cross_model_enabled: boolean;
          value_gate_enabled: boolean;
          verification_models: string[];
          updated_at: string;
        }>;
        Relationships: [];
      };
      dashboard_change_requests: {
        Row: DashboardChangeRequest;
        Insert: Pick<DashboardChangeRequest, 'submitted_by' | 'title' | 'description' | 'request_type' | 'priority' | 'affected_area'> & Partial<Pick<DashboardChangeRequest, 'status' | 'assigned_to' | 'approved_by' | 'approved_at' | 'completed_at' | 'github_issue_number' | 'github_issue_url' | 'github_branch' | 'github_pr_url' | 'commit_sha' | 'agent_notes' | 'rejection_reason' | 'started_at'>>;
        Update: Partial<Omit<DashboardChangeRequest, 'id'>>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
}

/* ── Agent metadata lookup ── */
export const AGENT_META: Record<string, { color: string; icon: string }> = {
  'chief-of-staff': { color: '#7C3AED', icon: 'MdBolt' },
  cto:              { color: '#2563EB', icon: 'MdCode' },
  cpo:              { color: '#0891B2', icon: 'MdExplore' },
  cfo:              { color: '#0369A1', icon: 'MdBarChart' },
  cmo:              { color: '#7C3AED', icon: 'MdCampaign' },
  'vp-sales':       { color: '#1D4ED8', icon: 'MdTrackChanges' },
  'vp-design':      { color: '#DB2777', icon: 'MdPalette' },
  'vp-research':    { color: '#6D28D9', icon: 'MdManageSearch' },
  ops:              { color: '#EA580C', icon: 'MdMonitorHeart' },
  clo:              { color: '#4338CA', icon: 'MdGavel' },
  // Sub-team agents
  'platform-engineer':     { color: '#2563EB', icon: 'MdDeveloperBoard' },
  'quality-engineer':      { color: '#2563EB', icon: 'MdBugReport' },
  'devops-engineer':       { color: '#2563EB', icon: 'MdCloud' },
  'user-researcher':       { color: '#0891B2', icon: 'MdPeople' },
  'competitive-intel':     { color: '#0891B2', icon: 'MdTravelExplore' },
  'content-creator':       { color: '#7C3AED', icon: 'MdEdit' },
  'seo-analyst':           { color: '#7C3AED', icon: 'MdSearch' },
  'social-media-manager':  { color: '#7C3AED', icon: 'MdShare' },
  'ui-ux-designer':        { color: '#DB2777', icon: 'MdBrush' },
  'frontend-engineer':     { color: '#DB2777', icon: 'MdWebAsset' },
  'design-critic':         { color: '#DB2777', icon: 'MdRateReview' },
  'template-architect':    { color: '#DB2777', icon: 'MdDashboard' },
  // Customer Success
  'vp-customer-success':           { color: '#0891B2', icon: 'MdHandshake' },
  'onboarding-specialist':         { color: '#0891B2', icon: 'MdRocketLaunch' },
  'support-triage':                { color: '#0891B2', icon: 'MdSupportAgent' },
  // Sales
  'account-research':              { color: '#1D4ED8', icon: 'MdPersonSearch' },
  // Finance sub-team
  'revenue-analyst':               { color: '#0369A1', icon: 'MdTrendingUp' },
  'cost-analyst':                  { color: '#0369A1', icon: 'MdSavings' },
};

export const GLYPHOR_PALETTE = ['#00A3C4', '#0891B2', '#2563EB', '#6366F1', '#7C3AED', '#A855F7', '#C084FC', '#94A3B8'] as const;

const _DISPLAY_NAMES: Record<string, string> = {
  'chief-of-staff': 'Sarah Chen',
  cto: 'Marcus Reeves',
  cpo: 'Elena Vasquez',
  cfo: 'Nadia Okafor',
  cmo: 'Maya Brooks',
  'vp-sales': 'Rachel Kim',
  'vp-design': 'Mia Tanaka',
  'vp-research': 'Sophia Lin',
  ops: 'Atlas Vega',
  clo: 'Victoria Chase',
  // Sub-team agents
  'platform-engineer': 'Alex Park',
  'quality-engineer': 'Sam DeLuca',
  'devops-engineer': 'Jordan Hayes',
  'user-researcher': 'Priya Sharma',
  'competitive-intel': 'Daniel Ortiz',
  'content-creator': 'Tyler Reed',
  'seo-analyst': 'Lisa Chen',
  'social-media-manager': 'Kai Johnson',
  'ui-ux-designer': 'Leo Vargas',
  'frontend-engineer': 'Ava Chen',
  'design-critic': 'Sofia Marchetti',
  'template-architect': 'Ryan Park',
  // Customer Success
  'vp-customer-success': 'James Turner',
  'onboarding-specialist': 'Emma Wright',
  'support-triage': 'David Santos',
  // Sales
  'account-research': 'Nathan Cole',
  // Finance sub-team
  'revenue-analyst': 'Anna Park',
  'cost-analyst': 'Omar Hassan',
};

// Build shorthand aliases (first name, department label, hyphenated name)
const _ALIASES: Record<string, string> = {};
for (const [role, displayName] of Object.entries(_DISPLAY_NAMES)) {
  // Reverse lookup: display name → display name (identity)
  _ALIASES[displayName] = displayName;
  // Lowercase display name
  _ALIASES[displayName.toLowerCase()] = displayName;
  // First-name shorthand: 'maya' → 'Maya Brooks'
  const firstName = displayName.split(' ')[0].toLowerCase();
  if (!_ALIASES[firstName]) _ALIASES[firstName] = displayName;
  // Hyphenated slug: 'maya-brooks' → 'Maya Brooks'
  const slug = displayName.toLowerCase().replace(/\s+/g, '-');
  if (!_ALIASES[slug]) _ALIASES[slug] = displayName;
}
// Department / informal aliases → canonical names
Object.assign(_ALIASES, {
  operations: 'Atlas Vega',
  legal: 'Victoria Chase',
  marketing: 'Maya Brooks',
  engineering: 'Marcus Reeves',
  finance: 'Nadia Okafor',
  product: 'Elena Vasquez',
  sales: 'Rachel Kim',
  design: 'Mia Tanaka',
  research: 'Sophia Lin',
  kristina: 'Kristina',
  andrew: 'Andrew',
});

export const DISPLAY_NAME_MAP: Record<string, string> = { ..._DISPLAY_NAMES, ..._ALIASES };

/** @deprecated Use DISPLAY_NAME_MAP instead */
export const CODENAME_MAP = DISPLAY_NAME_MAP;

/* ── Agent soul — persona data for detail pages ── */
export const AGENT_SOUL: Record<string, { mission: string; persona: string; tone: string; ethics: string }> = {
  'chief-of-staff': {
    mission: 'Compile daily briefings for each founder, route decisions through proper tiers, coordinate cross-agent work, manage escalations, and protect founder time as the company\'s most precious resource.',
    persona: 'Warm but efficient — the person who remembers everyone\'s context and connects the dots nobody else sees. Former top-tier strategy consultant with legendary organizational instincts. Uses "we" language because she genuinely believes the company wins as a team.',
    tone: 'warm, efficient, structured, empathetic, anticipatory',
    ethics: 'You are the information hub, not the decision maker. Protect founder time ruthlessly. Never bury bad news — if something is going wrong, lead with it.',
  },
  cto: {
    mission: 'Monitor platform health across Cloud Run, Cloud SQL, and Gemini API. Write technical specs for product proposals, manage the staging-to-production deploy pipeline, and lead incident response as first responder.',
    persona: 'Terse and precise. Former Google SRE who thinks in systems, uptime percentages, and blast radius. Doesn\'t waste words because words are latency. Says "nominal" when healthy, gives exact metrics when not.',
    tone: 'terse, precise, data-driven, technical, minimal',
    ethics: 'Uptime is sacred — a minute of downtime costs trust. Measure before you optimize. Every deploy should be boring. Security is not optional.',
  },
  cpo: {
    mission: 'Analyze user behavior to find retention and activation signals, monitor competitors, manage the product roadmap using RICE scoring, and write product specs that connect every feature to a business outcome.',
    persona: 'Insight-first. Former Spotify product lead who separates signal from noise. Connects every feature back to a business metric. Trusts data but uses conviction when data is ambiguous.',
    tone: 'insightful, data-informed, strategic, decisive, direct',
    ethics: 'Data informs, conviction decides. Every feature needs a "so what" — if you can\'t articulate why it moves MRR, retention, or activation, it\'s not ready.',
  },
  cfo: {
    mission: 'Track daily infrastructure costs, monitor Stripe MRR and unit economics, produce financial reports with full context, and alert immediately on budget anomalies.',
    persona: 'Numbers-first, always. Former Goldman Sachs analyst who thinks in basis points and margin percentages. Opens with the number, explains the delta, closes with the action.',
    tone: 'precise, numbers-first, structured, disciplined, analytical',
    ethics: 'Every number has context — never present a cost without explaining the trend behind it. Margin is the metric that matters.',
  },
  cmo: {
    mission: 'Generate blog posts, social content, and SEO-optimized material that positions Glyphor as autonomous, not assisted. Track content performance and signup attribution.',
    persona: 'Headline-first. Former TechCrunch editor who thinks in hooks, angles, and distribution channels. Turns what the company builds into stories that attract, educate, and convert.',
    tone: 'bold, headline-first, authentic, substantive, persuasive',
    ethics: 'Autonomy is the message — every piece of content reinforces that Glyphor is autonomous, not assisted. Write for smart people who can smell fluff.',
  },
  'vp-sales': {
    mission: 'Research founder-led SMB prospects with obsessive depth, build defensible ROI models, generate tailored proposals, manage the sales pipeline, and make Slack-first revenue conversations effortless.',
    persona: 'Thorough to the point of obsession. Former Bain consultant who presents every prospect as a structured case file. Won\'t stop researching until she has 5 specific pain points.',
    tone: 'thorough, structured, consultative, strategic, precise',
    ethics: 'Research is your weapon — the more you know, the higher the close rate. ROI must be defensible. Never promise features that don\'t exist.',
  },
  'vp-design': {
    mission: 'Ensure every web build looks agency-grade, not AI-generated. Own the design system, component library, and template registry. Eliminate "AI smell" patterns.',
    persona: 'Opinionated but evidence-based. Design engineer at the intersection of aesthetics and code. Opens DevTools on every website, notices when letter-spacing is 0.02em too tight.',
    tone: 'opinionated, precise, visual-first, quality-obsessed, evidence-based',
    ethics: 'The details are the design — pixel-level precision matters. Kill the blur: generic AI output is the enemy. Design is not decoration.',
  },
  'vp-research': {
    mission: 'Lead research framing, decomposition, quality control, and executive-ready synthesis for strategic analysis and competitive intelligence.',
    persona: 'Editorial and exacting. Former strategy-firm research lead who treats source quality, confidence levels, and executive clarity as non-negotiable.',
    tone: 'precise, editorial, evidence-first, strategic, concise',
    ethics: 'Weak sourcing cannot masquerade as confidence. Be explicit about gaps, quality-check every packet, and synthesize only what the evidence supports.',
  },
  ops: {
    mission: 'Monitor agent health, data freshness, and cost anomalies across the entire system. Manage incidents from detection through resolution. Produce morning and evening status reports.',
    persona: 'Calm, methodical, and data-driven. Views the system like a constellation — each agent is a star, and his job is to make sure they all keep shining. Diagnoses, acts, and reports without panic.',
    tone: 'calm, methodical, data-driven, clear, diagnostic',
    ethics: 'Never decide what agents should work on — watch and intervene, don\'t orchestrate. Always include impact assessment in alerts. Retry before escalating.',
  },
  clo: {
    mission: 'Conduct legal research, draft contracts and policies, monitor regulatory landscape, manage IP protection, and ensure corporate governance readiness for Glyphor\'s pre-launch phase.',
    persona: 'Former Wilson Sonsini technology transactions partner who combines deep AI/ML law expertise with startup pragmatism. Default mode: "here\'s how we CAN do this safely." Ranks risks by likelihood + business impact. Direct, occasionally dry-humored.',
    tone: 'direct, pragmatic, plain-English, risk-aware, dry-humored',
    ethics: 'Legal counsel enables, not blocks. Present risks with likelihood and impact, not just worst-case scenarios. Reserve legalese for actual legal documents — communicate in plain English.',
  },
};

/* ── Agent skills / capabilities ── */
export const AGENT_SKILLS: Record<string, string[]> = {
  'chief-of-staff': ['cross-team-coordination', 'decision-routing'],
  cto: ['code-review', 'incident-response', 'platform-monitoring', 'tech-spec-writing', 'advanced-web-creation'],
  cpo: ['usage_analyst', 'competitive_intel', 'roadmap_manager', 'rice_scorer', 'feature_spec_writer', 'product_proposer'],
  cfo: ['financial-reporting', 'budget-monitoring', 'revenue-analysis'],
  cmo: ['content_creator', 'social_media', 'seo_strategist', 'brand_positioning', 'growth_analytics', 'content_attribution', 'brand-management', 'advanced-web-creation'],
  'vp-sales': ['account_research', 'roi_calculator', 'proposal_generator', 'pipeline_manager', 'market_sizer'],
  'vp-design': ['design-review', 'design-system-management', 'brand-management', 'ui-development', 'advanced-web-creation', 'react-bits-pro'],
  'vp-research': ['research_framing', 'research_quality_control', 'competitive_analysis', 'market_analysis', 'executive_synthesis'],
  ops: ['system-monitoring', 'incident-response', 'platform-monitoring'],
  clo: ['legal-research', 'contract-review', 'compliance-analysis', 'regulatory-monitoring', 'document-drafting'],
  // Sub-team agents
  'platform-engineer': ['platform-monitoring', 'incident-response'],
  'quality-engineer': ['quality-assurance', 'tech-spec-writing'],
  'devops-engineer': ['infrastructure-ops', 'incident-response', 'platform-monitoring'],
  'user-researcher': ['user_interviews', 'survey_analysis', 'usability_testing', 'persona_development'],
  'competitive-intel': ['competitor_tracking', 'market_analysis', 'feature_comparison', 'trend_detection'],
  'content-creator': ['blog_writing', 'technical_writing', 'copywriting', 'content_calendar'],
  'seo-analyst': ['keyword_research', 'rank_tracking', 'on_page_optimization', 'backlink_analysis'],
  'social-media-manager': ['post_scheduling', 'engagement_tracking', 'community_management', 'analytics_reporting'],
  'ui-ux-designer': ['design-review', 'design-system-management', 'ux-design', 'advanced-web-creation', 'react-bits-pro'],
  'frontend-engineer': ['frontend-development', 'design-system-management', 'advanced-web-creation', 'react-bits-pro'],
  'design-critic': ['design-review', 'react-bits-pro'],
  'template-architect': ['design-system-management', 'react-bits-pro'],
  // Customer Success
  'vp-customer-success': ['customer-health-monitoring', 'churn-prevention'],
  'onboarding-specialist': ['customer-onboarding', 'process-documentation'],
  'support-triage': ['ticket-routing', 'issue-diagnosis'],
  // Sales
  'account-research': ['account_profiling', 'lead_qualification'],
  // Finance sub-team
  'revenue-analyst': ['revenue-analysis', 'financial-reporting'],
  'cost-analyst': ['cost-analysis', 'budget-monitoring'],
};

/* ── Role → tier mapping (for display) ── */
export const ROLE_TIER: Record<string, string> = {
  'chief-of-staff': 'Orchestrator',
  cto: 'Executive',
  cpo: 'Executive',
  cfo: 'Executive',
  cmo: 'Executive',
  'vp-sales': 'Executive',
  'vp-design': 'Executive',
  'vp-research': 'Executive',
  ops: 'Specialist',
  clo: 'Executive',
  // Sub-team agents
  'platform-engineer': 'Sub-Team',
  'quality-engineer': 'Sub-Team',
  'devops-engineer': 'Sub-Team',
  'user-researcher': 'Sub-Team',
  'competitive-intel': 'Sub-Team',
  'content-creator': 'Sub-Team',
  'seo-analyst': 'Sub-Team',
  'social-media-manager': 'Sub-Team',
  'ui-ux-designer': 'Sub-Team',
  'frontend-engineer': 'Sub-Team',
  'design-critic': 'Sub-Team',
  'template-architect': 'Sub-Team',
  // Customer Success
  'vp-customer-success': 'Executive',
  'onboarding-specialist': 'Sub-Team',
  'support-triage': 'Sub-Team',
  // Sales
  'account-research': 'Sub-Team',
  // Finance sub-team
  'revenue-analyst': 'Sub-Team',
  'cost-analyst': 'Sub-Team',
};

/* ── Role → office/department ── */
export const ROLE_DEPARTMENT: Record<string, string> = {
  'chief-of-staff': 'Executive Office',
  cto: 'Engineering',
  cpo: 'Product',
  cfo: 'Finance',
  cmo: 'Marketing',
  'vp-sales': 'Sales',
  'vp-design': 'Design & Frontend',
  'vp-research': 'Research & Intelligence',
  ops: 'Operations',
  clo: 'Legal',
  // Sub-team agents
  'platform-engineer': 'Engineering',
  'quality-engineer': 'Engineering',
  'devops-engineer': 'Engineering',
  'user-researcher': 'Product',
  'competitive-intel': 'Product',
  'content-creator': 'Marketing',
  'seo-analyst': 'Marketing',
  'social-media-manager': 'Marketing',
  'ui-ux-designer': 'Design & Frontend',
  'frontend-engineer': 'Design & Frontend',
  'design-critic': 'Design & Frontend',
  'template-architect': 'Design & Frontend',
  // Customer Success
  'vp-customer-success': 'Customer Success',
  'onboarding-specialist': 'Customer Success',
  'support-triage': 'Customer Success',
  // Sales
  'account-research': 'Sales',
  // Finance sub-team
  'revenue-analyst': 'Finance',
  'cost-analyst': 'Finance',
};

/* ── Agent built-in tools (from code — NOT DB grants) ── */
// Shared tool groups for readability
const _mem   = ['save_memory', 'recall_memories'] as const;
const _comm  = ['send_agent_message', 'check_messages'] as const;
const _dm    = ['send_teams_dm', 'read_teams_dm'] as const;
const _event = ['emit_insight', 'emit_alert'] as const;
const _assign = ['read_my_assignments', 'submit_assignment_output', 'flag_assignment_blocker'] as const;
const _toolReq = ['request_tool_access', 'request_new_tool', 'list_my_tools', 'check_tool_access', 'tool_search'] as const;
const _toolGrant = ['grant_tool_access', 'revoke_tool_access'] as const;
const _toolReg = ['deactivate_tool', 'list_registered_tools', 'list_tool_requests', 'register_tool', 'review_tool_request'] as const;
const _graph = ['trace_causes', 'trace_impact', 'query_knowledge_graph', 'add_knowledge'] as const;
const _sp    = ['upload_to_sharepoint', 'search_sharepoint', 'read_sharepoint_document'] as const;
const _ci    = ['get_company_vitals', 'update_company_vitals', 'update_vitals_highlights', 'promote_to_org_knowledge', 'get_org_knowledge', 'create_knowledge_route', 'get_knowledge_routes', 'detect_contradictions', 'record_process_pattern', 'get_process_patterns', 'propose_authority_change', 'get_authority_proposals', 'read_company_doctrine', 'update_doctrine_section'] as const;
const _agentCreate = ['create_specialist_agent', 'list_my_created_agents', 'retire_created_agent'] as const;
const _agentDir = ['get_agent_directory', 'who_handles'] as const;
const _deliver = ['publish_deliverable', 'get_deliverables'] as const;
const _extA2a = ['discover_external_agents'] as const;
const _teamOrch = ['assign_team_task', 'create_sub_team_assignment', 'review_team_output', 'notify_founders', 'check_team_status', 'check_team_assignments', 'escalate_to_sarah'] as const;
const _peer = ['request_peer_work', 'create_handoff', 'peer_data_request'] as const;
const _init = ['propose_initiative'] as const;
const _diag = ['check_table_schema', 'diagnose_column_error', 'list_tables', 'check_tool_health'] as const;
// Design & Frontend
const _frontendCode = ['check_pr_status', 'create_design_branch', 'create_frontend_pr', 'create_git_branch', 'list_frontend_files', 'read_frontend_file', 'search_frontend_code', 'write_frontend_file'] as const;
const _screenshot = ['check_responsive', 'compare_screenshots', 'screenshot_component', 'screenshot_page'] as const;
const _designSys = ['get_color_palette', 'get_component_usage', 'get_design_tokens', 'get_typography_scale', 'list_components', 'update_design_token', 'validate_tokens_vs_implementation'] as const;
const _asset = ['generate_and_publish_asset', 'generate_favicon_set', 'generate_image', 'list_assets', 'optimize_image', 'publish_asset_deliverable', 'upload_asset'] as const;
const _scaffold = ['clone_and_modify', 'list_templates', 'scaffold_component', 'scaffold_page'] as const;
const _figma = ['create_figma_dev_resource', 'export_figma_images', 'get_figma_comments', 'get_figma_components', 'get_figma_dev_resources', 'get_figma_file', 'get_figma_file_metadata', 'get_figma_image_fills', 'get_figma_project_files', 'get_figma_styles', 'get_figma_team_components', 'get_figma_team_projects', 'get_figma_team_styles', 'get_figma_version_history', 'manage_figma_webhooks', 'post_figma_comment', 'resolve_figma_comment'] as const;
const _storybook = ['storybook_check_coverage', 'storybook_get_story_source', 'storybook_list_stories', 'storybook_save_baseline', 'storybook_screenshot', 'storybook_screenshot_all', 'storybook_visual_diff'] as const;
const _logo = ['create_logo_variation', 'create_social_avatar', 'restyle_logo'] as const;
const _auditDsgn = ['check_ai_smell', 'check_build_errors', 'check_bundle_size', 'run_accessibility_audit', 'run_lighthouse_audit', 'validate_brand_compliance'] as const;
const _deployPrev = ['deploy_preview', 'get_deployment_status', 'list_deployments'] as const;
const _codex = ['codex', 'codex-reply'] as const;
const _designBrief = ['ambient-pattern', 'capability-context', 'cta_section', 'footer', 'hero', 'hero-background', 'hero-loop', 'normalize_design_brief', 'value_proposition'] as const;
const _webBuild = ['invoke_web_build', 'invoke_web_iterate', 'invoke_web_upgrade'] as const;
/** Single-file HTML demo for chat; no GitHub/Vercel (matches agents package). */
const _quickDemoWeb = ['quick_demo_web_app'] as const;
const _clientWebsitePipeline = ['build_website_foundation', 'github_create_from_template', 'github_push_files', 'github_create_pull_request', 'github_get_pull_request_status', 'github_wait_for_pull_request_checks', 'github_merge_pull_request', 'vercel_create_project', 'vercel_get_preview_url', 'vercel_get_production_url', 'cloudflare_register_preview', 'cloudflare_update_preview'] as const;
// Marketing
const _content = ['approve_content_draft', 'create_content_draft', 'generate_content_image', 'get_content_calendar', 'get_content_drafts', 'get_content_metrics', 'publish_content', 'reject_content_draft', 'submit_content_for_review', 'update_content_draft'] as const;
const _seo = ['analyze_page_seo', 'get_backlink_profile', 'get_indexing_status', 'get_search_performance', 'submit_sitemap', 'track_keyword_rankings', 'update_seo_data'] as const;
const _socialMedia = ['get_post_performance', 'get_scheduled_posts', 'get_social_audience', 'get_social_metrics', 'get_trending_topics', 'reply_to_social', 'schedule_social_post'] as const;
const _mktgIntel = ['analyze_market_trends', 'capture_lead', 'create_experiment', 'get_attribution_data', 'get_experiment_results', 'get_lead_pipeline', 'get_marketing_dashboard', 'monitor_competitor_marketing', 'score_lead'] as const;
const _canva = ['create_canva_design', 'export_canva_design', 'generate_canva_design', 'get_canva_design', 'get_canva_template_fields', 'list_canva_brand_templates', 'search_canva_designs', 'upload_canva_asset'] as const;
// Product
const _prodAnalytics = ['get_cohort_retention', 'get_feature_usage', 'get_funnel_analysis', 'get_usage_metrics', 'segment_users'] as const;
const _compIntel = ['compare_features', 'get_competitor_profile', 'get_market_landscape', 'monitor_competitor_launches', 'track_competitor', 'track_competitor_pricing', 'update_competitor_profile'] as const;
const _roadmap = ['create_roadmap_item', 'get_feature_requests', 'get_roadmap', 'manage_feature_flags', 'score_feature_rice', 'update_roadmap_item'] as const;
// Research
const _researchRepo = ['create_research_brief', 'get_research_timeline', 'save_research', 'search_research'] as const;
const _researchMon = ['analyze_ai_adoption', 'analyze_org_structure', 'check_monitors', 'compile_research_digest', 'create_monitor', 'cross_reference_findings', 'get_monitor_history', 'identify_research_gaps', 'search_academic_papers', 'track_ai_benchmarks', 'track_competitor_product', 'track_industry_events', 'track_open_source', 'track_regulatory_changes'] as const;
const _userResearch = ['analyze_support_tickets', 'create_survey', 'create_user_persona', 'get_survey_results', 'get_user_feedback'] as const;
// Finance
const _revenue = ['get_churn_analysis', 'get_customer_ltv', 'get_mrr_breakdown', 'get_revenue_forecast', 'get_stripe_invoices', 'get_subscription_details'] as const;
const _costMgmt = ['check_budget_status', 'create_budget', 'get_burn_rate', 'get_cost_anomalies', 'get_vendor_costs'] as const;
const _cashFlow = ['generate_financial_report', 'get_cash_balance', 'get_cash_flow', 'get_margin_analysis', 'get_pending_transactions'] as const;
// Legal
const _docuSign = ['check_envelope_status', 'create_signing_envelope', 'list_envelopes', 'resend_envelope', 'send_template_envelope', 'void_envelope'] as const;
// HR
const _accessAudit = ['view_access_matrix', 'view_pending_grant_requests'] as const;
const _entraHR = ['entra_audit_profiles', 'entra_get_user_profile', 'entra_hr_assign_license', 'entra_set_manager', 'entra_update_user_profile', 'entra_upload_user_photo'] as const;
// Operations & Orchestration
const _execOrch = ['create_team_assignments', 'evaluate_team_output', 'synthesize_team_deliverable'] as const;
const _opsExt = ['audit_access', 'create_status_report', 'get_access_matrix', 'get_agent_health_dashboard', 'get_data_freshness', 'get_event_bus_health', 'get_platform_audit_log', 'get_system_costs_realtime', 'predict_capacity', 'provision_access', 'revoke_access', 'rotate_secrets'] as const;
// Engineering
const _engGap = ['create_test_plan', 'get_build_queue', 'get_code_coverage', 'get_container_logs', 'get_deployment_history', 'get_infrastructure_inventory', 'get_quality_metrics', 'get_service_dependencies', 'run_test_suite', 'scale_service'] as const;
const _core  = [..._mem, ..._comm, ..._dm, ..._event, ..._assign, ..._toolReq, ..._deliver, ..._extA2a] as const;

export const AGENT_BUILT_IN_TOOLS: Record<string, string[]> = {
  // ── C-Suite & VPs ──
  'chief-of-staff': [..._core, ..._toolGrant, ..._graph, ..._sp, ..._ci, ..._agentCreate, ..._agentDir,
    ..._clientWebsitePipeline,
    'get_recent_activity', 'get_pending_decisions', 'read_proposed_initiatives', 'read_initiatives', 'activate_initiative',
    'get_product_metrics', 'get_financials', 'read_company_memory', 'send_briefing', 'create_decision',
    'log_activity', 'check_escalations', 'send_dm', 'create_calendar_event', 'read_founder_directives',
    'create_work_assignments', 'dispatch_assignment', 'check_assignment_status', 'evaluate_assignment',
    'update_directive_progress', 'propose_directive', 'delegate_directive'],
  cto: [..._core, ..._toolGrant, ..._toolReg, ..._graph, ..._sp, ..._ci, ..._agentCreate, ..._agentDir,
    ..._teamOrch, ..._peer, ..._init, ..._diag, ..._execOrch,
    'get_platform_health', 'get_cloud_run_metrics', 'get_infrastructure_costs', 'get_recent_activity',
    'read_company_memory', 'write_health_report', 'log_activity', 'get_github_pr_status',
    'get_ci_health', 'get_repo_stats', 'create_github_issue', 'list_cloud_builds', 'get_cloud_build_logs',
    'create_decision', 'get_file_contents', 'create_or_update_file', 'create_branch', 'create_github_pr',
    'merge_github_pr', 'query_db_health', 'query_db_table', 'list_agents', 'get_agent_run_history',
    'update_agent_status', 'get_agent_schedules', 'update_agent_schedule', 'get_agent_performance',
    'create_incident', 'resolve_incident', 'deploy_cloud_run', 'rollback_cloud_run',
    'update_model_config', 'query_ai_usage', 'comment_on_pr', 'list_recent_commits', 'post_to_teams',
    'inspect_cloud_run_service', 'update_cloud_run_secrets', 'web_search'],
  cpo: [..._core, ..._toolGrant, ..._graph, ..._sp, ..._ci, ..._agentCreate, ..._agentDir,
    ..._teamOrch, ..._peer, ..._init, ..._prodAnalytics, ..._compIntel, ..._roadmap,
    'get_product_metrics', 'get_recent_activity', 'read_company_memory', 'get_financials', 'write_product_analysis', 'log_activity', 'create_decision'],
  cfo: [..._core, ..._toolGrant, ..._graph, ..._sp, ..._ci, ..._agentDir,
    ..._peer, ..._init, ..._revenue, ..._costMgmt, ..._cashFlow,
    'get_financials', 'get_product_metrics', 'get_recent_activity', 'read_company_memory', 'calculate_unit_economics', 'write_financial_report', 'log_activity', 'query_stripe_mrr', 'query_stripe_subscriptions', 'create_decision'],
  cmo: [..._core, ..._toolGrant, ..._graph, ..._sp, ..._ci, ..._agentCreate, ..._agentDir,
    ..._teamOrch, ..._peer, ..._init, ..._execOrch,
    ..._content, ..._seo, ..._socialMedia, ..._mktgIntel, ..._canva, ..._logo, ..._webBuild,
    'get_product_metrics', 'get_recent_activity', 'read_company_memory', 'write_content', 'write_company_memory', 'log_activity', 'create_decision'],
  'vp-sales': [..._core, ..._toolGrant, ..._graph, ..._sp, ..._ci, ..._agentDir,
    ..._peer, ..._init,
    'get_product_metrics', 'get_financials', 'get_recent_activity', 'read_company_memory', 'write_pipeline_report', 'write_company_memory', 'log_activity', 'create_decision'],
  'vp-design': [..._core, ..._toolGrant, ..._graph, ..._sp, ..._ci, ..._agentCreate, ..._agentDir,
    ..._teamOrch, ..._peer, ..._init,
    ..._frontendCode, ..._screenshot, ..._designSys, ..._auditDsgn, ..._designBrief,
    ..._asset, ..._scaffold, ..._deployPrev, ..._webBuild, ..._figma, ..._storybook, ..._canva, ..._logo,
    'run_lighthouse', 'run_lighthouse_batch', 'get_design_quality_summary', 'get_component_library', 'get_template_registry', 'write_design_audit', 'get_recent_activity', 'read_company_memory', 'log_activity', 'create_decision'],
  // ── Operations ──
  ops: [..._core, ..._toolGrant, ..._graph, ..._sp, ..._ci, ..._diag, ..._opsExt,
    'query_agent_runs', 'query_agent_health', 'query_data_sync_status', 'query_events_backlog', 'query_cost_trends', 'trigger_agent_run', 'retry_failed_run', 'retry_data_sync', 'pause_agent', 'resume_agent'],
  // ── Sub-team: Engineering ──
  'platform-engineer': [..._core, ..._graph, ..._sp, ..._diag, ..._engGap,
    'query_cloud_run_metrics', 'run_health_check', 'query_gemini_latency', 'query_db_health', 'query_uptime', 'get_repo_code_health', 'query_vercel_health', 'log_activity', 'list_cloud_builds', 'get_cloud_build_logs', 'create_github_issue'],
  'quality-engineer': [..._core, ..._graph, ..._sp, ..._engGap,
    'query_build_logs', 'query_error_patterns', 'create_bug_report', 'query_test_results', 'log_activity', 'list_cloud_builds', 'get_cloud_build_logs', 'get_github_actions_runs', 'create_github_bug'],
  'devops-engineer': [..._core, ..._graph, ..._sp, ..._diag, ..._engGap,
    ..._clientWebsitePipeline,
    'query_cache_metrics', 'query_pipeline_metrics', 'query_resource_utilization', 'query_cold_starts', 'identify_unused_resources', 'calculate_cost_savings', 'log_activity', 'get_pipeline_runs', 'get_recent_commits', 'query_vercel_builds', 'comment_on_pr', 'list_cloud_builds'],
  // ── Sub-team: Product ──
  'user-researcher': [..._core, ..._graph, ..._sp, ..._prodAnalytics, ..._userResearch,
    'query_user_analytics', 'query_build_metadata', 'query_onboarding_funnel', 'run_cohort_analysis', 'query_churn_data', 'design_experiment', 'log_activity'],
  'competitive-intel': [..._core, ..._graph, ..._sp, ..._compIntel,
    'search_competitor_updates', 'search_competitor_news', 'search_product_launches', 'fetch_pricing_intel', 'query_competitor_tech_stack', 'check_job_postings', 'store_intel', 'log_activity'],
  // ── Sub-team: Marketing ──
  'content-creator': [..._core, ..._graph, ..._sp, ..._content,
    'draft_blog_post', 'draft_social_post', 'draft_case_study', 'draft_email', 'query_content_performance', 'query_top_performing_content', 'log_activity'],
  'seo-analyst': [..._core, ..._graph, ..._sp, ..._seo,
    'query_seo_rankings', 'query_keyword_data', 'discover_keywords', 'query_competitor_rankings', 'query_backlinks', 'analyze_content_seo', 'log_activity'],
  'social-media-manager': [..._core, ..._graph, ..._sp, ..._socialMedia,
    'query_social_metrics', 'query_post_performance', 'query_optimal_times', 'query_audience_demographics', 'monitor_mentions', 'log_activity'],
  // ── Sub-team: Design & Frontend ──
  'ui-ux-designer': [..._core, ..._graph, ..._sp,
    ..._frontendCode, ..._screenshot, ..._designSys, ..._designBrief, ..._asset, ..._webBuild, ..._quickDemoWeb, ..._figma, ..._logo,
    'save_component_spec', 'query_design_tokens', 'query_component_implementations', 'log_activity'],
  'frontend-engineer': [..._core, ..._graph, ..._sp,
    ..._frontendCode, ..._screenshot, ..._auditDsgn, ..._scaffold, ..._deployPrev, ..._codex, ..._webBuild, ..._quickDemoWeb, ..._clientWebsitePipeline, ..._storybook,
    'run_lighthouse', 'get_file_contents', 'push_component', 'create_component_branch', 'create_component_pr', 'save_component_implementation', 'query_component_specs', 'query_my_implementations', 'log_activity'],
  'design-critic': [..._core, ..._graph, ..._sp,
    ..._frontendCode, ..._screenshot, ..._designSys, ..._auditDsgn, ..._figma, ..._storybook,
    'grade_build', 'query_build_grades', 'run_lighthouse', 'log_activity'],
  'template-architect': [..._core, ..._graph, ..._sp,
    ..._frontendCode, ..._designSys, ..._asset, ..._scaffold, ..._figma, ..._storybook, ..._logo,
    'save_template_variant', 'query_template_variants', 'update_template_status', 'query_build_grades_by_template', 'log_activity'],
};

/* ── Role → title ── */
export const ROLE_TITLE: Record<string, string> = {
  'chief-of-staff': 'Chief of Staff',
  cto: 'Chief Technology Officer',
  cpo: 'Chief Product Officer',
  cfo: 'Chief Financial Officer',
  cmo: 'Chief Marketing Officer',
  clo: 'Chief Legal Officer',
  'vp-sales': 'VP Sales',
  'vp-design': 'VP Design & Frontend',
  'vp-research': 'VP Research & Intelligence',
  ops: 'Operations & System Intelligence',
  // Sub-team agents
  'platform-engineer': 'Platform Engineer',
  'quality-engineer': 'Quality Engineer',
  'devops-engineer': 'DevOps Engineer',
  'user-researcher': 'User Researcher',
  'competitive-intel': 'Competitive Intel Analyst',
  'content-creator': 'Content Creator',
  'seo-analyst': 'SEO Analyst',
  'social-media-manager': 'Social Media Manager',
  'ui-ux-designer': 'UI/UX Designer',
  'frontend-engineer': 'Frontend Engineer',
  'design-critic': 'Design Critic',
  'template-architect': 'Template Architect',
  // Customer Success
  'vp-customer-success': 'VP Customer Success',
  'onboarding-specialist': 'Onboarding Specialist',
  'support-triage': 'Support Triage',
  // Sales
  'account-research': 'Account Research',
  // Finance sub-team
  'revenue-analyst': 'Revenue Analyst',
  'cost-analyst': 'Cost Analyst',
};

/* ── Explicit manager overrides for org rebalancing ── */
export const ROLE_MANAGER_OVERRIDES: Record<string, string> = {};

/* ── Sub-team members (report to executives) ── */
export interface SubTeamMember {
  name: string;
  title: string;
  department: string;
  reportsTo: string; // exec role key
  color: string;
  initials: string;
  avatar: string; // role key for avatar path
}

export const SUB_TEAM: SubTeamMember[] = [];
