/**
 * Company Agent Runner — Core Execution Loop
 *
 * Ported from Fuse V7 runtime/agentRunner.ts and adapted for company agents.
 * Loop: supervisor check → context injection → model call → tool dispatch → loop
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ModelClient } from './modelClient.js';
import { ToolExecutor } from './toolExecutor.js';
import { AgentSupervisor } from './supervisor.js';
import { extractReasoning } from './reasoning.js';
import type { GlyphorEventBus } from './glyphorEventBus.js';
import type {
  AgentConfig,
  AgentEvent,
  AgentExecutionResult,
  AgentMemory,
  AgentReflection,
  CompanyAgentRole,
  ConversationTurn,
  IMemoryBus,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROLE_TO_BRIEF: Record<CompanyAgentRole, string> = {
  'chief-of-staff': 'sarah-chen',
  'cto': 'marcus-reeves',
  'cfo': 'nadia-okafor',
  'cpo': 'elena-vasquez',
  'cmo': 'maya-brooks',
  'vp-customer-success': 'james-turner',
  'vp-sales': 'rachel-kim',
};

function buildSystemPrompt(role: CompanyAgentRole, existingPrompt: string): string {
  try {
    const knowledgeBase = readFileSync(
      join(__dirname, '../../company-knowledge/COMPANY_KNOWLEDGE_BASE.md'), 'utf-8',
    );
    const briefId = ROLE_TO_BRIEF[role];
    const roleBrief = readFileSync(
      join(__dirname, `../../company-knowledge/briefs/${briefId}.md`), 'utf-8',
    );
    return `${knowledgeBase}\n\n---\n\n${roleBrief}\n\n---\n\n${existingPrompt}`;
  } catch (err) {
    console.warn(`[CompanyAgentRunner] Failed to load knowledge files for ${role}:`, (err as Error).message);
    return existingPrompt;
  }
}

/**
 * Optional store interface for memory/reflection persistence.
 * Matches CompanyMemoryStore methods without a hard dependency.
 */
export interface AgentMemoryStore {
  getMemories(role: CompanyAgentRole, options?: { limit?: number }): Promise<AgentMemory[]>;
  getReflections(role: CompanyAgentRole, limit?: number): Promise<AgentReflection[]>;
  saveMemory(memory: Omit<AgentMemory, 'id' | 'createdAt'>): Promise<string>;
  saveReflection(reflection: Omit<AgentReflection, 'id' | 'createdAt'>): Promise<string>;
}

export interface RunDependencies {
  glyphorEventBus?: GlyphorEventBus;
  agentMemoryStore?: AgentMemoryStore;
}

export class CompanyAgentRunner {
  constructor(private modelClient: ModelClient) {}
  async run(
    config: AgentConfig,
    initialMessage: string,
    supervisor: AgentSupervisor,
    toolExecutor: ToolExecutor,
    emitEvent: (event: AgentEvent) => void,
    memoryBus: IMemoryBus,
    deps?: RunDependencies,
  ): Promise<AgentExecutionResult> {
    const history: ConversationTurn[] = [
      { role: 'user', content: initialMessage, timestamp: Date.now() },
    ];
    let lastTextOutput: string | null = null;

    emitEvent({
      type: 'agent_started',
      agentId: config.id,
      role: config.role,
      model: config.model,
    });

    // ─── MEMORY RETRIEVAL: inject prior memories + reflections ──
    if (deps?.agentMemoryStore) {
      try {
        const [memories, reflections] = await Promise.all([
          deps.agentMemoryStore.getMemories(config.role, { limit: 20 }),
          deps.agentMemoryStore.getReflections(config.role, 3),
        ]);

        if (memories.length > 0 || reflections.length > 0) {
          const memoryContext = buildMemoryContext(memories, reflections);
          history.push({
            role: 'user',
            content: memoryContext,
            timestamp: Date.now(),
          });
        }
      } catch (err) {
        console.warn(
          `[CompanyAgentRunner] Memory retrieval failed for ${config.role}:`,
          (err as Error).message,
        );
      }
    }

    try {
      let turnNumber = 0;

      while (true) {
        turnNumber++;
        emitEvent({ type: 'turn_started', agentId: config.id, turnNumber });

        // 1. SUPERVISOR CHECK
        const check = supervisor.checkBeforeModelCall();
        if (!check.ok) {
          return this.buildResult(
            config, 'aborted', lastTextOutput, history, supervisor, check.reason,
          );
        }

        // 2. CONTEXT INJECTION
        if (config.contextInjector && turnNumber > 1) {
          try {
            const injected = await config.contextInjector(turnNumber, history);
            if (injected) {
              history.push({
                role: 'user',
                content: injected,
                timestamp: Date.now(),
              });
              emitEvent({
                type: 'context_injected',
                agentId: config.id,
                turnNumber,
                contextLength: injected.length,
              });
            }
          } catch (injectorError) {
            console.warn(
              `[CompanyAgentRunner] contextInjector failed for ${config.id} turn ${turnNumber}:`,
              (injectorError as Error).message,
            );
          }
        }

        // 3. MODEL CALL
        let response: Awaited<ReturnType<ModelClient['generate']>>;
        try {
          emitEvent({
            type: 'model_request',
            agentId: config.id,
            turnNumber,
            tokenEstimate: estimateTokens(history),
          });

          const systemPrompt = buildSystemPrompt(config.role, config.systemPrompt);

          response = await this.modelClient.generate({
            model: config.model,
            systemInstruction: systemPrompt,
            contents: history,
            tools: toolExecutor.getDeclarations(),
            temperature: config.temperature,
            topP: config.topP,
            topK: config.topK,
            signal: supervisor.signal,
          });

          emitEvent({
            type: 'model_response',
            agentId: config.id,
            turnNumber,
            hasToolCalls: response.toolCalls.length > 0,
            thinkingText: response.thinkingText,
          });
        } catch (error) {
          if (supervisor.isAborted) {
            return this.buildResult(
              config, 'aborted', lastTextOutput, history, supervisor,
              (error as Error).message,
            );
          }
          throw error;
        }

        // 4. TOOL CALLS
        if (response.toolCalls.length > 0) {
          // Push all tool_call turns first (batched for proper Gemini 3+ thought signature replay)
          for (let j = 0; j < response.toolCalls.length; j++) {
            const call = response.toolCalls[j];
            history.push({
              role: 'tool_call',
              content: JSON.stringify(call.args),
              toolName: call.name,
              toolParams: call.args,
              thoughtSignature: call.thoughtSignature,
              thinkingBeforeTools: j === 0 ? response.thinkingText : undefined,
              timestamp: Date.now(),
            });

            emitEvent({
              type: 'tool_call',
              agentId: config.id,
              turnNumber,
              toolName: call.name,
              params: call.args,
            });
          }

          // Execute all tools and push all tool_result turns
          for (const call of response.toolCalls) {
            const result = await toolExecutor.execute(call.name, call.args, {
              agentId: config.id,
              agentRole: config.role,
              turnNumber,
              abortSignal: supervisor.signal,
              memoryBus,
              emitEvent,
            });

            const resultContent = result.data !== undefined
              ? JSON.stringify(result.data)
              : result.error ?? 'ok';

            history.push({
              role: 'tool_result',
              content: resultContent,
              toolName: call.name,
              toolResult: result,
              timestamp: Date.now(),
            });

            emitEvent({
              type: 'tool_result',
              agentId: config.id,
              turnNumber,
              toolName: call.name,
              success: result.success,
              filesWritten: result.filesWritten ?? 0,
              memoryKeysWritten: result.memoryKeysWritten ?? 0,
            });

            const progressCheck = supervisor.recordToolResult(call.name, result);
            if (!progressCheck.ok) {
              return this.buildResult(
                config, 'aborted', lastTextOutput, history, supervisor,
                progressCheck.reason,
              );
            }
          }
          continue;
        }

        // 5. TEXT RESPONSE — agent done
        if (response.text) {
          lastTextOutput = response.text;
          history.push({
            role: 'assistant',
            content: response.text,
            timestamp: Date.now(),
          });
        }

        if (response.finishReason === 'STOP' || response.toolCalls.length === 0) {
          break;
        }
      }

      const stats = supervisor.stats;

      // ─── REFLECT: Self-assessment of this run ──────────────────
      if (deps?.agentMemoryStore && lastTextOutput) {
        try {
          await this.reflectOnRun(config, history, lastTextOutput, deps.agentMemoryStore);
        } catch (err) {
          console.warn(
            `[CompanyAgentRunner] Reflection failed for ${config.id}:`,
            (err as Error).message,
          );
        }
      }

      // ─── EMIT: agent.completed event to event bus ──────────────
      if (deps?.glyphorEventBus) {
        try {
          await deps.glyphorEventBus.emit({
            type: 'agent.completed',
            source: config.role,
            payload: {
              runId: config.id,
              task: config.id.split('-').slice(1, -1).join('-'),
              totalTurns: stats.turnCount,
              elapsedMs: stats.elapsedMs,
              outputLength: lastTextOutput?.length ?? 0,
              summary: lastTextOutput?.slice(0, 500) ?? '',
            },
            priority: 'normal',
          });
        } catch (err) {
          console.warn(
            `[CompanyAgentRunner] Event emission failed for ${config.id}:`,
            (err as Error).message,
          );
        }
      }

      emitEvent({
        type: 'agent_completed',
        agentId: config.id,
        totalTurns: stats.turnCount,
        totalFiles: stats.filesWritten,
        totalMemoryKeys: stats.memoryKeysWritten,
        elapsedMs: stats.elapsedMs,
      });

      return this.buildResult(config, 'completed', lastTextOutput, history, supervisor);

    } catch (error) {
      emitEvent({
        type: 'agent_error',
        agentId: config.id,
        error: (error as Error).message,
        turnNumber: supervisor.stats.turnCount,
      });
      return this.buildResult(
        config,
        supervisor.isAborted ? 'aborted' : 'error',
        lastTextOutput,
        history,
        supervisor,
        (error as Error).message,
      );
    }
  }

  private buildResult(
    config: AgentConfig,
    status: AgentExecutionResult['status'],
    output: string | null,
    history: ConversationTurn[],
    supervisor: AgentSupervisor,
    errorMsg?: string,
  ): AgentExecutionResult {
    const stats = supervisor.stats;
    return {
      agentId: config.id,
      role: config.role,
      status,
      output,
      totalTurns: stats.turnCount,
      totalFilesWritten: stats.filesWritten,
      totalMemoryKeysWritten: stats.memoryKeysWritten,
      elapsedMs: stats.elapsedMs,
      abortReason: status === 'aborted' ? errorMsg : undefined,
      error: status === 'error' ? errorMsg : undefined,
      reasoning: output ? extractReasoning(output) : undefined,
      conversationHistory: history,
    };
  }

  /**
   * REFLECT phase: Ask the model to self-assess the run and persist
   * a structured reflection + extracted memories.
   */
  private async reflectOnRun(
    config: AgentConfig,
    history: ConversationTurn[],
    output: string,
    store: AgentMemoryStore,
  ): Promise<void> {
    const systemPrompt = buildSystemPrompt(config.role, config.systemPrompt);

    const reflectPrompt = `You just completed a task. Here is your final output:

---
${output.slice(0, 3000)}
---

Reflect on this run and respond with a JSON object (no markdown fencing):
{
  "summary": "1-2 sentence summary of what you accomplished",
  "qualityScore": <0-100>,
  "whatWentWell": ["..."],
  "whatCouldImprove": ["..."],
  "promptSuggestions": ["suggestions for how your instructions could be improved"],
  "knowledgeGaps": ["things you didn't know but needed"],
  "memories": [
    { "type": "observation|learning|preference|fact", "content": "...", "importance": 0.0-1.0 }
  ]
}`;

    const reflectHistory: ConversationTurn[] = [
      ...history.slice(-4),
      { role: 'user', content: reflectPrompt, timestamp: Date.now() },
    ];

    const response = await this.modelClient.generate({
      model: config.model,
      systemInstruction: systemPrompt,
      contents: reflectHistory,
      tools: [],
      temperature: 0.3,
    });

    if (!response.text) return;

    try {
      const parsed = JSON.parse(response.text.replace(/```json?\n?/g, '').replace(/```/g, '').trim());

      // Save reflection
      await store.saveReflection({
        agentRole: config.role,
        runId: config.id,
        summary: parsed.summary ?? '',
        qualityScore: Math.max(0, Math.min(100, parsed.qualityScore ?? 50)),
        whatWentWell: parsed.whatWentWell ?? [],
        whatCouldImprove: parsed.whatCouldImprove ?? [],
        promptSuggestions: parsed.promptSuggestions ?? [],
        knowledgeGaps: parsed.knowledgeGaps ?? [],
      });

      // Save extracted memories
      const memories = parsed.memories ?? [];
      for (const mem of memories.slice(0, 5)) {
        await store.saveMemory({
          agentRole: config.role,
          memoryType: mem.type ?? 'observation',
          content: mem.content ?? '',
          importance: Math.max(0, Math.min(1, mem.importance ?? 0.5)),
          sourceRunId: config.id,
        });
      }

      console.log(
        `[CompanyAgentRunner] Reflection saved for ${config.id}: score=${parsed.qualityScore}, memories=${memories.length}`,
      );
    } catch (parseErr) {
      console.warn(
        `[CompanyAgentRunner] Failed to parse reflection output for ${config.id}:`,
        (parseErr as Error).message,
      );
    }
  }
}

function estimateTokens(history: ConversationTurn[]): number {
  const totalChars = history.reduce((sum, t) => sum + t.content.length, 0);
  return Math.ceil(totalChars / 4);
}

function buildMemoryContext(
  memories: AgentMemory[],
  reflections: AgentReflection[],
): string {
  const parts: string[] = [
    '## Your Prior Knowledge & Learnings\n',
    'Below are your accumulated memories and recent self-reflections.',
    'Use these to inform your approach and avoid repeating past mistakes.\n',
  ];

  if (memories.length > 0) {
    parts.push('### Memories');
    for (const m of memories) {
      parts.push(
        `- [${m.memoryType}] (importance: ${m.importance}) ${m.content}`,
      );
    }
    parts.push('');
  }

  if (reflections.length > 0) {
    parts.push('### Recent Reflections');
    for (const r of reflections) {
      parts.push(`**Run ${r.runId}** (score: ${r.qualityScore}/100): ${r.summary}`);
      if (r.whatCouldImprove.length > 0) {
        parts.push(`  Improve: ${r.whatCouldImprove.join('; ')}`);
      }
      if (r.promptSuggestions.length > 0) {
        parts.push(`  Suggestions: ${r.promptSuggestions.join('; ')}`);
      }
    }
  }

  return parts.join('\n');
}
