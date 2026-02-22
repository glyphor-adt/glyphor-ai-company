/**
 * Company Memory — Supabase Schema Types
 *
 * TypeScript types mirroring the Supabase tables from the architecture spec.
 * These are the database-level types (with DB column conventions).
 */

export interface DbCompanyProfile {
  id: string;
  key: string;
  value: unknown;          // JSONB
  updated_by: string;
  updated_at: string;
  version: number;
}

export interface DbProduct {
  id: string;
  slug: string;
  name: string;
  status: 'active' | 'beta' | 'concept' | 'sunset';
  roadmap: unknown[];     // JSONB array
  metrics: unknown;       // JSONB
  updated_at: string;
}

export interface DbCompanyAgent {
  id: string;
  role: string;
  display_name: string;
  model: string;
  status: 'active' | 'paused' | 'under-review';
  schedule_cron: string | null;
  last_run_at: string | null;
  last_run_duration_ms: number | null;
  last_run_cost_usd: number | null;
  performance_score: number | null;
  total_runs: number;
  total_cost_usd: number;
  config: unknown;        // JSONB
  created_at: string;
}

export interface DbDecision {
  id: string;
  tier: 'green' | 'yellow' | 'red';
  status: 'pending' | 'approved' | 'rejected' | 'discussed';
  title: string;
  summary: string;
  proposed_by: string;
  reasoning: string;
  data: unknown | null;   // JSONB
  assigned_to: string[];
  resolved_by: string | null;
  resolution_note: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface DbActivityLog {
  id: string;
  agent_role: string;
  action: string;
  product: string | null;
  summary: string;
  details: unknown | null;  // JSONB
  tier: string;
  created_at: string;
}

export interface DbCompetitiveIntel {
  id: string;
  competitor: string;
  category: 'feature_launch' | 'pricing' | 'funding' | 'partnership';
  summary: string;
  source_url: string | null;
  relevance: 'fuse' | 'pulse' | 'both' | null;
  action_recommended: string | null;
  detected_at: string;
}

export interface DbCustomerHealth {
  user_id: string;
  product: string;
  health_score: number | null;
  builds_last_7d: number | null;
  builds_last_30d: number | null;
  quality_avg: number | null;
  last_active_at: string | null;
  churn_risk: 'low' | 'medium' | 'high' | 'churned' | null;
  segment: 'power' | 'regular' | 'casual' | 'dormant' | null;
  notes: string | null;
  updated_at: string;
}

export interface DbFinancial {
  id: string;
  date: string;
  product: string | null;
  metric: string;
  value: number;
  details: unknown | null;  // JSONB
  created_at: string;
}

export interface DbProductProposal {
  id: string;
  codename: string;
  proposed_by: string;
  status: 'draft' | 'analysis' | 'review' | 'approved' | 'rejected';
  description: string;
  target_market: string | null;
  tam_estimate: unknown | null;     // JSONB
  financial_model: unknown | null;  // JSONB
  technical_feasibility: unknown | null;  // JSONB
  competitive_landscape: unknown | null;  // JSONB
  decision_id: string | null;
  created_at: string;
}
