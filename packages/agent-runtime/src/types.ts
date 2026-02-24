/**
 * Company Agent Runtime — Core Type Definitions
 *
 * Ported from Fuse V7 runtime/types.ts and adapted for company executive agents.
 * Stripped: build/design/component types (Fuse-specific)
 * Added: company memory contract, decision tiers, briefing types
 */

// ═══════════════════════════════════════════════════════════════════
// AGENT DEFINITION
// ═══════════════════════════════════════════════════════════════════

export interface AgentConfig {
  id: string;                        // Unique run ID (e.g., "cos-briefing-2026-02-21")
  role: CompanyAgentRole;            // Agent role
  systemPrompt: string;
  model: string;                     // 'gemini-3.0-flash-preview', 'gemini-2.5-pro'
  tools: ToolDefinition[];
  maxTurns: number;
  maxStallTurns: number;
  timeoutMs: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  thinkingEnabled?: boolean;         // Enable extended thinking / reasoning mode
  contextInjector?: ContextInjector;
  dryRun?: boolean;                  // When true, mutative tools are intercepted and logged
}

export type CompanyAgentRole =
  | 'chief-of-staff'
  | 'cto'
  | 'cpo'
  | 'cmo'
  | 'cfo'
  | 'vp-customer-success'
  | 'vp-sales'
  | 'vp-design'
  // Sub-team members
  | 'platform-engineer'       // Alex Park → reports to CTO
  | 'quality-engineer'        // Sam DeLuca → reports to CTO
  | 'devops-engineer'         // Jordan Hayes → reports to CTO
  | 'user-researcher'         // Priya Sharma → reports to CPO
  | 'competitive-intel'       // Daniel Ortiz → reports to CPO
  | 'revenue-analyst'         // Anna Park → reports to CFO
  | 'cost-analyst'            // Omar Hassan → reports to CFO
  | 'content-creator'         // Tyler Reed → reports to CMO
  | 'seo-analyst'             // Lisa Chen → reports to CMO
  | 'social-media-manager'    // Kai Johnson → reports to CMO
  | 'onboarding-specialist'   // Emma Wright → reports to VP-CS
  | 'support-triage'          // David Santos → reports to VP-CS
  | 'account-research'        // Nathan Cole → reports to VP-Sales
  | 'ui-ux-designer'          // Leo Vargas → reports to VP-Design
  | 'frontend-engineer'       // Ava Chen → reports to VP-Design
  | 'design-critic'           // Sofia Marchetti → reports to VP-Design
  | 'template-architect'      // Ryan Park → reports to VP-Design
  | 'm365-admin'              // Riley Morgan → reports to CTO, manages Microsoft 365
  | 'ops';                    // Atlas Vega → Operations & System Intelligence

export type ContextInjector = (
  turnNumber: number,
  history: ConversationTurn[],
) => Promise<string | null>;

// ═══════════════════════════════════════════════════════════════════
// TOOLS
// ═══════════════════════════════════════════════════════════════════

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  execute: (params: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;
}

export interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required?: boolean;
  enum?: string[];
  items?: ToolParameter;
  properties?: Record<string, ToolParameter>;
}

export interface ToolContext {
  agentId: string;
  agentRole: CompanyAgentRole;
  turnNumber: number;
  abortSignal: AbortSignal;
  memoryBus: IMemoryBus;
  emitEvent: (event: AgentEvent) => void;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  filesWritten?: number;
  memoryKeysWritten?: number;
}

// ═══════════════════════════════════════════════════════════════════
// CONVERSATION
// ═══════════════════════════════════════════════════════════════════

export interface ConversationTurn {
  role: 'user' | 'assistant' | 'tool_call' | 'tool_result';
  content: string;
  toolName?: string;
  toolParams?: Record<string, unknown>;
  toolResult?: ToolResult;
  thoughtSignature?: string;
  thinkingBeforeTools?: string;
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════════
// REASONING ENVELOPE
// ═══════════════════════════════════════════════════════════════════

export interface ReasoningEnvelope {
  approach?: string;
  tradeoffs?: string;
  risks?: string;
  alternatives?: string;
  raw: string;
}

// ═══════════════════════════════════════════════════════════════════
// EVENTS
// ═══════════════════════════════════════════════════════════════════

export type AgentEvent =
  | { type: 'agent_started'; agentId: string; role: string; model: string }
  | { type: 'turn_started'; agentId: string; turnNumber: number }
  | { type: 'model_request'; agentId: string; turnNumber: number; tokenEstimate: number }
  | { type: 'model_response'; agentId: string; turnNumber: number; hasToolCalls: boolean; thinkingText?: string }
  | { type: 'tool_call'; agentId: string; turnNumber: number; toolName: string; params: Record<string, unknown> }
  | { type: 'tool_result'; agentId: string; turnNumber: number; toolName: string; success: boolean; filesWritten: number; memoryKeysWritten: number }
  | { type: 'context_injected'; agentId: string; turnNumber: number; contextLength: number }
  | { type: 'agent_completed'; agentId: string; totalTurns: number; totalFiles: number; totalMemoryKeys: number; elapsedMs: number }
  | { type: 'agent_aborted'; agentId: string; reason: string; totalTurns: number; elapsedMs: number }
  | { type: 'agent_error'; agentId: string; error: string; turnNumber: number };

// ═══════════════════════════════════════════════════════════════════
// EXECUTION RESULT
// ═══════════════════════════════════════════════════════════════════

export interface AgentExecutionResult {
  agentId: string;
  role: string;
  status: 'completed' | 'aborted' | 'error';
  output: string | null;
  totalTurns: number;
  totalFilesWritten: number;
  totalMemoryKeysWritten: number;
  elapsedMs: number;
  abortReason?: string;
  error?: string;
  reasoning?: ReasoningEnvelope;
  conversationHistory: ConversationTurn[];
}

// ═══════════════════════════════════════════════════════════════════
// GEMINI API TYPES
// ═══════════════════════════════════════════════════════════════════

export interface GeminiToolDeclaration {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// ═══════════════════════════════════════════════════════════════════
// SUPERVISOR CONFIG
// ═══════════════════════════════════════════════════════════════════

export interface SupervisorConfig {
  maxTurns: number;
  maxStallTurns: number;
  timeoutMs: number;
  onEvent?: (event: AgentEvent) => void;
}

// ═══════════════════════════════════════════════════════════════════
// COMPANY MEMORY — Shared Knowledge Contract
// ═══════════════════════════════════════════════════════════════════

export type DecisionTier = 'green' | 'yellow' | 'red';
export type DecisionStatus = 'pending' | 'approved' | 'rejected' | 'discussed';
export type ProductSlug = 'fuse' | 'pulse';

export interface CompanyDecision {
  id: string;
  tier: DecisionTier;
  status: DecisionStatus;
  title: string;
  summary: string;
  proposedBy: CompanyAgentRole;
  reasoning: string;
  data?: unknown;
  assignedTo: string[];       // ['kristina'], ['andrew'], ['kristina','andrew']
  resolvedBy?: string;
  resolutionNote?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface ActivityLogEntry {
  agentRole: CompanyAgentRole;
  action: 'analysis' | 'decision' | 'alert' | 'content' | 'deploy' | 'briefing' | 'outreach';
  product?: ProductSlug | 'company';
  summary: string;
  details?: unknown;
  tier?: DecisionTier;
  createdAt: string;
}

export interface ProductMetrics {
  slug: ProductSlug;
  name: string;
  status: 'active' | 'beta' | 'concept' | 'sunset';
  mrr?: number;
  activeUsers?: number;
  buildsLast7d?: number;
  buildSuccessRate?: number;
}

export interface FinancialSnapshot {
  date: string;
  product?: ProductSlug;
  mrr: number;
  infraCost: number;
  apiCost: number;
  margin: number;
}

export interface BriefingData {
  recipient: 'kristina' | 'andrew';
  date: string;
  metrics: { label: string; value: string; trend: 'up' | 'down' | 'flat' }[];
  greenItems: ActivityLogEntry[];
  yellowItems: CompanyDecision[];
  redItems: CompanyDecision[];
  highlights: string[];
  actionRequired: string[];
}

// ═══════════════════════════════════════════════════════════════════
// GLYPHOR EVENT BUS — Inter-Agent Communication
// ═══════════════════════════════════════════════════════════════════

export type GlyphorEventType =
  | 'agent.completed'
  | 'insight.detected'
  | 'decision.filed'
  | 'decision.resolved'
  | 'alert.triggered'
  | 'task.requested'
  | 'agent.spawned'
  | 'agent.retired'
  | 'message.sent'
  | 'meeting.called'
  | 'meeting.completed'
  | 'assignment.submitted'
  | 'assignment.blocked';

export type EventPriority = 'critical' | 'high' | 'normal' | 'low';

export interface GlyphorEvent {
  id: string;
  type: GlyphorEventType;
  source: CompanyAgentRole | 'scheduler' | 'system';
  timestamp: string;
  payload: Record<string, unknown>;
  priority: EventPriority;
  correlationId?: string;
}

// ═══════════════════════════════════════════════════════════════════
// AGENT MEMORY + REFLECTIONS
// ═══════════════════════════════════════════════════════════════════

export type MemoryType = 'observation' | 'learning' | 'preference' | 'fact';

export interface AgentMemory {
  id: string;
  agentRole: CompanyAgentRole;
  memoryType: MemoryType;
  content: string;
  importance: number;          // 0-1
  sourceRunId?: string;
  tags?: string[];
  expiresAt?: string;
  createdAt: string;
}

export interface AgentReflection {
  id: string;
  agentRole: CompanyAgentRole;
  runId: string;
  summary: string;
  qualityScore: number;        // 0-100
  whatWentWell: string[];
  whatCouldImprove: string[];
  promptSuggestions: string[];
  knowledgeGaps: string[];
  createdAt: string;
}

// ═══════════════════════════════════════════════════════════════════
// MEMORY BUS INTERFACE — Company-scoped
// ═══════════════════════════════════════════════════════════════════

export interface IMemoryBus {
  read<T = unknown>(key: string): Promise<T | null>;
  write(key: string, value: unknown, agentId: string): Promise<void>;
  appendActivity(entry: ActivityLogEntry): Promise<void>;
  createDecision(decision: Omit<CompanyDecision, 'id' | 'createdAt'>): Promise<string>;
  getDecisions(filter?: { tier?: DecisionTier; status?: DecisionStatus }): Promise<CompanyDecision[]>;
  getRecentActivity(hours?: number): Promise<ActivityLogEntry[]>;
  getProductMetrics(slug: ProductSlug): Promise<ProductMetrics | null>;
  getFinancials(days?: number): Promise<FinancialSnapshot[]>;
}

// ═══════════════════════════════════════════════════════════════════
// AGENT BUDGET — Per-run, daily, monthly cost caps
// ═══════════════════════════════════════════════════════════════════

export interface AgentBudget {
  perRunUsd: number;
  dailyUsd: number;
  monthlyUsd: number;
}

export const AGENT_BUDGETS: Record<CompanyAgentRole, AgentBudget> = {
  'chief-of-staff':       { perRunUsd: 0.15, dailyUsd: 1.50, monthlyUsd: 40 },
  'cto':                  { perRunUsd: 0.10, dailyUsd: 2.00, monthlyUsd: 50 },
  'cfo':                  { perRunUsd: 0.05, dailyUsd: 0.50, monthlyUsd: 15 },
  'cpo':                  { perRunUsd: 0.08, dailyUsd: 1.00, monthlyUsd: 30 },
  'cmo':                  { perRunUsd: 0.10, dailyUsd: 1.50, monthlyUsd: 40 },
  'vp-customer-success':  { perRunUsd: 0.05, dailyUsd: 0.50, monthlyUsd: 15 },
  'vp-sales':             { perRunUsd: 0.05, dailyUsd: 0.50, monthlyUsd: 15 },
  'vp-design':            { perRunUsd: 0.05, dailyUsd: 0.50, monthlyUsd: 15 },
  'platform-engineer':    { perRunUsd: 0.02, dailyUsd: 0.20, monthlyUsd: 6 },
  'quality-engineer':     { perRunUsd: 0.03, dailyUsd: 0.30, monthlyUsd: 8 },
  'devops-engineer':      { perRunUsd: 0.02, dailyUsd: 0.20, monthlyUsd: 6 },
  'user-researcher':      { perRunUsd: 0.03, dailyUsd: 0.30, monthlyUsd: 8 },
  'competitive-intel':    { perRunUsd: 0.05, dailyUsd: 0.50, monthlyUsd: 12 },
  'revenue-analyst':      { perRunUsd: 0.02, dailyUsd: 0.20, monthlyUsd: 6 },
  'cost-analyst':         { perRunUsd: 0.02, dailyUsd: 0.20, monthlyUsd: 6 },
  'content-creator':      { perRunUsd: 0.08, dailyUsd: 1.00, monthlyUsd: 25 },
  'seo-analyst':          { perRunUsd: 0.03, dailyUsd: 0.30, monthlyUsd: 8 },
  'social-media-manager': { perRunUsd: 0.03, dailyUsd: 0.30, monthlyUsd: 8 },
  'onboarding-specialist':{ perRunUsd: 0.02, dailyUsd: 0.20, monthlyUsd: 6 },
  'support-triage':       { perRunUsd: 0.03, dailyUsd: 0.50, monthlyUsd: 12 },
  'account-research':     { perRunUsd: 0.05, dailyUsd: 0.50, monthlyUsd: 12 },
  'ui-ux-designer':       { perRunUsd: 0.03, dailyUsd: 0.30, monthlyUsd: 8 },
  'frontend-engineer':    { perRunUsd: 0.03, dailyUsd: 0.30, monthlyUsd: 8 },
  'design-critic':        { perRunUsd: 0.02, dailyUsd: 0.20, monthlyUsd: 6 },
  'template-architect':   { perRunUsd: 0.03, dailyUsd: 0.30, monthlyUsd: 8 },
  'm365-admin':           { perRunUsd: 0.03, dailyUsd: 0.30, monthlyUsd: 8 },
  'ops':                  { perRunUsd: 0.03, dailyUsd: 0.50, monthlyUsd: 15 },
};

// ═══════════════════════════════════════════════════════════════════
// TOOL GRANTS — Per-agent tool access + scope + rate limits
// ═══════════════════════════════════════════════════════════════════

export interface ToolGrant {
  toolName: string;
  scope?: Record<string, unknown>;   // Scope constraints (e.g., { branches: 'test/*' })
  rateLimit: number;                  // Max calls per hour
}

export interface AgentToolGrants {
  role: CompanyAgentRole;
  grants: ToolGrant[];
}

// ═══════════════════════════════════════════════════════════════════
// TOOL CALL LOG — Audit trail for all tool executions
// ═══════════════════════════════════════════════════════════════════

export interface ToolCallLog {
  agentId: string;
  agentRole: CompanyAgentRole;
  toolName: string;
  args: Record<string, unknown>;
  result: ToolResult;
  estimatedCostUsd: number;
  timestamp: string;
}

export type SecurityEventType =
  | 'TOOL_NOT_GRANTED'
  | 'SCOPE_VIOLATION'
  | 'RATE_LIMITED'
  | 'BUDGET_EXCEEDED'
  | 'EVENT_NOT_PERMITTED';

export interface SecurityEvent {
  agentId: string;
  agentRole: CompanyAgentRole;
  toolName: string;
  eventType: SecurityEventType;
  details?: unknown;
  timestamp: string;
}

// ═══════════════════════════════════════════════════════════════════
// EVENT EMISSION PERMISSIONS
// ═══════════════════════════════════════════════════════════════════

export type AgentTier = 'executive' | 'sub-team';

export const EXECUTIVE_ROLES: CompanyAgentRole[] = [
  'chief-of-staff', 'cto', 'cpo', 'cmo', 'cfo',
  'vp-customer-success', 'vp-sales', 'vp-design',
];

export const SUB_TEAM_ROLES: CompanyAgentRole[] = [
  'platform-engineer', 'quality-engineer', 'devops-engineer',
  'user-researcher', 'competitive-intel', 'revenue-analyst',
  'cost-analyst', 'content-creator', 'seo-analyst',
  'social-media-manager', 'onboarding-specialist',
  'support-triage', 'account-research', 'm365-admin',
];

/** Events executives can emit */
export const EXECUTIVE_ALLOWED_EVENTS: GlyphorEventType[] = [
  'agent.completed', 'insight.detected', 'decision.filed',
  'alert.triggered', 'task.requested',
  'agent.spawned', 'agent.retired',
  'message.sent', 'meeting.called', 'meeting.completed',
];

/** Events sub-team members can emit */
export const SUB_TEAM_ALLOWED_EVENTS: GlyphorEventType[] = [
  'insight.detected',
  'message.sent',
];

/** Events that only the system / founders can emit */
export const FORBIDDEN_AGENT_EVENTS: GlyphorEventType[] = [
  'decision.resolved',
];

// ═══════════════════════════════════════════════════════════════════
// WRITE TOOLS — Tools that mutate state (require Yellow decision for dynamic grants)
// ═══════════════════════════════════════════════════════════════════

export const WRITE_TOOLS: ReadonlySet<string> = new Set([
  // GitHub code authoring
  'create_or_update_file',
  'create_branch',
  'create_github_pr',
  'merge_github_pr',
  'create_github_issue',
  // Infrastructure / deployment
  'deploy_to_staging',
  'trigger_agent_run',
  'retry_failed_run',
  'pause_agent',
  'resume_agent',
  // Communication (external-facing)
  'send_email',
  'send_dm',
  'send_briefing',
  'respond_to_ticket',
  'escalate_ticket',
  'post_to_channel',
  'schedule_social_post',
  // Data mutation
  'write_health_report',
  'write_financial_report',
  'write_product_analysis',
  'write_content',
  'write_company_memory',
  'write_pipeline_report',
  'write_design_audit',
  'write_admin_log',
  'create_decision',
  'create_calendar_event',
  'create_incident',
  'resolve_incident',
  'post_system_status',
  'store_intel',
  // Tool grant management
  'grant_tool_access',
  'revoke_tool_access',
]);

// ═══════════════════════════════════════════════════════════════════
// AGENT ORG CHART — Manager relationships
// ═══════════════════════════════════════════════════════════════════

export const AGENT_MANAGER: Partial<Record<CompanyAgentRole, CompanyAgentRole>> = {
  'platform-engineer':     'cto',
  'quality-engineer':      'cto',
  'devops-engineer':       'cto',
  'user-researcher':       'cpo',
  'competitive-intel':     'cpo',
  'revenue-analyst':       'cfo',
  'cost-analyst':          'cfo',
  'content-creator':       'cmo',
  'seo-analyst':           'cmo',
  'social-media-manager':  'cmo',
  'onboarding-specialist': 'vp-customer-success',
  'support-triage':        'vp-customer-success',
  'account-research':      'vp-sales',
  'm365-admin':            'cto',
};
