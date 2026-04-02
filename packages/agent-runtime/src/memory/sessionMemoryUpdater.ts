import type { AgentConfig, ConversationTurn } from '../types.js';

const DEFAULT_MIN_TURNS_BETWEEN_UPDATE = 2;
const DEFAULT_MIN_TOOL_CALLS_BETWEEN_UPDATE = 1;
const DEFAULT_MIN_TOKEN_DELTA_BETWEEN_UPDATE = 1200;
const DEFAULT_MAX_SUMMARY_TOKENS = 1000;
const DEFAULT_MAX_TURNS_IN_SUMMARY = 12;

export interface SessionMemoryConfig {
  enabled: boolean;
  minTurnsBetweenUpdate: number;
  minToolCallsBetweenUpdate: number;
  minTokenDeltaBetweenUpdate: number;
  maxSummaryTokens: number;
}

export interface SessionMemorySummaryRecord {
  conversationId: string;
  sessionId?: string;
  agentRole: string;
  summaryText: string;
  updatedAt: string;
  sourceTurnCount: number;
  sourceToolCount: number;
  sourceTokenEstimate: number;
}

export interface SessionMemoryStore {
  getLatest(conversationId: string): Promise<SessionMemorySummaryRecord | null>;
  upsert(record: SessionMemorySummaryRecord): Promise<void>;
}

type BaselineStats = {
  turnCount: number;
  toolCount: number;
  tokenEstimate: number;
};

export interface SessionMemoryUpdateInput {
  config: Pick<AgentConfig, 'id' | 'dbRunId' | 'role'>;
  history: ConversationTurn[];
  turnNumber: number;
  latestAssistantText: string;
  conversationId?: string;
  sessionId?: string;
}

export interface SessionMemoryUpdateResult {
  updated: boolean;
  reason:
    | 'disabled'
    | 'empty_history'
    | 'baseline_initialized'
    | 'threshold_not_met'
    | 'updated'
    | 'store_error';
  tokenEstimate: number;
}

function parseIntWithDefault(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function isSummaryFirstCompactionEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isTruthy(env.SUMMARY_FIRST_COMPACTION_ENABLED);
}

function estimateTokens(history: ConversationTurn[]): number {
  const chars = history.reduce((sum, turn) => sum + turn.content.length, 0);
  return Math.ceil(chars / 4);
}

function summarizeTurn(turn: ConversationTurn): string {
  const compact = turn.content.replace(/\s+/g, ' ').trim();
  const clipped = compact.length > 240 ? `${compact.slice(0, 237)}...` : compact;
  return `${turn.role.toUpperCase()}: ${clipped}`;
}

export function buildSessionSummary(
  history: ConversationTurn[],
  latestAssistantText: string,
  maxSummaryTokens: number,
): string {
  const maxChars = Math.max(200, maxSummaryTokens * 4);
  const recentTurns = history.slice(-DEFAULT_MAX_TURNS_IN_SUMMARY);
  const body = recentTurns.map(summarizeTurn).join('\n');
  const assistantLine = latestAssistantText
    ? `\n\nLATEST_ASSISTANT_DECISION: ${latestAssistantText.replace(/\s+/g, ' ').trim().slice(0, 300)}`
    : '';
  const summary = `${body}${assistantLine}`.trim();
  return summary.length > maxChars ? `${summary.slice(0, maxChars - 3)}...` : summary;
}

export function getSessionMemoryConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SessionMemoryConfig {
  return {
    enabled: isTruthy(env.SESSION_MEMORY_ENABLED),
    minTurnsBetweenUpdate: parseIntWithDefault(
      env.SESSION_MEMORY_MIN_TURNS_BETWEEN_UPDATE,
      DEFAULT_MIN_TURNS_BETWEEN_UPDATE,
    ),
    minToolCallsBetweenUpdate: parseIntWithDefault(
      env.SESSION_MEMORY_MIN_TOOL_CALLS_BETWEEN_UPDATE,
      DEFAULT_MIN_TOOL_CALLS_BETWEEN_UPDATE,
    ),
    minTokenDeltaBetweenUpdate: parseIntWithDefault(
      env.SESSION_MEMORY_MIN_TOKEN_DELTA,
      DEFAULT_MIN_TOKEN_DELTA_BETWEEN_UPDATE,
    ),
    maxSummaryTokens: parseIntWithDefault(
      env.SESSION_MEMORY_MAX_TOKENS,
      DEFAULT_MAX_SUMMARY_TOKENS,
    ),
  };
}

export class SessionMemoryUpdater {
  private readonly baselineByConversation = new Map<string, BaselineStats>();

  constructor(
    private readonly store: SessionMemoryStore,
    private readonly config: SessionMemoryConfig = getSessionMemoryConfigFromEnv(),
  ) {}

  async maybeUpdate(
    input: SessionMemoryUpdateInput,
  ): Promise<SessionMemoryUpdateResult> {
    if (!this.config.enabled) {
      return { updated: false, reason: 'disabled', tokenEstimate: 0 };
    }

    if (input.history.length === 0) {
      return { updated: false, reason: 'empty_history', tokenEstimate: 0 };
    }

    const conversationId = input.conversationId ?? input.config.dbRunId ?? input.config.id;
    const turnCount = input.history.length;
    const toolCount = input.history.filter(
      turn => turn.role === 'tool_call' || turn.role === 'tool_result',
    ).length;
    const tokenEstimate = estimateTokens(input.history);

    let baseline = this.baselineByConversation.get(conversationId);
    if (!baseline) {
      try {
        const persisted = await this.store.getLatest(conversationId);
        baseline = persisted
          ? {
              turnCount: persisted.sourceTurnCount,
              toolCount: persisted.sourceToolCount,
              tokenEstimate: persisted.sourceTokenEstimate,
            }
          : { turnCount, toolCount, tokenEstimate };
      } catch {
        baseline = { turnCount, toolCount, tokenEstimate };
      }
      this.baselineByConversation.set(conversationId, baseline);
      return { updated: false, reason: 'baseline_initialized', tokenEstimate };
    }

    const turnDelta = Math.max(0, turnCount - baseline.turnCount);
    const toolDelta = Math.max(0, toolCount - baseline.toolCount);
    const tokenDelta = Math.max(0, tokenEstimate - baseline.tokenEstimate);
    const thresholdMet =
      turnDelta >= this.config.minTurnsBetweenUpdate ||
      toolDelta >= this.config.minToolCallsBetweenUpdate ||
      tokenDelta >= this.config.minTokenDeltaBetweenUpdate;

    if (!thresholdMet) {
      return { updated: false, reason: 'threshold_not_met', tokenEstimate };
    }

    const summaryText = buildSessionSummary(
      input.history,
      input.latestAssistantText,
      this.config.maxSummaryTokens,
    );

    try {
      await this.store.upsert({
        conversationId,
        sessionId: input.sessionId,
        agentRole: input.config.role,
        summaryText,
        updatedAt: new Date().toISOString(),
        sourceTurnCount: turnCount,
        sourceToolCount: toolCount,
        sourceTokenEstimate: tokenEstimate,
      });
    } catch {
      return { updated: false, reason: 'store_error', tokenEstimate };
    }

    this.baselineByConversation.set(conversationId, {
      turnCount,
      toolCount,
      tokenEstimate,
    });
    return { updated: true, reason: 'updated', tokenEstimate };
  }
}

