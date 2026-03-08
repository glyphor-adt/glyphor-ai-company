/**
 * Unified Provider Types — Shared contract for all LLM provider adapters.
 *
 * Each provider (Gemini, OpenAI, Anthropic) implements the ProviderAdapter
 * interface and maps its native API to these unified types.
 */

import type { ConversationTurn, GeminiToolDeclaration } from '../types.js';

// ─── Provider Identification ─────────────────────────────────

export type ModelProvider = 'gemini' | 'openai' | 'anthropic';
export type ReasoningLevel = 'none' | 'standard' | 'deep';

// ─── Unified Request ─────────────────────────────────────────

export interface UnifiedModelRequest {
  model: string;
  systemInstruction: string;
  contents: ConversationTurn[];
  tools?: GeminiToolDeclaration[];
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
  thinkingText?: string;
  usageMetadata: UnifiedUsageMetadata;
  finishReason: string;
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
