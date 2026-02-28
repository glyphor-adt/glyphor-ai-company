/**
 * Base Agent Runner — Shared infrastructure for Orchestrator & Task runners.
 *
 * Extracts context loading, model calling, tool dispatching, and result
 * building into a base class. Subclasses override `buildRunPrompt()` and
 * `postRun()` to inject archetype-specific behavior.
 *
 * The existing CompanyAgentRunner remains the default runner for backward
 * compatibility (on_demand chat, generic scheduled tasks). The new runners
 * are used for classified agents in structured workflows.
 */

import { ModelClient } from './modelClient.js';
import { ToolExecutor } from './toolExecutor.js';
import { AgentSupervisor } from './supervisor.js';
import { extractReasoning } from './reasoning.js';
import { isOfficeDocument, extractDocumentText } from './documentExtractor.js';
import type { GlyphorEventBus } from './glyphorEventBus.js';
import type {
  AgentConfig,
  AgentEvent,
  AgentExecutionResult,
  AgentArchetype,
  CompanyAgentRole,
  ConversationAttachment,
  ConversationTurn,
  IMemoryBus,
  SharedMemoryContext,
} from './types.js';
import type { RunDependencies, AgentProfileData, SkillContext } from './companyAgentRunner.js';
import type { ReasoningEngine } from './reasoningEngine.js';
import type { JitContextRetriever, JitContext } from './jitContextRetriever.js';
import type { RedisCache } from './redisCache.js';

// ─── Cost estimation (mirrors companyAgentRunner) ───────────────
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gemini-3':         { input: 0.10 / 1_000_000, output: 0.40 / 1_000_000 },
  'gemini-2.5-flash': { input: 0.15 / 1_000_000, output: 0.60 / 1_000_000 },
  'gemini-2.5-pro':   { input: 1.25 / 1_000_000, output: 10.0 / 1_000_000 },
  'gemini-2':         { input: 0.10 / 1_000_000, output: 0.40 / 1_000_000 },
  'claude':           { input: 3.00 / 1_000_000, output: 15.0 / 1_000_000 },
  'gpt-4':            { input: 2.50 / 1_000_000, output: 10.0 / 1_000_000 },
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const entry = Object.entries(MODEL_PRICING)
    .sort((a, b) => b[0].length - a[0].length)
    .find(([prefix]) => model.startsWith(prefix));
  const pricing = entry?.[1] ?? MODEL_PRICING['gemini-3'];
  return inputTokens * pricing.input + outputTokens * pricing.output;
}

function estimateTokens(history: ConversationTurn[]): number {
  return Math.ceil(history.reduce((s, t) => s + t.content.length, 0) / 4);
}

// ─── Extended RunDependencies with shared memory ────────────────
export interface ClassifiedRunDependencies extends RunDependencies {
  /** Shared memory loader — provides cross-agent episodic/procedural/world-model context. */
  sharedMemoryLoader?: {
    loadForAgent(role: CompanyAgentRole, currentTask: string): Promise<SharedMemoryContext>;
    formatForPrompt(ctx: SharedMemoryContext): string;
    writeEpisode(episode: {
      authorAgent: string;
      episodeType: string;
      summary: string;
      detail?: Record<string, unknown>;
      outcome?: string;
      confidence?: number;
      domains: string[];
      tags?: string[];
      relatedAgents?: string[];
      directiveId?: string;
      assignmentId?: string;
    }): Promise<string>;
    initializeWorldModel?(role: CompanyAgentRole): Promise<void>;
  };
  /** World model updater — updates agent self-models after grading. */
  worldModelUpdater?: {
    updateFromGrade(grade: {
      agentRole: CompanyAgentRole;
      taskType: string;
      overallScore: number;
      dimensionScores: Record<string, number>;
      evaluatorFeedback: string;
    }): Promise<void>;
  };
  /** Redis cache instance for shared caching. */
  cache?: RedisCache;
  /** Factory to create a ReasoningEngine for the current agent. */
  reasoningEngineFactory?: (agentRole: string) => Promise<ReasoningEngine | null>;
  /** JIT context retriever for task-aware semantic retrieval. */
  jitContextRetriever?: JitContextRetriever;
}

/**
 * Abstract base runner — provides shared execution infrastructure.
 * Subclasses implement `archetype`, `buildRunPrompt()`, and `postRun()`.
 */
export abstract class BaseAgentRunner {
  constructor(protected modelClient: ModelClient) {}

  /** The archetype this runner handles. */
  abstract readonly archetype: AgentArchetype;

  /**
   * Build the system prompt for this run. Subclasses inject their
   * archetype-specific protocols (orchestration vs task execution).
   */
  protected abstract buildRunPrompt(
    config: AgentConfig,
    profile: AgentProfileData | null,
    sharedMemory: SharedMemoryContext | null,
    deps: ClassifiedRunDependencies,
  ): string;

  /**
   * Post-run hook — called after the main execution loop finishes.
   * Orchestrators use this for grading/world-model updates.
   * Task agents use this for episode writing.
   */
  protected abstract postRun(
    config: AgentConfig,
    output: string,
    history: ConversationTurn[],
    deps: ClassifiedRunDependencies,
  ): Promise<void>;

  /**
   * Execute the agent run with the archetype-specific protocols.
   */
  async run(
    config: AgentConfig,
    initialMessage: string,
    supervisor: AgentSupervisor,
    toolExecutor: ToolExecutor,
    emitEvent: (event: AgentEvent) => void,
    memoryBus: IMemoryBus,
    deps?: ClassifiedRunDependencies,
  ): Promise<AgentExecutionResult> {
    const safeDeps = deps ?? {};

    // ─── Pre-process attachments ────────────────────────────────
    let initialAttachments: ConversationAttachment[] | undefined;
    const cleanHistory = (config.conversationHistory ?? []).filter((t) => {
      if (t.content === '__multimodal_attachments__' && t.attachments?.length) {
        initialAttachments = t.attachments;
        return false;
      }
      return true;
    });

    if (initialAttachments?.length) {
      initialAttachments = await Promise.all(
        initialAttachments.map(async (att) => {
          if (isOfficeDocument(att.mimeType, att.name)) {
            const text = await extractDocumentText(att.data, att.name);
            return { name: att.name, mimeType: 'text/plain', data: Buffer.from(text).toString('base64') };
          }
          return att;
        }),
      );
    }

    const history: ConversationTurn[] = [
      ...cleanHistory,
      { role: 'user', content: initialMessage, timestamp: Date.now(), ...(initialAttachments ? { attachments: initialAttachments } : {}) },
    ];

    let lastTextOutput: string | null = null;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    emitEvent({ type: 'agent_started', agentId: config.id, role: config.role, model: config.model });

    // ─── Load shared memory + JIT context in parallel ───────────
    const taskForContext = config.id.replace(/-\d{4}-\d{2}-\d{2}$/, '').split('-').pop() ?? 'general';

    let sharedMemory: SharedMemoryContext | null = null;
    let jitContext: JitContext | null = null;

    const [sharedMemResult, jitResult] = await Promise.allSettled([
      safeDeps.sharedMemoryLoader
        ? safeDeps.sharedMemoryLoader.loadForAgent(config.role, taskForContext)
        : Promise.resolve(null),
      safeDeps.jitContextRetriever
        ? safeDeps.jitContextRetriever.retrieve(config.role, `${taskForContext}: ${initialMessage.slice(0, 200)}`)
        : Promise.resolve(null),
    ]);

    if (sharedMemResult.status === 'fulfilled') {
      sharedMemory = sharedMemResult.value;
    } else {
      console.warn(`[${this.archetype}Runner] Shared memory load failed for ${config.role}:`, (sharedMemResult.reason as Error).message);
    }

    if (jitResult.status === 'fulfilled') {
      jitContext = jitResult.value;
    } else {
      console.warn(`[${this.archetype}Runner] JIT context load failed for ${config.role}:`, (jitResult.reason as Error).message);
    }

    // ─── Load agent profile ─────────────────────────────────────
    let agentProfile: AgentProfileData | null = null;
    if (safeDeps.agentProfileLoader) {
      try {
        agentProfile = await safeDeps.agentProfileLoader(config.role);
      } catch (err) {
        console.warn(`[${this.archetype}Runner] Profile load failed for ${config.role}:`, (err as Error).message);
      }
    }

    // ─── Inject shared memory into history ──────────────────────
    if (sharedMemory && safeDeps.sharedMemoryLoader) {
      const memPrompt = safeDeps.sharedMemoryLoader.formatForPrompt(sharedMemory);
      if (memPrompt) {
        history.push({ role: 'user', content: memPrompt, timestamp: Date.now() });
      }
    }

    // ─── Inject JIT context into history ────────────────────────
    if (jitContext && jitContext.tokenEstimate > 0) {
      const jitSections: string[] = [];
      if (jitContext.relevantMemories.length > 0) {
        jitSections.push('## Relevant Memories\n' + jitContext.relevantMemories.map(m => `- ${m.content}`).join('\n'));
      }
      if (jitContext.relevantKnowledge.length > 0) {
        jitSections.push('## Relevant Knowledge\n' + jitContext.relevantKnowledge.map(k => `- ${k.content}`).join('\n'));
      }
      if (jitContext.relevantEpisodes.length > 0) {
        jitSections.push('## Relevant Episodes\n' + jitContext.relevantEpisodes.map(e => `- ${e.content}`).join('\n'));
      }
      if (jitContext.relevantProcedures.length > 0) {
        jitSections.push('## Relevant Procedures\n' + jitContext.relevantProcedures.map(p => `- ${p.content}`).join('\n'));
      }
      if (jitSections.length > 0) {
        history.push({
          role: 'user',
          content: `# Task-Relevant Context (JIT Retrieved)\n\n${jitSections.join('\n\n')}`,
          timestamp: Date.now(),
        });
      }
    }

    // ─── Value gate (optional pre-loop check) ───────────────────
    let reasoningEngine: import('./reasoningEngine.js').ReasoningEngine | null = null;
    let valueAssessment: import('./reasoningEngine.js').ValueScore | null = null;

    if (safeDeps.reasoningEngineFactory) {
      try {
        reasoningEngine = await safeDeps.reasoningEngineFactory(config.role);
      } catch (err) {
        console.warn(`[${this.archetype}Runner] Reasoning engine init failed for ${config.role}:`, (err as Error).message);
      }
    }

    if (reasoningEngine && (reasoningEngine as any).config?.valueGateEnabled) {
      try {
        const contextSummary = jitContext
          ? `JIT context: ${jitContext.tokenEstimate} tokens from ${jitContext.relevantMemories.length + jitContext.relevantKnowledge.length} sources`
          : 'No JIT context';
        valueAssessment = await reasoningEngine.evaluateValue(config.role, initialMessage, contextSummary);

        if (valueAssessment.recommendation === 'abort') {
          console.log(`[${this.archetype}Runner] Value gate aborted run for ${config.role}: ${valueAssessment.reasoning}`);
          return this.buildResult(config, 'aborted', `Value gate: ${valueAssessment.reasoning}`, history, supervisor, 'value_gate_abort', totalInputTokens, totalOutputTokens);
        }
      } catch (err) {
        console.warn(`[${this.archetype}Runner] Value gate failed for ${config.role}:`, (err as Error).message);
      }
    }

    // ─── Build system prompt via subclass ────────────────────────
    const systemPrompt = this.buildRunPrompt(config, agentProfile, sharedMemory, safeDeps);

    try {
      let turnNumber = 0;

      while (true) {
        turnNumber++;
        emitEvent({ type: 'turn_started', agentId: config.id, turnNumber });

        // ── Supervisor check ────────────────────────────────────
        const check = supervisor.checkBeforeModelCall();
        if (!check.ok) {
          return this.buildResult(config, 'aborted', lastTextOutput, history, supervisor, check.reason, totalInputTokens, totalOutputTokens);
        }

        // ── Context injector ────────────────────────────────────
        if (config.contextInjector && turnNumber > 1) {
          try {
            const injected = await config.contextInjector(turnNumber, history);
            if (injected) {
              history.push({ role: 'user', content: injected, timestamp: Date.now() });
            }
          } catch { /* non-critical */ }
        }

        // ── Model call ──────────────────────────────────────────
        let response: Awaited<ReturnType<ModelClient['generate']>>;
        try {
          emitEvent({ type: 'model_request', agentId: config.id, turnNumber, tokenEstimate: estimateTokens(history) });

          // Strip tools on last turn to force text response
          let effectiveTools: ReturnType<typeof toolExecutor.getDeclarations> | undefined = toolExecutor.getDeclarations();
          if (turnNumber >= supervisor.config.maxTurns) effectiveTools = undefined;

          let effectiveTemp = config.temperature;
          if (config.model.startsWith('gemini-3') && (effectiveTemp === undefined || effectiveTemp < 1.0)) {
            effectiveTemp = 1.0;
          }

          response = await this.modelClient.generate({
            model: config.model,
            systemInstruction: systemPrompt,
            contents: history,
            tools: effectiveTools,
            temperature: effectiveTemp,
            topP: config.topP,
            topK: config.topK,
            thinkingEnabled: config.thinkingEnabled,
            signal: supervisor.signal,
            callTimeoutMs: 60_000,
          });

          totalInputTokens += response.usageMetadata.inputTokens;
          totalOutputTokens += response.usageMetadata.outputTokens;
          emitEvent({ type: 'model_response', agentId: config.id, turnNumber, hasToolCalls: response.toolCalls.length > 0, thinkingText: response.thinkingText });
        } catch (error) {
          if (supervisor.isAborted) {
            return this.buildResult(config, 'aborted', lastTextOutput, history, supervisor, (error as Error).message, totalInputTokens, totalOutputTokens);
          }
          throw error;
        }

        // ── Tool calls ──────────────────────────────────────────
        if (response.toolCalls.length > 0) {
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
            emitEvent({ type: 'tool_call', agentId: config.id, turnNumber, toolName: call.name, params: call.args });
          }

          for (const call of response.toolCalls) {
            const result = await toolExecutor.execute(call.name, call.args, {
              agentId: config.id,
              agentRole: config.role,
              turnNumber,
              abortSignal: supervisor.signal,
              memoryBus,
              emitEvent,
            });

            const resultContent = result.data !== undefined ? JSON.stringify(result.data) : result.error ?? 'ok';
            history.push({ role: 'tool_result', content: resultContent, toolName: call.name, toolResult: result, timestamp: Date.now() });
            emitEvent({ type: 'tool_result', agentId: config.id, turnNumber, toolName: call.name, success: result.success, filesWritten: result.filesWritten ?? 0, memoryKeysWritten: result.memoryKeysWritten ?? 0 });

            const progressCheck = supervisor.recordToolResult(call.name, result);
            if (!progressCheck.ok) {
              return this.buildResult(config, 'aborted', lastTextOutput, history, supervisor, progressCheck.reason, totalInputTokens, totalOutputTokens);
            }
          }
          continue;
        }

        // ── Text response — agent done ──────────────────────────
        if (response.text) {
          lastTextOutput = response.text;
          history.push({ role: 'assistant', content: response.text, timestamp: Date.now() });
        }

        if (response.finishReason === 'stop' || response.toolCalls.length === 0) {
          if (!lastTextOutput && !history.some(h => h.content === 'Please provide your final text response summarizing what you found and any actions taken.')) {
            history.push({ role: 'user', content: 'Please provide your final text response summarizing what you found and any actions taken.', timestamp: Date.now() });
            continue;
          }
          break;
        }
      }

      // Fallback
      if (!lastTextOutput) {
        const toolResults = history.filter(t => t.role === 'tool_result').map(t => t.content).slice(-3);
        lastTextOutput = toolResults.length > 0 ? `Completed. Tool results:\n${toolResults.join('\n')}` : 'Run completed but produced no text output.';
      }

      // ─── Verification pipeline (reasoning engine) ─────────────
      let reasoningResult: import('./reasoningEngine.js').ReasoningResult | null = null;
      if (reasoningEngine && lastTextOutput) {
        try {
          const contextForVerification = jitContext
            ? jitContext.relevantKnowledge.map(k => k.content).join('\n').slice(0, 2000)
            : '';
          reasoningResult = await reasoningEngine.verify(
            config.role,
            initialMessage,
            lastTextOutput,
            contextForVerification,
          );

          if (reasoningResult.revised && reasoningResult.revisedOutput) {
            lastTextOutput = reasoningResult.revisedOutput;
          }

          console.log(
            `[${this.archetype}Runner] Reasoning for ${config.role}: ` +
            `${reasoningResult.passes.length} passes, ` +
            `confidence=${reasoningResult.overallConfidence.toFixed(2)}, ` +
            `revised=${reasoningResult.revised}, ` +
            `cost=$${reasoningResult.totalCostUsd.toFixed(4)}`,
          );
        } catch (err) {
          console.warn(`[${this.archetype}Runner] Verification failed for ${config.id}:`, (err as Error).message);
        }
      }

      // ─── Post-run hook (archetype-specific) ───────────────────
      try {
        await this.postRun(config, lastTextOutput, history, safeDeps);
      } catch (err) {
        console.warn(`[${this.archetype}Runner] postRun failed for ${config.id}:`, (err as Error).message);
      }

      // ─── Emit completion ──────────────────────────────────────
      if (safeDeps.glyphorEventBus) {
        try {
          await safeDeps.glyphorEventBus.emit({
            type: 'agent.completed',
            source: config.role,
            payload: {
              runId: config.id,
              archetype: this.archetype,
              totalTurns: supervisor.stats.turnCount,
              elapsedMs: supervisor.stats.elapsedMs,
              summary: lastTextOutput.slice(0, 500),
              ...(reasoningResult ? {
                reasoning_passes: reasoningResult.passes.length,
                reasoning_confidence: reasoningResult.overallConfidence,
                reasoning_revised: reasoningResult.revised,
                reasoning_cost_usd: reasoningResult.totalCostUsd,
              } : {}),
            },
            priority: 'normal',
          });
        } catch { /* non-critical */ }
      }

      emitEvent({
        type: 'agent_completed',
        agentId: config.id,
        totalTurns: supervisor.stats.turnCount,
        totalFiles: supervisor.stats.filesWritten,
        totalMemoryKeys: supervisor.stats.memoryKeysWritten,
        elapsedMs: supervisor.stats.elapsedMs,
      });

      const result = this.buildResult(config, 'completed', lastTextOutput, history, supervisor, undefined, totalInputTokens, totalOutputTokens);
      if (reasoningResult) {
        (result as any).reasoningMeta = {
          passes: reasoningResult.passes.length,
          confidence: reasoningResult.overallConfidence,
          revised: reasoningResult.revised,
          costUsd: reasoningResult.totalCostUsd,
        };
      }
      if (valueAssessment) {
        (result as any).valueAssessment = {
          score: valueAssessment.score,
          recommendation: valueAssessment.recommendation,
          costUsd: valueAssessment.costUsd,
        };
      }
      return result;
    } catch (error) {
      emitEvent({ type: 'agent_error', agentId: config.id, error: (error as Error).message, turnNumber: supervisor.stats.turnCount });
      return this.buildResult(config, supervisor.isAborted ? 'aborted' : 'error', lastTextOutput, history, supervisor, (error as Error).message, totalInputTokens, totalOutputTokens);
    }
  }

  protected buildResult(
    config: AgentConfig,
    status: AgentExecutionResult['status'],
    output: string | null,
    history: ConversationTurn[],
    supervisor: AgentSupervisor,
    errorMsg?: string,
    inputTokens = 0,
    outputTokens = 0,
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
      inputTokens,
      outputTokens,
      cost: estimateCost(config.model, inputTokens, outputTokens),
      abortReason: status === 'aborted' ? errorMsg : undefined,
      error: status === 'error' ? errorMsg : undefined,
      reasoning: output ? extractReasoning(output) : undefined,
      conversationHistory: history,
    };
  }
}
