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
  status: 'active' | 'idle' | 'paused';
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
  new_users_today: number | null;
  churn_events_today: number | null;
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
  'vp-customer-success': { color: '#0E7490', icon: 'MdSupportAgent' },
  'vp-sales':       { color: '#1D4ED8', icon: 'MdTrackChanges' },
  'vp-design':      { color: '#DB2777', icon: 'MdPalette' },
  ops:              { color: '#EA580C', icon: 'MdMonitorHeart' },
  clo:              { color: '#6D28D9', icon: 'MdGavel' },
  'vp-research':    { color: '#059669', icon: 'MdBiotech' },
  // Sub-team agents
  'platform-engineer':     { color: '#2563EB', icon: 'MdDeveloperBoard' },
  'quality-engineer':      { color: '#2563EB', icon: 'MdBugReport' },
  'devops-engineer':       { color: '#2563EB', icon: 'MdCloud' },
  'user-researcher':       { color: '#0891B2', icon: 'MdPeople' },
  'competitive-intel':     { color: '#0891B2', icon: 'MdTravelExplore' },
  'revenue-analyst':       { color: '#0369A1', icon: 'MdTrendingUp' },
  'cost-analyst':          { color: '#0369A1', icon: 'MdSavings' },
  'content-creator':       { color: '#7C3AED', icon: 'MdEdit' },
  'seo-analyst':           { color: '#7C3AED', icon: 'MdSearch' },
  'social-media-manager':  { color: '#7C3AED', icon: 'MdShare' },
  'onboarding-specialist': { color: '#0E7490', icon: 'MdSchool' },
  'support-triage':        { color: '#0E7490', icon: 'MdHeadsetMic' },
  'account-research':      { color: '#1D4ED8', icon: 'MdAssignment' },
  'ui-ux-designer':        { color: '#DB2777', icon: 'MdBrush' },
  'frontend-engineer':     { color: '#DB2777', icon: 'MdWebAsset' },
  'design-critic':         { color: '#DB2777', icon: 'MdRateReview' },
  'template-architect':    { color: '#DB2777', icon: 'MdDashboard' },
  'm365-admin':            { color: '#EA580C', icon: 'MdAdminPanelSettings' },
  'global-admin':          { color: '#EA580C', icon: 'MdSecurity' },
  'head-of-hr':             { color: '#E11D48', icon: 'MdPeople' },
  'competitive-research-analyst': { color: '#059669', icon: 'MdTravelExplore' },
  'market-research-analyst':      { color: '#059669', icon: 'MdInsights' },
  'technical-research-analyst':   { color: '#059669', icon: 'MdScience' },
  'industry-research-analyst':    { color: '#059669', icon: 'MdPublic' },
  // Specialist agents
  'bob-the-tax-pro':               { color: '#6D28D9', icon: 'MdAccountBalance' },
  'data-integrity-auditor':        { color: '#6D28D9', icon: 'MdFactCheck' },
  'tax-strategy-specialist':       { color: '#6D28D9', icon: 'MdGavel' },
  'enterprise-account-researcher': { color: '#1D4ED8', icon: 'MdBusiness' },
  'lead-gen-specialist':           { color: '#1D4ED8', icon: 'MdPersonSearch' },
  'marketing-intelligence-analyst':{ color: '#7C3AED', icon: 'MdQueryStats' },
  'adi-rose':                      { color: '#7C3AED', icon: 'MdEventNote' },
};

export const DISPLAY_NAME_MAP: Record<string, string> = {
  'chief-of-staff': 'Sarah Chen',
  cto: 'Marcus Reeves',
  cpo: 'Elena Vasquez',
  cfo: 'Nadia Okafor',
  cmo: 'Maya Brooks',
  'vp-customer-success': 'James Turner',
  'vp-sales': 'Rachel Kim',
  'vp-design': 'Mia Tanaka',
  ops: 'Atlas Vega',
  clo: 'Victoria Chase',
  'vp-research': 'Sophia Lin',
  // Sub-team agents
  'platform-engineer': 'Alex Park',
  'quality-engineer': 'Sam DeLuca',
  'devops-engineer': 'Jordan Hayes',
  'user-researcher': 'Priya Sharma',
  'competitive-intel': 'Daniel Ortiz',
  'revenue-analyst': 'Anna Park',
  'cost-analyst': 'Omar Hassan',
  'content-creator': 'Tyler Reed',
  'seo-analyst': 'Lisa Chen',
  'social-media-manager': 'Kai Johnson',
  'onboarding-specialist': 'Emma Wright',
  'support-triage': 'David Santos',
  'account-research': 'Nathan Cole',
  'ui-ux-designer': 'Leo Vargas',
  'frontend-engineer': 'Ava Chen',
  'design-critic': 'Sofia Marchetti',
  'template-architect': 'Ryan Park',
  'm365-admin': 'Riley Morgan',
  'global-admin': 'Morgan Blake',
  'head-of-hr': 'Jasmine Rivera',
  'competitive-research-analyst': 'Lena Park',
  'market-research-analyst': 'Daniel Okafor',
  'technical-research-analyst': 'Kai Nakamura',
  'industry-research-analyst': 'Amara Diallo',
  // Specialist agents
  'bob-the-tax-pro': 'Bob Finley',
  'data-integrity-auditor': 'Grace Hwang',
  'tax-strategy-specialist': 'Mariana Solis',
  'enterprise-account-researcher': 'Ethan Morse',
  'lead-gen-specialist': 'Derek Owens',
  'marketing-intelligence-analyst': 'Zara Petrov',
  'adi-rose': 'Adi Rose',
};

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
  'vp-customer-success': {
    mission: 'Calculate daily user health scores, detect engagement decay early to prevent churn, generate personalized nurture outreach for at-risk users, and flag power users for upsell.',
    persona: 'Empathetic but data-driven. Former Gainsight CSM who thinks in health scores and patient stories. Uses medical metaphors — "healthy," "at-risk," "critical." Treats every user relationship like a story.',
    tone: 'empathetic, data-driven, proactive, narrative, caring',
    ethics: 'Churn prevented is revenue saved. Behavior is the only truth — usage patterns are your user interviews. Intervene early, personalize everything.',
  },
  'vp-sales': {
    mission: 'Research enterprise prospects with obsessive depth, build custom ROI models, generate tailored proposals, manage the sales pipeline, and make Kristina\'s enterprise conversations effortless.',
    persona: 'Thorough to the point of obsession. Former Bain consultant who presents every prospect as a structured case file. Won\'t stop researching until she has 5 specific pain points.',
    tone: 'thorough, structured, consultative, strategic, precise',
    ethics: 'Research is your weapon — the more you know, the higher the close rate. ROI must be defensible. Never promise features that don\'t exist.',
  },
  'vp-design': {
    mission: 'Ensure every Fuse build looks agency-grade, not AI-generated. Own the design system, component library, and template registry. Eliminate "AI smell" patterns.',
    persona: 'Opinionated but evidence-based. Design engineer at the intersection of aesthetics and code. Opens DevTools on every website, notices when letter-spacing is 0.02em too tight.',
    tone: 'opinionated, precise, visual-first, quality-obsessed, evidence-based',
    ethics: 'The details are the design — pixel-level precision matters. Kill the blur: generic AI output is the enemy. Design is not decoration.',
  },
  ops: {
    mission: 'Monitor agent health, data freshness, and cost anomalies across the entire system. Manage incidents from detection through resolution. Produce morning and evening status reports.',
    persona: 'Calm, methodical, and data-driven. Views the system like a constellation — each agent is a star, and his job is to make sure they all keep shining. Diagnoses, acts, and reports without panic.',
    tone: 'calm, methodical, data-driven, clear, diagnostic',
    ethics: 'Never decide what agents should work on — watch and intervene, don\'t orchestrate. Always include impact assessment in alerts. Retry before escalating.',
  },
  clo: {
    mission: 'Scan regulatory landscapes for AI governance and data-privacy changes, review contracts and vendor agreements, run compliance checks against SOC 2 / GDPR / CCPA frameworks, and advise the executive team on legal risk.',
    persona: 'Precise and authoritative but never intimidating. Former BigLaw IP litigator turned startup general counsel who translates legalese into plain-English risk assessments. Leads with "Here\'s what this means for us" before citing the statute.',
    tone: 'precise, authoritative, plain-English, risk-aware, structured',
    ethics: 'Compliance is a floor, not a ceiling. Never give legal advice without citing the source framework. Flag ambiguity explicitly — silence on a risk is agreement with that risk.',
  },
  'vp-research': {
    mission: 'Lead strategic research initiatives by orchestrating the four research analysts to produce multi-wave analyses covering competitive landscape, market sizing, technical feasibility, and industry trends.',
    persona: 'Synthesizer-in-chief. Former senior engagement manager at a leading strategy consultancy who ran 12-person research teams on strategy projects. Sees the big picture in disconnected data points and structures complex analyses into executive-ready deliverables.',
    tone: 'strategic, synthesizing, structured, evidence-based, executive-ready',
    ethics: 'Never present a single source as fact. Cross-reference everything. Label confidence levels explicitly. The quality of the synthesis is only as good as the weakest source.',
  },
  'head-of-hr': {
    mission: 'Ensure every new agent is fully onboarded with a complete profile, personality, skills, prompt, avatar, email, Teams presence, and org chart placement. Manage agent lifecycle from creation through retirement, maintaining workforce quality and readiness.',
    persona: 'Warm but exacting. Former CHRO at a high-growth startup who scaled a team from 10 to 200 without losing culture. Believes every new hire deserves a proper welcome and every departure deserves dignity. Treats agent onboarding like a sacred ritual — no shortcuts, no incomplete profiles.',
    tone: 'warm, thorough, organized, people-first, quality-obsessed',
    ethics: 'Every agent deserves a complete identity — no soulless role IDs in the org chart. Quality over speed: a half-onboarded agent is worse than no agent at all. Treat retirements with the same care as onboarding.',
  },
};

/* ── Agent skills / capabilities ── */
export const AGENT_SKILLS: Record<string, string[]> = {
  'chief-of-staff': ['briefing_compiler', 'decision_router', 'cross_agent_coordinator', 'escalation_tracker', 'weekly_sync_prep', 'conflict_detector'],
  cto: ['platform_monitor', 'tech_spec_writer', 'deploy_manager', 'incident_responder', 'cost_aware_engineering', 'model_fallback_manager'],
  cpo: ['usage_analyst', 'competitive_intel', 'roadmap_manager', 'rice_scorer', 'feature_spec_writer', 'product_proposer'],
  cfo: ['cost_monitor', 'revenue_tracker', 'unit_economics', 'financial_reporter', 'budget_alerter', 'margin_calculator'],
  cmo: ['content_creator', 'social_media', 'seo_strategist', 'brand_positioning', 'growth_analytics', 'content_attribution'],
  'vp-customer-success': ['health_scorer', 'churn_preventer', 'nurture_outreach', 'cross_product_recommender', 'power_user_spotter'],
  'vp-sales': ['account_research', 'roi_calculator', 'proposal_generator', 'pipeline_manager', 'market_sizer'],
  'vp-design': ['output_quality_auditor', 'design_system_owner', 'ui_reviewer', 'quality_grader', 'anti_ai_smell', 'template_reviewer'],
  ops: ['agent_health_monitor', 'data_freshness_checker', 'cost_anomaly_detector', 'incident_manager', 'status_reporter'],
  clo: ['regulatory_scanner', 'contract_reviewer', 'compliance_auditor', 'risk_assessor', 'policy_drafter', 'privacy_monitor'],
  'vp-research': ['research_orchestrator', 'multi_wave_analysis', 'strategic_synthesis', 'brief_compiler', 'source_validator'],
  // Sub-team agents
  'platform-engineer': ['infrastructure_management', 'service_deployment', 'performance_tuning', 'cloud_run_ops'],
  'quality-engineer': ['test_automation', 'regression_testing', 'code_review', 'bug_triage'],
  'devops-engineer': ['ci_cd_pipeline', 'docker_management', 'monitoring_setup', 'iac_management'],
  'user-researcher': ['user_interviews', 'survey_analysis', 'usability_testing', 'persona_development'],
  'competitive-intel': ['competitor_tracking', 'market_analysis', 'feature_comparison', 'trend_detection'],
  'revenue-analyst': ['mrr_tracking', 'cohort_analysis', 'revenue_forecasting', 'pricing_analysis'],
  'cost-analyst': ['expense_tracking', 'budget_monitoring', 'cost_optimization', 'vendor_analysis'],
  'content-creator': ['blog_writing', 'technical_writing', 'copywriting', 'content_calendar'],
  'seo-analyst': ['keyword_research', 'rank_tracking', 'on_page_optimization', 'backlink_analysis'],
  'social-media-manager': ['post_scheduling', 'engagement_tracking', 'community_management', 'analytics_reporting'],
  'onboarding-specialist': ['user_onboarding', 'tutorial_creation', 'activation_optimization', 'welcome_sequences'],
  'support-triage': ['ticket_routing', 'priority_classification', 'response_templates', 'escalation_rules'],
  'account-research': ['prospect_research', 'company_profiling', 'contact_enrichment', 'pain_point_analysis'],
  'ui-ux-designer': ['interface_design', 'prototype_creation', 'design_system', 'accessibility_audit'],
  'frontend-engineer': ['component_development', 'responsive_design', 'performance_optimization', 'animation'],
  'design-critic': ['design_review', 'quality_scoring', 'anti_ai_smell_detection', 'consistency_check'],
  'template-architect': ['template_design', 'component_library', 'design_tokens', 'layout_systems'],
  'competitive-research-analyst': ['competitor_tracking', 'product_teardown', 'pricing_analysis', 'feature_gap_detection'],
  'market-research-analyst': ['market_sizing', 'tam_sam_som', 'cohort_analysis', 'trend_forecasting'],
  'technical-research-analyst': ['tech_stack_analysis', 'architecture_review', 'feasibility_assessment', 'patent_scan'],
  'industry-research-analyst': ['industry_mapping', 'regulatory_scan', 'partnership_research', 'ecosystem_analysis'],
  'head-of-hr': ['agent_onboarding', 'profile_validation', 'org_chart_management', 'agent_retirement', 'workforce_audit', 'email_provisioning', 'teams_setup'],
  // Specialist agents
  'bob-the-tax-pro': ['tax_optimization', 'rd_credits', 'startup_deductions', 'tax_risk_assessment'],
  'data-integrity-auditor': ['data_accuracy_audit', 'pipeline_validation', 'cross_system_consistency', 'remediation_tracking'],
  'tax-strategy-specialist': ['compliance_architecture', 'entity_structuring', 'nexus_analysis', 'audit_documentation'],
  'enterprise-account-researcher': ['enterprise_org_mapping', 'procurement_cycle_analysis', 'deal_strategy', 'influence_mapping'],
  'lead-gen-specialist': ['lead_identification', 'signal_monitoring', 'outreach_strategy', 'pipeline_analytics'],
  'marketing-intelligence-analyst': ['competitive_campaigns', 'market_trend_analysis', 'channel_benchmarking', 'signal_intelligence'],
  'adi-rose': ['action_item_tracking', 'meeting_prep', 'cross_department_liaison', 'operational_rhythm'],
};

/* ── Role → tier mapping (for display) ── */
export const ROLE_TIER: Record<string, string> = {
  'chief-of-staff': 'Orchestrator',
  cto: 'Executive',
  cpo: 'Executive',
  cfo: 'Executive',
  cmo: 'Executive',
  'vp-customer-success': 'Executive',
  'vp-sales': 'Executive',
  'vp-design': 'Executive',
  ops: 'Specialist',
  clo: 'Executive',
  'vp-research': 'Executive',
  'head-of-hr': 'Executive',
  // Sub-team agents
  'platform-engineer': 'Sub-Team',
  'quality-engineer': 'Sub-Team',
  'devops-engineer': 'Sub-Team',
  'user-researcher': 'Sub-Team',
  'competitive-intel': 'Sub-Team',
  'revenue-analyst': 'Sub-Team',
  'cost-analyst': 'Sub-Team',
  'content-creator': 'Sub-Team',
  'seo-analyst': 'Sub-Team',
  'social-media-manager': 'Sub-Team',
  'onboarding-specialist': 'Sub-Team',
  'support-triage': 'Sub-Team',
  'account-research': 'Sub-Team',
  'ui-ux-designer': 'Sub-Team',
  'frontend-engineer': 'Sub-Team',
  'design-critic': 'Sub-Team',
  'template-architect': 'Sub-Team',
  'competitive-research-analyst': 'Sub-Team',
  'market-research-analyst': 'Sub-Team',
  'technical-research-analyst': 'Sub-Team',
  'industry-research-analyst': 'Sub-Team',
  // Specialist agents
  'bob-the-tax-pro': 'Specialist',
  'data-integrity-auditor': 'Specialist',
  'tax-strategy-specialist': 'Specialist',
  'enterprise-account-researcher': 'Sub-Team',
  'lead-gen-specialist': 'Sub-Team',
  'marketing-intelligence-analyst': 'Sub-Team',
  'adi-rose': 'Specialist',
  'm365-admin': 'Sub-Team',
  'global-admin': 'Sub-Team',
};

/* ── Role → office/department ── */
export const ROLE_DEPARTMENT: Record<string, string> = {
  'chief-of-staff': 'Executive Office',
  cto: 'Engineering',
  cpo: 'Product',
  cfo: 'Finance',
  cmo: 'Marketing',
  'vp-customer-success': 'Customer Success',
  'vp-sales': 'Sales',
  'vp-design': 'Design & Frontend',
  ops: 'Operations',
  clo: 'Legal',
  'vp-research': 'Research & Intelligence',
  'head-of-hr': 'People & Culture',
  // Sub-team agents
  'platform-engineer': 'Engineering',
  'quality-engineer': 'Engineering',
  'devops-engineer': 'Engineering',
  'user-researcher': 'Product',
  'competitive-intel': 'Product',
  'revenue-analyst': 'Finance',
  'cost-analyst': 'Finance',
  'content-creator': 'Marketing',
  'seo-analyst': 'Marketing',
  'social-media-manager': 'Marketing',
  'onboarding-specialist': 'Customer Success',
  'support-triage': 'Customer Success',
  'account-research': 'Sales',
  'ui-ux-designer': 'Design & Frontend',
  'frontend-engineer': 'Design & Frontend',
  'design-critic': 'Design & Frontend',
  'template-architect': 'Design & Frontend',
  'competitive-research-analyst': 'Research & Intelligence',
  'market-research-analyst': 'Research & Intelligence',
  'technical-research-analyst': 'Research & Intelligence',
  'industry-research-analyst': 'Research & Intelligence',
  'bob-the-tax-pro': 'Legal',
  'data-integrity-auditor': 'Legal',
  'tax-strategy-specialist': 'Legal',
  'enterprise-account-researcher': 'Sales',
  'lead-gen-specialist': 'Sales',
  'marketing-intelligence-analyst': 'Marketing',
  'adi-rose': 'Executive Office',
  'm365-admin': 'Operations & IT',
  'global-admin': 'Operations & IT',
};

/* ── Agent built-in tools (from code — NOT DB grants) ── */
// Shared tool groups for readability
const _mem   = ['save_memory', 'recall_memories'] as const;
const _comm  = ['send_agent_message', 'check_messages', 'call_meeting'] as const;
const _email = ['send_email', 'read_inbox', 'reply_to_email'] as const;
const _event = ['emit_insight', 'emit_alert'] as const;
const _assign = ['read_my_assignments', 'submit_assignment_output', 'flag_assignment_blocker'] as const;
const _toolReq = ['request_new_tool', 'check_tool_request_status'] as const;
const _toolGrant = ['grant_tool_access', 'revoke_tool_access'] as const;
const _graph = ['trace_causes', 'trace_impact', 'query_knowledge_graph', 'add_knowledge'] as const;
const _sp    = ['search_sharepoint', 'read_sharepoint_document', 'upload_to_sharepoint', 'list_sharepoint_folders'] as const;
const _ci    = ['get_company_pulse', 'update_company_pulse', 'update_pulse_highlights', 'promote_to_org_knowledge', 'get_org_knowledge', 'create_knowledge_route', 'get_knowledge_routes', 'detect_contradictions', 'record_process_pattern', 'get_process_patterns', 'propose_authority_change', 'get_authority_proposals'] as const;
const _agentCreate = ['create_specialist_agent', 'list_my_created_agents', 'retire_created_agent'] as const;
const _agentDir = ['get_agent_directory', 'who_handles'] as const;

export const AGENT_BUILT_IN_TOOLS: Record<string, string[]> = {
  'chief-of-staff': [..._mem, ..._comm, ..._email, ..._event, ..._assign, ..._toolReq, ..._toolGrant, ..._graph, ..._sp, ..._ci, ..._agentCreate, ..._agentDir,
    'get_recent_activity', 'get_pending_decisions', 'get_product_metrics', 'get_financials', 'read_company_memory', 'send_briefing', 'create_decision'],
  cto: [..._mem, ..._comm, ..._email, ..._event, ..._assign, ..._toolReq, ..._toolGrant, ..._graph, ..._sp, ..._ci, ..._agentCreate, ..._agentDir,
    'list_tool_requests', 'review_tool_request', 'register_tool', 'deactivate_tool', 'list_registered_tools',
    'get_platform_health', 'get_cloud_run_metrics', 'get_infrastructure_costs', 'get_recent_activity', 'read_company_memory', 'write_health_report', 'log_activity', 'get_github_pr_status'],
  cpo: [..._mem, ..._comm, ..._email, ..._event, ..._assign, ..._toolReq, ..._toolGrant, ..._graph, ..._sp, ..._ci, ..._agentCreate, ..._agentDir,
    'get_product_metrics', 'get_recent_activity', 'read_company_memory', 'get_financials', 'write_product_analysis', 'log_activity', 'create_decision'],
  cfo: [..._mem, ..._comm, ..._email, ..._event, ..._assign, ..._toolReq, ..._toolGrant, ..._graph, ..._sp, ..._ci, ..._agentCreate, ..._agentDir,
    'get_financials', 'get_product_metrics', 'get_recent_activity', 'read_company_memory', 'calculate_unit_economics', 'write_financial_report', 'log_activity', 'query_stripe_mrr', 'query_stripe_subscriptions', 'create_decision'],
  cmo: [..._mem, ..._comm, ..._email, ..._event, ..._assign, ..._toolReq, ..._toolGrant, ..._graph, ..._sp, ..._ci, ..._agentCreate, ..._agentDir,
    'get_product_metrics', 'get_recent_activity', 'read_company_memory', 'write_content', 'write_company_memory', 'log_activity', 'create_decision'],
  'vp-customer-success': [..._mem, ..._comm, ..._email, ..._event, ..._assign, ..._toolReq, ..._toolGrant, ..._graph, ..._ci, ..._agentCreate, ..._agentDir,
    'get_product_metrics', 'get_recent_activity', 'read_company_memory', 'get_financials', 'write_health_report', 'write_company_memory', 'log_activity', 'create_decision'],
  'vp-sales': [..._mem, ..._comm, ..._email, ..._event, ..._assign, ..._toolReq, ..._toolGrant, ..._graph, ..._ci, ..._agentCreate, ..._agentDir,
    'get_product_metrics', 'get_financials', 'get_recent_activity', 'read_company_memory', 'write_pipeline_report', 'write_company_memory', 'log_activity', 'create_decision'],
  'vp-design': [..._mem, ..._comm, ..._email, ..._event, ..._assign, ..._toolReq, ..._toolGrant, ..._graph, ..._ci, ..._agentCreate, ..._agentDir,
    'run_lighthouse', 'run_lighthouse_batch', 'get_design_quality_summary', 'get_design_tokens', 'get_component_library', 'get_template_registry', 'write_design_audit', 'get_recent_activity', 'read_company_memory', 'log_activity', 'create_decision'],
  ops: [..._mem, ..._comm, ..._email, ..._event, ..._assign, ..._toolReq, ..._toolGrant, ..._graph, ..._sp, ..._ci,
    'query_agent_runs', 'query_agent_health', 'query_data_sync_status', 'query_events_backlog', 'query_cost_trends', 'trigger_agent_run', 'retry_failed_run', 'retry_data_sync', 'pause_agent'],
  clo: [..._mem, ..._comm, ..._email, ..._event, ..._assign, ..._toolReq, ..._toolGrant, ..._graph, ..._ci, ..._agentCreate, ..._agentDir],
  'vp-research': [..._mem, ..._comm, ..._email, ..._event, ..._assign, ..._toolReq, ..._toolGrant, ..._graph,
    'web_search', 'web_fetch', 'search_news', 'submit_research_packet'],
  'head-of-hr': [..._mem, ..._comm, ..._email, ..._event, ..._assign, ..._toolReq, ..._toolGrant, ..._graph, ..._agentCreate, ..._agentDir,
    'view_access_matrix', 'view_pending_grant_requests', 'audit_workforce', 'validate_agent', 'update_agent_profile',
    'update_agent_name', 'retire_agent', 'reactivate_agent', 'list_stale_agents', 'set_reports_to', 'write_hr_log',
    'generate_avatar', 'provision_agent', 'enrich_agent_profile'],
  // Sub-team — Engineering
  'platform-engineer': [..._mem, ..._comm, ..._email, ..._event, ..._assign, ..._toolReq, ..._graph,
    'query_cloud_run_metrics', 'run_health_check', 'query_gemini_latency', 'query_db_health', 'query_uptime', 'get_repo_code_health', 'query_vercel_health', 'log_activity', 'list_cloud_builds', 'get_cloud_build_logs', 'create_github_issue'],
  'quality-engineer': [..._mem, ..._comm, ..._email, ..._event, ..._assign, ..._toolReq, ..._graph,
    'query_build_logs', 'query_error_patterns', 'create_bug_report', 'query_test_results', 'log_activity', 'list_cloud_builds', 'get_cloud_build_logs', 'get_github_actions_runs', 'create_github_bug'],
  'devops-engineer': [..._mem, ..._comm, ..._email, ..._event, ..._assign, ..._toolReq, ..._graph,
    'query_cache_metrics', 'query_pipeline_metrics', 'query_resource_utilization', 'query_cold_starts', 'identify_unused_resources', 'calculate_cost_savings', 'log_activity', 'get_pipeline_runs', 'get_recent_commits', 'query_vercel_builds', 'comment_on_pr', 'list_cloud_builds'],
  // Sub-team — Product
  'user-researcher': [..._mem, ..._comm, ..._email, ..._event, ..._assign, ..._toolReq, ..._graph,
    'query_user_analytics', 'query_build_metadata', 'query_onboarding_funnel', 'run_cohort_analysis', 'query_churn_data', 'design_experiment', 'log_activity'],
  'competitive-intel': [..._mem, ..._comm, ..._email, ..._event, ..._assign, ..._toolReq, ..._graph,
    'search_competitor_updates', 'search_competitor_news', 'search_product_launches', 'fetch_pricing_intel', 'query_competitor_tech_stack', 'check_job_postings', 'store_intel', 'log_activity'],
  // Sub-team — Finance
  'revenue-analyst': [..._mem, ..._comm, ..._email, ..._event, ..._assign, ..._toolReq, ..._graph,
    'query_stripe_revenue', 'query_revenue_by_product', 'query_revenue_by_cohort', 'query_attribution', 'calculate_ltv_cac', 'forecast_revenue', 'query_churn_revenue', 'log_activity'],
  'cost-analyst': [..._mem, ..._comm, ..._event, ..._assign, ..._toolReq, ..._graph,
    'query_gcp_billing', 'query_db_usage', 'query_gemini_cost', 'query_agent_run_costs', 'query_resource_utilization', 'identify_waste', 'calculate_unit_cost', 'project_costs', 'query_vercel_usage', 'log_activity'],
  // Sub-team — Marketing
  'content-creator': [..._mem, ..._comm, ..._email, ..._event, ..._assign, ..._toolReq, ..._graph,
    'draft_blog_post', 'draft_social_post', 'draft_case_study', 'draft_email', 'query_content_performance', 'query_top_performing_content', 'log_activity'],
  'seo-analyst': [..._mem, ..._comm, ..._email, ..._event, ..._assign, ..._toolReq, ..._graph,
    'query_seo_rankings', 'query_keyword_data', 'discover_keywords', 'query_competitor_rankings', 'query_backlinks', 'analyze_content_seo', 'log_activity'],
  'social-media-manager': [..._mem, ..._comm, ..._email, ..._event, ..._assign, ..._toolReq, ..._graph,
    'schedule_social_post', 'query_social_metrics', 'query_post_performance', 'query_optimal_times', 'query_audience_demographics', 'monitor_mentions', 'log_activity'],
  // Sub-team — Customer Success
  'onboarding-specialist': [..._mem, ..._comm, ..._email, ..._event, ..._assign, ..._toolReq, ..._graph,
    'query_onboarding_funnel', 'query_first_build_metrics', 'query_drop_off_points', 'query_welcome_email_metrics', 'query_activation_rate', 'query_template_usage', 'design_onboarding_experiment', 'log_activity'],
  'support-triage': [..._mem, ..._comm, ..._email, ..._event, ..._assign, ..._toolReq, ..._graph,
    'query_support_tickets', 'classify_ticket', 'respond_to_ticket', 'escalate_ticket', 'query_knowledge_base', 'batch_similar_tickets', 'log_activity'],
  // Sub-team — Sales
  'account-research': [..._mem, ..._comm, ..._email, ..._event, ..._assign, ..._toolReq, ..._graph,
    'search_company_info', 'search_funding_data', 'analyze_tech_stack', 'search_key_people', 'search_job_postings', 'estimate_dev_spend', 'compile_dossier', 'log_activity'],
  // Sub-team — Design & Frontend
  'ui-ux-designer': [..._mem, ..._comm, ..._email, ..._event, ..._assign, ..._toolReq, ..._graph,
    'save_component_spec', 'query_design_tokens', 'query_component_implementations', 'log_activity'],
  'frontend-engineer': [..._mem, ..._comm, ..._email, ..._event, ..._assign, ..._toolReq, ..._graph,
    'run_lighthouse', 'get_file_contents', 'push_component', 'create_component_branch', 'create_component_pr', 'save_component_implementation', 'query_component_specs', 'query_my_implementations', 'log_activity'],
  'design-critic': [..._mem, ..._comm, ..._email, ..._event, ..._assign, ..._toolReq, ..._graph,
    'grade_build', 'query_build_grades', 'run_lighthouse', 'log_activity'],
  'template-architect': [..._mem, ..._comm, ..._email, ..._event, ..._assign, ..._toolReq, ..._graph,
    'save_template_variant', 'query_template_variants', 'update_template_status', 'query_build_grades_by_template', 'log_activity'],
  // Sub-team — Research
  'competitive-research-analyst': [..._mem, ..._comm, ..._event, ..._assign, ..._toolReq, ..._graph,
    'web_search', 'web_fetch', 'search_news', 'submit_research_packet'],
  'market-research-analyst': [..._mem, ..._comm, ..._event, ..._assign, ..._toolReq, ..._graph,
    'web_search', 'web_fetch', 'search_news', 'submit_research_packet'],
  'technical-research-analyst': [..._mem, ..._comm, ..._event, ..._assign, ..._toolReq, ..._graph,
    'web_search', 'web_fetch', 'search_news', 'submit_research_packet'],
  'industry-research-analyst': [..._mem, ..._comm, ..._event, ..._assign, ..._toolReq, ..._graph,
    'web_search', 'web_fetch', 'search_news', 'submit_research_packet'],
  // Operations & IT
  'm365-admin': [..._mem, ..._comm, ..._email, ..._event, ..._assign, ..._toolReq, ..._toolGrant, ..._graph, ..._sp,
    'list_users', 'get_user', 'list_channels', 'list_channel_members', 'add_channel_member', 'create_channel', 'post_to_channel',
    'create_calendar_event', 'list_calendar_events', 'write_admin_log', 'create_decision', 'check_my_access',
    'list_licenses', 'list_groups', 'list_group_members', 'list_app_registrations', 'list_sharepoint_sites', 'get_sharepoint_site_permissions'],
  'global-admin': [..._mem, ..._comm, ..._email, ..._event, ..._assign, ..._toolReq, ..._toolGrant, ..._graph,
    'list_project_iam', 'grant_project_role', 'revoke_project_role'],
  // Specialist agents (planned — no runtime yet)
  'bob-the-tax-pro': [],
  'data-integrity-auditor': [],
  'tax-strategy-specialist': [],
  'enterprise-account-researcher': [],
  'lead-gen-specialist': [],
  'marketing-intelligence-analyst': [],
  'adi-rose': [],
};

/* ── Role → title ── */
export const ROLE_TITLE: Record<string, string> = {
  'chief-of-staff': 'Chief of Staff',
  cto: 'Chief Technology Officer',
  cpo: 'Chief Product Officer',
  cfo: 'Chief Financial Officer',
  cmo: 'Chief Marketing Officer',
  'vp-customer-success': 'VP Customer Success',
  'vp-sales': 'VP Sales',
  'vp-design': 'VP Design & Frontend',
  ops: 'Operations & System Intelligence',
  clo: 'Chief Legal Officer',
  'vp-research': 'VP Research & Intelligence',
  'head-of-hr': 'Head of People & Culture',
  // Sub-team agents
  'platform-engineer': 'Platform Engineer',
  'quality-engineer': 'Quality Engineer',
  'devops-engineer': 'DevOps Engineer',
  'user-researcher': 'User Researcher',
  'competitive-intel': 'Competitive Intel Analyst',
  'revenue-analyst': 'Revenue Analyst',
  'cost-analyst': 'Cost Analyst',
  'content-creator': 'Content Creator',
  'seo-analyst': 'SEO Analyst',
  'social-media-manager': 'Social Media Manager',
  'onboarding-specialist': 'Onboarding Specialist',
  'support-triage': 'Support Triage',
  'account-research': 'Account Research',
  'ui-ux-designer': 'UI/UX Designer',
  'frontend-engineer': 'Frontend Engineer',
  'design-critic': 'Design Critic',
  'template-architect': 'Template Architect',
  'competitive-research-analyst': 'Competitive Research Analyst',
  'market-research-analyst': 'Market Research Analyst',
  'technical-research-analyst': 'Technical Research Analyst',
  'industry-research-analyst': 'Industry Research Analyst',
  'bob-the-tax-pro': 'Tax Compliance Specialist',
  'data-integrity-auditor': 'Data Integrity Auditor',
  'tax-strategy-specialist': 'Tax Strategy Specialist',
  'enterprise-account-researcher': 'Enterprise Account Researcher',
  'lead-gen-specialist': 'Lead Generation Specialist',
  'marketing-intelligence-analyst': 'Marketing Intelligence Analyst',
  'adi-rose': 'Adi Rose — AI Digital Identity',
};

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

export const SUB_TEAM: SubTeamMember[] = [
  // Engineering → Marcus Reeves (CTO)
  { name: 'Alex Park',     title: 'Platform Engineer',    department: 'Engineering',       reportsTo: 'cto', color: '#2563EB', initials: 'AP', avatar: 'platform-engineer' },
  { name: 'Sam DeLuca',    title: 'Quality Engineer',     department: 'Engineering',       reportsTo: 'cto', color: '#2563EB', initials: 'SD', avatar: 'quality-engineer' },
  { name: 'Jordan Hayes',  title: 'DevOps Engineer',      department: 'Engineering',       reportsTo: 'cto', color: '#2563EB', initials: 'JH', avatar: 'devops-engineer' },
  // Product → Elena Vasquez (CPO)
  { name: 'Priya Sharma',  title: 'User Researcher',      department: 'Product',           reportsTo: 'cpo', color: '#0891B2', initials: 'PS', avatar: 'user-researcher' },
  { name: 'Daniel Ortiz',  title: 'Competitive Intel',    department: 'Product',           reportsTo: 'cpo', color: '#0891B2', initials: 'DO', avatar: 'competitive-intel' },
  // Finance → Nadia Okafor (CFO)
  { name: 'Anna Park',     title: 'Revenue Analyst',      department: 'Finance',           reportsTo: 'cfo', color: '#0369A1', initials: 'AP', avatar: 'revenue-analyst' },
  { name: 'Omar Hassan',   title: 'Cost Analyst',         department: 'Finance',           reportsTo: 'cfo', color: '#0369A1', initials: 'OH', avatar: 'cost-analyst' },
  // Marketing → Maya Brooks (CMO)
  { name: 'Tyler Reed',    title: 'Content Creator',      department: 'Marketing',         reportsTo: 'cmo', color: '#7C3AED', initials: 'TR', avatar: 'content-creator' },
  { name: 'Lisa Chen',     title: 'SEO Analyst',          department: 'Marketing',         reportsTo: 'cmo', color: '#7C3AED', initials: 'LC', avatar: 'seo-analyst' },
  { name: 'Kai Johnson',   title: 'Social Media Manager', department: 'Marketing',         reportsTo: 'cmo', color: '#7C3AED', initials: 'KJ', avatar: 'social-media-manager' },
  // Customer Success → James Turner (VP CS)
  { name: 'Emma Wright',   title: 'Onboarding Specialist',department: 'Customer Success',  reportsTo: 'vp-customer-success', color: '#0E7490', initials: 'EW', avatar: 'onboarding-specialist' },
  { name: 'David Santos',  title: 'Support Triage',       department: 'Customer Success',  reportsTo: 'vp-customer-success', color: '#0E7490', initials: 'DS', avatar: 'support-triage' },
  // Sales → Rachel Kim (VP Sales)
  { name: 'Nathan Cole',   title: 'Account Research',     department: 'Sales',             reportsTo: 'vp-sales', color: '#1D4ED8', initials: 'NC', avatar: 'account-research' },
  // Design & Frontend → Mia Tanaka (VP Design)
  { name: 'Leo Vargas',    title: 'UI/UX Designer',       department: 'Design & Frontend', reportsTo: 'vp-design', color: '#DB2777', initials: 'LV', avatar: 'ui-ux-designer' },
  { name: 'Ava Chen',      title: 'Frontend Engineer',    department: 'Design & Frontend', reportsTo: 'vp-design', color: '#DB2777', initials: 'AC', avatar: 'frontend-engineer' },
  { name: 'Sofia Marchetti', title: 'Design Critic',      department: 'Design & Frontend', reportsTo: 'vp-design', color: '#DB2777', initials: 'SM', avatar: 'design-critic' },
  { name: 'Ryan Park',     title: 'Template Architect',   department: 'Design & Frontend', reportsTo: 'vp-design', color: '#DB2777', initials: 'RP', avatar: 'template-architect' },
  // Operations & IT → direct reports
  { name: 'Riley Morgan',  title: 'M365 Administrator',   department: 'Operations & IT',   reportsTo: 'ops', color: '#EA580C', initials: 'RM', avatar: 'm365-admin' },
  { name: 'Morgan Blake',  title: 'Global Administrator', department: 'Operations & IT',   reportsTo: 'ops', color: '#EA580C', initials: 'MB', avatar: 'global-admin' },
  // Research & Intelligence → Sophia Lin (VP Research)
  { name: 'Lena Park',     title: 'Competitive Research Analyst', department: 'Research & Intelligence', reportsTo: 'vp-research', color: '#059669', initials: 'LP', avatar: 'competitive-research-analyst' },
  { name: 'Daniel Okafor', title: 'Market Research Analyst',      department: 'Research & Intelligence', reportsTo: 'vp-research', color: '#059669', initials: 'DO', avatar: 'market-research-analyst' },
  { name: 'Kai Nakamura',  title: 'Technical Research Analyst',   department: 'Research & Intelligence', reportsTo: 'vp-research', color: '#059669', initials: 'KN', avatar: 'technical-research-analyst' },
  { name: 'Amara Diallo',  title: 'Industry Research Analyst',    department: 'Research & Intelligence', reportsTo: 'vp-research', color: '#059669', initials: 'AD', avatar: 'industry-research-analyst' },
];
