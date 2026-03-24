/**
 * History Manager — Structure-Aware Conversation Compression
 *
 * Three-layer compression pipeline that treats conversation history as a graph
 * of atomic structural groups rather than a flat list of turns:
 *
 *   Layer 1 — groupConversation():  Parse turns into atomic ConversationGroups
 *             (tool groups, user exchanges, reflections). Groups are indivisible.
 *   Layer 2 — scoreAndEvict():      Importance-score each group and evict lowest-
 *             importance groups first until token budget is met. First user message
 *             and recent groups are pinned.
 *   Layer 3 — summarizeEvicted():   Synthesize evicted groups into a single context
 *             summary injected at the top, so the agent retains awareness of lost
 *             context without carrying full token weight.
 *
 * The old FIFO `.slice(1)` trim loop could bisect atomic tool_call/tool_result
 * pairs, orphan reasoning chains, or lose the original user request. This design
 * ensures structural integrity: groups stay or go entirely, and evicted context
 * is summarized rather than silently dropped. OpenAI and Anthropic now prefer
 * provider-managed compaction for on-demand chat; this module remains the
 * client-side fallback and Gemini path.
 */

import type { ConversationTurn } from './types.js';
import type { ModelClient } from './modelClient.js';
import { getTierModel } from '@glyphor/shared';

// ═══════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

export interface HistoryCompressionConfig {
  maxHistoryTokens: number;
  keepRecentTurns: number;
  toolResultMaxTokens: number;
  summarizeToolResults: boolean;
}

export const DEFAULT_HISTORY_COMPRESSION: HistoryCompressionConfig = {
  maxHistoryTokens: 8_000,
  keepRecentTurns: 2,
  toolResultMaxTokens: 400,
  summarizeToolResults: true,
};

// ═══════════════════════════════════════════════════════════════════
// LAYER 1 — STRUCTURAL GROUPING
// ═══════════════════════════════════════════════════════════════════

export interface ConversationGroup {
  type: 'user_exchange' | 'tool_group' | 'reflection' | 'system';
  turns: ConversationTurn[];
  tokenCount: number;
  timestamp: number;
  importance: number; // 0-1, computed by scoreGroups()
}

/**
 * Parse flat ConversationTurn[] into atomic ConversationGroup[].
 *
 * Grouping rules:
 *   - tool_call + all following tool_result turns → one 'tool_group'
 *   - user turn (optionally followed by assistant turn) → one 'user_exchange'
 *   - standalone assistant turn → 'reflection'
 */
export function groupConversation(turns: ConversationTurn[]): ConversationGroup[] {
  const groups: ConversationGroup[] = [];
  let i = 0;

  while (i < turns.length) {
    const turn = turns[i];

    // ── Tool group: consecutive tool_call(s) + consecutive tool_result(s) ──
    if (turn.role === 'tool_call') {
      const groupTurns: ConversationTurn[] = [];
      while (i < turns.length && turns[i].role === 'tool_call') {
        groupTurns.push(turns[i]);
        i++;
      }
      while (i < turns.length && turns[i].role === 'tool_result') {
        groupTurns.push(turns[i]);
        i++;
      }
      groups.push({
        type: 'tool_group',
        turns: groupTurns,
        tokenCount: estimateTokensForTurns(groupTurns),
        timestamp: groupTurns[0].timestamp,
        importance: 0,
      });
      continue;
    }

    // ── Orphaned tool_result without preceding tool_call — system/noise ──
    if (turn.role === 'tool_result') {
      groups.push({
        type: 'system',
        turns: [turn],
        tokenCount: estimateTokensForTurns([turn]),
        timestamp: turn.timestamp,
        importance: 0,
      });
      i++;
      continue;
    }

    // ── User turn — absorb following assistant turn into one exchange ──
    if (turn.role === 'user') {
      const groupTurns: ConversationTurn[] = [turn];
      i++;
      if (i < turns.length && turns[i].role === 'assistant') {
        groupTurns.push(turns[i]);
        i++;
      }
      groups.push({
        type: 'user_exchange',
        turns: groupTurns,
        tokenCount: estimateTokensForTurns(groupTurns),
        timestamp: turn.timestamp,
        importance: 0,
      });
      continue;
    }

    // ── Standalone assistant turn (no preceding user turn) — reflection ──
    if (turn.role === 'assistant') {
      groups.push({
        type: 'reflection',
        turns: [turn],
        tokenCount: estimateTokensForTurns([turn]),
        timestamp: turn.timestamp,
        importance: 0,
      });
      i++;
      continue;
    }

    // Unknown role — skip
    i++;
  }

  return groups;
}

// ═══════════════════════════════════════════════════════════════════
// LAYER 2 — IMPORTANCE SCORING & EVICTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Score each group's importance (0–1) based on structural signals.
 * Mutates group.importance in place and returns the same array.
 */
function scoreGroups(groups: ConversationGroup[]): ConversationGroup[] {
  if (groups.length === 0) return groups;

  const maxTs = Math.max(...groups.map(g => g.timestamp));
  const minTs = Math.min(...groups.map(g => g.timestamp));
  const tsRange = maxTs - minTs || 1;

  // Collect tool names referenced in later assistant turns, so we can boost
  // tool groups whose results the agent actually used.
  const referencedToolNames = new Set<string>();
  for (const g of groups) {
    if (g.type === 'reflection' || g.type === 'user_exchange') {
      for (const t of g.turns) {
        if (t.role === 'assistant') {
          // Check if assistant text mentions any tool name
          for (const tg of groups) {
            if (tg.type === 'tool_group') {
              for (const tc of tg.turns) {
                if (tc.toolName && t.content.includes(tc.toolName)) {
                  referencedToolNames.add(tc.toolName);
                }
              }
            }
          }
        }
      }
    }
  }

  for (let idx = 0; idx < groups.length; idx++) {
    const g = groups[idx];
    let score = 0;

    // ── Recency: 0.0–0.3 ──
    score += 0.3 * ((g.timestamp - minTs) / tsRange);

    // ── Positional signals ──
    if (idx === 0 && g.type === 'user_exchange') {
      // First user message — the original request. Pin it.
      score += 0.5;
    }

    // ── Type-based base scores ──
    switch (g.type) {
      case 'user_exchange':
        score += 0.2;
        // Founder identity injection → higher importance
        if (g.turns[0]?.content.includes('Co-Founder of Glyphor')) score += 0.15;
        break;
      case 'tool_group': {
        // Base importance for tool work
        score += 0.1;
        // Were results referenced by later assistant turns?
        const toolNames = g.turns
          .filter(t => t.role === 'tool_call' && t.toolName)
          .map(t => t.toolName!);
        if (toolNames.some(n => referencedToolNames.has(n))) score += 0.2;
        // Failed tool calls the agent retried → low importance (retry supersedes)
        const hasFailure = g.turns.some(t =>
          t.role === 'tool_result' && t.toolResult && !t.toolResult.success
        );
        if (hasFailure) score -= 0.15;
        break;
      }
      case 'reflection':
        // Standalone assistant thinking — low value unless it contains decisions
        score += 0.05;
        if (g.turns[0]?.content.length > 500) score += 0.05; // Substantial response
        break;
      case 'system':
        // Orphaned tool results, noise
        score += 0;
        break;
    }

    g.importance = Math.max(0, Math.min(1, score));
  }

  return groups;
}

/**
 * Evict lowest-importance groups until total tokens fit within budget.
 * Returns { surviving, evicted } — both sorted by original order.
 *
 * Pinned groups (first user_exchange, last N groups) are never evicted.
 */
function evictGroups(
  groups: ConversationGroup[],
  maxTokens: number,
  pinnedTailCount: number,
): { surviving: ConversationGroup[]; evicted: ConversationGroup[] } {
  const totalTokens = groups.reduce((sum, g) => sum + g.tokenCount, 0);
  if (totalTokens <= maxTokens) {
    return { surviving: groups, evicted: [] };
  }

  // Build eviction candidates: tagged with original index and eviction eligibility
  const pinned = new Set<number>();
  // Pin first user_exchange (original request)
  const firstUserIdx = groups.findIndex(g => g.type === 'user_exchange');
  if (firstUserIdx >= 0) pinned.add(firstUserIdx);
  // Pin last N groups (recent context the agent needs)
  for (let i = Math.max(0, groups.length - pinnedTailCount); i < groups.length; i++) {
    pinned.add(i);
  }

  // Sort eviction candidates by importance ascending (least important first)
  const candidates = groups
    .map((g, i) => ({ group: g, index: i }))
    .filter(c => !pinned.has(c.index))
    .sort((a, b) => a.group.importance - b.group.importance);

  const evictedIndices = new Set<number>();
  let currentTokens = totalTokens;

  for (const c of candidates) {
    if (currentTokens <= maxTokens) break;
    evictedIndices.add(c.index);
    currentTokens -= c.group.tokenCount;
  }

  const surviving: ConversationGroup[] = [];
  const evicted: ConversationGroup[] = [];
  for (let i = 0; i < groups.length; i++) {
    if (evictedIndices.has(i)) {
      evicted.push(groups[i]);
    } else {
      surviving.push(groups[i]);
    }
  }

  return { surviving, evicted };
}

// ═══════════════════════════════════════════════════════════════════
// LAYER 3 — EVICTED CONTEXT SUMMARIZATION
// ═══════════════════════════════════════════════════════════════════

const EVICTION_SUMMARY_MODEL = getTierModel('default');
const EVICTION_SUMMARY_SYSTEM = `You are summarizing earlier parts of a conversation between a user and an AI agent that were evicted from the context window. Produce a concise summary (100-250 words) that preserves:
- The original user request/question if present
- Key facts, data, or decisions from tool results
- Important context the agent would need to continue coherently
Write in third person as a context briefing. No preamble — start directly with the summary.`;

/**
 * Summarize evicted groups into a single context-restoration turn.
 * Uses a fast LLM call when a ModelClient is available, otherwise falls back
 * to deterministic extraction.
 */
async function summarizeEvicted(
  evicted: ConversationGroup[],
  config: HistoryCompressionConfig,
  modelClient?: ModelClient,
): Promise<ConversationTurn> {
  const allTurns = evicted.flatMap(g => g.turns);

  // Try LLM summarization first — produces much higher quality context preservation
  if (modelClient && allTurns.length > 4) {
    try {
      const evictedText = buildEvictedText(allTurns, config);
      const response = await modelClient.generate({
        model: EVICTION_SUMMARY_MODEL,
        systemInstruction: EVICTION_SUMMARY_SYSTEM,
        contents: [{ role: 'user', content: evictedText, timestamp: Date.now() }],
        temperature: 0.2,
        maxTokens: 500,
        callTimeoutMs: 10_000,
      });
      if (response.text) {
        return {
          role: 'user',
          content: `[Earlier in this conversation — compressed context]\n${response.text}`,
          timestamp: allTurns[0]?.timestamp ?? Date.now(),
        };
      }
    } catch (err) {
      console.warn(`[HistoryManager] Eviction summary LLM call failed, falling back to deterministic: ${(err as Error).message}`);
    }
  }

  // Deterministic fallback — structured extraction without LLM
  return buildDeterministicSummary(allTurns, config);
}

function buildEvictedText(turns: ConversationTurn[], config: HistoryCompressionConfig): string {
  const lines: string[] = ['Summarize the following evicted conversation turns:'];
  for (const t of turns) {
    const content = clip(t.content.replace(/\s+/g, ' ').trim(), config.toolResultMaxTokens * 2);
    switch (t.role) {
      case 'user':
        lines.push(`USER: ${content}`);
        break;
      case 'assistant':
        lines.push(`ASSISTANT: ${content}`);
        break;
      case 'tool_call':
        lines.push(`TOOL CALL [${t.toolName ?? 'unknown'}]: ${content}`);
        break;
      case 'tool_result':
        lines.push(`TOOL RESULT [${t.toolName ?? 'unknown'}]: ${content}`);
        break;
    }
  }
  return lines.join('\n');
}

function buildDeterministicSummary(
  turns: ConversationTurn[],
  config: HistoryCompressionConfig,
): ConversationTurn {
  const lines: string[] = [
    '[Earlier in this conversation — compressed context]',
  ];

  const priorRequests = turns
    .filter(t => t.role === 'user')
    .slice(-3)
    .map(t => `- ${clip(t.content.replace(/\s+/g, ' ').trim(), 220)}`);
  if (priorRequests.length > 0) {
    lines.push('', 'Prior requests:', ...priorRequests);
  }

  const priorResponses = turns
    .filter(t => t.role === 'assistant')
    .slice(-2)
    .map(t => `- ${clip(t.content.replace(/\s+/g, ' ').trim(), 220)}`);
  if (priorResponses.length > 0) {
    lines.push('', 'Prior responses:', ...priorResponses);
  }

  const toolNames = Array.from(new Set(
    turns.filter(t => t.role === 'tool_call' && t.toolName).map(t => t.toolName!),
  ));
  if (toolNames.length > 0) {
    lines.push('', `Tools used: ${toolNames.join(', ')}`);
  }

  if (config.summarizeToolResults) {
    const toolResults = turns
      .filter(t => t.role === 'tool_result')
      .slice(-4)
      .map(t => `- ${t.toolName ?? 'tool'}: ${clip(t.content.replace(/\s+/g, ' ').trim(), config.toolResultMaxTokens)}`);
    if (toolResults.length > 0) {
      lines.push('', 'Key tool results:', ...toolResults);
    }
  }

  return {
    role: 'user',
    content: lines.join('\n'),
    timestamp: turns[0]?.timestamp ?? Date.now(),
  };
}

// ═══════════════════════════════════════════════════════════════════
// SAFETY NET — Structural validation for provider adapters
// ═══════════════════════════════════════════════════════════════════

/**
 * Remove orphaned tool_call / tool_result turns that lost their pair.
 * This is a SAFETY NET for provider adapters — if the grouping layer is
 * working correctly, this should never fire. If it does, it logs a warning
 * because it means a structural group got corrupted upstream.
 */
export function sanitizeToolPairs(turns: ConversationTurn[]): ConversationTurn[] {
  const result: ConversationTurn[] = [];
  let i = 0;
  let repaired = false;
  while (i < turns.length) {
    if (turns[i].role === 'tool_result') {
      repaired = true;
      i++;
      continue;
    }
    if (turns[i].role === 'tool_call') {
      const groupStart = i;
      while (i < turns.length && turns[i].role === 'tool_call') i++;
      const callCount = i - groupStart;
      const resultStart = i;
      while (i < turns.length && turns[i].role === 'tool_result') i++;
      const resultCount = i - resultStart;
      if (resultCount > 0) {
        const pairCount = Math.min(callCount, resultCount);
        if (pairCount < callCount || pairCount < resultCount) repaired = true;
        for (let j = groupStart; j < groupStart + pairCount; j++) result.push(turns[j]);
        for (let j = resultStart; j < resultStart + pairCount; j++) result.push(turns[j]);
      } else {
        repaired = true;
      }
      continue;
    }
    result.push(turns[i]);
    i++;
  }
  if (repaired) {
    console.warn(
      `[HistoryManager] sanitizeToolPairs repaired ${turns.length - result.length} orphaned turns — ` +
      `compaction should have prevented this. Investigate upstream grouping. ` +
      `Input: ${turns.length} turns, output: ${result.length} turns`,
    );
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════
// TOOL RESULT TRUNCATION
// ═══════════════════════════════════════════════════════════════════

function truncateToolResults(
  turns: ConversationTurn[],
  maxTokens: number,
): ConversationTurn[] {
  const lastToolIdx = turns.reduce((acc, t, i) => (t.role === 'tool_result' ? i : acc), -1);
  return turns.map((turn, index) => {
    if (turn.role !== 'tool_result') return turn;
    const limit = index === lastToolIdx ? maxTokens * 2 : maxTokens;
    return {
      ...turn,
      content: clip(turn.content.replace(/\s+/g, ' ').trim(), limit),
    };
  });
}

// ═══════════════════════════════════════════════════════════════════
// MAIN PIPELINE — compressHistory()
// ═══════════════════════════════════════════════════════════════════

/**
 * Structure-aware history compression pipeline.
 *
 * When a ModelClient is provided, evicted context is summarized via a fast
 * LLM call (~$0.001). Without a ModelClient, falls back to deterministic
 * extraction (same quality as the old buildCompressedSummary).
 *
 * The pipeline:
 *   1. groupConversation() — parse into atomic groups
 *   2. scoreGroups()       — importance-score each group
 *   3. evictGroups()       — drop lowest-importance groups
 *   4. summarizeEvicted()  — distill evicted context into one turn
 *   5. truncateToolResults + sanitizeToolPairs — final safety pass
 */
export async function compressHistory(
  history: ConversationTurn[],
  config: HistoryCompressionConfig = DEFAULT_HISTORY_COMPRESSION,
  modelClient?: ModelClient,
): Promise<ConversationTurn[]> {
  if (history.length === 0) return history;

  // Truncate tool results first so token estimates are realistic
  const truncated = truncateToolResults(history, config.toolResultMaxTokens);

  if (estimateTokensForTurns(truncated) <= config.maxHistoryTokens) {
    return truncated;
  }

  // Layer 1: structural grouping
  const groups = groupConversation(truncated);

  // Layer 2: importance scoring + eviction
  scoreGroups(groups);

  // Reserve token budget for the summary turn (~300 tokens)
  const summaryBudget = 300;
  const groupBudget = config.maxHistoryTokens - summaryBudget;

  // Pin at least the last few groups. The config's keepRecentTurns translates
  // to pinning the last N groups (each group can contain multiple turns).
  const pinnedTailCount = Math.max(2, config.keepRecentTurns);
  const { surviving, evicted } = evictGroups(groups, groupBudget, pinnedTailCount);

  // Layer 3: summarize evicted context
  const survivingTurns = surviving.flatMap(g => g.turns);

  if (evicted.length > 0) {
    const summary = await summarizeEvicted(evicted, config, modelClient);
    return sanitizeToolPairs([summary, ...survivingTurns]);
  }

  return sanitizeToolPairs(survivingTurns);
}

// ═══════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════

function estimateTokensForTurns(turns: ConversationTurn[]): number {
  return Math.ceil(turns.reduce((total, turn) => total + turn.content.length, 0) / 3);
}

function clip(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}
