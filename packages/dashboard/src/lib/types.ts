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
  agent_id: string;
  title: string;
  description: string;
  impact: 'low' | 'medium' | 'high' | 'critical';
  status: 'pending' | 'approved' | 'rejected';
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

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
  period: string;
  revenue: number;
  costs: number;
  runway_months: number;
  mrr: number;
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

/* ── Agent metadata lookup ── */
export const AGENT_META: Record<string, { color: string; icon: string }> = {
  'chief-of-staff': { color: '#8b5cf6', icon: '⚡' },
  cto:              { color: '#ef4444', icon: '🔧' },
  cpo:              { color: '#06b6d4', icon: '🧭' },
  cfo:              { color: '#10b981', icon: '📊' },
  cmo:              { color: '#ec4899', icon: '📡' },
  'vp-cs':          { color: '#3b82f6', icon: '🛟' },
  'vp-sales':       { color: '#f59e0b', icon: '🎯' },
};

export const CODENAME_MAP: Record<string, string> = {
  'chief-of-staff': 'Atlas',
  cto: 'Forge',
  cpo: 'Compass',
  cfo: 'Ledger',
  cmo: 'Beacon',
  'vp-cs': 'Harbor',
  'vp-sales': 'Closer',
};
