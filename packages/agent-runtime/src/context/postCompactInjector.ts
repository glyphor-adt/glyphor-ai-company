/**
 * Post-Compact Context Re-injection
 *
 * After the compressor evicts old conversation groups, critical context
 * may be lost. This module re-injects essential context that the agent
 * needs to maintain coherence:
 *
 *   1. Task context — the original assignment/task description
 *   2. Recent tool outputs — condensed summaries of the last N tool results
 *   3. Active skills — which skills/capabilities are available
 *   4. Working state — key facts discovered during the run
 *
 * Inspired by Claude Code's post-compact reconstruction (re-inject
 * recently-read files, skills, plan attachments, deferred tools).
 *
 * Budget: each injection has a max token allocation. Total re-injection
 * is capped at ~25% of the composition budget.
 */

import type { ConversationTurn } from '../types.js';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface PostCompactContext {
  /** The original task/assignment description. */
  taskDescription?: string;
  /** Names of skills currently available to the agent. */
  activeSkills?: string[];
  /** Key facts/decisions made during the run (from working memory). */
  workingState?: string[];
  /** Recent tool outputs to preserve (name → condensed output). */
  recentToolSummaries?: Array<{ toolName: string; summary: string }>;
}

export interface PostCompactInjectionResult {
  history: ConversationTurn[];
  injectedTurns: number;
  injectedTokenEstimate: number;
}

// ═══════════════════════════════════════════════════════════════════
// TOKEN LIMITS PER INJECTION TYPE
// ═══════════════════════════════════════════════════════════════════

const TASK_CONTEXT_MAX_CHARS  = 2_000;  // ~500 tokens
const SKILLS_MAX_CHARS        = 1_200;  // ~300 tokens
const WORKING_STATE_MAX_CHARS = 2_400;  // ~600 tokens
const TOOL_SUMMARY_MAX_CHARS  = 1_600;  // ~400 tokens per tool, max 3 tools
const TOOL_SUMMARY_MAX_COUNT  = 3;

const POST_COMPACT_PREFIX = '[POST-COMPACT CONTEXT]';

// ═══════════════════════════════════════════════════════════════════
// INJECTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Inject post-compact context into the composed history.
 * Injections are placed right after the last system/frame turn
 * (or at the beginning if none exists).
 *
 * Only injects when the compressor actually dropped groups
 * (droppedGroups > 0), to avoid redundant context on short conversations.
 */
export function injectPostCompactContext(
  history: ConversationTurn[],
  context: PostCompactContext,
  droppedGroups: number,
): PostCompactInjectionResult {
  if (droppedGroups === 0) {
    return { history, injectedTurns: 0, injectedTokenEstimate: 0 };
  }

  const injections: ConversationTurn[] = [];

  // 1. Task context re-injection
  if (context.taskDescription) {
    const clipped = clip(context.taskDescription, TASK_CONTEXT_MAX_CHARS);
    injections.push({
      role: 'user',
      content: `${POST_COMPACT_PREFIX} Task reminder:\n${clipped}`,
      timestamp: Date.now(),
    });
  }

  // 2. Active skills
  if (context.activeSkills?.length) {
    const skillList = context.activeSkills.join(', ');
    const clipped = clip(skillList, SKILLS_MAX_CHARS);
    injections.push({
      role: 'user',
      content: `${POST_COMPACT_PREFIX} Available skills: ${clipped}`,
      timestamp: Date.now(),
    });
  }

  // 3. Working state (key facts/decisions)
  if (context.workingState?.length) {
    const stateLines = context.workingState
      .map(fact => `• ${fact}`)
      .join('\n');
    const clipped = clip(stateLines, WORKING_STATE_MAX_CHARS);
    injections.push({
      role: 'user',
      content: `${POST_COMPACT_PREFIX} Key context from this run:\n${clipped}`,
      timestamp: Date.now(),
    });
  }

  // 4. Recent tool output summaries
  if (context.recentToolSummaries?.length) {
    const summaries = context.recentToolSummaries
      .slice(0, TOOL_SUMMARY_MAX_COUNT)
      .map(s => `[${s.toolName}]: ${clip(s.summary, TOOL_SUMMARY_MAX_CHARS)}`)
      .join('\n');
    injections.push({
      role: 'user',
      content: `${POST_COMPACT_PREFIX} Recent tool results:\n${summaries}`,
      timestamp: Date.now(),
    });
  }

  if (injections.length === 0) {
    return { history, injectedTurns: 0, injectedTokenEstimate: 0 };
  }

  // Find injection point — after last frame/system turn, before conversation
  const insertIndex = findInjectionPoint(history);
  const result = [
    ...history.slice(0, insertIndex),
    ...injections,
    ...history.slice(insertIndex),
  ];

  const injectedChars = injections.reduce((sum, t) => sum + t.content.length, 0);
  const injectedTokenEstimate = Math.ceil(injectedChars / 4);

  return {
    history: result,
    injectedTurns: injections.length,
    injectedTokenEstimate,
  };
}

/**
 * Extract recent tool output summaries from the raw history
 * (before compaction). This preserves key tool results that
 * might be evicted by the compressor.
 */
export function extractRecentToolSummaries(
  history: ConversationTurn[],
  maxTools = TOOL_SUMMARY_MAX_COUNT,
): Array<{ toolName: string; summary: string }> {
  const toolResults = history
    .filter(t => t.role === 'tool_result' && t.toolResult?.success)
    .slice(-maxTools);

  return toolResults.map(t => ({
    toolName: t.toolName ?? 'unknown',
    summary: condenseSummary(t.content ?? '', TOOL_SUMMARY_MAX_CHARS),
  }));
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function findInjectionPoint(history: ConversationTurn[]): number {
  // Find the last system/frame/context turn
  let lastFrameIdx = -1;
  for (let i = 0; i < history.length; i++) {
    const content = history[i].content ?? '';
    if (
      content.startsWith('[SYSTEM FRAME]') ||
      content.startsWith('[SESSION SUMMARY]') ||
      content.startsWith('[REASONING STATE]') ||
      content.startsWith('[CONTEXT')
    ) {
      lastFrameIdx = i;
    }
  }
  // Insert after the last frame turn, or at position 0
  return lastFrameIdx >= 0 ? lastFrameIdx + 1 : 0;
}

function clip(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 12) + ' [truncated]';
}

function condenseSummary(content: string, maxChars: number): string {
  // Strip whitespace runs, take first maxChars
  const normalized = content.replace(/\s+/g, ' ').trim();
  return clip(normalized, maxChars);
}
