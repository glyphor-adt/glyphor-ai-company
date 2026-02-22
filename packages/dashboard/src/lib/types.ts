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
};

export const DISPLAY_NAME_MAP: Record<string, string> = {
  'chief-of-staff': 'Sarah Chen',
  cto: 'Marcus Reeves',
  cpo: 'Elena Vasquez',
  cfo: 'Nadia Okafor',
  cmo: 'Maya Brooks',
  'vp-customer-success': 'James Turner',
  'vp-sales': 'Rachel Kim',
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
}

export const SUB_TEAM: SubTeamMember[] = [
  // Engineering → Marcus Reeves (CTO)
  { name: 'Alex Park',     title: 'Platform Engineer',    department: 'Engineering',       reportsTo: 'cto', color: '#0097FF', initials: 'AP' },
  { name: 'Sam DeLuca',    title: 'Quality Engineer',     department: 'Engineering',       reportsTo: 'cto', color: '#0097FF', initials: 'SD' },
  { name: 'Jordan Hayes',  title: 'DevOps Engineer',      department: 'Engineering',       reportsTo: 'cto', color: '#0097FF', initials: 'JH' },
  // Product → Elena Vasquez (CPO)
  { name: 'Priya Sharma',  title: 'User Researcher',      department: 'Product',           reportsTo: 'cpo', color: '#00E0FF', initials: 'PS' },
  { name: 'Daniel Ortiz',  title: 'Competitive Intel',    department: 'Product',           reportsTo: 'cpo', color: '#00E0FF', initials: 'DO' },
  // Finance → Nadia Okafor (CFO)
  { name: 'Anna Park',     title: 'Revenue Analyst',      department: 'Finance',           reportsTo: 'cfo', color: '#4B9FE1', initials: 'AP' },
  { name: 'Omar Hassan',   title: 'Cost Analyst',         department: 'Finance',           reportsTo: 'cfo', color: '#4B9FE1', initials: 'OH' },
  // Marketing → Maya Brooks (CMO)
  { name: 'Tyler Reed',    title: 'Content Creator',      department: 'Marketing',         reportsTo: 'cmo', color: '#7B68EE', initials: 'TR' },
  { name: 'Lisa Chen',     title: 'SEO Analyst',          department: 'Marketing',         reportsTo: 'cmo', color: '#7B68EE', initials: 'LC' },
  { name: 'Kai Johnson',   title: 'Social Media Manager', department: 'Marketing',         reportsTo: 'cmo', color: '#7B68EE', initials: 'KJ' },
  // Customer Success → James Turner (VP CS)
  { name: 'Emma Wright',   title: 'Onboarding Specialist',department: 'Customer Success',  reportsTo: 'vp-customer-success', color: '#00BCD4', initials: 'EW' },
  { name: 'David Santos',  title: 'Support Triage',       department: 'Customer Success',  reportsTo: 'vp-customer-success', color: '#00BCD4', initials: 'DS' },
  // Sales → Rachel Kim (VP Sales)
  { name: 'Nathan Cole',   title: 'Account Research',     department: 'Sales',             reportsTo: 'vp-sales', color: '#5B8DEF', initials: 'NC' },
];
