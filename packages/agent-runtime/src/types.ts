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
  /** Prior conversation turns for multi-turn chat (on_demand). */
  conversationHistory?: ConversationTurn[];
}

export type CompanyAgentRole =
  | 'chief-of-staff'
  | 'cto'
  | 'cpo'
  | 'cmo'
  | 'cfo'
  | 'clo'
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
  | 'global-admin'            // Morgan Blake → reports to CoS, cross-project IAM & onboarding
  | 'ops'                     // Atlas Vega → Operations & System Intelligence
  // People & Culture
  | 'head-of-hr'                // Jasmine Rivera → Head of People & Culture, reports to CoS
  // Research & Intelligence
  | 'vp-research'                   // Sophia Lin → VP of Research & Intelligence
  | 'competitive-research-analyst'  // Lena Park → reports to Sophia Lin
  | 'market-research-analyst'       // Daniel Okafor → reports to Sophia Lin
  | 'technical-research-analyst'    // Kai Nakamura → reports to Sophia Lin
  | 'industry-research-analyst'       // Amara Diallo → reports to Sophia Lin
  // Sales, Finance, Marketing, Operations specialists
  | 'enterprise-account-researcher'   // Ethan Morse → reports to VP-Sales
  | 'bob-the-tax-pro'                 // Robert "Bob" Finley → CPA & Tax Strategist, reports to CLO
  | 'data-integrity-auditor'          // Grace Hwang → reports to CLO
  | 'tax-strategy-specialist'         // Mariana Solis → reports to CLO
  | 'lead-gen-specialist'             // Derek Owens → reports to CoS
  | 'marketing-intelligence-analyst'  // Zara Petrov → reports to CMO
  | 'ai-impact-analyst'               // Riya Mehta → reports to VP-Research
  | 'org-analyst'                     // Marcus Chen → reports to VP-Research
  | 'adi-rose';                       // Adi Rose → Executive Assistant, reports to CoS

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
  /** RuntimeToolFactory — present when runtime tool synthesis is enabled. */
  runtimeToolFactory?: import('./runtimeToolFactory.js').RuntimeToolFactory;
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

/** An inline file attachment (image, PDF, or text document). */
export interface ConversationAttachment {
  /** Original filename */
  name: string;
  /** MIME type (e.g. 'image/png', 'application/pdf', 'text/plain') */
  mimeType: string;
  /** Base64-encoded file data */
  data: string;
}

export interface ConversationTurn {
  role: 'user' | 'assistant' | 'tool_call' | 'tool_result';
  content: string;
  toolName?: string;
  toolParams?: Record<string, unknown>;
  toolResult?: ToolResult;
  thoughtSignature?: string;
  thinkingBeforeTools?: string;
  timestamp: number;
  /** Inline file attachments (images, PDFs, documents) for multimodal input. */
  attachments?: ConversationAttachment[];
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
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  cachedInputTokens: number;
  cost: number;
  abortReason?: string;
  error?: string;
  reasoning?: ReasoningEnvelope;
  conversationHistory: ConversationTurn[];
  /** Structured action receipts for tool calls made during this run. */
  actions?: ActionReceipt[];
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
  /** When true, any successful tool result counts as progress (not just writes). */
  readsAsProgress?: boolean;
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
  | 'assignment.blocked'
  | 'assignment.revised'
  | 'assignment.created'
  | 'escalation.created';

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
  // ── Executives: 24/7 always-on budgets ──
  'chief-of-staff':       { perRunUsd: 0.15, dailyUsd: 5.00, monthlyUsd: 150 },
  'cto':                  { perRunUsd: 0.12, dailyUsd: 4.00, monthlyUsd: 120 },
  'cfo':                  { perRunUsd: 0.10, dailyUsd: 3.00, monthlyUsd: 90 },
  'clo':                  { perRunUsd: 0.10, dailyUsd: 3.00, monthlyUsd: 90 },
  'cpo':                  { perRunUsd: 0.10, dailyUsd: 2.00, monthlyUsd: 60 },
  'cmo':                  { perRunUsd: 0.10, dailyUsd: 2.00, monthlyUsd: 60 },
  'vp-customer-success':  { perRunUsd: 0.08, dailyUsd: 1.50, monthlyUsd: 45 },
  'vp-sales':             { perRunUsd: 0.08, dailyUsd: 1.50, monthlyUsd: 45 },
  'vp-design':            { perRunUsd: 0.08, dailyUsd: 1.50, monthlyUsd: 45 },
  // ── Ops (Atlas): Always-hot tier ──
  'ops':                  { perRunUsd: 0.08, dailyUsd: 3.00, monthlyUsd: 90 },
  // ── Sub-team: Standard 24/7 budgets ──
  'platform-engineer':    { perRunUsd: 0.05, dailyUsd: 1.00, monthlyUsd: 30 },
  'quality-engineer':     { perRunUsd: 0.05, dailyUsd: 1.00, monthlyUsd: 30 },
  'devops-engineer':      { perRunUsd: 0.05, dailyUsd: 1.00, monthlyUsd: 30 },
  'user-researcher':      { perRunUsd: 0.05, dailyUsd: 1.00, monthlyUsd: 30 },
  'competitive-intel':    { perRunUsd: 0.05, dailyUsd: 1.00, monthlyUsd: 30 },
  'revenue-analyst':      { perRunUsd: 0.05, dailyUsd: 1.00, monthlyUsd: 30 },
  'cost-analyst':         { perRunUsd: 0.05, dailyUsd: 1.00, monthlyUsd: 30 },
  'content-creator':      { perRunUsd: 0.08, dailyUsd: 1.00, monthlyUsd: 30 },
  'seo-analyst':          { perRunUsd: 0.05, dailyUsd: 1.00, monthlyUsd: 30 },
  'social-media-manager': { perRunUsd: 0.05, dailyUsd: 1.00, monthlyUsd: 30 },
  'onboarding-specialist':{ perRunUsd: 0.05, dailyUsd: 1.00, monthlyUsd: 30 },
  'support-triage':       { perRunUsd: 0.05, dailyUsd: 1.00, monthlyUsd: 30 },
  'account-research':     { perRunUsd: 0.05, dailyUsd: 1.00, monthlyUsd: 30 },
  'ui-ux-designer':       { perRunUsd: 0.05, dailyUsd: 1.00, monthlyUsd: 30 },
  'frontend-engineer':    { perRunUsd: 0.05, dailyUsd: 1.00, monthlyUsd: 30 },
  'design-critic':        { perRunUsd: 0.05, dailyUsd: 1.00, monthlyUsd: 30 },
  'template-architect':   { perRunUsd: 0.05, dailyUsd: 1.00, monthlyUsd: 30 },
  'm365-admin':           { perRunUsd: 0.05, dailyUsd: 1.00, monthlyUsd: 30 },
  'global-admin':          { perRunUsd: 0.05, dailyUsd: 1.00, monthlyUsd: 30 },
  // People & Culture
  'head-of-hr':             { perRunUsd: 0.10, dailyUsd: 2.00, monthlyUsd: 60 },
  // Research & Intelligence
  'vp-research':                    { perRunUsd: 0.10, dailyUsd: 2.00, monthlyUsd: 60 },
  'competitive-research-analyst': { perRunUsd: 0.08, dailyUsd: 2.00, monthlyUsd: 60 },
  'market-research-analyst':      { perRunUsd: 0.08, dailyUsd: 2.00, monthlyUsd: 60 },
  'technical-research-analyst':   { perRunUsd: 0.08, dailyUsd: 2.00, monthlyUsd: 60 },
  'industry-research-analyst':    { perRunUsd: 0.08, dailyUsd: 2.00, monthlyUsd: 60 },
  // Sales, Finance, Marketing, Operations specialists
  'enterprise-account-researcher': { perRunUsd: 0.08, dailyUsd: 2.00, monthlyUsd: 60 },
  'bob-the-tax-pro':               { perRunUsd: 0.08, dailyUsd: 2.00, monthlyUsd: 60 },
  'data-integrity-auditor':        { perRunUsd: 0.08, dailyUsd: 2.00, monthlyUsd: 60 },
  'tax-strategy-specialist':       { perRunUsd: 0.08, dailyUsd: 2.00, monthlyUsd: 60 },
  'lead-gen-specialist':           { perRunUsd: 0.08, dailyUsd: 2.00, monthlyUsd: 60 },
  'marketing-intelligence-analyst': { perRunUsd: 0.08, dailyUsd: 2.00, monthlyUsd: 60 },
  'ai-impact-analyst':              { perRunUsd: 0.08, dailyUsd: 2.00, monthlyUsd: 60 },
  'org-analyst':                    { perRunUsd: 0.08, dailyUsd: 2.00, monthlyUsd: 60 },
  'adi-rose':                      { perRunUsd: 0.08, dailyUsd: 2.00, monthlyUsd: 60 },
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

/** A structured receipt for a tool call, included in the agent response for transparency. */
export interface ActionReceipt {
  /** Tool name that was called */
  tool: string;
  /** Parameters passed to the tool */
  params: Record<string, unknown>;
  /** Whether the tool call succeeded or failed */
  result: 'success' | 'error';
  /** Summarized output or error message */
  output: string;
  /** ISO timestamp of when the tool was called */
  timestamp: string;
}

export type SecurityEventType =
  | 'TOOL_NOT_GRANTED'
  | 'SCOPE_VIOLATION'
  | 'RATE_LIMITED'
  | 'BUDGET_EXCEEDED'
  | 'EVENT_NOT_PERMITTED'
  | 'DATA_EVIDENCE_MISSING';

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
  'chief-of-staff', 'cto', 'cpo', 'cmo', 'cfo', 'clo',
  'vp-customer-success', 'vp-sales', 'vp-design', 'head-of-hr',
];

export const SUB_TEAM_ROLES: CompanyAgentRole[] = [
  'platform-engineer', 'quality-engineer', 'devops-engineer',
  'user-researcher', 'competitive-intel', 'revenue-analyst',
  'cost-analyst', 'content-creator', 'seo-analyst',
  'social-media-manager', 'onboarding-specialist',
  'support-triage', 'account-research', 'm365-admin', 'global-admin',
  'vp-research',
  'competitive-research-analyst', 'market-research-analyst',
  'technical-research-analyst', 'industry-research-analyst',
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
  // Global admin — GCP IAM mutations
  'grant_project_role',
  'revoke_project_role',
  'create_service_account',
  'grant_secret_access',
  'revoke_secret_access',
  'run_onboarding',
  // Global admin — Entra ID mutations
  'entra_create_user',
  'entra_disable_user',
  'entra_add_group_member',
  'entra_remove_group_member',
  'entra_assign_directory_role',
  'entra_assign_license',
  'entra_revoke_license',
  // Tool grant management
  'grant_tool_access',
  'revoke_tool_access',
  // Directive proposals
  'propose_directive',
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
  'global-admin':           'chief-of-staff',
  'head-of-hr':              'chief-of-staff',
};

// ═══════════════════════════════════════════════════════════════════
// AGENT CLASSIFICATION — Orchestrator vs Task Agent
// ═══════════════════════════════════════════════════════════════════

export type AgentArchetype = 'orchestrator' | 'task';

/** Roles that use the OrchestratorRunner — they decompose, delegate, evaluate, and synthesize. */
export const ORCHESTRATOR_ROLES: ReadonlySet<CompanyAgentRole> = new Set([
  'chief-of-staff',   // Master orchestrator — decomposes directives, routes to departments
  'vp-research',      // Research orchestrator — decomposes research into analyst briefs
  'cto',              // Engineering orchestrator — triages, delegates to eng sub-team
  'clo',              // Legal orchestrator — decomposes compliance across departments
  'ops',              // System orchestrator — monitors health, triages alerts
]);

/** All remaining roles use the TaskRunner — they receive, reason, execute, and report. */
export const TASK_AGENT_ROLES: ReadonlySet<CompanyAgentRole> = new Set([
  'cfo', 'cpo', 'cmo', 'vp-customer-success', 'vp-sales', 'vp-design', 'head-of-hr',
  'platform-engineer', 'quality-engineer', 'devops-engineer',
  'user-researcher', 'competitive-intel',
  'revenue-analyst', 'cost-analyst',
  'content-creator', 'seo-analyst', 'social-media-manager',
  'onboarding-specialist', 'support-triage', 'account-research',
  'ui-ux-designer', 'frontend-engineer', 'design-critic', 'template-architect',
  'm365-admin', 'global-admin',
  'competitive-research-analyst', 'market-research-analyst',
  'technical-research-analyst', 'industry-research-analyst',
]);

export function getAgentArchetype(role: CompanyAgentRole): AgentArchetype {
  return ORCHESTRATOR_ROLES.has(role) ? 'orchestrator' : 'task';
}

// ═══════════════════════════════════════════════════════════════════
// SHARED MEMORY LAYER — Cross-agent knowledge types
// ═══════════════════════════════════════════════════════════════════

export type EpisodeType =
  | 'task_completed'
  | 'discovery'
  | 'decision_made'
  | 'problem_solved'
  | 'customer_interaction'
  | 'market_signal'
  | 'system_event'
  | 'collaboration'
  | 'failure_lesson'
  | 'process_improvement';

export interface SharedEpisode {
  id: string;
  createdAt: string;
  authorAgent: CompanyAgentRole;
  episodeType: EpisodeType;
  summary: string;
  detail?: Record<string, unknown>;
  outcome?: string;
  confidence: number;
  domains: string[];
  tags?: string[];
  relatedAgents?: string[];
  directiveId?: string;
  assignmentId?: string;
  timesAccessed: number;
  promotedToSemantic: boolean;
  archivedAt?: string;
}

export type ProcedureStatus = 'proposed' | 'active' | 'deprecated';

export interface SharedProcedure {
  id: string;
  createdAt: string;
  updatedAt: string;
  slug: string;
  name: string;
  domain: string;
  description: string;
  steps: { order: number; instruction: string; tools?: string[] }[];
  preconditions?: string[];
  toolsNeeded?: string[];
  exampleInput?: string;
  exampleOutput?: string;
  discoveredBy?: CompanyAgentRole;
  validatedBy?: string[];
  sourceEpisodes?: string[];
  timesUsed: number;
  successRate?: number;
  version: number;
  status: ProcedureStatus;
}

// ═══════════════════════════════════════════════════════════════════
// WORLD MODEL — Per-agent self-model + rubrics
// ═══════════════════════════════════════════════════════════════════

export interface WorldModelDimension {
  dimension: string;
  evidence: string;
  confidence: number;
}

export interface TaskTypeScore {
  avgScore: number;
  count: number;
  trend: 'improving' | 'stable' | 'declining';
}

export interface PredictionRecord {
  predicted: number;
  actual: number;
  delta: number;
  timestamp: string;
}

export interface ImprovementGoal {
  dimension: string;
  currentScore: number;
  targetScore: number;
  strategy: string;
  progress: number;  // 0-1
}

export interface AgentWorldModel {
  id: string;
  agentRole: CompanyAgentRole;
  updatedAt: string;
  strengths: WorldModelDimension[];
  weaknesses: WorldModelDimension[];
  blindspots?: WorldModelDimension[];
  preferredApproaches?: Record<string, string>;
  failurePatterns?: { pattern: string; occurrences: number; lastSeen: string }[];
  taskTypeScores: Record<string, TaskTypeScore>;
  toolProficiency?: Record<string, { successRate: number; avgTimeMs: number }>;
  collaborationMap?: Record<string, { quality: number; friction: number }>;
  lastPredictions: PredictionRecord[];
  predictionAccuracy: number;
  improvementGoals: ImprovementGoal[];
  rubricVersion: number;
}

export interface RubricLevel {
  '1_novice': string;
  '2_developing': string;
  '3_competent': string;
  '4_expert': string;
  '5_master': string;
}

export interface RubricDimension {
  name: string;
  weight: number;
  levels: RubricLevel;
}

export interface RoleRubric {
  id: string;
  role: string;
  taskType: string;
  version: number;
  createdAt: string;
  dimensions: RubricDimension[];
  passingScore: number;
  excellenceScore: number;
}

// ═══════════════════════════════════════════════════════════════════
// STRUCTURED REFLECTION — Rubric-based self-assessment
// ═══════════════════════════════════════════════════════════════════

export interface RubricScore {
  dimension: string;
  selfScore: number;
  evidence: string;
  confidence: number;
}

export interface StructuredReflection {
  runId: string;
  taskType: string;
  rubricScores: RubricScore[];
  predictedScore: number;
  actualScore?: number;
  predictionDelta?: number;
  approachUsed: string;
  wouldChange: string;
  newKnowledge: string;
  blockedBy: string | null;
}

export interface OrchestratorGrade {
  assignmentId: string;
  agentRole: CompanyAgentRole;
  rubricScores: {
    dimension: string;
    orchestratorScore: number;
    evidence: string;
    feedback: string;
  }[];
  weightedTotal: number;
  disposition: 'accept' | 'iterate' | 'reassign' | 'escalate';
  calibrationNote?: string;
}

// ═══════════════════════════════════════════════════════════════════
// SHARED MEMORY CONTEXT — Loaded per-agent per-run
// ═══════════════════════════════════════════════════════════════════

export interface SharedMemoryContext {
  /** Layer 1: Hot — current cycle state */
  working: { activeAssignments: number; alerts: string[]; companyPulse?: Record<string, unknown> };
  /** Layer 2: Warm — recent episodes relevant to current task */
  episodes: SharedEpisode[];
  /** Layer 3: Cool — knowledge graph matches */
  semantic: { title: string; content: string; nodeType: string; similarity: number }[];
  /** Layer 4: Persistent — applicable procedures */
  procedures: SharedProcedure[];
  /** Layer 5: Meta — world model state (orchestrators only) */
  worldModel: AgentWorldModel | null;
}
