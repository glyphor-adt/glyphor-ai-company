/**
 * Unified Provider Types — Shared contract for all LLM provider adapters.
 *
 * Each provider (Gemini, OpenAI, Anthropic) implements the ProviderAdapter
 * interface and maps its native API to these unified types.
 */

import type { ConversationTurn, ToolDeclaration } from '../types.js';

// ─── Provider Identification ─────────────────────────────────

export type ModelProvider = 'gemini' | 'openai' | 'anthropic';
export type ReasoningLevel = 'none' | 'standard' | 'deep';
export type ModelReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';
export type ModelVerbosity = 'low' | 'medium' | 'high';
export type GeminiThinkingLevel = 'low' | 'medium' | 'high';
export type RequestSource = 'on_demand' | 'scheduled' | 'heartbeat' | 'wake' | 'a2a';

export interface StructuredOutputSpec {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
}

export interface ModelRoutingMetadata {
  model: string;
  routingRule: string;
  capabilities: string[];
  reasoningEffort?: ModelReasoningEffort;
  verbosity?: ModelVerbosity;
  claudeEffort?: 'low' | 'medium' | 'high' | 'adaptive';
  claudeThinking?: 'manual' | 'adaptive';
  enableCitations?: boolean;
  enableCompaction?: boolean;
  enableGoogleSearch?: boolean;
  enableWebSearch?: boolean;
  enableCodeExecution?: boolean;
  thinkingLevel?: GeminiThinkingLevel;
  thinkingBudget?: number;
  enableToolSearch?: boolean;
  enableApplyPatch?: boolean;
  a365McpServers?: string[];
  glyphorMcpServers?: string[];
  nativeMcpServers?: string[];
  structuredOutput?: StructuredOutputSpec;
}

export interface UnifiedRequestMetadata {
  previousResponseId?: string;
  modelConfig?: ModelRoutingMetadata;
  engineSource?: 'analysis' | 'simulation' | 'deep_dive' | 'strategy_lab' | 'cot';
  agentRole?: import('../types.js').CompanyAgentRole;
  runId?: string;
  assignmentId?: string;
  turnNumber?: number;
}

// ─── Unified Request ─────────────────────────────────────────

export interface UnifiedModelRequest {
  model: string;
  systemInstruction: string;
  contents: ConversationTurn[];
  source?: RequestSource;
  tools?: ToolDeclaration[];
  temperature?: number;
  topP?: number;
  topK?: number;
  maxTokens?: number;
  thinkingEnabled?: boolean;
  reasoningLevel?: ReasoningLevel;
  fallbackScope?: 'cross-provider' | 'same-provider' | 'none';
  signal?: AbortSignal;
  /** Per-call timeout override in ms. Defaults to 180_000. */
  callTimeoutMs?: number;
  metadata?: UnifiedRequestMetadata;
}

// ─── Unified Response ────────────────────────────────────────

export interface UnifiedToolCall {
  name: string;
  args: Record<string, unknown>;
  /** Gemini 3+ thought signatures for function call replay */
  thoughtSignature?: string;
}

export interface UnifiedUsageMetadata {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Thinking/reasoning tokens billed at a different (often lower) rate */
  thinkingTokens?: number;
  /** Cached input tokens that receive a provider discount */
  cachedInputTokens?: number;
}

export interface UnifiedModelResponse {
  text: string | null;
  toolCalls: UnifiedToolCall[];
  providerEvents?: Array<{ type: string; name?: string; payload?: string }>;
  thinkingText?: string;
  /** The concrete model that produced this response after fallback resolution. */
  actualModel?: string;
  /** The provider that produced this response after fallback resolution. */
  actualProvider?: ModelProvider;
  usageMetadata: UnifiedUsageMetadata;
  finishReason: string;
  responseId?: string;
  compactionOccurred?: boolean;
  compactionCount?: number;
  compactionSummary?: string;
}

// ─── Image Response ──────────────────────────────────────────

export interface ImageResponse {
  /** Base64-encoded image data */
  imageData: string;
  /** MIME type of the image (e.g. 'image/png') */
  mimeType: string;
}

// ─── Provider Adapter Interface ──────────────────────────────

export interface ProviderAdapter {
  readonly provider: ModelProvider;
  generate(request: UnifiedModelRequest): Promise<UnifiedModelResponse>;
}
