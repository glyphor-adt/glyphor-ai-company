/**
 * Company Memory — Database Schema Types
 *
 * TypeScript types mirroring the PostgreSQL tables from the architecture spec.
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
  relevance: 'web-build' | 'pulse' | 'both' | null;
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

// ─── Autonomous Operations Tables ─────────────────────────────

export interface DbEvent {
  id: string;
  type: string;
  source: string;
  timestamp: string;
  payload: unknown;           // JSONB
  priority: string;
  processed_by: string[];
  correlation_id: string | null;
}

export interface DbAgentMemory {
  id: string;
  agent_role: string;
  memory_type: string;
  content: string;
  importance: number;
  source_run_id: string | null;
  tags: string[];
  expires_at: string | null;
  embedding: number[] | null;
  created_at: string;
}

export interface DbAgentReflection {
  id: string;
  agent_role: string;
  run_id: string;
  summary: string;
  quality_score: number;
  what_went_well: string[];
  what_could_improve: string[];
  prompt_suggestions: string[];
  knowledge_gaps: string[];
  created_at: string;
}

// ─── Knowledge Management Tables ──────────────────────────────

export interface DbCompanyKnowledgeBase {
  id: string;
  section: string;
  title: string;
  content: string;
  audience: string;
  last_edited_by: string;
  version: number;
  is_active: boolean;
  updated_at: string;
  created_at: string;
}

export interface DbFounderBulletin {
  id: string;
  created_by: string;
  content: string;
  audience: string;
  priority: 'fyi' | 'normal' | 'important' | 'urgent';
  active_from: string;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
}

// ─── Founder Orchestration Tables ─────────────────────────────

export interface DbFounderDirective {
  id: string;
  created_by: string;
  title: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  target_agents: string[];
  department: string | null;
  status: 'active' | 'paused' | 'completed' | 'cancelled';
  due_date: string | null;
  progress_notes: string[];
  completion_summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbWorkAssignment {
  id: string;
  directive_id: string;
  assigned_to: string;
  task_description: string;
  task_type: string;
  expected_output: string | null;
  priority: 'urgent' | 'high' | 'normal' | 'low';
  depends_on: string[] | null;
  sequence_order: number;
  status: 'pending' | 'dispatched' | 'in_progress' | 'completed' | 'failed' | 'blocked';
  dispatched_at: string | null;
  completed_at: string | null;
  agent_output: string | null;
  evaluation: string | null;
  quality_score: number | null;
  need_type: string | null;
  blocker_reason: string | null;
  created_at: string;
  updated_at: string;
}
