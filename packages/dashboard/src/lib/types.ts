/* ──────────────────────────────────────────────────────
   Database types — mirrors supabase/migrations schema
   ────────────────────────────────────────────────────── */

export interface Agent {
  id: string;
  role: string;
  codename: string;
  model: string;
  department: string;
  status: 'active' | 'idle' | 'paused';
  tier: 'green' | 'yellow' | 'red';
  score: number;
  last_run: string | null;
  created_at: string;
}

export interface Decision {
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

export interface ActivityEntry {
  id: string;
  agent_id: string | null;
  action: string;
  detail: string | null;
  created_at: string;
}

export interface CompanyProfile {
  id: string;
  name: string;
  mission: string;
  values: string[];
  founded: string;
  stage: string;
  headcount: number;
}

export interface Product {
  id: string;
  name: string;
  tagline: string;
  status: string;
  mrr: number;
  users: number;
}

export interface Financial {
  id: string;
  date: string;
  product: string | null;
  metric: string;
  value: number;
  details: unknown;
  created_at: string;
}

export interface CustomerHealth {
  id: string;
  customer_name: string;
  health_score: number;
  tier: string;
  arr: number;
  risk_flag: boolean;
  last_contact: string | null;
}

/* ── Supabase generic DB shape (simplified) ── */
export interface Database {
  public: {
    Tables: {
      company_agents: { Row: Agent };
      decisions: { Row: Decision };
      activity_log: { Row: ActivityEntry };
      company_profile: { Row: CompanyProfile };
      products: { Row: Product };
      financials: { Row: Financial };
      customer_health: { Row: CustomerHealth };
    };
  };
}

/* ── Agent metadata lookup (monochrome blue-cyan spectrum) ── */
export const AGENT_META: Record<string, { color: string; icon: string }> = {
  'chief-of-staff': { color: '#623CEA', icon: 'MdBolt' },
  cto:              { color: '#0097FF', icon: 'MdCode' },
  cpo:              { color: '#00E0FF', icon: 'MdExplore' },
  cfo:              { color: '#4B9FE1', icon: 'MdBarChart' },
  cmo:              { color: '#7B68EE', icon: 'MdCampaign' },
  'vp-customer-success': { color: '#00BCD4', icon: 'MdSupportAgent' },
  'vp-sales':       { color: '#5B8DEF', icon: 'MdTrackChanges' },
  'vp-design':      { color: '#E91E63', icon: 'MdPalette' },
  ops:              { color: '#FF6B35', icon: 'MdMonitorHeart' },
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
};

/** @deprecated Use DISPLAY_NAME_MAP instead */
export const CODENAME_MAP = DISPLAY_NAME_MAP;

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
  { name: 'Alex Park',     title: 'Platform Engineer',    department: 'Engineering',       reportsTo: 'cto', color: '#0097FF', initials: 'AP', avatar: 'platform-engineer' },
  { name: 'Sam DeLuca',    title: 'Quality Engineer',     department: 'Engineering',       reportsTo: 'cto', color: '#0097FF', initials: 'SD', avatar: 'quality-engineer' },
  { name: 'Jordan Hayes',  title: 'DevOps Engineer',      department: 'Engineering',       reportsTo: 'cto', color: '#0097FF', initials: 'JH', avatar: 'devops-engineer' },
  // Product → Elena Vasquez (CPO)
  { name: 'Priya Sharma',  title: 'User Researcher',      department: 'Product',           reportsTo: 'cpo', color: '#00E0FF', initials: 'PS', avatar: 'user-researcher' },
  { name: 'Daniel Ortiz',  title: 'Competitive Intel',    department: 'Product',           reportsTo: 'cpo', color: '#00E0FF', initials: 'DO', avatar: 'competitive-intel' },
  // Finance → Nadia Okafor (CFO)
  { name: 'Anna Park',     title: 'Revenue Analyst',      department: 'Finance',           reportsTo: 'cfo', color: '#4B9FE1', initials: 'AP', avatar: 'revenue-analyst' },
  { name: 'Omar Hassan',   title: 'Cost Analyst',         department: 'Finance',           reportsTo: 'cfo', color: '#4B9FE1', initials: 'OH', avatar: 'cost-analyst' },
  // Marketing → Maya Brooks (CMO)
  { name: 'Tyler Reed',    title: 'Content Creator',      department: 'Marketing',         reportsTo: 'cmo', color: '#7B68EE', initials: 'TR', avatar: 'content-creator' },
  { name: 'Lisa Chen',     title: 'SEO Analyst',          department: 'Marketing',         reportsTo: 'cmo', color: '#7B68EE', initials: 'LC', avatar: 'seo-analyst' },
  { name: 'Kai Johnson',   title: 'Social Media Manager', department: 'Marketing',         reportsTo: 'cmo', color: '#7B68EE', initials: 'KJ', avatar: 'social-media-manager' },
  // Customer Success → James Turner (VP CS)
  { name: 'Emma Wright',   title: 'Onboarding Specialist',department: 'Customer Success',  reportsTo: 'vp-customer-success', color: '#00BCD4', initials: 'EW', avatar: 'onboarding-specialist' },
  { name: 'David Santos',  title: 'Support Triage',       department: 'Customer Success',  reportsTo: 'vp-customer-success', color: '#00BCD4', initials: 'DS', avatar: 'support-triage' },
  // Sales → Rachel Kim (VP Sales)
  { name: 'Nathan Cole',   title: 'Account Research',     department: 'Sales',             reportsTo: 'vp-sales', color: '#5B8DEF', initials: 'NC', avatar: 'account-research' },
  // Design & Frontend → Mia Tanaka (VP Design)
  { name: 'Leo Vargas',    title: 'UI/UX Designer',       department: 'Design & Frontend', reportsTo: 'vp-design', color: '#E91E63', initials: 'LV', avatar: 'ui-ux-designer' },
  { name: 'Ava Chen',      title: 'Frontend Engineer',    department: 'Design & Frontend', reportsTo: 'vp-design', color: '#E91E63', initials: 'AC', avatar: 'frontend-engineer' },
  { name: 'Sofia Marchetti', title: 'Design Critic',      department: 'Design & Frontend', reportsTo: 'vp-design', color: '#E91E63', initials: 'SM', avatar: 'design-critic' },
  { name: 'Ryan Park',     title: 'Template Architect',   department: 'Design & Frontend', reportsTo: 'vp-design', color: '#E91E63', initials: 'RP', avatar: 'template-architect' },
];
