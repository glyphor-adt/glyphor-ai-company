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
  ToolRetrievalMetadataMap,
} from './types.js';
import type { RunDependencies, AgentProfileData, SkillContext } from './companyAgentRunner.js';
import type { ReasoningEngine } from './reasoningEngine.js';
import type { JitContextRetriever, JitContext } from './jitContextRetriever.js';
import { estimateModelCost } from '@glyphor/shared/models';
import { systemQuery } from '@glyphor/shared/db';

const DB_RUN_ID_TURN_PREFIX = '__db_run_id__:';
const ASSIGNMENT_ID_TURN_PREFIX = '__assignment_id__:';
const DIRECTIVE_ID_TURN_PREFIX = '__directive_id__:';
import type { RedisCache } from './redisCache.js';
import type { ContextDistiller } from './contextDistiller.js';
import type { RuntimeToolFactory } from './runtimeToolFactory.js';
import type { ConstitutionalGovernor } from './constitutionalGovernor.js';
import type { TrustScorer } from './trustScorer.js';
import type { DecisionChainTracker } from './decisionChainTracker.js';
import { harvestTaskOutcome } from './taskOutcomeHarvester.js';
import type { ActionReceipt } from './types.js';
import { extractTaskFromConfigId } from './taskIdentity.js';
import {
  fetchUndecomposedDelegatedDirectives,
  filterBaselineStillUnresolved,
} from './orchestrationDecompositionGuard.js';
import { composeModelContext } from './context/contextComposer.js';
import { microCompactHistory } from './context/microCompactor.js';
import { calculateContextBudget, type ContextBudget } from './context/contextBudget.js';
import {
  isContextOverflowError,
  reactiveRecompose,
  createReactiveState,
  resetReactiveState,
  type ReactiveCompactionState,
} from './context/reactiveCompaction.js';
import {
  injectPostCompactContext,
  extractRecentToolSummaries,
} from './context/postCompactInjector.js';
import { startTraceSpan } from './telemetry/tracing.js';
import { extractAcceptanceCriteriaFromMessage, parseExecutionPlan } from './executionPlanning.js';
import { resolvePlanningPolicy, type PlanningModelTier } from './planningPolicy.js';
import { runDeterministicPreCheck } from './routing/index.js';
import { buildToolTaskContext, getToolRetriever, type ToolRetrieverTrace } from './routing/toolRetriever.js';
import type { RoutingDecision } from './routing/index.js';
import { determineVerificationTier } from './verificationPolicy.js';
import { compareSubtaskComplexity, routeSubtask, type SubtaskComplexity } from './subtaskRouter.js';
import { learnFromAgentRun } from './skillLearning.js';
import {
  isSummaryFirstCompactionEnabled,
  type SessionMemoryStore,
  type SessionMemoryUpdater,
} from './memory/sessionMemoryUpdater.js';
import {
  captureDecisionTrace,
  getTierModel,
  type AlternativeRejected,
  type SelfCritiqueOutput,
  type ValueAnalysisResult,
} from '@glyphor/shared';
import {
  recordRunEvent,
  recordFailureTaxonomy,
  linkClaimToEvidence,
  createContentDigest,
} from './telemetry/runLedger.js';

const CONTEXT_COMPOSITION_MAX_TOKENS = 12_000; // Legacy fallback — overridden by model-aware budget
const PLANNING_REQUEST_MARKER = '__planning_request__';
const PLANNING_REPAIR_MARKER = '__planning_repair__';
const EXECUTION_GATE_NUDGE_MARKER = '__completion_gate_nudge__';
const EXECUTION_GATE_AUTO_REPAIR_MARKER = '__completion_gate_auto_repair__';

// ─── Cost estimation (uses centralized model registry) ───────────────

function estimateCost(model: string, inputTokens: number, outputTokens: number, thinkingTokens = 0, cachedInputTokens = 0): number {
  return estimateModelCost(model, inputTokens, outputTokens, thinkingTokens, cachedInputTokens);
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
  /** Optional session summary persistence for cross-turn memory compaction. */
  sessionMemoryStore?: SessionMemoryStore;
  /** Optional post-turn session summary updater. */
  sessionMemoryUpdater?: SessionMemoryUpdater;
}

/** Future-tense planning patterns — agent describes intent but hasn't executed. */
const PLANNING_INTENT_PATTERNS = [
  /I(?:'m| am) (?:starting|beginning|preparing|creating|drafting|building|working)/i,
  /I(?:'ll| will) (?:create|prepare|draft|build|generate|send|upload|start|set up|write)/i,
  /I will (?:now |begin |start )?(?:create|prepare|draft|build|generate|send|upload)/i,
  /Let me (?:start|begin|prepare|create|draft|build|set up|work on)/i,
  /I'm going to (?:create|prepare|draft|build|generate|send|upload|start|set up)/i,
];

function containsPlanningIntent(text: string): boolean {
  return PLANNING_INTENT_PATTERNS.some(p => p.test(text));
}

function summarizeDecisionText(output: string | null): string | null {
  if (!output) return null;
  const normalized = output.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) return null;
  const sentence = normalized.split(/(?<=[.!?])\s+/)[0] ?? normalized;
  return sentence.slice(0, 600);
}

function inferBundleKind(turnNumber: number): 'planning' | 'execution' | 'verification' {
  if (turnNumber === 1) return 'planning';
  if (turnNumber >= 2) return 'execution';
  return 'verification';
}

function extractPotentialClaims(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => /\b\d+(\.\d+)?%?\b/.test(line) || /\b(according to|based on|source|evidence)\b/i.test(line))
    .slice(0, 12);
}

function findUnsupportedClaims(
  output: string,
  actionReceipts: ActionReceipt[],
): string[] {
  const availableEvidence = new Set(
    actionReceipts.flatMap((receipt) => receipt.evidenceIds ?? []),
  );
  const claims = extractPotentialClaims(output);
  if (claims.length === 0) return [];
  if (availableEvidence.size === 0) return claims;
  return claims.filter((claim) => !/\bevidence[:#]/i.test(claim));
}

function buildValueAnalysisTrace(valueAssessment: import('./reasoningEngine.js').ValueScore | null): ValueAnalysisResult | null {
  if (!valueAssessment) return null;
  const costScore = Math.max(0, 1 - Math.min(1, valueAssessment.costUsd / 0.1));
  return {
    function_score: valueAssessment.score,
    cost_score: costScore,
    value_ratio: valueAssessment.costUsd > 0 ? valueAssessment.score / valueAssessment.costUsd : valueAssessment.score,
    alternatives_considered: (valueAssessment.alternatives ?? []).map((alternative) => ({
      approach: alternative.approach,
      estimated_savings: alternative.estimatedSavings,
    })),
  };
}

function buildAlternativesRejected(valueAssessment: import('./reasoningEngine.js').ValueScore | null): AlternativeRejected[] {
  return (valueAssessment?.alternatives ?? []).map((alternative) => ({
    description: alternative.approach,
    rejection_reason: `Rejected during value analysis in favor of the selected execution path; estimated savings noted as ${alternative.estimatedSavings}.`,
  }));
}

function buildSelfCritiqueTrace(reasoningResult: import('./reasoningEngine.js').ReasoningResult | null): SelfCritiqueOutput | null {
  if (!reasoningResult) return null;
  return {
    issues_found: Array.from(new Set(reasoningResult.passes.flatMap((pass) => pass.issues))),
    revisions_made: reasoningResult.revised
      ? Array.from(new Set(reasoningResult.passes.flatMap((pass) => pass.suggestions)))
      : [],
    final_confidence: reasoningResult.overallConfidence,
  };
}

async function persistDecisionAuditLog(entry: {
  agentRole: string;
  taskId: string;
  action: string;
  summary: string;
  description?: string | null;
  details?: Record<string, unknown>;
}): Promise<string | null> {
  try {
    const rows = await systemQuery<{ id: string }>(
      `INSERT INTO activity_log (
         agent_role,
         agent_id,
         action,
         activity_type,
         summary,
         description,
         details,
         created_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
       RETURNING id`,
      [
        entry.agentRole,
        entry.agentRole,
        entry.action,
        'decision_trace',
        entry.summary,
        entry.description ?? null,
        JSON.stringify({ ...(entry.details ?? {}), task_id: entry.taskId }),
        new Date().toISOString(),
      ],
    );
    return rows[0]?.id ?? null;
  } catch (err) {
    console.warn(`[${entry.agentRole}] Failed to persist decision audit log:`, (err as Error).message);
    return null;
  }
}

async function persistRunMetricsAuditLog(entry: {
  agentRole: string;
  taskId: string;
  runId: string;
  model: string;
  summary: string;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  cachedInputTokens: number;
}): Promise<void> {
  try {
    await systemQuery(
      `INSERT INTO activity_log (
         agent_role,
         agent_id,
         action,
         activity_type,
         summary,
         details,
         input_tokens,
         output_tokens,
         thinking_tokens,
         cached_input_tokens,
         estimated_cost_usd,
         created_at
       )
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12)`,
      [
        entry.agentRole,
        entry.agentRole,
        'agent.run.completed',
        'run_metrics',
        entry.summary,
        JSON.stringify({ task_id: entry.taskId, run_id: entry.runId, model: entry.model }),
        entry.inputTokens,
        entry.outputTokens,
        entry.thinkingTokens,
        entry.cachedInputTokens,
        estimateCost(entry.model, entry.inputTokens, entry.outputTokens, entry.thinkingTokens, entry.cachedInputTokens),
        new Date().toISOString(),
      ],
    );
  } catch (err) {
    console.warn(`[${entry.agentRole}] Failed to persist run metrics audit log:`, (err as Error).message);
  }
}

/** Build a per-tool retrieval metadata map from the ToolRetriever trace. */
function buildRetrievalMetadataMap(trace: ToolRetrieverTrace): ToolRetrievalMetadataMap {
  const map: ToolRetrievalMetadataMap = new Map();
  const base = { toolsAvailable: trace.totalCandidates, modelCap: trace.modelCap };
  const rolePinSet = new Set(trace.rolePins ?? []);
  const deptPinSet = new Set(trace.deptPins ?? []);
  for (const name of trace.pinnedTools) {
    const method = rolePinSet.has(name) ? 'role_pin' as const
      : deptPinSet.has(name) ? 'dept_pin' as const
      : 'core_pin' as const;
    map.set(name, { method, ...base });
  }
  for (const entry of trace.retrievedTools) {
    map.set(entry.name, { method: 'semantic', score: entry.score, ...base });
  }
  return map;
}

function formatFreshnessTag(item: { metadata?: Record<string, unknown> }): string {
  const metadata = item.metadata ?? {};
  const rawCandidate = metadata.updatedAt
    ?? metadata.updated_at
    ?? metadata.createdAt
    ?? metadata.created_at
    ?? metadata.timestamp;
  const hasTemporalFlag = metadata.temporal === true;
  if (typeof rawCandidate !== 'string' || rawCandidate.trim().length === 0) {
    return hasTemporalFlag ? ' (live graph context)' : '';
  }
  const parsed = Date.parse(rawCandidate);
  if (!Number.isFinite(parsed)) return hasTemporalFlag ? ' (live graph context)' : '';
  const days = Math.max(0, Math.floor((Date.now() - parsed) / 86_400_000));
  if (days === 0) return ' (updated today)';
  if (days === 1) return ' (updated 1d ago)';
  return ` (updated ${days}d ago)`;
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
        config.dbRunId = config.dbRunId ?? t.content.slice(DB_RUN_ID_TURN_PREFIX.length);
        return false;
      }
      if (t.content.startsWith(ASSIGNMENT_ID_TURN_PREFIX)) {
        config.assignmentId = config.assignmentId ?? t.content.slice(ASSIGNMENT_ID_TURN_PREFIX.length);
        return false;
      }
      if (t.content.startsWith(DIRECTIVE_ID_TURN_PREFIX)) {
        config.directiveId = config.directiveId ?? t.content.slice(DIRECTIVE_ID_TURN_PREFIX.length);
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

    const taskForContext = extractTaskFromConfigId(config.id);
    let orchestrateDecompositionBaseline: { id: string; title: string }[] | null = null;
    if (taskForContext === 'orchestrate' || taskForContext === 'strategic_planning') {
      try {
        const undecomposed = await fetchUndecomposedDelegatedDirectives(config.role);
        if (undecomposed.length > 0) {
          orchestrateDecompositionBaseline = undecomposed;
          console.log(
            `[OrchestrationGuard] ${config.role} ${config.id}: undecomposed delegated directives at run start=${undecomposed.length} (${undecomposed.map((d) => d.id).join(', ')})`,
          );
        }
      } catch (err) {
        console.warn(`[OrchestrationGuard] Baseline query failed for ${config.role}:`, (err as Error).message);
      }
    }
    let lastTextOutput: string | null = null;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalThinkingTokens = 0;
    let totalCachedInputTokens = 0;
    let actualModelUsed: string | undefined;
    let actualProviderUsed: 'gemini' | 'openai' | 'anthropic' | undefined;
    let microCompactionCount = 0;
    let microCompactionOccurred = false;
    let latestMicroCompactionSummary: string | undefined;

    // ── Model-aware context budget ──────────────────────────────
    const contextBudget = calculateContextBudget(config.model);
    const compositionMaxTokens = contextBudget.compositionBudget;
    const reactiveState = createReactiveState();
    const actionReceipts: ActionReceipt[] = [];
    const planningPolicy = resolvePlanningPolicy({
      role: config.role,
      task: taskForContext,
      config,
      taskTierHint: this.archetype === 'task',
    });
    const planningMode = planningPolicy.planningMode;
    const completionGateEnabled = planningPolicy.completionGateEnabled;
    const planningMaxAttempts = planningPolicy.planningMaxAttempts;
    const completionGateMaxRetries = planningPolicy.completionGateMaxRetries;
    const completionGateAutoRepairEnabled = planningPolicy.completionGateAutoRepairEnabled;
    let runPhase: 'planning' | 'execution' = planningMode === 'off' ? 'execution' : 'planning';
    let planningAttempts = 0;
    let completionGateRetries = 0;
    let completionGateAutoRepairAttempts = 0;
    let completionGatePassed = false;
    let completionGateMissing: string[] = [];
    let executionPlanObjective: string | undefined;
    let acceptanceCriteria = extractAcceptanceCriteriaFromMessage(initialMessage);
    const traceAuditLogIds = new Set<string>();
    const traceTaskId = config.assignmentId ?? config.id;
    let reactIterationCounter = 0;
    const summaryFirstCompactionEnabled = isSummaryFirstCompactionEnabled();

    // ─── Load shared memory + JIT context in parallel ───────────
    void recordRunEvent({
      runId: config.dbRunId ?? config.id,
      eventType: 'run.started',
      trigger: 'runner.start',
      component: 'baseAgentRunner',
      payload: {
        role: config.role,
        task: taskForContext,
        assignment_id: config.assignmentId ?? null,
        directive_id: config.directiveId ?? null,
      },
    });
    const initialToolNames = toolExecutor.getToolNames();

    // Sync statically loaded tools to agent_tool_grants so that
    // list_my_tools and check_tool_access return accurate data.
    if (initialToolNames.length > 0) {
      try {
        await systemQuery(
          `UPDATE agent_tool_grants
              SET is_active = false,
                  updated_at = NOW()
            WHERE agent_role = $1
              AND granted_by = 'system'
              AND reason = 'auto-synced from static tool array'
              AND is_active = true
              AND NOT (tool_name = ANY($2::text[]))`,
          [config.role, initialToolNames],
        );
        const values = initialToolNames
          .map((_, i) => `($1, $${i + 2}, 'system', 'auto-synced from static tool array', NOW())`)
          .join(', ');

        await systemQuery(
          `INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by, reason, last_synced_at)
           VALUES ${values}
           ON CONFLICT (agent_role, tool_name) DO UPDATE
           SET granted_by = EXCLUDED.granted_by,
               reason = EXCLUDED.reason,
               is_active = true,
               expires_at = NULL,
               last_synced_at = NOW(),
               updated_at = NOW()`,
          [config.role, ...initialToolNames],
        );
      } catch {
        // Best-effort — DB may not be available in test/dev
      }
    } else {
      try {
        await systemQuery(
          `UPDATE agent_tool_grants
              SET is_active = false,
                  updated_at = NOW()
            WHERE agent_role = $1
              AND granted_by = 'system'
              AND reason = 'auto-synced from static tool array'
              AND is_active = true`,
          [config.role],
        );
      } catch {
        // Best-effort — DB may not be available in test/dev
      }
    }

    try {
      await getToolRetriever().warm(toolExecutor.getDeclarations());
    } catch (err) {
      console.warn(`[${this.archetype}Runner] Tool retriever warm-up failed for ${config.role}:`, (err as Error).message);
    }
    let trustScore: number | null = null;
    if (safeDeps.trustScorer) {
      try {
        trustScore = (await safeDeps.trustScorer.getTrust(config.role)).trustScore;
      } catch (err) {
        console.warn(`[${this.archetype}Runner] Trust load failed for ${config.role}:`, (err as Error).message);
      }
    }
    try {
      const [strengthRow] = await systemQuery<{ verified_strength: number }>(
        `SELECT
           COALESCE(AVG(
             CASE
               WHEN verification_tier IS NOT NULL AND status = 'completed' THEN 0.7
               WHEN status = 'completed' THEN 0.5
               ELSE 0.2
             END
           ), 0.5) AS verified_strength
         FROM (
           SELECT status, verification_tier
             FROM agent_runs
            WHERE agent_id = $1
              AND task = $2
              AND completed_at IS NOT NULL
            ORDER BY completed_at DESC
            LIMIT 40
         ) recent_runs`,
        [config.role, taskForContext],
      );
      if (typeof strengthRow?.verified_strength === 'number') {
        trustScore = trustScore == null
          ? strengthRow.verified_strength
          : ((trustScore * 0.7) + (strengthRow.verified_strength * 0.3));
      }
    } catch {
      // Non-critical: routing falls back to trust scorer.
    }
    let routingAudit = await routeSubtask({
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
             null,
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
      routedModel.model = getTierModel('default');
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
        history.push({ role: 'user', content: `[CONTEXT — Background information for reference. Do NOT respond to this message; wait for your task instruction.]

${memPrompt}`, timestamp: Date.now() });
      }
    }

    // ─── Inject JIT context into history ────────────────────────
    if (jitContext && jitContext.tokenEstimate > 0) {
      const jitSections: string[] = [];
      if (jitContext.relevantMemories.length > 0) {
        jitSections.push('## Relevant Memories\n' + jitContext.relevantMemories.map(m => `- ${m.content}${formatFreshnessTag(m)}`).join('\n'));
      }
      if (jitContext.relevantGraphNodes.length > 0) {
        jitSections.push('## Relevant Graph Context\n' + jitContext.relevantGraphNodes.map(g => `- ${g.content}${formatFreshnessTag(g)}`).join('\n'));
      }
      if (jitContext.relevantKnowledge.length > 0) {
        jitSections.push('## Relevant Knowledge\n' + jitContext.relevantKnowledge.map(k => `- ${k.content}${formatFreshnessTag(k)}`).join('\n'));
      }
      if (jitContext.relevantEpisodes.length > 0) {
        jitSections.push('## Relevant Episodes\n' + jitContext.relevantEpisodes.map(e => `- ${e.content}${formatFreshnessTag(e)}`).join('\n'));
      }
      if (jitContext.relevantProcedures.length > 0) {
        jitSections.push('## Relevant Procedures\n' + jitContext.relevantProcedures.map(p => `- ${p.content}${formatFreshnessTag(p)}`).join('\n'));
      }
      if (jitSections.length > 0) {
        if (jitContext.selectionMeta) {
          emitEvent({
            type: 'jit_selector_summary',
            agentId: config.id,
            turnNumber: 0,
            candidateCount: jitContext.selectionMeta.candidateCount,
            selectedCount: jitContext.selectionMeta.selectedCount,
            selectedBySource: jitContext.selectionMeta.selectedBySource,
            selectedFreshness: jitContext.selectionMeta.selectedFreshness,
          });
          console.log(
            `[JITSelector] ${config.role}: candidates=${jitContext.selectionMeta.candidateCount}, selected=${jitContext.selectionMeta.selectedCount}, by_source=${JSON.stringify(jitContext.selectionMeta.selectedBySource)}, freshness=${JSON.stringify(jitContext.selectionMeta.selectedFreshness)}`,
          );
        }
        history.push({
          role: 'user',
          content: `[CONTEXT — Background information for reference. Do NOT respond to this message; wait for your task instruction.]\n\n# Task-Relevant Context (JIT Retrieved)\n\n${jitSections.join('\n\n')}`,
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

    if (
      reasoningEngine &&
      (reasoningEngine as any).config?.valueGateEnabled &&
      taskForContext !== 'process_directive'
    ) {
      try {
        const contextSummary = jitContext
          ? `JIT context: ${jitContext.tokenEstimate} tokens from ${jitContext.relevantMemories.length + jitContext.relevantKnowledge.length} sources`
          : 'No JIT context';
        valueAssessment = await reasoningEngine.evaluateValue(config.role, initialMessage, contextSummary);

        if (valueAssessment.recommendation === 'abort') {
          console.log(`[${this.archetype}Runner] Value gate aborted run for ${config.role}: ${valueAssessment.reasoning}`);
          const auditLogId = await persistDecisionAuditLog({
            agentRole: config.role,
            taskId: traceTaskId,
            action: 'agent.value_gate_abort',
            summary: `Value gate aborted ${config.role} run`,
            description: valueAssessment.reasoning,
            details: {
              run_id: config.dbRunId ?? config.id,
              value_assessment: buildValueAnalysisTrace(valueAssessment),
            },
          });
          if (auditLogId) {
            await captureDecisionTrace(auditLogId, {
              agentId: config.role,
              taskId: traceTaskId,
              valueAnalysisResult: buildValueAnalysisTrace(valueAssessment),
              alternativesRejected: buildAlternativesRejected(valueAssessment),
              confidenceAtDecision: valueAssessment.score,
              finalDecisionSummary: `The agent chose not to execute because the value gate determined the work did not justify the expected cost. ${valueAssessment.reasoning}`,
            }).catch((err: unknown) => {
              console.warn(`[${this.archetype}Runner] Failed to capture value-gate decision trace for ${config.role}:`, (err as Error).message);
            });
          }
          return this.buildResult(config, 'aborted', `Value gate: ${valueAssessment.reasoning}`, history, supervisor, 'value_gate_abort', totalInputTokens, totalOutputTokens, totalThinkingTokens, totalCachedInputTokens, buildRoutingSummary());
        }
      } catch (err) {
        console.warn(`[${this.archetype}Runner] Value gate failed for ${config.role}:`, (err as Error).message);
      }
    }

    // ─── Load skill context ────────────────────────────────────
    // Skills provide structured methodology and domain expertise.
    // Load for all archetype runners so task agents benefit from playbooks.
    if (safeDeps.skillContextLoader) {
      try {
        const skillCtx = await safeDeps.skillContextLoader(config.role, initialMessage);
        if (skillCtx && skillCtx.skills.length > 0) {
          const skillParts: string[] = ['# Your Skills\n\nFollow the methodology precisely.\n'];
          for (const skill of skillCtx.skills) {
            skillParts.push(`## ${skill.name} (${skill.proficiency})`);
            skillParts.push(`Category: ${skill.category}`);
            skillParts.push(`\n**Methodology:**\n${skill.methodology}`);
            if (skill.learned_refinements.length > 0) {
              skillParts.push('\n**Learned refinements:**');
              for (const r of skill.learned_refinements) skillParts.push(`- ${r}`);
            }
            if (skill.failure_modes.length > 0) {
              skillParts.push('\n**Known failure modes (avoid):**');
              for (const f of skill.failure_modes) skillParts.push(`- [!] ${f}`);
            }
            if (skill.tools_granted.length > 0) {
              skillParts.push(`\nTools available: ${skill.tools_granted.join(', ')}`);
            }
            skillParts.push('');
          }
          history.push({ role: 'user', content: `[CONTEXT — Your skill playbooks for reference. Do NOT respond to this message; wait for your task instruction.]\n\n${skillParts.join('\n')}`, timestamp: Date.now() });
        }
      } catch (err) {
        console.warn(`[${this.archetype}Runner] Skill context load failed for ${config.role}:`, (err as Error).message);
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
      let lastRetrievalTrace: ToolRetrieverTrace | undefined;

      while (true) {
        turnNumber++;
        emitEvent({ type: 'turn_started', agentId: config.id, turnNumber });

        // ── Supervisor check ────────────────────────────────────
        const check = await supervisor.checkBeforeModelCall();
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

        if (runPhase === 'planning') {
          emitEvent({
            type: 'planning_phase_started',
            agentId: config.id,
            turnNumber,
            mode: planningMode,
          });
          void recordRunEvent({
            runId: config.dbRunId ?? config.id,
            eventType: 'planning_phase_started',
            trigger: 'planner.phase',
            component: 'baseAgentRunner',
            payload: {
              role: config.role,
              turn_number: turnNumber,
              mode: planningMode,
            },
          });
          const planningInstruction = `${PLANNING_REQUEST_MARKER}
Before executing any tools, produce a concise execution plan in STRICT JSON:
{
  "objective": "string",
  "acceptance_criteria": ["string"],
  "execution_steps": ["string"],
  "verification_steps": ["string"]
}
Rules:
- Include 3-7 concrete acceptance criteria.
- Criteria must be objectively verifiable from the agent's likely tool outputs and final text.
- Prefer criteria tied to data returned by a primary read (e.g. "each agent under 0.65 **listed in read_fleet_health**") rather than unbounded "every agent in the fleet" unless enumeration is a named step.
- When a step may fail (tool error, gate, missing data), allow a verifiable fallback: "document the blocker with tool name and error/summary."
- Output JSON only (no markdown, no prose).`;
          if (!history.some((turn) => turn.role === 'user' && turn.content.startsWith(PLANNING_REQUEST_MARKER))) {
            history.push({ role: 'user', content: planningInstruction, timestamp: Date.now() });
          }
        }

        // ── Model call ──────────────────────────────────────────
        let response: Awaited<ReturnType<ModelClient['generate']>>;
        const modelTurnSpan = startTraceSpan('runner.model_turn', {
          run_id: config.dbRunId ?? config.id,
          agent_role: config.role,
          turn_number: turnNumber,
          task: taskForContext,
        });
        try {
          let sessionSummaryForCompaction: string | undefined;
          if (summaryFirstCompactionEnabled && safeDeps.sessionMemoryStore) {
            try {
              const conversationId = config.dbRunId ?? config.id;
              const sessionSummary = await safeDeps.sessionMemoryStore.getLatest(conversationId);
              sessionSummaryForCompaction = sessionSummary?.summaryText;
              if (sessionSummaryForCompaction) {
                emitEvent({
                  type: 'context_injected',
                  agentId: config.id,
                  turnNumber,
                  contextLength: sessionSummaryForCompaction.length,
                });
              }
            } catch {
              // fail-open: summary compaction is optional
            }
          }
          // ── Capture recent tool summaries before compaction (for re-injection) ──
          const preCompactToolSummaries = extractRecentToolSummaries(history);

          const composedContext = composeModelContext({
            history: (() => {
              const microCompacted = microCompactHistory(history, {
                enabled: config.microCompactionEnabled ?? true,
                keepRecentToolResults: config.microCompactionKeepRecent ?? 3,
                maxToolResultChars: config.microCompactionMaxChars ?? 900,
              });
              if (microCompacted.compactedTurns > 0) {
                microCompactionOccurred = true;
                microCompactionCount += microCompacted.compactedTurns;
                latestMicroCompactionSummary = microCompacted.summary;
              }
              return microCompacted.history;
            })(),
            role: config.role,
            task: taskForContext,
            initialMessage,
            turnNumber,
            bundleKind: inferBundleKind(turnNumber),
            maxTokens: compositionMaxTokens,
            includeReasoningState: true,
            keepRecentGroups: 2,
            sessionSummary: sessionSummaryForCompaction,
          });

          // ── Post-compact context re-injection ──
          const postCompact = injectPostCompactContext(
            composedContext.history,
            {
              taskDescription: initialMessage,
              recentToolSummaries: preCompactToolSummaries,
            },
            composedContext.droppedGroups,
          );
          void recordRunEvent({
            runId: config.dbRunId ?? config.id,
            eventType: 'context.bundle_composed',
            trigger: 'model.turn',
            component: 'baseAgentRunner',
            payload: {
              bundle_kind: inferBundleKind(turnNumber),
              token_estimate: composedContext.tokenEstimate,
              dropped_turns: composedContext.droppedTurns,
              dropped_groups: composedContext.droppedGroups,
              clipped_turns: composedContext.clippedTurns,
              post_compact_injected: postCompact.injectedTurns,
              post_compact_tokens: postCompact.injectedTokenEstimate,
              composition_budget: compositionMaxTokens,
              context_window: contextBudget.contextWindow,
            },
          });
          const composedHistory = postCompact.history;

          emitEvent({
            type: 'model_request',
            agentId: config.id,
            turnNumber,
            tokenEstimate: composedContext.tokenEstimate,
          });

          if (turnNumber === 1 || turnNumber % 3 === 0) {
            const rawEstimate = Math.ceil(history.reduce((s, t) => s + t.content.length, 0) / 4);
            console.log(
              `[ContextComposer] ${config.role} turn=${turnNumber}: ` +
              `raw=${history.length} (~${rawEstimate} tok) -> ` +
              `composed=${composedHistory.length} (~${composedContext.tokenEstimate} tok), ` +
              `dropped_groups=${composedContext.droppedGroups}, dropped_turns=${composedContext.droppedTurns}`,
            );
          }

          // Strip tools on last turn to force text response
          let effectiveTools: ReturnType<typeof toolExecutor.getDeclarations> | undefined = toolExecutor.getDeclarations();
          if (turnNumber >= supervisor.config.maxTurns) effectiveTools = undefined;
          if (runPhase === 'planning') effectiveTools = undefined;
          if (effectiveTools) {
              const modelForRetrieval = routedModel.model === '__deterministic__'
                ? config.model
                : routedModel.model;
              const retriever = getToolRetriever();
              const retrieval = await retriever.retrieve(effectiveTools, {
                model: modelForRetrieval,
                role: config.role,
                taskContext: buildToolTaskContext({
                  message: initialMessage,
                  task: taskForContext,
                  role: config.role,
                  recentTools: actionReceipts.map((receipt) => receipt.tool),
                }),
              });
              effectiveTools = retrieval.tools;
              lastRetrievalTrace = retrieval.trace;

              if (turnNumber === 1 || turnNumber % 3 === 0) {
                console.log(
                  `[ToolRetriever] ${config.role} turn=${turnNumber}: ` +
                  `candidates=${retrieval.trace.totalCandidates}, pinned=${retrieval.trace.pinnedTools.length}, ` +
                  `selected=${effectiveTools.length}, cap=${retrieval.trace.modelCap}, model=${retrieval.trace.model}`,
                );
              }
          }

          routingAudit = await routeSubtask({
            role: config.role,
            task: taskForContext,
            history: composedHistory,
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
          const modelForTurn = routedModel.model === '__deterministic__'
            ? config.model
            : routedModel.model;
          let modelForGenerate = modelForTurn;
          if (runPhase === 'planning' && planningPolicy.planningModelTier) {
            modelForGenerate = getTierModel(planningPolicy.planningModelTier);
          }

          response = await this.modelClient.generate({
            model: modelForGenerate,
            systemInstruction: systemPrompt,
            contents: composedHistory,
            tools: effectiveTools,
            temperature: effectiveTemp,
            topP: config.topP,
            topK: config.topK,
            thinkingEnabled: effectiveThinkingEnabled,
            reasoningLevel,
            fallbackScope: 'same-provider',
            signal: supervisor.signal,
            callTimeoutMs: 300_000,
            metadata: {
              previousResponseId,
              modelConfig: routedModel,
              agentRole: config.role,
              runId: config.dbRunId ?? config.id,
              assignmentId: config.assignmentId,
              turnNumber,
            },
          });
          previousResponseId = response.responseId;

          totalInputTokens += response.usageMetadata.inputTokens;
          totalOutputTokens += response.usageMetadata.outputTokens;
          totalThinkingTokens += response.usageMetadata.thinkingTokens ?? 0;
          totalCachedInputTokens += response.usageMetadata.cachedInputTokens ?? 0;
          actualModelUsed = response.actualModel ?? modelForTurn;
          actualProviderUsed = response.actualProvider;
          modelTurnSpan.end({
            model: modelForTurn,
            actual_model: response.actualModel ?? modelForTurn,
            actual_provider: response.actualProvider ?? 'unknown',
            has_tool_calls: response.toolCalls.length > 0,
            input_tokens: response.usageMetadata.inputTokens,
            output_tokens: response.usageMetadata.outputTokens,
          });
          emitEvent({ type: 'model_response', agentId: config.id, turnNumber, hasToolCalls: response.toolCalls.length > 0, thinkingText: response.thinkingText });

          // Successful model call — reset reactive compaction state
          resetReactiveState(reactiveState);
        } catch (error) {
          modelTurnSpan.fail(error, {});
          if (supervisor.isAborted) {
            return this.buildResult(config, 'aborted', lastTextOutput, history, supervisor, (error as Error).message, totalInputTokens, totalOutputTokens, totalThinkingTokens, totalCachedInputTokens, buildRoutingSummary());
          }

          // ── Reactive compaction: retry with tighter budget on context overflow ──
          if (isContextOverflowError(error) && !reactiveState.circuitBroken) {
            const recomposed = reactiveRecompose({
              history,
              role: config.role,
              task: taskForContext,
              initialMessage,
              turnNumber,
              normalBudget: contextBudget,
              state: reactiveState,
            });
            if (recomposed) {
              void recordRunEvent({
                runId: config.dbRunId ?? config.id,
                eventType: 'context.reactive_compaction',
                trigger: 'model.context_overflow',
                component: 'baseAgentRunner',
                payload: {
                  attempt: reactiveState.consecutiveCount,
                  budget: recomposed.budgetUsed.compositionBudget,
                  dropped: recomposed.dropped,
                  token_estimate: recomposed.tokenEstimate,
                },
              });
              // Retry the model call with the tighter history — continue loop
              continue;
            }
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
            const toolTurnSpan = startTraceSpan('runner.tool_call', {
              run_id: config.dbRunId ?? config.id,
              agent_role: config.role,
              turn_number: turnNumber,
              tool_name: call.name,
            });
            const result = await (async () => {
              try {
                const toolResult = await toolExecutor.execute(call.name, call.args, {
                  agentId: config.id,
                  agentRole: config.role,
                  turnNumber,
                  abortSignal: supervisor.signal,
                  memoryBus,
                  emitEvent,
                  glyphorEventBus: safeDeps.glyphorEventBus,
                  runId: config.dbRunId ?? config.id,
                  assignmentId: config.assignmentId,
                  directiveId: config.directiveId,
                  requestSource: taskForContext === 'on_demand' ? 'on_demand' : 'scheduled',
                  retrievalMetadata: lastRetrievalTrace
                    ? buildRetrievalMetadataMap(lastRetrievalTrace)
                    : undefined,
                });
                toolTurnSpan.end({
                  success: toolResult.success,
                  files_written: toolResult.filesWritten ?? 0,
                  memory_keys_written: toolResult.memoryKeysWritten ?? 0,
                });
                return toolResult;
              } catch (toolError) {
                toolTurnSpan.fail(toolError, {});
                throw toolError;
              }
            })();

            const resultContent = result.data !== undefined ? JSON.stringify(result.data) : result.error ?? 'ok';
            history.push({ role: 'tool_result', content: resultContent, toolName: call.name, toolResult: result, timestamp: Date.now() });
            emitEvent({ type: 'tool_result', agentId: config.id, turnNumber, toolName: call.name, success: result.success, filesWritten: result.filesWritten ?? 0, memoryKeysWritten: result.memoryKeysWritten ?? 0 });

            if (result.auditLogId) {
              traceAuditLogIds.add(result.auditLogId);
              reactIterationCounter += 1;
              await captureDecisionTrace(result.auditLogId, {
                agentId: config.role,
                taskId: traceTaskId,
                reactIterations: [{
                  thought: (call.thoughtSignature ?? response.thinkingText ?? '').slice(0, 4000),
                  action: `${call.name} ${JSON.stringify(call.args).slice(0, 2000)}`,
                  observation: resultContent.slice(0, 4000),
                  iteration: reactIterationCounter,
                }],
                valueAnalysisResult: buildValueAnalysisTrace(valueAssessment),
              }).catch((err: unknown) => {
                console.warn(`[${this.archetype}Runner] Failed to capture ReAct trace for ${config.role}/${call.name}:`, (err as Error).message);
              });
            }

            actionReceipts.push({
              tool: call.name,
              params: call.args,
              result: result.success ? 'success' : 'error',
              output: (resultContent ?? '').slice(0, 500),
              timestamp: new Date().toISOString(),
              constitutional_check: result.constitutional_check,
              evidenceIds: result.evidenceIds,
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
          history.push({ role: 'assistant', content: response.text, timestamp: Date.now() });
          if (runPhase === 'planning') {
            planningAttempts += 1;
            const parsedPlan = parseExecutionPlan(response.text);
            if (parsedPlan) {
              executionPlanObjective = parsedPlan.objective;
              acceptanceCriteria = Array.from(new Set([
                ...acceptanceCriteria,
                ...parsedPlan.acceptanceCriteria,
              ]));
              runPhase = 'execution';
              completionGateRetries = 0;
              completionGateMissing = [];
              history.push({
                role: 'user',
                content: `Execution phase begins now. Complete the task using tools and satisfy all acceptance criteria before final response.
Acceptance criteria:
${acceptanceCriteria.map((criterion, idx) => `${idx + 1}. ${criterion}`).join('\n')}`,
                timestamp: Date.now(),
              });
              continue;
            }

            if (planningAttempts < planningMaxAttempts) {
              history.push({
                role: 'user',
                content: `${PLANNING_REPAIR_MARKER}
Your plan was not valid JSON or missed acceptance criteria.
Return ONLY strict JSON with:
- objective
- acceptance_criteria (3-7 concrete items)
- execution_steps
- verification_steps`,
                timestamp: Date.now(),
              });
              continue;
            }

            if (planningMode === 'required') {
              return this.buildResult(
                config,
                'aborted',
                null,
                history,
                supervisor,
                'planner_failed_to_produce_valid_plan',
                totalInputTokens,
                totalOutputTokens,
                totalThinkingTokens,
                totalCachedInputTokens,
                buildRoutingSummary(),
              );
            }

            runPhase = 'execution';
            history.push({
              role: 'user',
              content: 'Planning output was invalid. Continue directly in execution mode and complete the task with tool-backed verification.',
              timestamp: Date.now(),
            });
            continue;
          }

          lastTextOutput = response.text;
          if (safeDeps.sessionMemoryUpdater) {
            try {
              await safeDeps.sessionMemoryUpdater.maybeUpdate({
                config,
                history,
                turnNumber,
                latestAssistantText: response.text,
                conversationId: config.dbRunId ?? config.id,
                sessionId: config.assignmentId,
              });
            } catch (err) {
              console.warn(
                `[${this.archetype}Runner] Session memory update failed for ${config.role}:`,
                (err as Error).message,
              );
            }
          }
        }

        if (response.finishReason === 'stop' || response.toolCalls.length === 0) {
          if (!lastTextOutput && !history.some(h => h.content === 'Please provide your final text response summarizing what you found and any actions taken.')) {
            history.push({ role: 'user', content: 'Please provide your final text response summarizing what you found and any actions taken.', timestamp: Date.now() });
            continue;
          }

          // Planning-detection guard: if the agent described future actions
          // but never invoked any tools, nudge it to actually execute.
          const PLANNING_NUDGE = 'You described actions you intend to take but did not execute any tools. Do NOT just describe what you plan to do — actually call the tools now to carry out the work. Use your available tools to complete the task.';
          if (
            lastTextOutput &&
            actionReceipts.length === 0 &&
            turnNumber <= 2 &&
            containsPlanningIntent(lastTextOutput) &&
            !history.some(h => h.content === PLANNING_NUDGE)
          ) {
            console.warn(`[BaseAgentRunner] Planning-only response detected for ${config.role} on turn ${turnNumber} — nudging to execute.`);
            history.push({ role: 'user', content: PLANNING_NUDGE, timestamp: Date.now() });
            continue;
          }

          if (runPhase === 'execution' && completionGateEnabled && acceptanceCriteria.length > 0 && lastTextOutput) {
            const completionGate = await this.evaluateCompletionGate({
              role: config.role,
              initialMessage,
              acceptanceCriteria,
              output: lastTextOutput,
              actionReceipts,
              signal: supervisor.signal,
              verifyModelTier: planningPolicy.completionGateVerifyModelTier,
            });
            completionGatePassed = completionGate.meets;
            completionGateMissing = completionGate.missingCriteria;
            if (completionGate.meets) {
              emitEvent({
                type: 'completion_gate_passed',
                agentId: config.id,
                turnNumber,
              });
              void recordRunEvent({
                runId: config.dbRunId ?? config.id,
                eventType: 'completion_gate_passed',
                trigger: 'completion.gate',
                component: 'baseAgentRunner',
                payload: {
                  role: config.role,
                  turn_number: turnNumber,
                },
              });
            }
            if (!completionGate.meets && completionGateAutoRepairEnabled && completionGateAutoRepairAttempts < 1) {
              emitEvent({
                type: 'completion_gate_failed',
                agentId: config.id,
                turnNumber,
                missingCriteria: completionGate.missingCriteria,
                retryAttempt: completionGateRetries,
                maxRetries: completionGateMaxRetries,
              });
              void recordRunEvent({
                runId: config.dbRunId ?? config.id,
                eventType: 'completion_gate_failed',
                trigger: 'completion.gate',
                component: 'baseAgentRunner',
                payload: {
                  role: config.role,
                  turn_number: turnNumber,
                  retry_attempt: completionGateRetries,
                  max_retries: completionGateMaxRetries,
                  missing_criteria: completionGate.missingCriteria,
                  auto_repair_path: true,
                },
              });
              completionGateAutoRepairAttempts += 1;
              void recordRunEvent({
                runId: config.dbRunId ?? config.id,
                eventType: 'completion_gate_auto_repair_triggered',
                trigger: 'completion.gate',
                component: 'baseAgentRunner',
                payload: {
                  role: config.role,
                  turn_number: turnNumber,
                  auto_repair_attempt: completionGateAutoRepairAttempts,
                  missing_criteria: completionGate.missingCriteria,
                },
              });
              history.push({
                role: 'user',
                content: `${EXECUTION_GATE_AUTO_REPAIR_MARKER}
Perform exactly one corrective repair pass before finalizing.
Target only the missing acceptance criteria below, and keep already-satisfied criteria intact.
Missing criteria:
${completionGate.missingCriteria.map((criterion, idx) => `${idx + 1}. ${criterion}`).join('\n')}

Use tools if needed to gather evidence, then return a revised final output that explicitly satisfies every missing criterion.`,
                timestamp: Date.now(),
              });
              continue;
            }
            if (!completionGate.meets && completionGateRetries < completionGateMaxRetries) {
              emitEvent({
                type: 'completion_gate_failed',
                agentId: config.id,
                turnNumber,
                missingCriteria: completionGate.missingCriteria,
                retryAttempt: completionGateRetries + 1,
                maxRetries: completionGateMaxRetries,
              });
              void recordRunEvent({
                runId: config.dbRunId ?? config.id,
                eventType: 'completion_gate_failed',
                trigger: 'completion.gate',
                component: 'baseAgentRunner',
                payload: {
                  role: config.role,
                  turn_number: turnNumber,
                  retry_attempt: completionGateRetries + 1,
                  max_retries: completionGateMaxRetries,
                  missing_criteria: completionGate.missingCriteria,
                },
              });
              completionGateRetries += 1;
              history.push({
                role: 'user',
                content: `${EXECUTION_GATE_NUDGE_MARKER}
Do not finalize yet. The output does not satisfy all acceptance criteria.
Missing criteria:
${completionGate.missingCriteria.map((criterion, idx) => `${idx + 1}. ${criterion}`).join('\n')}

Continue execution, call tools as needed, and return only when all criteria are met.`,
                timestamp: Date.now(),
              });
              continue;
            }
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
        rubricId: verificationDecision.rubricId,
      };
      const evidenceIds = actionReceipts.flatMap((receipt) => receipt.evidenceIds ?? []);
      const unsupportedClaims = findUnsupportedClaims(lastTextOutput, actionReceipts);
      if (unsupportedClaims.length > 0) {
        verificationMeta.unsupportedClaims = unsupportedClaims;
        verificationMeta.reason = `${verificationMeta.reason}; unsupported claims detected`;
      }

      if (reasoningEngine && verificationDecision.tier !== 'none') {
        try {
          const contextForVerification = jitContext
            ? jitContext.relevantKnowledge.map(k => k.content).join('\n').slice(0, 2000)
            : '';
          let repairAttempt = 0;
          let workingOutput = lastTextOutput;
          const repairPasses: import('./reasoningEngine.js').PassType[] = [
            'self_critique',
            'cross_model',
            'contradiction_scan',
          ];
          while (repairAttempt < 2) {
            repairAttempt += 1;
            reasoningResult = await reasoningEngine.verifyWithOverride(
              {
                passTypes: verificationDecision.passes.length > 0 ? verificationDecision.passes : repairPasses,
                crossModelEnabled: true,
              },
              config.role,
              initialMessage,
              workingOutput,
              contextForVerification,
              'repair_loop',
            );
            void recordRunEvent({
              runId: config.dbRunId ?? config.id,
              eventType: 'verification.repair_cycle',
              trigger: 'verification_pipeline',
              component: 'baseAgentRunner',
              payload: {
                attempt: repairAttempt,
                confidence: reasoningResult.overallConfidence,
                revised: reasoningResult.revised,
                passes: reasoningResult.passes.map((pass) => pass.passType),
              },
            });
            if (!reasoningResult.revised || !reasoningResult.revisedOutput) break;
            workingOutput = reasoningResult.revisedOutput;
            if (reasoningResult.overallConfidence >= verificationDecision.minimumRubricScore) break;
          }

          if (reasoningResult && verificationDecision.tier === 'conditional' &&
            verificationDecision.conditionalEscalationThreshold !== undefined &&
            reasoningResult.overallConfidence < verificationDecision.conditionalEscalationThreshold) {
            const escalationInput = reasoningResult.revisedOutput ?? workingOutput;
            reasoningResult = await reasoningEngine.verifyWithOverride(
              {
                passTypes: ['self_critique', 'cross_model', 'contradiction_scan'],
                crossModelEnabled: true,
              },
              config.role,
              initialMessage,
              escalationInput,
              contextForVerification,
              'conditional_escalation',
            );
            verificationMeta.escalated = true;
            verificationMeta.reason = `${verificationDecision.reason} (escalated after low confidence)`;
          }

          if (!reasoningResult) {
            throw new Error('Verification produced no result.');
          }

          if (reasoningResult.revised && reasoningResult.revisedOutput) {
            lastTextOutput = reasoningResult.revisedOutput;
          }

          verificationMeta.passes = Array.from(new Set(reasoningResult.passes.map((pass) => pass.passType)));
          verificationMeta.rubricScore = reasoningResult.overallConfidence;
          if (
            verificationDecision.minimumRubricScore > 0 &&
            reasoningResult.overallConfidence < verificationDecision.minimumRubricScore
          ) {
            verificationMeta.escalated = true;
            verificationMeta.reason = `${verificationMeta.reason}; rubric threshold not met`;
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
      } else if (!reasoningEngine && verificationDecision.tier !== 'none') {
        console.warn(`[${this.archetype}Runner] Verification unavailable for ${config.id}: reasoning engine not configured`);
      }

      if (unsupportedClaims.length > 0 && evidenceIds.length > 0) {
        await Promise.all(
          unsupportedClaims.map((claim) => linkClaimToEvidence({
            runId: config.dbRunId ?? config.id,
            claimText: claim,
            evidenceUid: evidenceIds[0]!,
            verificationState: 'unsupported',
          })),
        );
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
              undefined,
              config.assignmentId,
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

      // ─── ORCHESTRATION: fail-closed decomposition ───────────────
      if (orchestrateDecompositionBaseline && orchestrateDecompositionBaseline.length > 0) {
        try {
          const currentUndecomposed = await fetchUndecomposedDelegatedDirectives(config.role);
          const unresolved = filterBaselineStillUnresolved(orchestrateDecompositionBaseline, currentUndecomposed);
          if (unresolved.length > 0) {
            const guardMsg =
              `orchestrate_decomposition_incomplete: ${unresolved.length} delegated directive(s) still have no work_assignments: ` +
              unresolved.map((d) => `"${d.title}" (${d.id})`).join('; ');
            console.warn(`[${this.archetype}Runner] ${config.role}: ${guardMsg}`);
            emitEvent({
              type: 'agent_aborted',
              agentId: config.id,
              reason: guardMsg,
              totalTurns: supervisor.stats.turnCount,
              elapsedMs: supervisor.stats.elapsedMs,
            });
            const guardResult = this.buildResult(
              config,
              'aborted',
              lastTextOutput,
              history,
              supervisor,
              guardMsg,
              totalInputTokens,
              totalOutputTokens,
              totalThinkingTokens,
              totalCachedInputTokens,
              buildRoutingSummary(),
              actualModelUsed,
              actualProviderUsed,
            );
            guardResult.actions = actionReceipts;
            return guardResult;
          }
        } catch (err) {
          console.warn(`[OrchestrationGuard] Post-run check failed for ${config.role}:`, (err as Error).message);
        }
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
      const verifiedOutcomeEligible =
        verificationMeta?.tier !== 'none' &&
        !verificationMeta?.escalated &&
        (verificationMeta?.unsupportedClaims?.length ?? 0) === 0 &&
        (reasoningResult?.overallConfidence ?? 0) >= Math.max(0.6, verificationDecision.minimumRubricScore);
      if (safeDeps.worldModelUpdater && safeDeps.sharedMemoryLoader && verifiedOutcomeEligible) {
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
      } else if (safeDeps.worldModelUpdater && !verifiedOutcomeEligible) {
        console.log(`[${this.archetype}Runner] Skipping world-model self-update for ${config.role}: outcome did not pass verified threshold.`);
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

      const result = this.buildResult(config, 'completed', lastTextOutput, history, supervisor, undefined, totalInputTokens, totalOutputTokens, totalThinkingTokens, totalCachedInputTokens, buildRoutingSummary(), actualModelUsed, actualProviderUsed);
      result.actions = actionReceipts;
      result.executionPlanMeta = {
        mode: planningMode,
        objective: executionPlanObjective,
        acceptanceCriteria,
        planned: planningAttempts > 0,
        planningAttempts,
        completionGateEnabled,
        completionGateAutoRepairEnabled,
        completionGateAutoRepairAttempts,
        completionGatePassed: (completionGateEnabled && acceptanceCriteria.length > 0) ? completionGatePassed : undefined,
        missingCriteria: completionGateMissing.length > 0 ? completionGateMissing : undefined,
      };
      if (microCompactionOccurred) {
        result.compactionOccurred = true;
        result.compactionCount = microCompactionCount;
        result.compactionSummary = latestMicroCompactionSummary ?? `Micro-compacted ${microCompactionCount} turn(s)`;
      }
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

      if (traceAuditLogIds.size === 0 && lastTextOutput) {
        const auditLogId = await persistDecisionAuditLog({
          agentRole: config.role,
          taskId: traceTaskId,
          action: 'agent.decision',
          summary: summarizeDecisionText(lastTextOutput) ?? `${config.role} completed a decision`,
          description: summarizeDecisionText(lastTextOutput),
          details: {
            run_id: config.dbRunId ?? config.id,
            verification_tier: verificationMeta.tier,
            verification_passes: verificationMeta.passes,
            reasoning_confidence: reasoningResult?.overallConfidence ?? null,
          },
        });
        if (auditLogId) {
          traceAuditLogIds.add(auditLogId);
        }
      }

      if (traceAuditLogIds.size > 0) {
        const finalTraceUpdate = {
          agentId: config.role,
          taskId: traceTaskId,
          selfCritiqueOutput: buildSelfCritiqueTrace(reasoningResult),
          valueAnalysisResult: buildValueAnalysisTrace(valueAssessment),
          alternativesRejected: buildAlternativesRejected(valueAssessment),
          confidenceAtDecision: reasoningResult?.overallConfidence ?? valueAssessment?.score ?? null,
          finalDecisionSummary: summarizeDecisionText(lastTextOutput),
        };

        await Promise.allSettled(
          [...traceAuditLogIds].map((auditLogId) => captureDecisionTrace(auditLogId, finalTraceUpdate)),
        );
      }

      await persistRunMetricsAuditLog({
        agentRole: config.role,
        taskId: traceTaskId,
        runId: config.dbRunId ?? config.id,
        model: actualModelUsed ?? config.model,
        summary: summarizeDecisionText(lastTextOutput) ?? `${config.role} completed run ${config.id}`,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        thinkingTokens: totalThinkingTokens,
        cachedInputTokens: totalCachedInputTokens,
      });

      // Fire-and-forget: harvest skill signals from efficient successful runs.
      void learnFromAgentRun({
        result,
        agentRole: config.role,
        runId: config.id,
        taskType: taskForContext,
        taskDescription: initialMessage,
        glyphorEventBus: safeDeps.glyphorEventBus,
      }).catch(() => {});

      // Fire-and-forget: harvest task outcome for Learning Governor
      void harvestTaskOutcome(result, {
        runId: config.id,
        agentRole: config.role,
        assignmentId: config.assignmentId ?? undefined,
        directiveId: config.directiveId ?? undefined,
      }).catch(() => {});

      void recordRunEvent({
        runId: config.dbRunId ?? config.id,
        eventType: 'run.completed',
        trigger: 'runner.complete',
        component: 'baseAgentRunner',
        payload: {
          status: result.status,
          verification_tier: verificationMeta?.tier ?? 'none',
          verification_score: verificationMeta?.rubricScore ?? null,
          unsupported_claims: verificationMeta?.unsupportedClaims ?? [],
          output_digest: createContentDigest(lastTextOutput),
        },
      });
      if ((verificationMeta?.unsupportedClaims?.length ?? 0) > 0) {
        void recordFailureTaxonomy({
          runId: config.dbRunId ?? config.id,
          agentRole: config.role,
          taskClass: taskForContext,
          failureCode: 'evidence_missing',
          severity: 'high',
          detail: 'Final output contained unsupported claim(s).',
          metadata: { unsupported_claims: verificationMeta?.unsupportedClaims ?? [] },
        });
      }
      if (verificationMeta?.escalated) {
        void recordFailureTaxonomy({
          runId: config.dbRunId ?? config.id,
          agentRole: config.role,
          taskClass: taskForContext,
          failureCode: 'unresolved_low_confidence',
          severity: 'medium',
          detail: verificationMeta.reason,
        });
      }

      return result;
    } catch (error) {
      emitEvent({ type: 'agent_error', agentId: config.id, error: (error as Error).message, turnNumber: supervisor.stats.turnCount });
      const errResult = this.buildResult(config, supervisor.isAborted ? 'aborted' : 'error', lastTextOutput, history, supervisor, (error as Error).message, totalInputTokens, totalOutputTokens, totalThinkingTokens, totalCachedInputTokens, buildRoutingSummary(), actualModelUsed, actualProviderUsed);
      errResult.actions = actionReceipts;
      errResult.executionPlanMeta = {
        mode: planningMode,
        objective: executionPlanObjective,
        acceptanceCriteria,
        planned: planningAttempts > 0,
        planningAttempts,
        completionGateEnabled,
        completionGateAutoRepairEnabled,
        completionGateAutoRepairAttempts,
        completionGatePassed: (completionGateEnabled && acceptanceCriteria.length > 0) ? completionGatePassed : undefined,
        missingCriteria: completionGateMissing.length > 0 ? completionGateMissing : undefined,
      };
      if (microCompactionOccurred) {
        errResult.compactionOccurred = true;
        errResult.compactionCount = microCompactionCount;
        errResult.compactionSummary = latestMicroCompactionSummary ?? `Micro-compacted ${microCompactionCount} turn(s)`;
      }
      void harvestTaskOutcome(errResult, {
        runId: config.id,
        agentRole: config.role,
        assignmentId: config.assignmentId ?? undefined,
        directiveId: config.directiveId ?? undefined,
      }).catch(() => {});
      void recordRunEvent({
        runId: config.dbRunId ?? config.id,
        eventType: 'run.failed',
        trigger: 'runner.error',
        component: 'baseAgentRunner',
        payload: {
          status: errResult.status,
          error: (error as Error).message,
        },
      });
      void recordFailureTaxonomy({
        runId: config.dbRunId ?? config.id,
        agentRole: config.role,
        taskClass: taskForContext,
        failureCode: errResult.status === 'aborted' ? 'policy_deny' : 'tool_timeout',
        severity: errResult.status === 'aborted' ? 'medium' : 'high',
        detail: (error as Error).message,
      });
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
    actualModel?: string,
    actualProvider?: 'gemini' | 'openai' | 'anthropic',
  ): AgentExecutionResult {
    const stats = supervisor.stats;
    const estimatedCost = estimateCost(routing?.model ?? config.model, inputTokens, outputTokens, thinkingTokens, cachedInputTokens);
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
      cost: estimatedCost,
      estimatedCostUsd: estimatedCost,
      actualModel,
      actualProvider,
      abortReason: status === 'aborted' ? errorMsg : undefined,
      error: status === 'error' ? errorMsg : undefined,
      resultSummary: status === 'skipped_precheck' && errorMsg
        ? `Precheck skip: ${errorMsg}`
        : (status === 'completed' && output ? output.slice(0, 500) : undefined),
      reasoning: output ? extractReasoning(output) : undefined,
      conversationHistory: history,
      routingRule: routing?.routingRule,
      routingCapabilities: routing?.capabilities,
      routingModel: routing?.model,
      modelRoutingReason: routing?.modelRoutingReason,
      subtaskComplexity: routing?.subtaskComplexity,
    };
  }

  private async evaluateCompletionGate(input: {
    role: CompanyAgentRole;
    initialMessage: string;
    acceptanceCriteria: string[];
    output: string;
    actionReceipts: ActionReceipt[];
    signal: AbortSignal;
    verifyModelTier?: PlanningModelTier;
  }): Promise<{ meets: boolean; missingCriteria: string[] }> {
    try {
      const toolEvidence = input.actionReceipts
        .map((receipt, idx) => `${idx + 1}. ${receipt.tool} (${receipt.result}): ${receipt.output}`)
        .join('\n')
        .slice(0, 12_000);
      const prompt = `Evaluate whether the candidate output satisfies ALL acceptance criteria.
Return STRICT JSON only:
{
  "meets": boolean,
  "missing_criteria": ["string"]
}

Initial task:
${input.initialMessage}

Acceptance criteria:
${input.acceptanceCriteria.map((criterion, idx) => `${idx + 1}. ${criterion}`).join('\n')}

Tool evidence:
${toolEvidence || 'No tool evidence recorded.'}

Candidate output:
${input.output}`;

      const verifyTier = input.verifyModelTier ?? 'default';
      const response = await this.modelClient.generate({
        model: getTierModel(verifyTier),
        systemInstruction: 'You are a strict task verifier. Reply with JSON only.',
        contents: [{ role: 'user', content: prompt, timestamp: Date.now() }],
        tools: undefined,
        thinkingEnabled: false,
        reasoningLevel: 'none',
        signal: input.signal,
        callTimeoutMs: 120_000,
        metadata: {
          agentRole: input.role,
        },
      });
      const raw = (response.text ?? '').trim();
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsed = JSON.parse(cleaned) as { meets?: unknown; missing_criteria?: unknown };
      const meets = parsed.meets === true;
      const missingCriteria = Array.isArray(parsed.missing_criteria)
        ? parsed.missing_criteria.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
        : [];
      return { meets, missingCriteria };
    } catch {
      // Fail-open to avoid deadlocking runs if the verifier cannot parse or call a model.
      return { meets: true, missingCriteria: [] };
    }
  }
}
