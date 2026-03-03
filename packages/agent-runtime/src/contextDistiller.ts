/**
 * Context Distiller — Compresses raw JIT context into a task-focused briefing.
 *
 * A single fast model call (gemini-3-flash-preview, temperature 0.3) that takes
 * raw JIT results + the task description and produces a structured briefing with
 * key facts and warnings. This replaces raw concatenation for standard/full tier
 * scheduled runs, producing higher-quality context at ~$0.001 per call.
 */

import { ModelClient } from './modelClient.js';
import type { JitContext, JitContextItem } from './jitContextRetriever.js';
import type { RedisCache } from './redisCache.js';
import { CACHE_KEYS } from './redisCache.js';
import { createHash } from 'node:crypto';

// ─── Types ──────────────────────────────────────────────────────

export interface DistilledContext {
  briefing: string;           // 200-400 word focused briefing
  keyFacts: string[];         // 3-7 critical facts
  warnings: string[];         // Risks or contradictions detected
  tokenEstimate: number;
  distillationModel: string;
  distillationCostUsd: number;
  distillationDurationMs: number;
  cacheHit: boolean;
}

// ─── Constants ──────────────────────────────────────────────────

const DISTILLATION_MODEL = 'gemini-2.5-flash';
const DISTILLATION_CACHE_TTL = 300; // 5 min

/** Cost per million tokens for gemini-3-flash-preview */
const FLASH_INPUT_COST = 0.10 / 1_000_000;
const FLASH_OUTPUT_COST = 0.40 / 1_000_000;

const DISTILLATION_SYSTEM_PROMPT = `You are a context distiller for an AI agent. Your job is to take raw context data (memories, knowledge graph nodes, past episodes, procedures, organizational knowledge) and compress it into a focused briefing for the agent that is about to execute a task.

Rules:
- Prioritize information directly relevant to the stated task
- Flag contradictions between different sources
- Highlight recent information over old information
- Identify risks or warnings the agent should know about
- Remove redundant or low-relevance items
- Be concise — the agent has a limited context window

Respond with JSON only, no markdown fences, no preamble:
{
  "briefing": "200-400 word focused briefing paragraph written directly to the agent",
  "keyFacts": ["fact 1", "fact 2", ...],
  "warnings": ["warning 1", ...]
}`;

// ─── Class ──────────────────────────────────────────────────────

export class ContextDistiller {
  constructor(
    private modelClient: ModelClient,
    private cache: RedisCache | null,
  ) {}

  /**
   * Distill raw JIT context into a task-focused briefing.
   * Called between JIT retrieval and system prompt building.
   */
  async distill(
    agentRole: string,
    task: string,
    taskDescription: string,
    jitContext: JitContext,
  ): Promise<DistilledContext> {
    // ─── Cache check ───
    const inputHash = createHash('md5')
      .update(`${agentRole}:${task}:${taskDescription}:${jitContext.tokenEstimate}`)
      .digest('hex')
      .slice(0, 12);

    const cacheKey = CACHE_KEYS.distilledContext(agentRole, inputHash);

    if (this.cache) {
      const cached = await this.cache.get<DistilledContext>(cacheKey);
      if (cached) return { ...cached, cacheHit: true };
    }

    // ─── Build distillation prompt ───
    const userPrompt = this.buildPrompt(agentRole, task, taskDescription, jitContext);

    const startMs = Date.now();

    // ─── Single fast model call ───
    const response = await this.modelClient.generate({
      model: DISTILLATION_MODEL,
      systemInstruction: DISTILLATION_SYSTEM_PROMPT,
      contents: [
        { role: 'user', content: userPrompt, timestamp: startMs },
      ],
      temperature: 0.3,
      maxTokens: 800,
    });

    const durationMs = Date.now() - startMs;
    const parsed = this.parseOutput(response.text ?? '');

    const costUsd =
      (response.usageMetadata?.inputTokens ?? 0) * FLASH_INPUT_COST +
      (response.usageMetadata?.outputTokens ?? 0) * FLASH_OUTPUT_COST;

    const result: DistilledContext = {
      briefing: parsed.briefing,
      keyFacts: parsed.keyFacts,
      warnings: parsed.warnings,
      tokenEstimate: Math.ceil(
        (parsed.briefing.length + parsed.keyFacts.join('').length + parsed.warnings.join('').length) / 4,
      ),
      distillationModel: DISTILLATION_MODEL,
      distillationCostUsd: costUsd || 0.001,
      distillationDurationMs: durationMs,
      cacheHit: false,
    };

    // ─── Cache result ───
    if (this.cache) {
      await this.cache.set(cacheKey, result, DISTILLATION_CACHE_TTL);
    }

    return result;
  }

  // ─── Prompt builder ───────────────────────────────────────────

  private buildPrompt(
    role: string,
    task: string,
    taskDescription: string,
    jit: JitContext,
  ): string {
    const lines: string[] = [
      `AGENT ROLE: ${role}`,
      `TASK TYPE: ${task}`,
      `TASK: ${taskDescription}`,
      '',
      'RAW CONTEXT TO DISTILL:',
    ];

    const formatItems = (label: string, items: JitContextItem[]) => {
      if (items.length === 0) return;
      lines.push(`\n--- ${label} ---`);
      for (const item of items) {
        lines.push(`[${item.source}, score=${item.score.toFixed(2)}] ${item.content}`);
      }
    };

    formatItems('MEMORIES', jit.relevantMemories);
    formatItems('KNOWLEDGE GRAPH', jit.relevantGraphNodes);
    formatItems('PAST EPISODES', jit.relevantEpisodes);
    formatItems('PROCEDURES', jit.relevantProcedures);
    formatItems('ORG KNOWLEDGE', jit.relevantKnowledge);

    return lines.join('\n');
  }

  // ─── Output parser ────────────────────────────────────────────

  private parseOutput(text: string): {
    briefing: string;
    keyFacts: string[];
    warnings: string[];
  } {
    // Strip markdown fences if model added them despite instructions
    const cleaned = text
      .replace(/^```json\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    try {
      const json = JSON.parse(cleaned);
      return {
        briefing: json.briefing ?? cleaned,
        keyFacts: Array.isArray(json.keyFacts ?? json.key_facts)
          ? (json.keyFacts ?? json.key_facts)
          : [],
        warnings: Array.isArray(json.warnings) ? json.warnings : [],
      };
    } catch {
      // Model didn't return valid JSON — use the whole text as the briefing
      return {
        briefing: text.slice(0, 2000),
        keyFacts: [],
        warnings: [],
      };
    }
  }
}
