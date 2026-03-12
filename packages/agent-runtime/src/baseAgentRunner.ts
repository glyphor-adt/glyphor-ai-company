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
import { estimateModelCost } from '@glyphor/shared/models';

const DB_RUN_ID_TURN_PREFIX = '__db_run_id__:';
import type { RedisCache } from './redisCache.js';
import type { ContextDistiller } from './contextDistiller.js';
import type { RuntimeToolFactory } from './runtimeToolFactory.js';
import type { ConstitutionalGovernor } from './constitutionalGovernor.js';
import type { TrustScorer } from './trustScorer.js';
import type { DecisionChainTracker } from './decisionChainTracker.js';
import { harvestTaskOutcome } from './taskOutcomeHarvester.js';
import type { ActionReceipt } from './types.js';
import { extractTaskFromConfigId } from './taskIdentity.js';
import { compressHistory, DEFAULT_HISTORY_COMPRESSION } from './historyManager.js';
import { filterToolDeclarations, getToolSubset } from './toolSubsets.js';
import { runDeterministicPreCheck } from './routing/index.js';
import type { RoutingDecision } from './routing/index.js';
import { determineVerificationTier } from './verificationPolicy.js';
import { compareSubtaskComplexity, routeSubtask, type SubtaskComplexity } from './subtaskRouter.js';

// ─── Cost estimation (uses centralized model registry) ───────────────

function estimateCost(model: string, inputTokens: number, outputTokens: number, thinkingTokens = 0, cachedInputTokens = 0): number {
  return estimateModelCost(model, inputTokens, outputTokens, thinkingTokens, cachedInputTokens);
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
  /** Context distiller — compresses raw JIT results into a focused briefing. */
  contextDistiller?: ContextDistiller;
  /** Runtime tool factory — lets agents define new tools mid-run. */
  runtimeToolFactory?: RuntimeToolFactory;
  /** Constitutional governor — evaluates outputs against agent principles. */
  constitutionalGovernor?: ConstitutionalGovernor;
  /** Trust scorer — tracks agent trust and adjusts effective authority. */
  trustScorer?: TrustScorer;
  /** Decision chain tracker factory — creates per-run chain trackers. */
  chainTrackerFactory?: () => DecisionChainTracker;
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

    // ─── Wire constitutional pre-check deps into tool executor ──
    if (safeDeps.constitutionalGovernor) {
      toolExecutor.setConstitutionalDeps({
        constitutionalGovernor: safeDeps.constitutionalGovernor,
        modelClient: this.modelClient,
        redisCache: safeDeps.cache,
      });
    }
    // ─── Pre-process attachments ────────────────────────────────
    let initialAttachments: ConversationAttachment[] | undefined;
    const cleanHistory = (config.conversationHistory ?? []).filter((t) => {
      if (t.content.startsWith(DB_RUN_ID_TURN_PREFIX)) {
        return false;
      }
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
    let totalThinkingTokens = 0;
    let totalCachedInputTokens = 0;
    const actionReceipts: ActionReceipt[] = [];

    // ─── Load shared memory + JIT context in parallel ───────────
    const taskForContext = extractTaskFromConfigId(config.id);
    const initialToolNames = toolExecutor.getToolNames();
    let trustScore: number | null = null;
    if (safeDeps.trustScorer) {
      try {
        trustScore = (await safeDeps.trustScorer.getTrust(config.role)).trustScore;
      } catch (err) {
        console.warn(`[${this.archetype}Runner] Trust load failed for ${config.role}:`, (err as Error).message);
      }
    }
    let routingAudit = routeSubtask({
      role: config.role,
      task: taskForContext,
      history,
      toolNames: initialToolNames,
      trustScore,
      currentModel: config.model,
    });
    let routedModel = routingAudit.routing;
    let highestSubtaskComplexity: SubtaskComplexity = routingAudit.classification.complexity;
    const buildRoutingSummary = () => ({
      routingRule: routedModel.routingRule,
      capabilities: routedModel.capabilities,
      model: routedModel.model,
      modelRoutingReason: routingAudit.reason,
      subtaskComplexity: highestSubtaskComplexity,
    });

    emitEvent({
      type: 'agent_started',
      agentId: config.id,
      role: config.role,
      model: routedModel.model === '__deterministic__' ? config.model : routedModel.model,
    });

    if (routedModel.model === '__deterministic__') {
      const preCheck = await runDeterministicPreCheck({
        role: config.role,
        task: taskForContext,
        message: initialMessage,
        history,
      });
      if (!preCheck.shouldCallLLM) {
          return this.buildResult(
            config,
            'skipped_precheck',
            preCheck.reason,
          history,
          supervisor,
          preCheck.reason,
          totalInputTokens,
          totalOutputTokens,
          totalThinkingTokens,
          totalCachedInputTokens,
            buildRoutingSummary(),
          );
      }
      if (preCheck.context) {
        history.push({ role: 'user', content: preCheck.context, timestamp: Date.now() });
      }
      routedModel.model = 'gpt-5-mini-2025-08-07';
      routedModel.reasoningEffort = 'low';
    }

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
          return this.buildResult(config, 'aborted', `Value gate: ${valueAssessment.reasoning}`, history, supervisor, 'value_gate_abort', totalInputTokens, totalOutputTokens, totalThinkingTokens, totalCachedInputTokens, buildRoutingSummary());
        }
      } catch (err) {
        console.warn(`[${this.archetype}Runner] Value gate failed for ${config.role}:`, (err as Error).message);
      }
    }

    // ─── Pre-load constitution for prompt injection ───────────
    if (safeDeps.constitutionalGovernor) {
      try {
        await safeDeps.constitutionalGovernor.getConstitution(config.role);
      } catch {
        // Non-critical — prompt just won't include principles
      }
    }

    // ─── Build system prompt via subclass ────────────────────────
    const systemPrompt = this.buildRunPrompt(config, agentProfile, sharedMemory, safeDeps);

    try {
      let turnNumber = 0;
      let previousResponseId: string | undefined;

      while (true) {
        turnNumber++;
        emitEvent({ type: 'turn_started', agentId: config.id, turnNumber });

        // ── Supervisor check ────────────────────────────────────
        const check = supervisor.checkBeforeModelCall();
        if (!check.ok) {
          return this.buildResult(config, 'aborted', lastTextOutput, history, supervisor, check.reason, totalInputTokens, totalOutputTokens, totalThinkingTokens, totalCachedInputTokens, buildRoutingSummary());
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
          const compressedHistory = compressHistory(history, DEFAULT_HISTORY_COMPRESSION);
          emitEvent({ type: 'model_request', agentId: config.id, turnNumber, tokenEstimate: estimateTokens(compressedHistory) });

          // Strip tools on last turn to force text response
          let effectiveTools: ReturnType<typeof toolExecutor.getDeclarations> | undefined = toolExecutor.getDeclarations();
          const allowedToolNames = getToolSubset(config.role, taskForContext);
          if (effectiveTools) {
            effectiveTools = filterToolDeclarations(effectiveTools, allowedToolNames);
          }
          if (turnNumber >= supervisor.config.maxTurns) effectiveTools = undefined;

          routingAudit = routeSubtask({
            role: config.role,
            task: taskForContext,
            history: compressedHistory,
            toolNames: effectiveTools?.map((tool) => tool.name) ?? [],
            trustScore,
            currentModel: routedModel.model === '__deterministic__' ? config.model : routedModel.model,
            lastTextOutput,
            actionReceipts,
          });
          routedModel = routingAudit.routing;
          if (compareSubtaskComplexity(routingAudit.classification.complexity, highestSubtaskComplexity) > 0) {
            highestSubtaskComplexity = routingAudit.classification.complexity;
          }

          let effectiveTemp = config.temperature;
          if (routedModel.model.startsWith('gemini-3') && (effectiveTemp === undefined || effectiveTemp < 1.0)) {
            effectiveTemp = 1.0;
          }

          const reasoningLevel = routedModel.reasoningEffort === 'high'
            ? 'deep'
            : routedModel.reasoningEffort === 'minimal'
              ? 'none'
              : 'standard';
          const effectiveThinkingEnabled = routedModel.reasoningEffort === 'minimal'
            ? false
            : config.thinkingEnabled;

          response = await this.modelClient.generate({
            model: routedModel.model,
            systemInstruction: systemPrompt,
            contents: compressedHistory,
            tools: effectiveTools,
            temperature: effectiveTemp,
            topP: config.topP,
            topK: config.topK,
            thinkingEnabled: effectiveThinkingEnabled,
            reasoningLevel,
            signal: supervisor.signal,
            callTimeoutMs: 300_000,
            metadata: {
              previousResponseId,
              modelConfig: routedModel,
            },
          });
          previousResponseId = response.responseId;

          totalInputTokens += response.usageMetadata.inputTokens;
          totalOutputTokens += response.usageMetadata.outputTokens;
          totalThinkingTokens += response.usageMetadata.thinkingTokens ?? 0;
          totalCachedInputTokens += response.usageMetadata.cachedInputTokens ?? 0;
          emitEvent({ type: 'model_response', agentId: config.id, turnNumber, hasToolCalls: response.toolCalls.length > 0, thinkingText: response.thinkingText });
        } catch (error) {
          if (supervisor.isAborted) {
            return this.buildResult(config, 'aborted', lastTextOutput, history, supervisor, (error as Error).message, totalInputTokens, totalOutputTokens, totalThinkingTokens, totalCachedInputTokens, buildRoutingSummary());
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
              glyphorEventBus: safeDeps.glyphorEventBus,
            });

            const resultContent = result.data !== undefined ? JSON.stringify(result.data) : result.error ?? 'ok';
            history.push({ role: 'tool_result', content: resultContent, toolName: call.name, toolResult: result, timestamp: Date.now() });
            emitEvent({ type: 'tool_result', agentId: config.id, turnNumber, toolName: call.name, success: result.success, filesWritten: result.filesWritten ?? 0, memoryKeysWritten: result.memoryKeysWritten ?? 0 });

            actionReceipts.push({
              tool: call.name,
              params: call.args,
              result: result.success ? 'success' : 'error',
              output: (resultContent ?? '').slice(0, 500),
              timestamp: new Date().toISOString(),
              constitutional_check: result.constitutional_check,
            });

            // Apply trust penalty for constitutional gate blocks
            if (result.constitutional_check?.blocked && safeDeps.trustScorer) {
              void safeDeps.trustScorer.applyConstitutionalBlockDelta(config.role, call.name);
            }

            const progressCheck = supervisor.recordToolResult(call.name, result);
            if (!progressCheck.ok) {
               return this.buildResult(config, 'aborted', lastTextOutput, history, supervisor, progressCheck.reason, totalInputTokens, totalOutputTokens, totalThinkingTokens, totalCachedInputTokens, buildRoutingSummary());
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
      const verificationDecision = determineVerificationTier({
        agentRole: config.role,
        configId: config.id,
        task: taskForContext,
        trustScore,
        turnsUsed: supervisor.stats.turnCount,
        mutationToolsCalled: actionReceipts.filter((receipt) => receipt.result === 'success').map((receipt) => receipt.tool),
        output: lastTextOutput,
      });
      let verificationMeta: import('./types.js').AgentExecutionResult['verificationMeta'] = {
        tier: verificationDecision.tier,
        reason: verificationDecision.reason,
        passes: [],
      };

      if (reasoningEngine && verificationDecision.tier !== 'none') {
        try {
          const contextForVerification = jitContext
            ? jitContext.relevantKnowledge.map(k => k.content).join('\n').slice(0, 2000)
            : '';

          reasoningResult = await reasoningEngine.verifyWithOverride(
            {
              passTypes: verificationDecision.passes,
              crossModelEnabled: verificationDecision.passes.includes('cross_model'),
            },
            config.role,
            initialMessage,
            lastTextOutput,
            contextForVerification,
          );

          if (
            verificationDecision.tier === 'conditional' &&
            verificationDecision.conditionalEscalationThreshold !== undefined &&
            reasoningResult.overallConfidence < verificationDecision.conditionalEscalationThreshold
          ) {
            const escalationInput = reasoningResult.revisedOutput ?? lastTextOutput;
            reasoningResult = await reasoningEngine.verifyWithOverride(
              {
                passTypes: ['self_critique', 'cross_model'],
                crossModelEnabled: true,
              },
              config.role,
              initialMessage,
              escalationInput,
              contextForVerification,
            );
            verificationMeta.reason = `${verificationDecision.reason} (escalated after low confidence)`;
          }

          if (reasoningResult.revised && reasoningResult.revisedOutput) {
            lastTextOutput = reasoningResult.revisedOutput;
          }

          verificationMeta.passes = Array.from(new Set(reasoningResult.passes.map((pass) => pass.passType)));

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
      } else if (!reasoningEngine && verificationDecision.tier !== 'none') {
        console.warn(`[${this.archetype}Runner] Verification unavailable for ${config.id}: reasoning engine not configured`);
      }

      // ─── Constitutional evaluation ────────────────────────────
      let constitutionalPassed = true;
      if (safeDeps.constitutionalGovernor && lastTextOutput) {
        try {
          const constitution = await safeDeps.constitutionalGovernor.getConstitution(config.role);
          if (constitution) {
            const constResult = await safeDeps.constitutionalGovernor.evaluate(
              config.role,
              initialMessage,
              lastTextOutput,
              constitution,
            );
            constitutionalPassed = !constResult.revisionRequired;

            if (constResult.revisionRequired) {
              console.warn(
                `[${this.archetype}Runner] Constitutional eval FAILED for ${config.role}: ` +
                `${constResult.violations.length} violation(s) — ${constResult.violations.join(', ')}`,
              );
            }

            // Record evaluation (fire-and-forget)
            void safeDeps.constitutionalGovernor.recordEvaluation(
              config.id,
              config.role,
              constitution.version,
              constResult,
              reasoningResult?.overallConfidence,
            );

            // Apply trust delta based on constitutional compliance
            if (safeDeps.trustScorer) {
              const delta = constResult.overallAdherence < 0.6 ? -0.08 : (!constResult.revisionRequired ? 0.01 : -0.03);
              void safeDeps.trustScorer.applyDelta(config.role, { delta, source: 'constitutional_eval', reason: 'Constitutional compliance result' });
            }
          }
        } catch (err) {
          console.warn(`[${this.archetype}Runner] Constitutional eval failed for ${config.id}:`, (err as Error).message);
        }
      }

      // ─── Trust scoring for reasoning quality ─────────────────
      if (safeDeps.trustScorer && reasoningResult) {
        const confidenceDelta = (reasoningResult.overallConfidence - 0.7) * 0.02;
        void safeDeps.trustScorer.applyDelta(config.role, { delta: confidenceDelta, source: 'reasoning_verification', reason: 'Reasoning confidence delta' });
      }

      // ─── Post-run hook (archetype-specific) ───────────────────
      try {
        await this.postRun(config, lastTextOutput, history, safeDeps);
      } catch (err) {
        console.warn(`[${this.archetype}Runner] postRun failed for ${config.id}:`, (err as Error).message);
      }

      // ─── Self-assessment world model update ───────────────────
      // After every completed run, auto-update the agent's world model
      // with a basic self-score derived from run outcome. This ensures
      // world models populate continuously, not just when CoS grades.
      // For task-tier agents, batch outcomes are the primary quality signal,
      // so self-assessment is down-weighted to 0.3x (vs 1.0x for orchestrators).
      if (safeDeps.worldModelUpdater && safeDeps.sharedMemoryLoader) {
        try {
          const taskType = config.id.replace(/-\d{4}-\d{2}-\d{2}$/, '').split('-').pop() ?? 'general';
          const turnsUsed = supervisor.stats.turnCount;
          const hadErrors = supervisor.isAborted;
          // Self-score: 4.0 baseline for completed runs, penalize for errors/excessive turns
          let selfScore = hadErrors ? 2.0 : 4.0;
          if (turnsUsed > 10) selfScore -= 0.5; // penalty for many turns
          if (turnsUsed <= 3 && !hadErrors) selfScore += 0.5; // bonus for efficiency
          selfScore = Math.max(1, Math.min(5, selfScore));

          // Task-tier agents: reduce self-assessment influence (batch outcomes are primary)
          const selfAssessmentWeight = this.archetype === 'task' ? 0.3 : 1.0;
          const baseline = 3.0;
          const weightedScore = baseline + (selfScore - baseline) * selfAssessmentWeight;

          await safeDeps.worldModelUpdater.updateFromGrade({
            agentRole: config.role,
            taskType,
            overallScore: weightedScore,
            dimensionScores: { task_completion: weightedScore, efficiency: turnsUsed <= 5 ? 4.5 : 3.0 },
            evaluatorFeedback: `Self-assessed: ${turnsUsed} turns, status=${hadErrors ? 'aborted' : 'completed'} (weight=${selfAssessmentWeight})`,
          });
        } catch (err) {
          console.warn(`[${this.archetype}Runner] Self-assessment world model update failed for ${config.id}:`, (err as Error).message);
        }
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
              summary: (lastTextOutput ?? '').slice(0, 500),
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

      const result = this.buildResult(config, 'completed', lastTextOutput, history, supervisor, undefined, totalInputTokens, totalOutputTokens, totalThinkingTokens, totalCachedInputTokens, buildRoutingSummary());
      result.actions = actionReceipts;
      if (reasoningResult) {
        result.reasoningMeta = {
          passes: reasoningResult.passes.length,
          confidence: reasoningResult.overallConfidence,
          revised: reasoningResult.revised,
          costUsd: reasoningResult.totalCostUsd,
        };
      }
      result.verificationMeta = verificationMeta;
      if (valueAssessment) {
        (result as any).valueAssessment = {
          score: valueAssessment.score,
          recommendation: valueAssessment.recommendation,
          costUsd: valueAssessment.costUsd,
        };
      }

      // Fire-and-forget: harvest task outcome for Learning Governor
      void harvestTaskOutcome(result, {
        runId: config.id,
        agentRole: config.role,
      }).catch(() => {});

      return result;
    } catch (error) {
      emitEvent({ type: 'agent_error', agentId: config.id, error: (error as Error).message, turnNumber: supervisor.stats.turnCount });
      const errResult = this.buildResult(config, supervisor.isAborted ? 'aborted' : 'error', lastTextOutput, history, supervisor, (error as Error).message, totalInputTokens, totalOutputTokens, totalThinkingTokens, totalCachedInputTokens, buildRoutingSummary());
      errResult.actions = actionReceipts;
      void harvestTaskOutcome(errResult, {
        runId: config.id,
        agentRole: config.role,
      }).catch(() => {});
      return errResult;
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
    thinkingTokens = 0,
    cachedInputTokens = 0,
    routing?: Pick<RoutingDecision, 'routingRule' | 'capabilities' | 'model'> & Pick<AgentExecutionResult, 'modelRoutingReason' | 'subtaskComplexity'>,
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
      thinkingTokens,
      cachedInputTokens,
      cost: estimateCost(routing?.model ?? config.model, inputTokens, outputTokens, thinkingTokens, cachedInputTokens),
      abortReason: status === 'aborted' ? errorMsg : undefined,
      error: status === 'error' || status === 'skipped_precheck' ? errorMsg : undefined,
      reasoning: output ? extractReasoning(output) : undefined,
      conversationHistory: history,
      routingRule: routing?.routingRule,
      routingCapabilities: routing?.capabilities,
      routingModel: routing?.model,
      modelRoutingReason: routing?.modelRoutingReason,
      subtaskComplexity: routing?.subtaskComplexity,
    };
  }
}
