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
  | 'vp-design';

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
    required: string[];
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
  | 'agent.retired';

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
