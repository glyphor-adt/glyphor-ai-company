/**
 * Company Agent Runner — Core Execution Loop
 *
 * Ported from the prior internal runtime baseline and adapted for company agents.
 * Loop: supervisor check → context injection → model call → tool dispatch → loop
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ModelClient, detectProvider } from './modelClient.js';
import { ToolExecutor } from './toolExecutor.js';
import { loadDynamicToolDeclarations } from './dynamicToolExecutor.js';
import { AgentSupervisor } from './supervisor.js';
import { extractReasoning, REASONING_PROMPT_SUFFIX } from './reasoning.js';
import { isOfficeDocument, extractDocumentText } from './documentExtractor.js';
import type { GlyphorEventBus } from './glyphorEventBus.js';
import type { JitContextRetriever, JitContext } from './jitContextRetriever.js';
import type { ReasoningEngine, ReasoningResult } from './reasoningEngine.js';
import type {
  AgentConfig,
  AgentEvent,
  AgentExecutionResult,
  AgentMemory,
  AgentReflection,
  CompanyAgentRole,
  ConversationAttachment,
  ConversationTurn,
  IMemoryBus,
  ToolRetrievalMetadataMap,
} from './types.js';
import { estimateModelCost } from '@glyphor/shared/models';
import { getTierModel } from '@glyphor/shared';
import { systemQuery } from '@glyphor/shared/db';
import { extractTaskFromConfigId } from './taskIdentity.js';
import { composeModelContext } from './context/contextComposer.js';
import { extractAcceptanceCriteriaFromMessage, parseExecutionPlan } from './executionPlanning.js';
import { buildToolTaskContext, getToolRetriever, type ToolRetrieverTrace } from './routing/toolRetriever.js';
import { runDeterministicPreCheck } from './routing/index.js';
import type { RoutingDecision } from './routing/index.js';
import type { TrustScorer } from './trustScorer.js';
import { determineVerificationTier, type VerificationDecision } from './verificationPolicy.js';
import { compareSubtaskComplexity, routeSubtask, type SubtaskComplexity } from './subtaskRouter.js';
import { learnFromAgentRun } from './skillLearning.js';
import { readWorldState, writeWorldState, formatWorldStateForPrompt } from './worldStateClient.js';
import { AGENT_WORLD_STATE_KEYS, AGENT_WORLD_STATE_DOMAIN } from './worldStateKeys.js';
import { resolveUpstreamContext } from './dependencyResolver.js';
import { extractDashboardChatEmbedsFromHistory } from './dashboardChatEmbeds.js';
import { shouldUseClientSideHistoryCompression } from './compaction.js';
import { resolvePlanningPolicy, type PlanningModelTier } from './planningPolicy.js';
import { maybeConsolidate } from './memory/consolidationTrigger.js';
import { ConcurrentToolExecutor, shouldUseConcurrentExecution, type ToolCallEntry } from './concurrentToolExecutor.js';
import type { RequestSource } from './providers/types.js';
import type {
  SessionMemoryStore,
  SessionMemoryUpdater,
} from './memory/sessionMemoryUpdater.js';
import { isSummaryFirstCompactionEnabled } from './memory/sessionMemoryUpdater.js';
import {
  TOOL_CATEGORY_HINT,
  shouldUseAnthropicToolSearch,
  shouldUseOpenAIToolSearch,
} from './toolSearchConfig.js';
import { recordRunEvent } from './telemetry/runLedger.js';
import {
  CONVERSATION_MODE,
  CHAT_REASONING_PROTOCOL,
  CHAT_DATA_HONESTY,
  REASONING_PROTOCOL,
  DATA_GROUNDING_PROTOCOL,
  ACTION_HONESTY_PROTOCOL,
  EXTERNAL_COMMUNICATION_PROTOCOL,
  TEAMS_COMMUNICATION_PROTOCOL,
  INSTRUCTION_ECHO_PROTOCOL,
  WORK_ASSIGNMENTS_PROTOCOL,
  ALWAYS_ON_PROTOCOL,
  COLLABORATION_PROTOCOL,
  EXECUTIVE_ORCHESTRATION_PROTOCOL,
  ANTI_PATTERNS,
  COST_AWARENESS_BLOCK,
} from './prompts/behavioralRules.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DB_RUN_ID_TURN_PREFIX = '__db_run_id__:';
const PLANNING_REQUEST_MARKER = '__planning_request__';
const PLANNING_REPAIR_MARKER = '__planning_repair__';
const EXECUTION_GATE_NUDGE_MARKER = '__completion_gate_nudge__';
const EXECUTION_GATE_AUTO_REPAIR_MARKER = '__completion_gate_auto_repair__';

// ─── THINKING CONFIG — Task-level override ─────────────────────
// Controls whether the model uses extended thinking per task type.
// on_demand (chat) uses dynamic classification — simple questions skip
// thinking for speed; complex questions enable it for quality.
// Heavy scheduled tasks always enable thinking.

const THINKING_DISABLED_TASKS = new Set<string>([
  // on_demand is intentionally NOT here — it uses dynamic classification
]);

const THINKING_ENABLED_TASKS = new Set([
  'morning_briefing',
  'eod_summary',
  'midday_digest',
  'orchestrate',
  'daily_cost_check',
  'weekly_usage_analysis',
  'weekly_content_planning',
]);

/** 5 min per-model-call timeout for all calls.
 *  GPT-5-mini with 128+ tools can take > 90 s — let API calls
 *  run to completion rather than timing out prematurely. */
const ON_DEMAND_CALL_TIMEOUT_MS = 300_000;
const THINKING_CALL_TIMEOUT_MS = 300_000;

/** Approximate per-token pricing (USD) — uses centralized model registry. */

function estimateCost(model: string, inputTokens: number, outputTokens: number, thinkingTokens = 0, cachedInputTokens = 0): number {
  return estimateModelCost(model, inputTokens, outputTokens, thinkingTokens, cachedInputTokens);
}

function summarizeRunOutput(output: string | null, fallback: string): string {
  if (!output) return fallback;
  const normalized = output.replace(/\s+/g, ' ').trim();
  if (!normalized) return fallback;
  const sentence = normalized.split(/(?<=[.!?])\s+/)[0] ?? normalized;
  return sentence.slice(0, 600);
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
  /** Defaults to agent.run.completed */
  auditAction?: string;
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
        entry.auditAction ?? 'agent.run.completed',
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
    console.warn(`[CompanyAgentRunner] Failed to persist run metrics audit log for ${entry.agentRole}:`, (err as Error).message);
  }
}

/** Overall supervisor limits for on_demand (chat).
 *  Must exceed TOOL_VERY_LONG_TIMEOUT_MS (default 900s) so invoke_web_build / coding_loop can finish.
 *  Dashboard/client may need a matching HTTP timeout for long builds. Override: ON_DEMAND_SUPERVISOR_TIMEOUT_MS.
 */
const ON_DEMAND_MAX_TURNS = 12;
const ON_DEMAND_SUPERVISOR_TIMEOUT_MS = Math.max(120_000, Number(process.env.ON_DEMAND_SUPERVISOR_TIMEOUT_MS ?? '960000'));
const ON_DEMAND_THINKING_SUPERVISOR_TIMEOUT_MS = Math.max(120_000, Number(process.env.ON_DEMAND_THINKING_SUPERVISOR_TIMEOUT_MS ?? '960000'));
/** When the model returns tool calls with no visible text, chat UIs show only a spinner until /run completes — inject this first. */
const ON_DEMAND_TOOL_ONLY_ACK =
  "Thanks — I'm on it. I'm working on this now. If I'm generating a live site or preview, that can take several minutes — I'll share the link here as soon as it's ready.";

const CHIEF_OF_STAFF_REFLECTION_PROMPT = `
You are reflecting on your recent orchestration performance as Chief of Staff.
You must be CRITICAL and HONEST. Self-congratulation is a failure mode.

## What to evaluate

For each orchestration cycle in the review window, assess:

### 1. Dispatch quality
- Did the agents you dispatched have everything they needed?
- Were briefs complete, unambiguous, and correctly scoped?
- Did any agent produce work that missed the mark because of your brief?

### 2. Escalation routing
- Did any tool gap requests reach the founders that should have gone to Nexus?
- Did any approval requests reach founders that you should have resolved?
- Did any agent request creation of a new agent that you failed to intercept?

### 3. Context accuracy
- Did you include any incorrect or stale context in dispatches?
- Did any downstream agent act on wrong information you provided?

### 4. Founder rejection signals (CRITICAL)
- Count every approval that was REJECTED in the review window
- For each rejection: was the root cause your dispatch, brief, or routing?
- A founder rejection of a downstream request you initiated is YOUR failure

### 5. Prediction accuracy
- Review any predictions you made about task outcomes
- Were they accurate? Record misses explicitly

## How to score weaknesses

A weakness must be recorded when ANY of the following occurred:
- A founder rejected an approval that originated from your orchestration
- A downstream agent created work that was off-brief due to context you provided
- A tool gap reached founders instead of Nexus
- An agent requested creation of a new agent on your watch
- You dispatched with missing or incorrect assets

Do NOT record a strength unless you have external evidence it went well —
not just that the run completed.

## Required output format

{
  "strengths": [
    {
      "skill": "skill_name",
      "evidence": "specific external evidence — not self-assessment",
      "confidence": 0.0-1.0
    }
  ],
  "weaknesses": [
    {
      "skill": "skill_name",
      "evidence": "what specifically went wrong and why",
      "improvement_goal": "what you will do differently"
    }
  ],
  "prediction_accuracy": {
    "predictions_made": 0,
    "predictions_correct": 0,
    "misses": ["description of each miss"]
  },
  "founder_rejections": {
    "count": 0,
    "root_causes": ["description of each"]
  }
}
`;

/** Task tier (work_loop) — narrow executor with tight limits.
 *  Research/account agents need multi-step tool calls (each = 2 turns),
 *  so 10 is too tight — raised to 20 for headroom. */
const TASK_TIER_MAX_TURNS = 20;
const TASK_TIER_TIMEOUT_MS = 600_000;
const TASK_TIER_CALL_TIMEOUT_MS = 300_000;

/** Scheduled tasks with thinking enabled get generous limits. */
const SCHEDULED_THINKING_TIMEOUT_MS = 900_000;
const SCHEDULED_CALL_TIMEOUT_MS = 300_000;
const CONTEXT_COMPOSER_MAX_TOKENS = 12_000;
const CONTEXT_COMPOSER_MAX_TOKENS_PROVIDER = 24_000;
/** Extra compose budget when `quick_demo_web_app` returned — full HTML JSON was clipped and the model had no artifact to show. */
const CONTEXT_COMPOSER_QUICK_DEMO_EXTRA = 30_000;

function historyHasSuccessfulQuickDemoWebApp(history: ConversationTurn[]): boolean {
  return history.some(
    (t) =>
      t.role === 'tool_result'
      && t.toolName === 'quick_demo_web_app'
      && t.toolResult?.success === true,
  );
}

// ─── TIERED CONTEXT LOADING ───────────────────────────────────
// light  → on_demand/chat: profile + pending messages + working memory only
// task   → work_loop: personality + tools + assignment only (narrow executor)
// standard → most scheduled tasks: adds KB + brief
// full   → briefing, orchestrate, deep analysis: everything including CI, graph, skills

type ContextTier = 'light' | 'task' | 'standard' | 'full';

// ─── DYNAMIC THINKING CLASSIFIER ──────────────────────────────
// Default: thinking ON for on_demand chat. Agents should reason through
// every request unless it's a trivially simple greeting/ack. The cost
// of reasoning on a simple message is negligible compared to the
// cost of giving a shallow answer on a complex one.

const TRIVIAL_PATTERNS = /^(hi|hey|hello|thanks|thank you|ok|okay|sure|yes|no|got it|cool|nice|bye|good morning|good night|gm|gn|\p{Extended_Pictographic}+)\s*[.!?]?$/iu;

function needsThinking(message: string): boolean {
  // Very short messages (< 10 chars) are almost always greetings/acks
  if (message.length < 10) return false;
  // Known trivial patterns — skip thinking for simple acks/greetings
  if (TRIVIAL_PATTERNS.test(message.trim())) return false;
  // Everything else benefits from reasoning
  return true;
}

const FULL_CONTEXT_TASKS = new Set([
  'morning_briefing',
  'eod_summary',
  'midday_digest',
  'orchestrate',
  'weekly_usage_analysis',
  'weekly_content_planning',
]);

/** Regex: if an on_demand message matches these, auto-upgrade from light → standard. */
const TASK_KEYWORDS = /\b(report|analys[ei]s|briefing|review|strategy|budget|cost|revenue|metric|quarterly|monthly|roadmap|competitive|pricing|audit|campaign|pipeline)\b/i;

function resolveContextTier(role: CompanyAgentRole, task: string, message: string): ContextTier {
  // CoS must retain identity/relationship context even during task-loop execution.
  if (role === 'chief-of-staff' && task === 'work_loop') return 'standard';

  if (FULL_CONTEXT_TASKS.has(task)) return 'full';
  if (task === 'work_loop') return 'task';
  if (task === 'on_demand') {
    return TASK_KEYWORDS.test(message) ? 'standard' : 'light';
  }
  return 'standard';
}

// ─── PROMPT CACHE — In-memory TTL cache ──────────────────────
// Avoids re-fetching KB, profiles, and briefs for every run.
// 5-minute TTL; invalidated via POST /cache/invalidate.

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

class PromptCache {
  private store = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  invalidate(prefix?: string): void {
    if (!prefix) {
      this.store.clear();
      return;
    }
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }
}

/** Shared prompt cache instance — importable by server.ts for invalidation. */
export const promptCache = new PromptCache();

/** Extract the task segment from a run ID like "cto-on_demand-2026-02-24". */
function extractTask(configId: string): string {
  return extractTaskFromConfigId(configId);
}

const ROLE_TO_BRIEF: Record<CompanyAgentRole, string> = {
  'chief-of-staff': 'sarah-chen',
  'cto': 'marcus-reeves',
  'cfo': 'nadia-okafor',
  'clo': 'victoria-chase',
  'cpo': 'elena-vasquez',
  'cmo': 'maya-brooks',
  'vp-sales': 'rachel-kim',
  'vp-design': 'mia-tanaka',
  // Sub-team members
  'platform-engineer': 'alex-park',
  'quality-engineer': 'sam-deluca',
  'devops-engineer': 'jordan-hayes',
  'user-researcher': 'priya-sharma',
  'competitive-intel': 'daniel-ortiz',
  'content-creator': 'tyler-reed',
  'seo-analyst': 'lisa-chen',
  'social-media-manager': 'kai-johnson',
  'ui-ux-designer': 'leo-vargas',
  'frontend-engineer': 'ava-chen',
  'design-critic': 'sofia-marchetti',
  'template-architect': 'ryan-park',
  'm365-admin': 'riley-morgan',
  'global-admin': 'morgan-blake',
  'ops': 'atlas-vega',
  // Research & Intelligence
  'vp-research': 'sophia-lin',
  'competitive-research-analyst': 'lena-park',
  'market-research-analyst': 'daniel-okafor',
  'head-of-hr': 'jasmine-rivera',
  'bob-the-tax-pro': 'robert-finley',
  'marketing-intelligence-analyst': 'zara-petrov',
  'adi-rose': 'adi-rose',
  'platform-intel': 'nexus',
};

/** Maps roles to their department for knowledge base audience targeting. */
const ROLE_DEPARTMENT: Record<string, string> = {
  'chief-of-staff': 'operations',
  'ops': 'operations',
  'cto': 'engineering',
  'cpo': 'product',
  'platform-engineer': 'engineering',
  'quality-engineer': 'engineering',
  'devops-engineer': 'engineering',
  'm365-admin': 'engineering',
  'cfo': 'finance',
  'clo': 'legal',
  'bob-the-tax-pro': 'legal',
  'cmo': 'marketing',
  'content-creator': 'marketing',
  'seo-analyst': 'marketing',
  'social-media-manager': 'marketing',
  'vp-sales': 'sales',
  'vp-design': 'design',
  'vp-research': 'research',
  'competitive-research-analyst': 'research',
  'market-research-analyst': 'research',
  'user-researcher': 'product',
  'competitive-intel': 'product',
  'ui-ux-designer': 'design',
  'frontend-engineer': 'design',
  'design-critic': 'design',
  'template-architect': 'design',
  'global-admin': 'operations',
  'marketing-intelligence-analyst': 'marketing',
  'adi-rose': 'operations',
  'platform-intel': 'operations',
  'head-of-hr': 'operations',
};

/** Maps roles to their department context files. */
const ROLE_CONTEXT_FILES: Record<string, string[]> = {
  'chief-of-staff': ['operations.md'],
  'ops': ['operations.md'],
  'cto': ['engineering.md'],
  'cpo': ['product.md'],
  'platform-engineer': ['engineering.md'],
  'quality-engineer': ['engineering.md'],
  'devops-engineer': ['engineering.md'],
  'm365-admin': ['engineering.md'],
  'cfo': ['finance.md'],
  'clo': ['legal.md'],
  'bob-the-tax-pro': ['legal.md'],
  'cmo': ['marketing.md'],
  'content-creator': ['marketing.md'],
  'seo-analyst': ['marketing.md'],
  'social-media-manager': ['marketing.md'],
  'vp-sales': ['sales-cs.md'],
  'vp-design': ['design.md'],
  'vp-research': ['research.md'],
  'competitive-research-analyst': ['research.md'],
  'market-research-analyst': ['research.md'],
  'user-researcher': ['product.md'],
  'competitive-intel': ['product.md'],
  'ui-ux-designer': ['design.md'],
  'frontend-engineer': ['design.md', 'engineering.md'],
  'design-critic': ['design.md'],
  'template-architect': ['design.md'],
  'global-admin': ['operations.md'],
  'marketing-intelligence-analyst': ['marketing.md'],
  'adi-rose': ['operations.md'],
  'platform-intel': ['operations.md'],
  'head-of-hr': ['operations.md'],
};

/** Profile data loaded from agent_profiles table. */
export interface AgentProfileData {
  personality_summary: string | null;
  backstory: string | null;
  communication_traits: string[] | null;
  quirks: string[] | null;
  tone_formality: number | null;
  emoji_usage: number | null;
  verbosity: number | null;
  voice_sample: string | null;
  signature: string | null;
  voice_examples: { situation: string; response: string }[] | null;
  anti_patterns: { never: string; instead: string }[] | null;
  working_voice: string | null;
  department?: string | null;
}

/** Roles that report directly to chief-of-staff and manage their own teams */
const EXECUTIVE_ROLES = new Set([
  'cto', 'cpo', 'cmo', 'cfo', 'clo',
  'vp-sales', 'vp-design', 'vp-research',
]);

/** Build a dynamic orchestration protocol section from DB-driven config. */
function buildDynamicExecutiveOrchestrationProtocol(
  role: string,
  config: { can_decompose: boolean; can_evaluate: boolean; allowed_assignees: string[]; max_assignments_per_directive: number },
): string {
  return `
## EXECUTIVE ORCHESTRATION PROTOCOL — DYNAMIC

You have been delegated a directive by Sarah (Chief of Staff). As the domain expert
for this work, you are responsible for decomposing it into assignments for your team.

YOUR TEAM (you can ONLY assign work to these agents):
${config.allowed_assignees.map(a => `- ${a}`).join('\n')}

DECOMPOSITION RULES:
1. Each assignment must be atomic — one clear task with one clear deliverable.
2. Each assignment must contain ALL context the agent needs. Your team members run
   with minimal ~150-line system prompts and no access to the knowledge base.
   Embed the "why", the data, the constraints, and the expected format.
3. Check tool requirements — use check_team_status to verify agents have the tools
   they need.
4. Set dependencies correctly — if Assignment B needs output from Assignment A,
   specify depends_on so they execute in the right order.
5. Max ${config.max_assignments_per_directive} assignments per directive.

${config.can_evaluate ? `EVALUATION RULES:
- Review each completed assignment for domain quality, not just completeness.
- Accept first-time if the work is genuinely good. Don't revise for style preferences.
- When revising, give specific, actionable feedback.
- After all assignments complete, synthesize a department deliverable for Sarah.
` : `EVALUATION: Sarah will evaluate your team's outputs. Focus on decomposition quality.`}

NEVER:
- Assign work to agents outside your team
- Modify another department's assignments or outputs
- Call assignee-only tools (\`submit_assignment_output\`, \`flag_assignment_blocker\`) on assignments owned by someone else
- Skip the synthesis step — Sarah needs a coherent deliverable, not raw fragments
`;
}

function buildPersonalityBlock(profile: AgentProfileData): string {
  const parts: string[] = ['## WHO YOU ARE\n'];

  // 1. Voice Monologue — the primary personality driver
  if (profile.personality_summary) {
    parts.push(profile.personality_summary);
    parts.push('');
  }

  // 2. Voice calibration examples (few-shot)
  if (profile.voice_examples?.length) {
    parts.push('**Voice calibration examples — match this tone (STYLE ONLY — all numbers, users, metrics, and scenarios in these examples are FICTIONAL placeholders showing communication style. Do NOT treat them as real data or current company state):**');
    for (const ex of profile.voice_examples) {
      parts.push(`\nSituation: ${ex.situation}`);
      parts.push(`Response: ${ex.response}`);
    }
    parts.push('');
  }

  // 3. Role-specific anti-patterns ("never say X, say Y")
  if (profile.anti_patterns?.length) {
    parts.push('**THINGS YOU NEVER SAY:**');
    for (const ap of profile.anti_patterns) {
      parts.push(`- Never: "${ap.never}"`);
      parts.push(`  Instead: "${ap.instead}"`);
    }
    parts.push('');
  }

  // 4. Generic anti-patterns
  parts.push('**ANTI-PATTERNS — never do these:**');
  for (const ap of ANTI_PATTERNS) parts.push(`- ${ap}`);
  parts.push('');

  // 5. Signature sign-off
  if (profile.signature) {
    parts.push(`**Signature sign-off:** ${profile.signature}`);
    parts.push('');
  }

  return parts.join('\n');
}

function buildSkillBlock(skillContext: SkillContext): string {
  const parts: string[] = ['## YOUR SKILLS\n'];
  parts.push('These are the skills activated for this task. Follow the methodology precisely.\n');

  for (const skill of skillContext.skills) {
    parts.push(`### ${skill.name} (${skill.proficiency})`);
    parts.push(`Category: ${skill.category}`);
    parts.push(`\n**Methodology:**\n${skill.methodology}`);

    if (skill.learned_refinements.length > 0) {
      parts.push('\n**Your learned refinements (from past runs):**');
      for (const r of skill.learned_refinements) parts.push(`- ${r}`);
    }

    if (skill.failure_modes.length > 0) {
      parts.push('\n**Known failure modes (avoid these):**');
      for (const f of skill.failure_modes) parts.push(`- [!] ${f}`);
    }

    if (skill.tools_granted.length > 0) {
      parts.push(`\nTools available: ${skill.tools_granted.join(', ')}`);
    }
    parts.push('');
  }

  return parts.join('\n');
}

function buildCanonicalDoctrineBlock(doctrineContext: string): string {
  return [
    '## Canonical Company Doctrine (Source of Truth)',
    'Apply these doctrine constraints consistently across all reasoning, recommendations, and outputs.',
    'If any role prompt, stale brief, message, or memory conflicts with this doctrine, follow this doctrine.',
    '',
    doctrineContext,
  ].join('\n');
}

function buildSystemPrompt(
  role: CompanyAgentRole,
  existingPrompt: string,
  dynamicBrief?: string,
  profile?: AgentProfileData | null,
  skillContext?: SkillContext | null,
  dbKnowledgeBase?: string | null,
  bulletinContext?: string | null,
  isOnDemand = false,
  orchestrationConfig?: { can_decompose: boolean; can_evaluate: boolean; allowed_assignees: string[]; max_assignments_per_directive: number } | null,
  hasDelegatedDirective = false,
  model?: string,
  doctrineContext?: string | null,
): string {
  try {
    const knowledgeDir = join(__dirname, '../../company-knowledge');

    // On-demand chat uses a slim prompt — skip heavy DB KB and department
    // context files, but always include CORE.md so agents can answer basic
    // company identity questions (legal name, EIN, address, billing IDs).
    let companyKnowledgeBase = '';
    let departmentContext = '';
    if (!isOnDemand) {
      if (dbKnowledgeBase) {
        companyKnowledgeBase = dbKnowledgeBase;
      } else {
        try {
          companyKnowledgeBase = readFileSync(join(knowledgeDir, 'CORE.md'), 'utf-8');
        } catch {
          companyKnowledgeBase = readFileSync(join(knowledgeDir, 'COMPANY_KNOWLEDGE_BASE.md'), 'utf-8');
        }
      }

      // Load department-specific context (still file-based — rarely changes)
      const contextFiles = ROLE_CONTEXT_FILES[role] ?? [];
      const contextBlocks: string[] = [];
      for (const file of contextFiles) {
        try {
          contextBlocks.push(readFileSync(join(knowledgeDir, 'context', file), 'utf-8'));
        } catch {
          // Context file missing — not critical
        }
      }
      departmentContext = contextBlocks.join('\n\n---\n\n');
    } else {
      // On-demand: still load core company facts (lightweight file read)
      try {
        companyKnowledgeBase = readFileSync(join(knowledgeDir, 'CORE.md'), 'utf-8');
      } catch {
        // CORE.md missing — not critical
      }
    }

    // If a DB system prompt override exists (from dashboard edits), use it
    // instead of the code-defined prompt
    let effectivePrompt = dynamicBrief ?? existingPrompt;

    // For on_demand chat, replace the heavy REASONING_PROMPT_SUFFIX with
    // a chat-appropriate data honesty rule. We keep anti-hallucination
    // constraints but drop the XML reasoning block requirement.
    if (isOnDemand && effectivePrompt.includes('Data Honesty')) {
      effectivePrompt = effectivePrompt.replace(REASONING_PROMPT_SUFFIX, '');
    }

    // Skip the heavy role brief for on_demand chat — the agent's system
    // prompt already defines their role sufficiently for conversations.
    let roleBrief = '';
    if (!isOnDemand) {
      const briefId = ROLE_TO_BRIEF[role];
      if (briefId) {
        try {
          roleBrief = readFileSync(
            join(__dirname, `../../company-knowledge/briefs/${briefId}.md`), 'utf-8',
          );
        } catch {
          // Brief file missing — not critical
        }
      }
    }

    const parts: string[] = [];
    const components: string[] = [];

    if (companyKnowledgeBase) {
      parts.push(companyKnowledgeBase);
      components.push('kb');
    }

    if (doctrineContext?.trim()) {
      parts.push(buildCanonicalDoctrineBlock(doctrineContext));
      components.push('doctrine');
    }

    parts.push(CONVERSATION_MODE);
    components.push('conversation_mode');

    // For on_demand chat, use a lightweight reasoning protocol focused on
    // intent classification and tool planning, plus chat-specific data
    // honesty rules to prevent hallucination.
    if (isOnDemand) {
      parts.push(CHAT_REASONING_PROTOCOL);
      parts.push(CHAT_DATA_HONESTY);
      parts.push(ACTION_HONESTY_PROTOCOL);
      parts.push(EXTERNAL_COMMUNICATION_PROTOCOL);
      parts.push(TEAMS_COMMUNICATION_PROTOCOL);
      parts.push(INSTRUCTION_ECHO_PROTOCOL);
      components.push('chat_protocols');
    } else {
      parts.push(REASONING_PROTOCOL);
      parts.push(DATA_GROUNDING_PROTOCOL);
      parts.push(ACTION_HONESTY_PROTOCOL);
      parts.push(EXTERNAL_COMMUNICATION_PROTOCOL);
      parts.push(WORK_ASSIGNMENTS_PROTOCOL);
      parts.push(ALWAYS_ON_PROTOCOL);
      parts.push(COLLABORATION_PROTOCOL);
      components.push('behavioral_rules');
      if (EXECUTIVE_ROLES.has(role)) {
        parts.push(EXECUTIVE_ORCHESTRATION_PROTOCOL);
        components.push('exec_orchestration');
      }
      // Inject dynamic orchestration protocol when a delegated directive is in context
      if (orchestrationConfig?.can_decompose && hasDelegatedDirective) {
        parts.push(buildDynamicExecutiveOrchestrationProtocol(role, orchestrationConfig));
        components.push('dynamic_orchestration');
      }
    }

    if (departmentContext) {
      parts.push(departmentContext);
      components.push('dept_context');
    }
    if (roleBrief) {
      parts.push(roleBrief);
      components.push('role_brief');
    }
    parts.push(effectivePrompt);
    components.push('role_prompt');

    if (profile) {
      parts.push(buildPersonalityBlock(profile));
      components.push('personality');
    }

    const now = new Date();
    const centralTime = now.toLocaleString('en-US', {
      timeZone: 'America/Chicago',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    parts.push(`Current date and time: ${centralTime} CT (US Central Time). Always report times in US Central Time.`);

    if (skillContext && skillContext.skills.length > 0) {
      parts.push(buildSkillBlock(skillContext));
      components.push('skill:' + skillContext.skills.map(s => s.name).join(','));
    }
    // Founder bulletins removed from system prompts — agents receive
    // Layer 1 doctrine via KB injection (doctrineContext) instead.
    if (model?.startsWith('gpt-5.4')) {
      parts.push('Before you call a tool, explain why you are calling it.');
    }

    if (model && (shouldUseAnthropicToolSearch(model) || shouldUseOpenAIToolSearch(model))) {
      parts.push(TOOL_CATEGORY_HINT);
      components.push('tool_category_hint');
    }

    const assembled = parts.join('\n\n---\n\n');
    // Estimate tokens at ~4 chars/token (conservative for English text)
    const tokenEstimate = Math.ceil(assembled.length / 4);
    console.log(JSON.stringify({
      event: 'prompt_assembled',
      agent: role,
      components,
      prompt_chars: assembled.length,
      prompt_token_estimate: tokenEstimate,
    }));
    return assembled;
  } catch (err) {
    console.warn(`[CompanyAgentRunner] Failed to load knowledge files for ${role}:`, (err as Error).message);
    if (dynamicBrief) {
      return `${dynamicBrief}\n\n---\n\n${existingPrompt}`;
    }
    return existingPrompt;
  }
}

/**
 * Build a minimal system prompt for the 'task' context tier.
 * Only includes personality + work protocol + cost awareness + core company facts.
 * No brief, no memories, no reasoning protocol, no skills.
 */
function buildTaskTierSystemPrompt(
  profile: AgentProfileData | null,
  doctrineContext?: string | null,
): string {
  const parts: string[] = [];

  // Always include core company facts — agents need basic identity info
  // (legal name, address, billing IDs) even in narrow task execution.
  try {
    const knowledgeDir = join(__dirname, '../../company-knowledge');
    const coreKB = readFileSync(join(knowledgeDir, 'CORE.md'), 'utf-8');
    parts.push(coreKB);
  } catch {
    // CORE.md missing — not critical, continue without it
  }

  if (doctrineContext?.trim()) {
    parts.push(buildCanonicalDoctrineBlock(doctrineContext));
  }

  parts.push(`## Your Assignment
Execute the task described in the user message below. Use your tools to gather data and produce results as instructed.

## Work Protocol
1. **Preflight:** Read the assignment. Confirm you have the tools and data access needed. If a tool is denied, call \`request_tool_access\` to self-grant it (read-only tools approve instantly), then retry.
2. **Plan:** Break the task into steps. Identify which tools to call, in what order.
3. **Execute:** Gather data and produce results as instructed.
4. **Submit:** Call submit_assignment_output with your complete findings.

- If blocked after 2 failed attempts: call flag_assignment_blocker immediately
- Do NOT search for additional context beyond what's in your instructions
- Do NOT investigate tangential issues — focus only on what's assigned
- If a tool call returns empty data, note it and move on — don't retry with variations`);

  parts.push(DATA_GROUNDING_PROTOCOL);
  parts.push(COST_AWARENESS_BLOCK);

  if (profile) {
    if (profile.working_voice) {
      const voiceParts: string[] = ['## WHO YOU ARE\n'];
      voiceParts.push('YOUR VOICE (even when heads-down on a task):');
      voiceParts.push(profile.working_voice);
      voiceParts.push('');
      voiceParts.push('FORMAT: Match this voice in your output. No corporate filler. No AI self-reference.');
      voiceParts.push('Be specific. Use real numbers, names, and details.');
      if (profile.anti_patterns?.length) {
        voiceParts.push('');
        voiceParts.push('**THINGS YOU NEVER SAY:**');
        for (const ap of profile.anti_patterns) {
          voiceParts.push(`- Never: "${ap.never}"`);
          voiceParts.push(`  Instead: "${ap.instead}"`);
        }
      }
      if (profile.signature) voiceParts.push('', `**Sign-off:** ${profile.signature}`);
      parts.push(voiceParts.join('\n'));
    } else {
      parts.push(buildPersonalityBlock(profile));
    }
  }

  return parts.join('\n\n---\n\n');
}

/**
 * Optional store interface for memory/reflection persistence.
 * Matches CompanyMemoryStore methods without a hard dependency.
 */
export interface AgentMemoryStore {
  getMemories(role: CompanyAgentRole, options?: { limit?: number }): Promise<AgentMemory[]>;
  getReflections(role: CompanyAgentRole, limit?: number): Promise<AgentReflection[]>;
  saveMemory(memory: Omit<AgentMemory, 'id' | 'createdAt'>): Promise<string>;
  saveMemoryWithEmbedding?(memory: Omit<AgentMemory, 'id' | 'createdAt'>): Promise<string>;
  searchMemoriesBySimilarity?(role: CompanyAgentRole, query: string, options?: { limit?: number; threshold?: number }): Promise<(AgentMemory & { similarity: number })[]>;
  saveReflection(reflection: Omit<AgentReflection, 'id' | 'createdAt'>): Promise<string>;
  savePeerFeedback?(feedback: { fromAgent: string; toAgent: string; feedback: string; context: string; sentiment: string }): Promise<void>;
  updateGrowthMetrics?(role: CompanyAgentRole): Promise<void>;
  saveLastRunSummary?(role: string, summary: string): Promise<void>;
}

/** Optional graph writer for persisting knowledge graph operations from reflections. */
export interface GraphOpsWriter {
  processGraphOps(agentId: string, runId: string, ops: { nodes: unknown[]; edges: unknown[] }): Promise<{ nodesCreated: number; edgesCreated: number }>;
}

/** Skill context returned by the skill loader for injection into the system prompt. */
export interface SkillContext {
  skills: {
    slug: string;
    name: string;
    category: string;
    methodology: string;
    proficiency: string;
    tools_granted: string[];
    learned_refinements: string[];
    failure_modes: string[];
  }[];
}

/** Post-reflection skill feedback for updating proficiency and learnings. */
export interface SkillFeedback {
  skill_slug: string;
  outcome: 'success' | 'partial' | 'failure';
  refinement?: string;
  failure_mode?: string;
}

export interface RunDependencies {
  glyphorEventBus?: GlyphorEventBus;
  agentMemoryStore?: AgentMemoryStore;
  /** Loader for DB-stored briefs (dynamic agents without file-based briefs). */
  dynamicBriefLoader?: (agentRole: string) => Promise<string | null>;
  /** Loader for agent personality profile from agent_profiles table. */
  agentProfileLoader?: (role: CompanyAgentRole) => Promise<AgentProfileData | null>;
  /** Loader for pending inter-agent messages. */
  pendingMessageLoader?: (role: CompanyAgentRole) => Promise<{ id: string; from_agent: string; message: string; message_type: string; priority: string; thread_id: string; created_at: string }[]>;
  /** Loader for collective intelligence context (pulse + org knowledge + knowledge inbox). */
  collectiveIntelligenceLoader?: (role: CompanyAgentRole) => Promise<string | null>;
  /** Called after reflection to route new knowledge to relevant agents. */
  knowledgeRouter?: (knowledge: { agent_id: string; content: string; tags: string[]; knowledge_type?: string }) => Promise<number>;
  /** Loader for the agent's last-run summary (working memory between runs). */
  workingMemoryLoader?: (role: CompanyAgentRole) => Promise<{ summary: string | null; lastRunAt: string | null }>;
  /** Optional: Knowledge Graph writer for persisting graph_operations from reflections. */
  graphWriter?: GraphOpsWriter;
  /** Loader for agent skill context (methodology, proficiency, refinements). */
  skillContextLoader?: (role: CompanyAgentRole, task: string) => Promise<SkillContext | null>;
  /** Updater for post-reflection skill feedback (proficiency, learnings, failures). */
  skillFeedbackWriter?: (role: CompanyAgentRole, feedback: SkillFeedback[]) => Promise<void>;
  /** Loader for company knowledge base from DB (replaces static file). */
  knowledgeBaseLoader?: (department?: string) => Promise<string>;
  /** Loader for active founder bulletins. */
  bulletinLoader?: (department?: string) => Promise<string>;
  /** Loader for canonical company doctrine shared across all agents and tiers. */
  doctrineLoader?: () => Promise<string | null>;
  /** Loader for pending work assignments assigned to this agent. */
  pendingAssignmentLoader?: (role: CompanyAgentRole) => Promise<{ id: string; task_description: string; task_type: string; expected_output: string | null; priority: string; status: string; evaluation: string | null; directive_title: string | null }[]>;
  /** Saves partial progress when a task-tier run is aborted mid-execution. */
  partialProgressSaver?: (assignmentId: string, partialOutput: string, agentRole: CompanyAgentRole, abortReason: string) => Promise<void>;
  /** Loader for executive orchestration config (directive decomposition authority). */
  orchestrationConfigLoader?: (role: CompanyAgentRole) => Promise<{ executive_role: string; can_decompose: boolean; can_evaluate: boolean; can_create_sub_directives: boolean; allowed_assignees: string[]; max_assignments_per_directive: number; requires_plan_verification: boolean; is_canary: boolean } | null>;
  /** JIT context retriever for task-aware semantic retrieval. */
  jitContextRetriever?: JitContextRetriever;
  /** Factory to create a ReasoningEngine for the current agent. */
  reasoningEngineFactory?: (agentRole: string) => Promise<ReasoningEngine | null>;
  /** Ensures an agent_world_model row exists for this agent (creates baseline if missing). */
  initializeWorldModel?: (role: CompanyAgentRole) => Promise<void>;
  /** Optional trust scorer used for routing and post-run trust adjustments. */
  trustScorer?: TrustScorer;
  /** Optional session summary persistence for cross-turn memory compaction. */
  sessionMemoryStore?: SessionMemoryStore;
  /** Optional post-turn session summary updater. */
  sessionMemoryUpdater?: SessionMemoryUpdater;
}

/**
 * Regex patterns matching future-tense planning intent — the agent is
 * describing what it *will* do, but hasn't executed any tools yet.
 * Used to nudge the agent into execution rather than ending the run.
 */
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

/** Build a per-tool retrieval metadata map from the ToolRetriever trace. */
function buildCompanyRetrievalMetadataMap(trace: ToolRetrieverTrace): ToolRetrievalMetadataMap {
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

/** Regex patterns that match common action claims in agent text. */
const ACTION_CLAIM_PATTERNS = [
  /I(?:'ve| have) (?:updated|corrected|set|changed|modified|adjusted)/gi,
  /I(?:'ve| have) (?:created|added|generated|built|established)/gi,
  /I(?:'ve| have) (?:deleted|removed|cleared|revoked)/gi,
  /I(?:'ve| have) (?:assigned|granted|dispatched|sent|submitted)/gi,
  /I(?:'ve| have) also (?:updated|corrected|set|created|deleted|assigned|fixed)/gi,
  /I just (?:updated|corrected|set|created|deleted|assigned|fixed)/gi,
];

function extractActionClaims(text: string): string[] {
  const claims: string[] = [];
  for (const pattern of ACTION_CLAIM_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) claims.push(...matches);
  }
  return claims;
}

function hasMatchingAction(
  claims: string[],
  receipts: Array<{ tool: string; result: 'success' | 'error' }>,
): string[] {
  const successfulTools = receipts.filter(r => r.result === 'success').map(r => r.tool);
  if (successfulTools.length === 0) return claims;
  // If there are successful tool calls, assume claims may be substantiated
  // Only flag if there are claims but ZERO successful mutations
  const hasMutations = successfulTools.some(t =>
    t.startsWith('update_') || t.startsWith('create_') || t.startsWith('delete_') ||
    t.startsWith('set_') || t.startsWith('assign_') || t.startsWith('grant_') ||
    t.startsWith('revoke_') || t.startsWith('dispatch_') || t.startsWith('submit_')
  );
  return hasMutations ? [] : claims;
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
    // Extract multimodal attachments from carrier turn (injected by scheduler)
    let initialAttachments: ConversationAttachment[] | undefined;
    let dbRunId: string | undefined;

    // Reset denial tracking for each new run — prevents stale escalation
    // state from a prior run leaking into a fresh execution.
    toolExecutor.resetDenialTracking();
    const cleanHistory = (config.conversationHistory ?? []).filter((t) => {
      if (t.content.startsWith(DB_RUN_ID_TURN_PREFIX)) {
        const candidate = t.content.slice(DB_RUN_ID_TURN_PREFIX.length).trim();
        dbRunId = candidate || undefined;
        return false;
      }
      if (t.content === '__multimodal_attachments__' && t.attachments?.length) {
        initialAttachments = t.attachments;
        return false; // Remove carrier turn from history
      }
      return true;
    });
    if (dbRunId) {
      config.dbRunId = config.dbRunId ?? dbRunId;
    }

    // Pre-process Office documents (.docx, .pptx, .xlsx) — extract text content
    // so providers don't pass raw binary to the LLM.
    if (initialAttachments?.length) {
      initialAttachments = await Promise.all(
        initialAttachments.map(async (att) => {
          if (isOfficeDocument(att.mimeType, att.name)) {
            const text = await extractDocumentText(att.data, att.name);
            return {
              name: att.name,
              mimeType: 'text/plain',
              data: Buffer.from(text).toString('base64'),
            };
          }
          return att;
        }),
      );
    }

    // Pre-seed with prior conversation history for multi-turn chat
    const history: ConversationTurn[] = [
      ...cleanHistory,
      { role: 'user', content: initialMessage, timestamp: Date.now(), ...(initialAttachments ? { attachments: initialAttachments } : {}) },
    ];
    const toolRunId = dbRunId ?? config.id;
    let lastTextOutput: string | null = null;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalThinkingTokens = 0;
    let totalCachedInputTokens = 0;
    let actualModelUsed: string | undefined;
    let actualProviderUsed: 'gemini' | 'openai' | 'anthropic' | undefined;

    // ─── TOOL INVENTORY LOG ──────────────────────────────────────
    // Log static tools per agent on startup for pipeline diagnostics
    const staticToolNames = toolExecutor.getToolNames();
    console.log(`[ToolInventory] ${config.role} (${config.id}): ${staticToolNames.length} tools loaded`);
    if (staticToolNames.length === 0) {
      console.warn(`[ToolInventory] WARNING: ${config.role} has ZERO tools — check run.ts wiring`);
    }
    try {
      await getToolRetriever().warm(toolExecutor.getDeclarations());
    } catch (err) {
      console.warn(`[ToolRetriever] Warm-up failed for ${config.role}:`, (err as Error).message);
    }

    // ─── AUTO-SYNC GRANTS ──────────────────────────────────────
    // Sync static tools to agent_tool_grants so list_my_tools and
    // check_tool_access return accurate data from the first tool call.
    if (staticToolNames.length > 0) {
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
          [config.role, staticToolNames],
        );
        const values = staticToolNames.map((_, i) =>
          `($1, $${i + 2}, 'system', 'auto-synced from static tool array', NOW())`
        ).join(', ');
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
           [config.role, ...staticToolNames],
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

    // ─── PARALLEL PRE-RUN DATA LOADING ────────────────────────
    // Tiered loading: light (chat) → task (work_loop) → standard (scheduled) → full (briefing/orchestrate)
    // light:    profile + pending messages + working memory
    // task:     profile + pending messages + assignments (no KB, no brief, no memories)
    // standard: + KB + brief + memories
    // full:     + memories + CI + graph + skills
    let dynamicBrief: string | undefined;
    let agentProfile: AgentProfileData | null = null;
    let skillContext: SkillContext | null = null;
    let dbKnowledgeBase: string | null = null;
    let bulletinContext: string | null = null;
    let doctrineContext: string | null = null;
    let jitContext: JitContext | null = null;
    let routingDepartment: string | undefined;
    let orchestrationConfig: { executive_role: string; can_decompose: boolean; can_evaluate: boolean; can_create_sub_directives: boolean; allowed_assignees: string[]; max_assignments_per_directive: number; requires_plan_verification: boolean; is_canary: boolean } | null = null;
    let hasDelegatedDirective = false;

    {
      const task = extractTask(config.id);
      const tier = resolveContextTier(config.role, task, initialMessage);

      // Memory retrieval — standard+ only (skip for light and task tiers)
      const memoryPromise = (tier !== 'light' && tier !== 'task' && deps?.agentMemoryStore)
        ? (async () => {
            const fetches: [Promise<AgentMemory[]>, Promise<AgentReflection[]>, Promise<(AgentMemory & { similarity: number })[]>] = [
              deps.agentMemoryStore!.getMemories(config.role, { limit: 20 }),
              deps.agentMemoryStore!.getReflections(config.role, 3),
              deps.agentMemoryStore!.searchMemoriesBySimilarity
                ? deps.agentMemoryStore!.searchMemoriesBySimilarity(config.role, initialMessage, { limit: 5, threshold: 0.7 })
                : Promise.resolve([]),
            ];
            return Promise.all(fetches);
          })().catch(err => {
            console.warn(`[CompanyAgentRunner] Memory retrieval failed for ${config.role}:`, (err as Error).message);
            return null;
          })
        : Promise.resolve(null);

      // Dynamic brief (system prompt override from agent_briefs DB) — standard+ only
      const briefPromise = (tier !== 'light' && tier !== 'task' && deps?.dynamicBriefLoader)
        ? deps.dynamicBriefLoader(config.role).catch(err => {
            console.warn(`[CompanyAgentRunner] Dynamic brief load failed for ${config.role}:`, (err as Error).message);
            return null;
          })
        : Promise.resolve(null);

      // Pending inter-agent messages — skip for light tier (chat)
      const messagesPromise = (tier !== 'light' && deps?.pendingMessageLoader)
        ? deps.pendingMessageLoader(config.role).catch(err => {
            console.warn(`[CompanyAgentRunner] Pending message load failed for ${config.role}:`, (err as Error).message);
            return [] as { id: string; from_agent: string; message: string; message_type: string; priority: string; thread_id: string; created_at: string }[];
          })
        : Promise.resolve([] as { id: string; from_agent: string; message: string; message_type: string; priority: string; thread_id: string; created_at: string }[]);

      // Collective Intelligence (pulse + org knowledge + inbox) — full only
      const ciPromise = (tier === 'full' && deps?.collectiveIntelligenceLoader)
        ? deps.collectiveIntelligenceLoader(config.role).catch(err => {
            console.warn(`[CompanyAgentRunner] Collective intelligence load failed for ${config.role}:`, (err as Error).message);
            return null;
          })
        : Promise.resolve(null);

      // Agent personality profile — cached
      const profilePromise = deps?.agentProfileLoader
        ? (async () => {
            const cacheKey = `profile:${config.role}`;
            const cached = promptCache.get<AgentProfileData | null>(cacheKey);
            if (cached !== undefined) return cached;
            const result = await deps.agentProfileLoader!(config.role);
            promptCache.set(cacheKey, result);
            return result;
          })().catch(err => {
            console.warn(`[CompanyAgentRunner] Profile load failed for ${config.role}:`, (err as Error).message);
            return null;
          })
        : Promise.resolve(null);

      // Working memory (last-run summary for continuity between runs) — skip for task tier
      const workingMemoryPromise = (tier !== 'task' && deps?.workingMemoryLoader)
        ? deps.workingMemoryLoader(config.role).catch(err => {
            console.warn(`[CompanyAgentRunner] Working memory load failed for ${config.role}:`, (err as Error).message);
            return null;
          })
        : Promise.resolve(null);

      // Skill context (matched skills for this task).
      // Load for all tiers except light (quick chat). Skills provide methodology
      // that agents need for work_loop, scheduled tasks, and on_demand analysis.
      const shouldLoadSkills = tier !== 'light' || task === 'skill_test';
      const skillPromise = (shouldLoadSkills && deps?.skillContextLoader)
        ? deps.skillContextLoader(config.role, initialMessage).catch(err => {
            console.warn(`[CompanyAgentRunner] Skill context load failed for ${config.role}:`, (err as Error).message);
            return null;
          })
        : Promise.resolve(null);

      // Determine department for knowledge base + bulletin targeting
      const roleDept = ROLE_DEPARTMENT[config.role] ?? undefined;
      const departmentSignalPromise = (async () => {
        try {
          const [agentRow] = await systemQuery<{ department: string | null; team: string | null }>(
            'SELECT department, team FROM company_agents WHERE role = $1',
            [config.role],
          );
          return agentRow?.department ?? agentRow?.team ?? roleDept ?? undefined;
        } catch (err) {
          console.warn(`[CompanyAgentRunner] Department lookup failed for ${config.role}:`, (err as Error).message);
          return roleDept;
        }
      })();

      // DB-driven knowledge base (replaces static file reading) — standard+ only, cached
      const kbPromise = (tier !== 'light' && tier !== 'task' && deps?.knowledgeBaseLoader)
        ? (async () => {
            const departmentSignal = await departmentSignalPromise;
            const cacheKey = `kb:${departmentSignal ?? 'all'}`;
            const cached = promptCache.get<string | null>(cacheKey);
            if (cached !== undefined) return cached;
            const result = await deps.knowledgeBaseLoader!(departmentSignal);
            promptCache.set(cacheKey, result);
            return result;
          })().catch(err => {
            console.warn(`[CompanyAgentRunner] Knowledge base load failed for ${config.role}:`, (err as Error).message);
            return null;
          })
        : Promise.resolve(null);

      // Founder bulletins — standard+ only, cached
      const bulletinPromise = (tier !== 'light' && tier !== 'task' && deps?.bulletinLoader)
        ? (async () => {
            const departmentSignal = await departmentSignalPromise;
            const cacheKey = `bulletin:${departmentSignal ?? 'all'}`;
            const cached = promptCache.get<string | null>(cacheKey);
            if (cached !== undefined) return cached;
            const result = await deps.bulletinLoader!(departmentSignal);
            promptCache.set(cacheKey, result);
            return result;
          })().catch(err => {
            console.warn(`[CompanyAgentRunner] Bulletin load failed for ${config.role}:`, (err as Error).message);
            return null;
          })
        : Promise.resolve(null);

      // Canonical doctrine — always load for all tiers, cached globally.
      const doctrinePromise = deps?.doctrineLoader
        ? (async () => {
            const cacheKey = 'doctrine:canonical';
            const cached = promptCache.get<string | null>(cacheKey);
            if (cached !== undefined) return cached;
            const result = await deps.doctrineLoader!();
            promptCache.set(cacheKey, result);
            return result;
          })().catch(err => {
            console.warn(`[CompanyAgentRunner] Doctrine load failed for ${config.role}:`, (err as Error).message);
            return null;
          })
        : Promise.resolve(null);

      // Pending work assignments — skip for light tier (chat)
      const assignmentPromise = (tier !== 'light' && deps?.pendingAssignmentLoader)
        ? deps.pendingAssignmentLoader(config.role).catch(err => {
            console.warn(`[CompanyAgentRunner] Assignment load failed for ${config.role}:`, (err as Error).message);
            return [] as { id: string; task_description: string; task_type: string; expected_output: string | null; priority: string; status: string; evaluation: string | null; directive_title: string | null }[];
          })
        : Promise.resolve([] as { id: string; task_description: string; task_type: string; expected_output: string | null; priority: string; status: string; evaluation: string | null; directive_title: string | null }[]);

      // JIT context — semantic retrieval tuned to the current task. All tiers.
      const jitPromise: Promise<JitContext | null> = deps?.jitContextRetriever
        ? deps.jitContextRetriever.retrieve(config.role, `${task}: ${initialMessage.slice(0, 200)}`).catch(err => {
            console.warn(`[CompanyAgentRunner] JIT context load failed for ${config.role}:`, (err as Error).message);
            return null;
          })
        : Promise.resolve(null);

      // Executive orchestration config — only for executive roles, non-light tiers
      const orchConfigPromise = (tier !== 'light' && EXECUTIVE_ROLES.has(config.role) && deps?.orchestrationConfigLoader)
        ? deps.orchestrationConfigLoader(config.role).catch(err => {
            console.warn(`[CompanyAgentRunner] Orchestration config load failed for ${config.role}:`, (err as Error).message);
            return null;
          })
        : Promise.resolve(null);

      // World model initialization — ensures agent_world_model row exists. Fire-and-forget.
      if (deps?.initializeWorldModel) {
        deps.initializeWorldModel(config.role).catch(err => {
          console.warn(`[CompanyAgentRunner] World model init failed for ${config.role}:`, (err as Error).message);
        });
      }

      // World state + upstream dependency context — standard+ only
      const worldStateKeys = AGENT_WORLD_STATE_KEYS[config.role];
      const worldStateDomain = AGENT_WORLD_STATE_DOMAIN[config.role];
      const worldStatePromise = (tier !== 'light' && tier !== 'task' && worldStateKeys && worldStateDomain)
        ? readWorldState(worldStateDomain, null, worldStateKeys).catch(err => {
            console.warn(`[CompanyAgentRunner] World state load failed for ${config.role}:`, (err as Error).message);
            return null;
          })
        : Promise.resolve(null);

      const upstreamContextPromise = (tier !== 'light' && tier !== 'task')
        ? resolveUpstreamContext(config.role, null).catch(err => {
            console.warn(`[CompanyAgentRunner] Upstream context load failed for ${config.role}:`, (err as Error).message);
            return '';
          })
        : Promise.resolve('');

      // Wrap all pre-run loading with a 60s timeout so a single
      // hung loader (DB, MCP, Graph API) can't leave the run stuck
      // in "running" state until the reaper kills it.
      const PRE_RUN_TIMEOUT_MS = 60_000;
      const preRunDeadline = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('pre-run data loading timed out after 60s')), PRE_RUN_TIMEOUT_MS),
      );

      const allLoaders = Promise.all([
        memoryPromise,
        briefPromise,
        messagesPromise,
        ciPromise,
        profilePromise,
        departmentSignalPromise,
        workingMemoryPromise,
        skillPromise,
        kbPromise,
        bulletinPromise,
        assignmentPromise,
        jitPromise,
        orchConfigPromise,
        doctrinePromise,
        worldStatePromise,
        upstreamContextPromise,
      ]);

      const [memoryResult, briefResult, pendingMessages, ciContext, profileResult, departmentSignal, workingMemory, skillResult, kbResult, bulletinResult, pendingAssignments, jitResult, orchConfigResult, doctrineResult, worldStateResult, upstreamContextResult] = await Promise.race([allLoaders, preRunDeadline]);

      // Inject memory context
      if (memoryResult) {
        const [memories, reflections, semanticMemories] = memoryResult;
        const seenIds = new Set(memories.map((m) => m.id));
        const uniqueSemantic = semanticMemories.filter((m) => !seenIds.has(m.id));

        if (memories.length > 0 || reflections.length > 0 || uniqueSemantic.length > 0) {
          const memoryContext = buildMemoryContext(
            [...memories, ...uniqueSemantic],
            reflections,
            uniqueSemantic,
          );
          history.push({
            role: 'user',
            content: `[CONTEXT — Do NOT respond to this message; wait for the user's actual message.]\n\n${memoryContext}`,
            timestamp: Date.now(),
          });
        }
      }

      // Set dynamic brief
      if (briefResult) dynamicBrief = briefResult;

      // Inject pending messages
      if (pendingMessages.length > 0) {
        const msgContext = buildPendingMessageContext(pendingMessages);
        history.push({
          role: 'user',
          content: `[CONTEXT — Do NOT respond to this message; wait for the user's actual message.]\n\n${msgContext}`,
          timestamp: Date.now(),
        });
      }

      // Inject pending work assignments
      if (pendingAssignments.length > 0) {
        const assignContext = buildPendingAssignmentContext(pendingAssignments);
        history.push({
          role: 'user',
          content: `[CONTEXT — Do NOT respond to this message; wait for the user's actual message.]\n\n${assignContext}`,
          timestamp: Date.now(),
        });
        // Detect delegated directive context — any assignment linked to a directive
        hasDelegatedDirective = pendingAssignments.some(a => !!a.directive_title);
      }

      // Inject CI context
      if (ciContext) {
        history.push({
          role: 'user',
          content: `[CONTEXT — Do NOT respond to this message; wait for the user's actual message.]\n\n${ciContext}`,
          timestamp: Date.now(),
        });
      }

      // Inject working memory (last-run summary)
      // In chat (light tier or with conversation history), deprioritize working
      // memory so the agent focuses on the user's question instead of fixating
      // on stale scheduled-run context.
      if (workingMemory?.summary) {
        const ago = workingMemory.lastRunAt
          ? formatTimeAgo(new Date(workingMemory.lastRunAt))
          : 'unknown time';
        const isChat = tier === 'light' || (config.conversationHistory && config.conversationHistory.length > 0);
        const preamble = isChat
          ? `## Background Context (from your last scheduled run ${ago} ago)\nWARNING: This is UNVERIFIED context from a previous run. It may be stale or inaccurate. Do NOT repeat any of this as fact. If the user asks about something mentioned here, verify it with a tool first.\n\n`
          : `## Working Memory\nYour last run was ${ago} ago. Here is what you accomplished:\n\n`;
        const suffix = isChat
          ? ''
          : '\n\nUse this context to build on your previous work and avoid repeating completed tasks.';
        history.push({
          role: 'user',
          content: `[CONTEXT — Do NOT respond to this message; wait for the user's actual message.]\n\n${preamble}${workingMemory.summary}${suffix}`,
          timestamp: Date.now(),
        });
      }

      // Set profile
      agentProfile = profileResult;
      routingDepartment = profileResult?.department ?? departmentSignal ?? undefined;

      // Set skill context
      skillContext = skillResult;

      // Set DB-driven knowledge base and bulletins
      dbKnowledgeBase = kbResult;
      bulletinContext = bulletinResult;
      doctrineContext = doctrineResult;

      // Capture JIT result for downstream use (verification pipeline)
      jitContext = jitResult;

      // Set executive orchestration config (only used when delegated directive is in context)
      orchestrationConfig = orchConfigResult;

      // Inject JIT context
      if (jitResult && jitResult.tokenEstimate > 0) {
        const jitSections: string[] = [];
        if (jitResult.relevantMemories.length > 0) {
          jitSections.push('## Relevant Memories\n' + jitResult.relevantMemories.map((m: { content: string; metadata?: Record<string, unknown> }) => `- ${m.content}${formatFreshnessTag(m)}`).join('\n'));
        }
        if (jitResult.relevantGraphNodes.length > 0) {
          jitSections.push('## Relevant Graph Context\n' + jitResult.relevantGraphNodes.map((g: { content: string; metadata?: Record<string, unknown> }) => `- ${g.content}${formatFreshnessTag(g)}`).join('\n'));
        }
        if (jitResult.relevantKnowledge.length > 0) {
          jitSections.push('## Relevant Knowledge\n' + jitResult.relevantKnowledge.map((k: { content: string; metadata?: Record<string, unknown> }) => `- ${k.content}${formatFreshnessTag(k)}`).join('\n'));
        }
        if (jitResult.relevantEpisodes.length > 0) {
          jitSections.push('## Relevant Episodes\n' + jitResult.relevantEpisodes.map((e: { content: string; metadata?: Record<string, unknown> }) => `- ${e.content}${formatFreshnessTag(e)}`).join('\n'));
        }
        if (jitResult.relevantProcedures.length > 0) {
          jitSections.push('## Relevant Procedures\n' + jitResult.relevantProcedures.map((p: { content: string; metadata?: Record<string, unknown> }) => `- ${p.content}${formatFreshnessTag(p)}`).join('\n'));
        }
        if (jitSections.length > 0) {
          if (jitResult.selectionMeta) {
            emitEvent({
              type: 'jit_selector_summary',
              agentId: config.id,
              turnNumber: 0,
              candidateCount: jitResult.selectionMeta.candidateCount,
              selectedCount: jitResult.selectionMeta.selectedCount,
              selectedBySource: jitResult.selectionMeta.selectedBySource,
              selectedFreshness: jitResult.selectionMeta.selectedFreshness,
            });
            console.log(
              `[JITSelector] ${config.role}: candidates=${jitResult.selectionMeta.candidateCount}, selected=${jitResult.selectionMeta.selectedCount}, by_source=${JSON.stringify(jitResult.selectionMeta.selectedBySource)}, freshness=${JSON.stringify(jitResult.selectionMeta.selectedFreshness)}`,
            );
          }
          history.push({
            role: 'user',
            content: `[CONTEXT — Do NOT respond to this message; wait for the user's actual message.]\n\n# Task-Relevant Context (JIT Retrieved)\n\n${jitSections.join('\n\n')}`,
            timestamp: Date.now(),
          });
        }
      }

      // Inject world state context (shared cross-agent knowledge)
      if (worldStateResult && Object.keys(worldStateResult).length > 0) {
        const wsBlock = formatWorldStateForPrompt(worldStateResult);
        if (wsBlock) {
          history.push({
            role: 'user',
            content: `[CONTEXT — Do NOT respond to this message; wait for the user's actual message.]\n\n${wsBlock}`,
            timestamp: Date.now(),
          });
        }
      }

      // Inject upstream agent outputs (cross-agent dependency context)
      if (upstreamContextResult) {
        history.push({
          role: 'user',
          content: `[CONTEXT — Do NOT respond to this message; wait for the user's actual message.]\n\n${upstreamContextResult}`,
          timestamp: Date.now(),
        });
      }
    }

    const task = extractTask(config.id);
    const isTaskTier = task === 'work_loop' || task === 'proactive';
    let trustScore: number | null = null;
    if (deps?.trustScorer) {
      try {
        trustScore = (await deps.trustScorer.getTrust(config.role)).trustScore;
      } catch (err) {
        console.warn(`[CompanyAgentRunner] Trust load failed for ${config.role}:`, (err as Error).message);
      }
    }
    let routingAudit = await routeSubtask({
      role: config.role,
      task,
      history,
      toolNames: staticToolNames,
      department: routingDepartment,
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
        task,
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
          undefined,
            buildRoutingSummary(),
            0,
            undefined,
            actualModelUsed,
            actualProviderUsed,
          );
      }
      if (preCheck.context) {
        history.push({ role: 'user', content: preCheck.context, timestamp: Date.now() });
      }
      routedModel.model = getTierModel('default');
      routedModel.reasoningEffort = 'low';
    }

    const requestSource: RequestSource = task === 'on_demand' ? 'on_demand' : 'scheduled';
    let compactionCount = 0;
    let compactionSummary: string | undefined;
    const planningPolicy = resolvePlanningPolicy({
      role: config.role,
      task,
      config,
      taskTierHint: isTaskTier,
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
    const summaryFirstCompactionEnabled = isSummaryFirstCompactionEnabled();
    const composeHistoryForModel = (
      model: string,
      currentHistory: ConversationTurn[],
      turnForContext: number,
      sessionSummary?: string,
    ) => {
      const provider = detectProvider(model);
      const shouldUseClientCompression = shouldUseClientSideHistoryCompression(provider, requestSource);
      const baseComposerMax = shouldUseClientCompression
        ? CONTEXT_COMPOSER_MAX_TOKENS
        : CONTEXT_COMPOSER_MAX_TOKENS_PROVIDER;
      const needsQuickDemoBudget = historyHasSuccessfulQuickDemoWebApp(currentHistory);
      return composeModelContext({
        history: currentHistory,
        role: config.role,
        task,
        initialMessage,
        turnNumber: turnForContext,
        maxTokens: needsQuickDemoBudget ? baseComposerMax + CONTEXT_COMPOSER_QUICK_DEMO_EXTRA : baseComposerMax,
        includeReasoningState: true,
        keepRecentGroups: shouldUseClientCompression ? 2 : 3,
        sessionSummary,
      });
    };

    try {
      let turnNumber = 0;
      let onDemandToolOnlyAckInjected = false;
      let previousResponseId: string | undefined;
      let lastRetrievalTrace: ToolRetrieverTrace | undefined;

      // ─── ON-DEMAND / TASK TIER SPEED GUARD ─────────────────────
      // Chat (on_demand) must finish within the dashboard's 180 s abort.
      // Task tier (work_loop) gets tight limits — narrow executor agents.
      // Scheduled thinking tasks get generous timeouts (10 min).
      // Clamp the supervisor's maxTurns and timeoutMs so the agent
      // doesn't burn 10 tool-call cycles on a simple question.
      // Dynamic thinking for on_demand: classify the user's message to decide.
      // For scheduled tasks, use the static config.
      const chatNeedsThinking = task === 'on_demand' && config.thinkingEnabled !== false && needsThinking(initialMessage);
      const usesThinking = chatNeedsThinking || THINKING_ENABLED_TASKS.has(task) || (config.thinkingEnabled && !THINKING_DISABLED_TASKS.has(task) && !isTaskTier);
      {
        if (task === 'on_demand') {
          supervisor.config.maxTurns = Math.min(supervisor.config.maxTurns, ON_DEMAND_MAX_TURNS);
          supervisor.config.timeoutMs = Math.min(
            supervisor.config.timeoutMs,
            chatNeedsThinking ? ON_DEMAND_THINKING_SUPERVISOR_TIMEOUT_MS : ON_DEMAND_SUPERVISOR_TIMEOUT_MS,
          );
          // Successful read-only tool results count as progress in chat —
          // the agent is gathering info to answer a question, not stalling.
          supervisor.config.readsAsProgress = true;
        } else if (isTaskTier) {
          supervisor.config.maxTurns = Math.min(supervisor.config.maxTurns, TASK_TIER_MAX_TURNS);
          supervisor.config.timeoutMs = Math.min(supervisor.config.timeoutMs, TASK_TIER_TIMEOUT_MS);
          // Task-tier agents must produce write-side progress (files, memory)
          // to avoid burning tokens on repeated failing reads. Reads alone
          // don't count — only mutations reset the stall counter.
          supervisor.config.readsAsProgress = false;
          supervisor.config.maxStallTurns = Math.max(supervisor.config.maxStallTurns, 5);
        } else if (usesThinking) {
          // Thinking-enabled scheduled tasks: ensure at least 10 min
          supervisor.config.timeoutMs = Math.max(supervisor.config.timeoutMs, SCHEDULED_THINKING_TIMEOUT_MS);
        }
      }

      const actionReceipts: Array<{ tool: string; params: Record<string, unknown>; result: 'success' | 'error'; output: string; timestamp: string }> = [];

      while (true) {
        turnNumber++;
        emitEvent({ type: 'turn_started', agentId: config.id, turnNumber });

        // 1. SUPERVISOR CHECK
        const check = await supervisor.checkBeforeModelCall();
        if (!check.ok) {
          // For on_demand chat: if we collected tool data but never got text,
          // make one final no-tools model call to synthesize the data into
          // a proper response instead of dumping raw JSON.
          if (task === 'on_demand' && !lastTextOutput) {
            const toolData = history
              .filter(t => t.role === 'tool_result' && t.toolResult?.success)
              .map(t => t.content)
              .slice(-5);
            if (toolData.length > 0) {
              try {
                const synthPrompt = 'You ran out of time. Using ONLY the tool results already in the conversation, give a clear, concise answer to the user. Do NOT apologize about running out of time. Just answer naturally.';
                history.push({ role: 'user', content: synthPrompt, timestamp: Date.now() });
                const synthModel = routedModel.model === '__deterministic__' ? config.model : routedModel.model;
                const composedSynthContext = composeHistoryForModel(synthModel, history, turnNumber + 1);
                const compressedSynthHistory = composedSynthContext.history;
                const synthResponse = await this.modelClient.generate({
                  model: synthModel,
                  systemInstruction: '',
                  contents: compressedSynthHistory,
                  source: requestSource,
                  fallbackScope: 'same-provider',
                  tools: undefined,
                  temperature: config.temperature,
                  thinkingEnabled: false,
                  callTimeoutMs: 30_000,
                  metadata: {
                    previousResponseId,
                    modelConfig: routedModel,
                    agentRole: config.role,
                  },
                });
                if (synthResponse.text) {
                  lastTextOutput = synthResponse.text;
                  totalInputTokens += synthResponse.usageMetadata.inputTokens;
                  totalOutputTokens += synthResponse.usageMetadata.outputTokens;
                }
                if (synthResponse.compactionCount) {
                  compactionCount += synthResponse.compactionCount;
                  compactionSummary = synthResponse.compactionSummary ?? compactionSummary;
                }
                previousResponseId = synthResponse.responseId;
              } catch {
                // Synthesis call failed — fall back to truncated data
                const truncated = toolData.map(d => d.length > 500 ? d.substring(0, 500) + '...' : d);
                lastTextOutput = `Here's what I found:\n\n${truncated.join('\n\n')}`;
              }
            }
          }
          if (isTaskTier) await this.savePartialProgress(initialMessage, config, lastTextOutput, history, check.reason ?? 'supervisor_limit', deps);
          return this.buildResult(
            config, 'aborted', lastTextOutput, history, supervisor, check.reason, totalInputTokens, totalOutputTokens, totalThinkingTokens, totalCachedInputTokens, actionReceipts, buildRoutingSummary(),
            0, undefined, actualModelUsed, actualProviderUsed,
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
            component: 'companyAgentRunner',
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

        // 3. MODEL CALL
        let response: Awaited<ReturnType<ModelClient['generate']>>;
        try {
          // Task-level thinking override
          const isOnDemand = task === 'on_demand';

          // ─── SMART TOOL GATING (on_demand / task) ────────────────
          // on_demand: time-aware gating. The model gets tools on early turns
          //   BUT if we've used >55% of the time budget, strip tools immediately
          //   to force a text response before the supervisor times out.
          //   Also strip after turn 3 regardless.
          // task tier: strip tools on last turn to force a text response.
          // Scheduled: full tool access every turn.
          let effectiveTools: ReturnType<typeof toolExecutor.getDeclarations> | undefined = toolExecutor.getDeclarations();
          if (runPhase === 'planning') {
            effectiveTools = undefined;
          }

          // ─── MERGE DYNAMIC TOOL DECLARATIONS ────────────────────
          // Load tools registered at runtime via register_tool so the
          // LLM can discover and call them without a code deploy.
          if (effectiveTools && turnNumber === 1) {
            try {
              const staticNames = new Set(staticToolNames);
              const dynamicDecls = await loadDynamicToolDeclarations(staticNames);
              if (dynamicDecls.length > 0) {
                effectiveTools = [...effectiveTools, ...dynamicDecls];
                console.log(`[ToolInventory] ${config.role}: +${dynamicDecls.length} dynamic tools from tool_registry`);
              }
            } catch {
              // Non-fatal — agent runs with static tools only
            }
          }

          // ─── TOOL DECLARATION MISMATCH LOG ──────────────────────
          if (effectiveTools && turnNumber === 1) {
            const declaredCount = effectiveTools.length;
            const dynamicCount = declaredCount - staticToolNames.length;
            if (dynamicCount < 0) {
              console.warn(`[ToolInventory] ${config.role} MISMATCH: ${staticToolNames.length} static, ${declaredCount} declared to model`);
            }
          }
          const elapsedRatio = supervisor.elapsedMs / supervisor.config.timeoutMs;
          const isLastTurn = isOnDemand
            ? (turnNumber > 6 || elapsedRatio > 0.55)
            : isTaskTier && turnNumber >= supervisor.config.maxTurns;
          const isPenultimateTurn = !isLastTurn && (
            (isOnDemand && (turnNumber === 6 || (elapsedRatio > 0.45 && elapsedRatio <= 0.55))) ||
            (isTaskTier && turnNumber === supervisor.config.maxTurns - 1)
          );

          // Penultimate turn: warn agent that next turn is final
          if (isPenultimateTurn) {
            history.push({
              role: 'user',
              content: 'ATTENTION: You have ONE turn remaining. On your next turn you MUST ' +
                'produce your final text response. Do NOT claim actions you haven\'t ' +
                'completed. If work is unfinished, say what you DID and what REMAINS.',
              timestamp: Date.now(),
            });
          }

          // Last turn: strip tools and inject honesty constraint
          if (isLastTurn) {
            effectiveTools = undefined;
            history.push({
              role: 'user',
              content: 'FINAL TURN — tools unavailable. Only describe actions that ALREADY ' +
                'executed successfully in previous turns. If work is incomplete, ' +
                'state clearly: "I completed X but still need to do Y."',
              timestamp: Date.now(),
            });
          }

          const modelForTurn = routedModel.model === '__deterministic__'
            ? config.model
            : routedModel.model;
          const providerForTurn = detectProvider(modelForTurn);
          const useProviderToolSearch = (
            (providerForTurn === 'anthropic' && shouldUseAnthropicToolSearch(modelForTurn))
            || (providerForTurn === 'openai' && shouldUseOpenAIToolSearch(modelForTurn))
          );

          if (effectiveTools) {
            const retrieval = await getToolRetriever().retrieve(effectiveTools, {
              model: modelForTurn,
              role: config.role,
              department: routingDepartment,
              taskContext: buildToolTaskContext({
                message: initialMessage,
                task,
                role: config.role,
                department: routingDepartment,
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

            if (useProviderToolSearch && turnNumber === 1) {
              console.log(
                `[ToolSearch] ${config.role}: provider=${providerForTurn} tool_search enabled; ` +
                `declaring ${effectiveTools.length} retrieved tools with deferred loading.`,
              );
            }
          }

          let sessionSummaryForCompaction: string | undefined;
          if (summaryFirstCompactionEnabled && deps?.sessionMemoryStore) {
            try {
              const conversationId = config.dbRunId ?? config.id;
              const summary = await deps.sessionMemoryStore.getLatest(conversationId);
              sessionSummaryForCompaction = summary?.summaryText;
              if (sessionSummaryForCompaction) {
                emitEvent({
                  type: 'context_injected',
                  agentId: config.id,
                  turnNumber,
                  contextLength: sessionSummaryForCompaction.length,
                });
              }
            } catch {
              // fail-open: summary-first compaction is optional
            }
          }
          const composedContext = composeHistoryForModel(
            modelForTurn,
            history,
            turnNumber,
            sessionSummaryForCompaction,
          );
          const compressedHistory = composedContext.history;

          emitEvent({
            type: 'model_request',
            agentId: config.id,
            turnNumber,
            tokenEstimate: composedContext.tokenEstimate,
          });

          if (turnNumber === 1 || turnNumber % 3 === 0) {
            const rawEstimate = Math.ceil(history.reduce((t, h) => t + h.content.length, 0) / 4);
            console.log(
              `[ContextComposer] ${config.role} turn=${turnNumber}: ` +
              `raw=${history.length} (~${rawEstimate} tok) -> ` +
              `composed=${compressedHistory.length} (~${composedContext.tokenEstimate} tok), ` +
              `dropped_groups=${composedContext.droppedGroups}, dropped_turns=${composedContext.droppedTurns}, ` +
              `tools=${effectiveTools?.length ?? 0}`,
            );
          }

          routingAudit = await routeSubtask({
            role: config.role,
            task,
            history: compressedHistory,
            toolNames: effectiveTools?.map((tool) => tool.name) ?? [],
            department: routingDepartment,
            trustScore,
            currentModel: routedModel.model === '__deterministic__' ? config.model : routedModel.model,
            lastTextOutput,
            actionReceipts,
          });
          routedModel = routingAudit.routing;
          if (compareSubtaskComplexity(routingAudit.classification.complexity, highestSubtaskComplexity) > 0) {
            highestSubtaskComplexity = routingAudit.classification.complexity;
          }

          let modelForGenerate = routedModel.model === '__deterministic__'
            ? config.model
            : routedModel.model;
          if (runPhase === 'planning' && planningPolicy.planningModelTier) {
            modelForGenerate = getTierModel(planningPolicy.planningModelTier);
          }

          // Select system prompt based on context tier
          const systemPrompt = isTaskTier
            ? buildTaskTierSystemPrompt(agentProfile, doctrineContext)
            : buildSystemPrompt(
                config.role,
                config.systemPrompt,
                dynamicBrief,
                agentProfile,
                skillContext,
                dbKnowledgeBase,
                bulletinContext,
                isOnDemand,
                orchestrationConfig,
                hasDelegatedDirective,
                modelForGenerate,
                doctrineContext,
              );
          let effectiveThinking = routedModel.reasoningEffort === 'minimal' ? false : config.thinkingEnabled;
          if (isTaskTier) {
            effectiveThinking = false;
          } else if (task === 'on_demand') {
            effectiveThinking = chatNeedsThinking;
          } else if (THINKING_DISABLED_TASKS.has(task)) {
            effectiveThinking = false;
          } else if (THINKING_ENABLED_TASKS.has(task)) {
            effectiveThinking = true;
          }

          let effectiveTemp = config.temperature;
          if (routedModel.model.startsWith('gemini-3') && (effectiveTemp === undefined || effectiveTemp < 1.0)) {
            effectiveTemp = 1.0;
          }

          response = await this.modelClient.generate({
            model: modelForGenerate,
            systemInstruction: systemPrompt,
            contents: compressedHistory,
            source: requestSource,
            fallbackScope: 'same-provider',
            tools: effectiveTools,
            temperature: effectiveTemp,
            topP: config.topP,
            topK: config.topK,
            thinkingEnabled: effectiveThinking,
            reasoningLevel: routedModel.reasoningEffort === 'high'
              ? 'deep'
              : routedModel.reasoningEffort === 'minimal'
                ? 'none'
                : 'standard',
            signal: supervisor.signal,
            callTimeoutMs: isOnDemand
              ? (effectiveThinking ? THINKING_CALL_TIMEOUT_MS : ON_DEMAND_CALL_TIMEOUT_MS)
              : isTaskTier
                ? TASK_TIER_CALL_TIMEOUT_MS
                : (effectiveThinking ? THINKING_CALL_TIMEOUT_MS : SCHEDULED_CALL_TIMEOUT_MS),
            metadata: {
              previousResponseId,
              modelConfig: routedModel,
              agentRole: config.role,
            },
          });
          previousResponseId = response.responseId;
          if (response.compactionCount) {
            compactionCount += response.compactionCount;
            compactionSummary = response.compactionSummary ?? compactionSummary;
            console.log(
              `[Compaction] ${config.role} turn=${turnNumber}: provider summarized earlier context ` +
              `(${response.compactionCount} event${response.compactionCount === 1 ? '' : 's'})`,
            );
          }

          // Accumulate token usage across turns
          totalInputTokens += response.usageMetadata.inputTokens;
          totalOutputTokens += response.usageMetadata.outputTokens;
          totalThinkingTokens += response.usageMetadata.thinkingTokens ?? 0;
          totalCachedInputTokens += response.usageMetadata.cachedInputTokens ?? 0;
          actualModelUsed = response.actualModel ?? routedModel.model;
          actualProviderUsed = response.actualProvider;

          emitEvent({
            type: 'model_response',
            agentId: config.id,
            turnNumber,
            hasToolCalls: response.toolCalls.length > 0,
            thinkingText: response.thinkingText,
          });
        } catch (error) {
          const errMsg = (error as Error).message ?? String(error);
          console.error(`[CompanyAgentRunner] Model call failed for ${config.id} (model=${routedModel.model}, turn=${turnNumber}): ${errMsg}`);
          if (supervisor.isAborted) {
            if (isTaskTier) await this.savePartialProgress(initialMessage, config, lastTextOutput, history, errMsg, deps);
            return this.buildResult(
              config, 'aborted', lastTextOutput, history, supervisor,
              errMsg, totalInputTokens, totalOutputTokens, totalThinkingTokens, totalCachedInputTokens, actionReceipts, buildRoutingSummary(),
              0, undefined, actualModelUsed, actualProviderUsed,
            );
          }
          throw error;
        }

        if (response.providerEvents && response.providerEvents.length > 0) {
          const eventSummary = response.providerEvents
            .map((event) => event.name ? `${event.type}:${event.name}` : event.type)
            .join(', ');
          history.push({
            role: 'assistant',
            content: `[provider_events] ${eventSummary}`,
            timestamp: Date.now(),
          });
        }

        if (!response.text && response.toolCalls.length === 0 && (response.providerEvents?.length ?? 0) > 0) {
          // Hosted tool-search events can arrive in an intermediate response.
          // Continue the loop so the model can issue concrete tool calls next.
          continue;
        }

        // 4. TOOL CALLS
        if (response.toolCalls.length > 0) {
          if (task === 'on_demand' && !response.text?.trim() && !onDemandToolOnlyAckInjected) {
            onDemandToolOnlyAckInjected = true;
            history.push({
              role: 'assistant',
              content: ON_DEMAND_TOOL_ONLY_ACK,
              timestamp: Date.now(),
            });
            lastTextOutput = ON_DEMAND_TOOL_ONLY_ACK;
          }
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
          const toolContext: ToolContext = {
              agentId: config.id,
              agentRole: config.role,
              turnNumber,
              abortSignal: supervisor.signal,
              memoryBus,
              emitEvent,
              glyphorEventBus: deps?.glyphorEventBus,
              runId: toolRunId,
              assignmentId: config.assignmentId,
              directiveId: config.directiveId,
              requestSource,
              retrievalMetadata: lastRetrievalTrace
                ? buildCompanyRetrievalMetadataMap(lastRetrievalTrace)
                : undefined,
          };

          // Concurrent dispatch: run safe tools in parallel when possible
          const useConcurrent = response.toolCalls.length > 1
            && shouldUseConcurrentExecution(response.toolCalls, (toolExecutor as any).tools);

          if (useConcurrent) {
            const concurrent = new ConcurrentToolExecutor(toolExecutor);
            const callEntries: ToolCallEntry[] = response.toolCalls.map((call, idx) => ({
              index: idx,
              name: call.name,
              args: call.args,
            }));

            let batchAborted = false;
            const iter = concurrent.executeBatch(callEntries, toolContext);
            let iterResult = await iter.next();
            while (!iterResult.done) {
              const { call, result } = iterResult.value;
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

              actionReceipts.push({
                tool: call.name,
                params: call.args,
                result: result.success ? 'success' : 'error',
                output: (result.success
                  ? (typeof result.data === 'string' ? result.data : (JSON.stringify(result.data) ?? 'ok')).slice(0, 500)
                  : result.error ?? 'Unknown error'
                ),
                timestamp: new Date().toISOString(),
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
                if (isTaskTier) await this.savePartialProgress(initialMessage, config, lastTextOutput, history, progressCheck.reason ?? 'stall_detected', deps);
                batchAborted = true;
                return this.buildResult(
                  config, 'aborted', lastTextOutput, history, supervisor,
                  progressCheck.reason, totalInputTokens, totalOutputTokens, totalThinkingTokens, totalCachedInputTokens, actionReceipts, buildRoutingSummary(),
                  0, undefined, actualModelUsed, actualProviderUsed,
                );
              }
              iterResult = await iter.next();
            }
          } else {
          // Sequential fallback (single tool or all tools unsafe)
          for (const call of response.toolCalls) {
            const result = await toolExecutor.execute(call.name, call.args, toolContext);

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

            // Collect action receipt for transparency
            actionReceipts.push({
              tool: call.name,
              params: call.args,
              result: result.success ? 'success' : 'error',
              output: (result.success
                ? (typeof result.data === 'string' ? result.data : (JSON.stringify(result.data) ?? 'ok')).slice(0, 500)
                : result.error ?? 'Unknown error'
              ),
              timestamp: new Date().toISOString(),
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
              if (isTaskTier) await this.savePartialProgress(initialMessage, config, lastTextOutput, history, progressCheck.reason ?? 'stall_detected', deps);
              return this.buildResult(
                config, 'aborted', lastTextOutput, history, supervisor,
                progressCheck.reason, totalInputTokens, totalOutputTokens, totalThinkingTokens, totalCachedInputTokens, actionReceipts, buildRoutingSummary(),
                0, undefined, actualModelUsed, actualProviderUsed,
              );
            }
          }
          } // end if/else concurrent
          continue;
        }

        // 5. TEXT RESPONSE — agent done
        if (response.text) {
          history.push({
            role: 'assistant',
            content: response.text,
            timestamp: Date.now(),
          });
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
              if (isTaskTier) await this.savePartialProgress(initialMessage, config, lastTextOutput, history, 'planner_failed_to_produce_valid_plan', deps);
              return this.buildResult(
                config, 'aborted', lastTextOutput, history, supervisor,
                'planner_failed_to_produce_valid_plan', totalInputTokens, totalOutputTokens, totalThinkingTokens, totalCachedInputTokens, actionReceipts, buildRoutingSummary(),
                compactionCount, compactionSummary, actualModelUsed, actualProviderUsed,
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
          if (deps?.sessionMemoryUpdater) {
            try {
              await deps.sessionMemoryUpdater.maybeUpdate({
                config,
                history,
                turnNumber,
                latestAssistantText: response.text,
                conversationId: config.dbRunId ?? config.id,
                sessionId: config.assignmentId,
              });
            } catch (err) {
              console.warn(
                `[CompanyAgentRunner] Session memory update failed for ${config.role}:`,
                (err as Error).message,
              );
            }
          }
        }

        if (response.finishReason === 'stop' || response.toolCalls.length === 0) {
          // Safety: model stopped without producing text output.
          // Nudge it for a final summary (once only).
          if (!lastTextOutput && !history.some(h => h.content === 'Please provide your final text response summarizing what you found and any actions taken.')) {
            history.push({
              role: 'user',
              content: 'Please provide your final text response summarizing what you found and any actions taken.',
              timestamp: Date.now(),
            });
            continue;
          }

          // Planning-detection guard: if the agent described future actions
          // ("I'll create…", "I'm starting…") on an early turn but never
          // invoked any tools, nudge it to actually execute instead of
          // ending the run with an empty promise. Apply once only.
          const PLANNING_NUDGE = 'You described actions you intend to take but did not execute any tools. Do NOT just describe what you plan to do — actually call the tools now to carry out the work. Use your available tools to complete the task.';
          if (
            lastTextOutput &&
            actionReceipts.length === 0 &&
            turnNumber <= 2 &&
            containsPlanningIntent(lastTextOutput) &&
            !history.some(h => h.content === PLANNING_NUDGE)
          ) {
            console.warn(
              `[CompanyAgentRunner] Planning-only response detected for ${config.role} on turn ${turnNumber} — nudging to execute.`,
            );
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
                component: 'companyAgentRunner',
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
                component: 'companyAgentRunner',
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
                component: 'companyAgentRunner',
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
                component: 'companyAgentRunner',
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

      // Fallback: if we still have no text output, reconstruct from tool results
      if (!lastTextOutput) {
        const toolResults = history
          .filter(t => t.role === 'tool_result')
          .map(t => t.content)
          .slice(-3);
        lastTextOutput = toolResults.length > 0
          ? `Completed. Tool results:\n${toolResults.join('\n')}`
          : 'Run completed but produced no text output.';
      }

      // ─── CLAIM DETECTION: flag unsubstantiated action claims ─────
      if (lastTextOutput && task === 'on_demand') {
        const claims = extractActionClaims(lastTextOutput);
        if (claims.length > 0) {
          const unsubstantiated = hasMatchingAction(claims, actionReceipts);
          if (unsubstantiated.length > 0) {
            console.warn(
              `[CompanyAgentRunner] Unsubstantiated claims detected for ${config.role}:`,
              unsubstantiated,
              'Executed tools:', actionReceipts.map(a => `${a.tool}:${a.result}`),
            );
            lastTextOutput += '\n\n⚠️ *Some actions mentioned above may not have completed. Please verify changes on the dashboard.*';
          }
        }
      }

      // ─── VERIFICATION PIPELINE (reasoning engine) ──────────────
      // Post-loop quality gate: if this agent has a reasoning engine config,
      // run verification passes (self-critique, consistency, factual checks).
      // Skip for on_demand chat to keep response times fast — only verify
      // scheduled/significant tasks where accuracy matters more than speed.
      let reasoningResult: ReasoningResult | null = null;
      let verificationDecision: VerificationDecision = {
        tier: 'none',
        passes: [] as import('./reasoningEngine.js').PassType[],
        reason: 'on-demand chat bypassed verification',
        rubricId: 'on_demand_bypass',
        minimumRubricScore: 0,
      };
      let verificationMeta: NonNullable<AgentExecutionResult['verificationMeta']> = {
        tier: 'none',
        reason: 'on-demand chat bypassed verification',
        passes: [],
      };
      if (lastTextOutput && task !== 'on_demand') {
        verificationDecision = determineVerificationTier({
          agentRole: config.role,
          configId: config.id,
          task,
          trustScore,
          turnsUsed: supervisor.stats.turnCount,
          mutationToolsCalled: actionReceipts.filter((receipt) => receipt.result === 'success').map((receipt) => receipt.tool),
          output: lastTextOutput,
        });
        verificationMeta = {
          tier: verificationDecision.tier,
          reason: verificationDecision.reason,
          passes: [],
        };
      }

      if (deps?.reasoningEngineFactory && lastTextOutput && task !== 'on_demand' && verificationMeta.tier !== 'none') {
        try {
          const reasoningEngine = await deps.reasoningEngineFactory(config.role);
          if (reasoningEngine) {
            const contextForVerification = jitContext
              ? jitContext.relevantKnowledge.map((k: { content: string }) => k.content).join('\n').slice(0, 2000)
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

            if (verificationMeta.tier === 'conditional' && reasoningResult.overallConfidence < 0.8) {
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
              verificationMeta.reason = `${verificationMeta.reason} (escalated after low confidence)`;
            }

            if (reasoningResult.revised && reasoningResult.revisedOutput) {
              lastTextOutput = reasoningResult.revisedOutput;
            }

            verificationMeta.passes = Array.from(new Set(reasoningResult.passes.map((pass) => pass.passType)));

            console.log(
              `[CompanyAgentRunner] Reasoning for ${config.role}: ` +
              `${reasoningResult.passes.length} passes, ` +
              `confidence=${reasoningResult.overallConfidence.toFixed(2)}, ` +
              `revised=${reasoningResult.revised}, ` +
              `cost=$${reasoningResult.totalCostUsd.toFixed(4)}`,
            );
          }
        } catch (err) {
          console.warn(`[CompanyAgentRunner] Verification failed for ${config.id}:`, (err as Error).message);
        }
      } else if (!deps?.reasoningEngineFactory && lastTextOutput && task !== 'on_demand' && verificationMeta.tier !== 'none') {
        console.warn(`[CompanyAgentRunner] Verification unavailable for ${config.id}: reasoning engine not configured`);
      }

      const stats = supervisor.stats;

      // ─── REFLECT: Self-assessment of this run ──────────────────
      // Skip reflection for task-tier runs — narrow executors don't need it
      if (deps?.agentMemoryStore && lastTextOutput && !isTaskTier) {
        // Fire-and-forget — reflection is non-critical post-processing
        // that should never block the run response (saves 10–20s)
        this.reflectOnRun(config, history, lastTextOutput!, deps.agentMemoryStore!, dbRunId, deps?.knowledgeRouter, deps?.graphWriter, deps?.skillFeedbackWriter, skillContext)
          .catch(err => console.warn(`[CompanyAgentRunner] Reflection failed for ${config.id}:`, (err as Error).message));

        // Fire-and-forget: check if memory consolidation is due
        maybeConsolidate(config.role, deps.agentMemoryStore!, this.modelClient)
          .catch(err => console.warn(`[CompanyAgentRunner] Consolidation trigger failed for ${config.id}:`, (err as Error).message));
      }

      // ─── WORLD STATE: Write last output for downstream agents ──
      if (lastTextOutput && !isTaskTier) {
        writeWorldState(
          'agent_output',
          null,
          `last_output_${config.role}`,
          {
            summary: lastTextOutput.slice(0, 2000),
            task: extractTask(config.id),
            completed_at: new Date().toISOString(),
          },
          config.role,
          { validUntilHours: 48 },
        ).catch(err => console.warn(`[CompanyAgentRunner] World state write failed for ${config.role}:`, (err as Error).message));
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

      const result = this.buildResult(
        config,
        'completed',
        lastTextOutput,
        history,
        supervisor,
        undefined,
        totalInputTokens,
        totalOutputTokens,
        totalThinkingTokens,
        totalCachedInputTokens,
        actionReceipts,
        buildRoutingSummary(),
        compactionCount,
        compactionSummary,
        actualModelUsed,
        actualProviderUsed,
      );
      if (reasoningResult) {
        result.reasoningMeta = {
          passes: reasoningResult.passes.length,
          confidence: reasoningResult.overallConfidence,
          revised: reasoningResult.revised,
          costUsd: reasoningResult.totalCostUsd,
        };
      }
      result.verificationMeta = verificationMeta;
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
      await persistRunMetricsAuditLog({
        agentRole: config.role,
        taskId: config.assignmentId ?? extractTaskFromConfigId(config.id),
        runId: config.dbRunId ?? config.id,
        model: actualModelUsed ?? config.model,
        summary: summarizeRunOutput(lastTextOutput, `${config.role} completed run ${config.id}`),
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        thinkingTokens: totalThinkingTokens,
        cachedInputTokens: totalCachedInputTokens,
      });
      void learnFromAgentRun({
        result,
        agentRole: config.role,
        runId: config.id,
        taskType: task,
        taskDescription: initialMessage,
        glyphorEventBus: deps?.glyphorEventBus,
      }).catch(() => {});
      return result;

    } catch (error) {
      emitEvent({
        type: 'agent_error',
        agentId: config.id,
        error: (error as Error).message,
        turnNumber: supervisor.stats.turnCount,
      });

      // Emit failure event for Atlas
      if (deps?.glyphorEventBus) {
        try {
          await deps.glyphorEventBus.emit({
            type: 'alert.triggered',
            source: config.role,
            payload: {
              eventType: 'agent.failed',
              run_id: config.id,
              error: (error as Error).message,
            },
            priority: 'high',
          });
        } catch (emitErr) {
          console.warn(
            `[CompanyAgentRunner] Failed to emit failure event for ${config.id}:`,
            (emitErr as Error).message,
          );
        }
      }

      if (isTaskTier && supervisor.isAborted) await this.savePartialProgress(initialMessage, config, lastTextOutput, history, (error as Error).message, deps);
      const errResult = this.buildResult(
        config,
        supervisor.isAborted ? 'aborted' : 'error',
        lastTextOutput,
        history,
        supervisor,
        (error as Error).message,
        totalInputTokens,
        totalOutputTokens,
        totalThinkingTokens,
        totalCachedInputTokens,
        undefined,
        buildRoutingSummary(),
        compactionCount,
        compactionSummary,
        actualModelUsed,
        actualProviderUsed,
      );
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
      return errResult;
    }
  }

  private async evaluateCompletionGate(input: {
    role: CompanyAgentRole;
    initialMessage: string;
    acceptanceCriteria: string[];
    output: string;
    actionReceipts: Array<{ tool: string; params: Record<string, unknown>; result: 'success' | 'error'; output: string; timestamp: string }>;
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
        source: 'scheduled',
        fallbackScope: 'same-provider',
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
      // Fail-open to avoid deadlocking runs if verifier parsing/model call fails.
      return { meets: true, missingCriteria: [] };
    }
  }

  /**
   * Save partial progress when a task-tier run is aborted.
   * Extracts assignment_id from the initial message and persists what was done.
   */
  private async savePartialProgress(
    initialMessage: string,
    config: AgentConfig,
    lastOutput: string | null,
    history: ConversationTurn[],
    abortReason: string,
    deps?: RunDependencies,
  ): Promise<void> {
    if (!deps?.partialProgressSaver) return;

    // Extract assignment_id from the dispatch message
    const match = initialMessage.match(/assignment_id="([^"]+)"/);
    if (!match) return;

    const assignmentId = match[1];
    const toolResults = history
      .filter(t => t.role === 'tool_result')
      .map(t => `[${t.toolName}] ${(t.content ?? '').slice(0, 500)}`)
      .slice(-5);

    const partialOutput = [
      lastOutput ? `Last output: ${lastOutput.slice(0, 1000)}` : 'No text output produced.',
      toolResults.length > 0 ? `Tool results:\n${toolResults.join('\n')}` : '',
    ].filter(Boolean).join('\n\n');

    try {
      await deps.partialProgressSaver(assignmentId, partialOutput, config.role, abortReason);
      console.log(`[CompanyAgentRunner] Partial progress saved for assignment ${assignmentId}`);
    } catch (err) {
      console.warn(`[CompanyAgentRunner] Failed to save partial progress:`, (err as Error).message);
    }
  }

  private buildResult(
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
    actions?: Array<{ tool: string; params: Record<string, unknown>; result: 'success' | 'error'; output: string; timestamp: string }>,
    routing?: Pick<RoutingDecision, 'routingRule' | 'capabilities' | 'model'> & Pick<AgentExecutionResult, 'modelRoutingReason' | 'subtaskComplexity'>,
    compactionCount = 0,
    compactionSummary?: string,
    actualModel?: string,
    actualProvider?: 'gemini' | 'openai' | 'anthropic',
  ): AgentExecutionResult {
    const stats = supervisor.stats;
    const estimatedCost = estimateCost(routing?.model ?? config.model, inputTokens, outputTokens, thinkingTokens, cachedInputTokens);
    const dashboardChatEmbeds = extractDashboardChatEmbedsFromHistory(history);
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
      actions: actions && actions.length > 0 ? actions : undefined,
      dashboardChatEmbeds: dashboardChatEmbeds.length > 0 ? dashboardChatEmbeds : undefined,
      routingRule: routing?.routingRule,
      routingCapabilities: routing?.capabilities,
      routingModel: routing?.model,
      modelRoutingReason: routing?.modelRoutingReason,
      subtaskComplexity: routing?.subtaskComplexity,
      compactionOccurred: compactionCount > 0 ? true : undefined,
      compactionCount: compactionCount > 0 ? compactionCount : undefined,
      compactionSummary: compactionCount > 0 ? compactionSummary : undefined,
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
    dbRunId?: string,
    knowledgeRouter?: (knowledge: { agent_id: string; content: string; tags: string[]; knowledge_type?: string }) => Promise<number>,
    graphWriter?: GraphOpsWriter,
    skillFeedbackWriter?: (role: CompanyAgentRole, feedback: SkillFeedback[]) => Promise<void>,
    skillContext?: SkillContext | null,
  ): Promise<void> {
    const systemPrompt = buildSystemPrompt(config.role, config.systemPrompt, undefined, undefined, undefined, undefined, undefined);

    const reviewWindowDays = 14;
    let cosSignalContext = '';
    if (config.role === 'chief-of-staff') {
      try {
        const [rejectionCountRow, recentEvidenceRows] = await Promise.all([
          systemQuery<{ count: string }>(
            `SELECT COUNT(*)::text AS count
             FROM agent_world_model_evidence
             WHERE agent_role = 'chief-of-staff'
               AND evidence_type = 'negative'
               AND description ILIKE 'Founder rejection:%'
               AND created_at > NOW() - ($1::int * INTERVAL '1 day')`,
            [reviewWindowDays],
          ),
          systemQuery<{ description: string }>(
            `SELECT description
             FROM agent_world_model_evidence
             WHERE agent_role = 'chief-of-staff'
               AND evidence_type = 'negative'
               AND created_at > NOW() - ($1::int * INTERVAL '1 day')
             ORDER BY created_at DESC
             LIMIT 20`,
            [reviewWindowDays],
          ),
        ]);

        const rejectionCount = Number(rejectionCountRow[0]?.count ?? '0');
        const negativeSignals = recentEvidenceRows.map((row) => `- ${row.description}`).join('\n');
        cosSignalContext = [
          `Review window: last ${reviewWindowDays} days`,
          `Founder rejections (count): ${rejectionCount}`,
          'Recent negative external signals:',
          negativeSignals || '- none captured',
        ].join('\n');
      } catch (err) {
        console.warn('[CompanyAgentRunner] Failed to load CoS reflection signals:', (err as Error).message);
      }
    }

    const genericReflectPrompt = `You just completed a task. Here is your final output:

---
${(output ?? '').slice(0, 3000)}
---

Reflect on this run and respond with a JSON object (no markdown fencing):
{
  "summary": "1-2 sentence summary of what you accomplished",
  "qualityScore": <0-100>,
  "whatWentWell": ["..."],
  "whatCouldImprove": ["..."],
  "promptSuggestions": ["suggestions for how your instructions could be improved — for each, include a category: 'wording' (phrasing change), 'instruction' (add/remove a rule), 'context' (add/remove context source), 'tool' (add/remove tool access)"],
  "knowledgeGaps": ["things you didn't know but needed"],
  "memories": [
    { "type": "observation|learning|preference|fact", "content": "...", "importance": 0.0-1.0 }
  ],
  "peerFeedback": [
    { "toAgent": "role-slug", "feedback": "what you observed about their work", "sentiment": "positive|constructive|neutral" }
  ],${skillContext && skillContext.skills.length > 0 ? `
  "skill_feedback": [
    { "skill_slug": "slug-of-skill-used", "outcome": "success|partial|failure", "refinement": "optional tip for next time", "failure_mode": "optional pattern that caused failure" }
  ],` : ''}
  "graph_operations": {
    "nodes": [
      { "node_type": "event|fact|observation|pattern|metric|risk|hypothesis", "title": "short label", "content": "full description", "tags": ["tag1"], "department": "engineering|finance|marketing|product|etc", "importance": 0.0-1.0, "metadata": {} }
    ],
    "edges": [
      { "source": {"this_run_node": 0} | {"find_by": "title_contains"|"entity", "query": "search term"}, "target": {"this_run_node": 0} | {"find_by": "title_contains"|"entity", "query": "search term"}, "edge_type": "caused|contributed_to|supports|contradicts|affects|related_to", "strength": 0.0-1.0, "evidence": "why this relationship exists" }
    ]
  }
}
${skillContext && skillContext.skills.length > 0 ? `\nFor skill_feedback: You used skills [${skillContext.skills.map(s => s.slug).join(', ')}] during this run. Rate how well each skill's methodology worked. Include refinements (tips for next time) or failure_modes (patterns that caused problems). Leave the array empty if no skills were notably helpful or problematic.` : ''}
For graph_operations: Extract key events, metrics, patterns, or risks from this run and connect them to existing knowledge. This builds the organizational knowledge graph — focus on causal chains (what caused what) and cross-functional impacts. Leave arrays empty if nothing noteworthy happened.

For peerFeedback: If during this task you interacted with or observed the work of other agents, include brief feedback for them. Only include genuine observations — leave the array empty if you had no cross-agent interaction.`;

    const reflectPrompt = config.role === 'chief-of-staff'
      ? `${CHIEF_OF_STAFF_REFLECTION_PROMPT}\n\n## External Signals\n${cosSignalContext || 'No external signals available for this window.'}`
      : genericReflectPrompt;

    // Filter to only user/assistant text turns for reflection — including
    // tool_call/tool_result turns violates Gemini's strict ordering requirement
    // ("function response turn must come immediately after a function call turn")
    const textOnlyHistory = history.filter(t => t.role === 'user' || t.role === 'assistant');
    const reflectHistory: ConversationTurn[] = [
      ...textOnlyHistory.slice(-4),
      { role: 'user', content: reflectPrompt, timestamp: Date.now() },
    ];

    const reflectionModel = getTierModel('fast');

    const response = await this.modelClient.generate({
      model: reflectionModel,
      systemInstruction: systemPrompt,
      contents: reflectHistory,
      fallbackScope: 'same-provider',
      tools: [],
      temperature: 0.3,
      thinkingEnabled: false,
      metadata: {
        modelConfig: {
          model: reflectionModel,
          routingRule: 'reflection_subcall',
          capabilities: ['batch_eligible', 'structured_extraction'],
          reasoningEffort: 'low',
          verbosity: 'low',
        },
      },
    });

    if (!response.text) return;

    try {
      const parsed = JSON.parse(response.text.replace(/```json?\n?/g, '').replace(/```/g, '').trim());

      if (config.role === 'chief-of-staff' && Array.isArray(parsed.strengths) && Array.isArray(parsed.weaknesses)) {
        const strengths = parsed.strengths as Array<{ skill?: string; evidence?: string }>;
        const weaknesses = parsed.weaknesses as Array<{ skill?: string; evidence?: string; improvement_goal?: string }>;
        const rejections = Number(parsed?.founder_rejections?.count ?? 0);
        const predictionsMade = Number(parsed?.prediction_accuracy?.predictions_made ?? 0);
        const predictionsCorrect = Number(parsed?.prediction_accuracy?.predictions_correct ?? 0);
        const predictionRate = predictionsMade > 0 ? (predictionsCorrect / predictionsMade) : 1;
        const computedQuality = Math.max(0, Math.min(100, Math.round(100 - (rejections * 20) - (weaknesses.length * 8) + (predictionRate * 10))));

        parsed.summary = `CoS reflection: ${rejections} founder rejections, ${weaknesses.length} weaknesses, prediction accuracy ${(predictionRate * 100).toFixed(0)}%.`;
        parsed.qualityScore = computedQuality;
        parsed.whatWentWell = strengths
          .map((item) => `${item.skill ?? 'unknown_skill'}: ${item.evidence ?? 'external evidence provided'}`)
          .slice(0, 8);
        parsed.whatCouldImprove = weaknesses
          .map((item) => `${item.skill ?? 'unknown_skill'}: ${item.evidence ?? 'issue noted'} | Next: ${item.improvement_goal ?? 'define corrective action'}`)
          .slice(0, 10);
        parsed.promptSuggestions = [];
        parsed.knowledgeGaps = parsed?.prediction_accuracy?.misses ?? [];
      }

      // Save reflection
      await store.saveReflection({
        agentRole: config.role,
        runId: dbRunId ?? config.id,
        summary: parsed.summary ?? '',
        qualityScore: Math.max(0, Math.min(100, parsed.qualityScore ?? 50)),
        whatWentWell: parsed.whatWentWell ?? [],
        whatCouldImprove: parsed.whatCouldImprove ?? [],
        promptSuggestions: parsed.promptSuggestions ?? [],
        knowledgeGaps: parsed.knowledgeGaps ?? [],
      });

      // Save extracted memories (with embeddings when available)
      const memories = parsed.memories ?? [];
      const saveFn = store.saveMemoryWithEmbedding
        ? store.saveMemoryWithEmbedding.bind(store)
        : store.saveMemory.bind(store);
      const memoryPromises = memories.slice(0, 5).map((mem: any) =>
        saveFn({
          agentRole: config.role,
          memoryType: mem.type ?? 'observation',
          content: mem.content ?? '',
          importance: Math.max(0, Math.min(1, mem.importance ?? 0.5)),
          sourceRunId: config.id,
        }).catch(() => {}),
      );

      // Process knowledge graph operations
      const graphPromise = (graphWriter && parsed.graph_operations)
        ? (async () => {
            const ops = parsed.graph_operations;
            const graphNodes = Array.isArray(ops.nodes) ? ops.nodes : [];
            const graphEdges = Array.isArray(ops.edges) ? ops.edges : [];
            if (graphNodes.length > 0 || graphEdges.length > 0) {
              const result = await graphWriter.processGraphOps(
                config.role,
                config.id,
                { nodes: graphNodes.slice(0, 5), edges: graphEdges.slice(0, 10) },
              );
              console.log(
                `[CompanyAgentRunner] Graph ops for ${config.id}: ${result.nodesCreated} nodes, ${result.edgesCreated} edges`,
              );
            }
          })().catch(graphErr => console.warn(`[CompanyAgentRunner] Graph ops failed for ${config.id}:`, (graphErr as Error).message))
        : Promise.resolve();

      // Save working memory (last-run summary for next run's context)
      const summaryPromise = (store.saveLastRunSummary && parsed.summary)
        ? store.saveLastRunSummary(config.role, parsed.summary).catch(() => {})
        : Promise.resolve();

      // Update growth metrics for dashboard GrowthAreas component
      const growthPromise = store.updateGrowthMetrics
        ? store.updateGrowthMetrics(config.role).catch(() => {})
        : Promise.resolve();

      // Route new knowledge to relevant agents via the CI system
      const knowledgePromises = (knowledgeRouter && memories.length > 0)
        ? memories.slice(0, 5)
            .filter((mem: any) => mem.type === 'learning' || mem.type === 'fact')
            .map((mem: any) => knowledgeRouter({
              agent_id: config.role,
              content: mem.content ?? '',
              tags: mem.tags ?? [],
              knowledge_type: mem.type,
            }).catch(() => {}))
        : [];

      // Save peer feedback
      const peerFeedback = parsed.peerFeedback ?? [];
      const peerPromises = (peerFeedback.length > 0 && store.savePeerFeedback)
        ? peerFeedback.slice(0, 3).map((fb: any) =>
            store.savePeerFeedback!({
              fromAgent: config.role,
              toAgent: fb.toAgent,
              feedback: fb.feedback,
              context: config.id,
              sentiment: fb.sentiment ?? 'neutral',
            }).catch(() => {}))
        : [];

      // Update skill proficiency and learnings from reflection
      const skillFeedbackItems: SkillFeedback[] = parsed.skill_feedback ?? [];
      const skillPromise = (skillFeedbackItems.length > 0 && skillFeedbackWriter)
        ? skillFeedbackWriter(config.role, skillFeedbackItems.slice(0, 5))
            .then(() => console.log(`[CompanyAgentRunner] Skill feedback saved for ${config.id}: ${skillFeedbackItems.length} skills`))
            .catch(skillErr => console.warn(`[CompanyAgentRunner] Skill feedback failed for ${config.id}:`, (skillErr as Error).message))
        : Promise.resolve();

      // Run all post-reflection DB writes in parallel
      await Promise.all([
        ...memoryPromises,
        graphPromise,
        summaryPromise,
        growthPromise,
        ...knowledgePromises,
        ...peerPromises,
        skillPromise,
      ]);

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

function buildMemoryContext(
  memories: AgentMemory[],
  reflections: AgentReflection[],
  semanticMatches?: (AgentMemory & { similarity: number })[],
): string {
  const parts: string[] = [
    '## Your Prior Knowledge & Learnings\n',
    'Below are your accumulated memories and recent self-reflections.',
    'Use these to inform your approach and avoid repeating past mistakes.\n',
  ];

  if (semanticMatches && semanticMatches.length > 0) {
    parts.push('### Relevant Memories (semantic match to current task)');
    for (const m of semanticMatches) {
      parts.push(
        `- [${m.memoryType}] (relevance: ${(m.similarity * 100).toFixed(0)}%, importance: ${m.importance}) ${m.content}`,
      );
    }
    parts.push('');
  }

  if (memories.length > 0) {
    parts.push('### Recent Memories');
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

function buildPendingMessageContext(
  messages: { id: string; from_agent: string; message: string; message_type: string; priority: string; thread_id: string; created_at: string }[],
): string {
  const urgentMessages = messages.filter((m) => m.priority === 'urgent');
  const normalMessages = messages.filter((m) => m.priority !== 'urgent');

  const parts: string[] = [
    `## Pending Messages (${messages.length})\n`,
    'You have messages from other agents. Read them and consider them in your work.',
    'You can reply using the send_agent_message tool with the same thread_id.\n',
  ];

  if (urgentMessages.length > 0) {
    parts.push('### URGENT');
    for (const m of urgentMessages) {
      parts.push(`**From ${m.from_agent}** (${m.message_type}) [thread: ${m.thread_id}]`);
      parts.push(`> ${m.message}`);
      parts.push('');
    }
  }

  if (normalMessages.length > 0) {
    parts.push('### Messages');
    for (const m of normalMessages) {
      parts.push(`**From ${m.from_agent}** (${m.message_type}) [thread: ${m.thread_id}]`);
      parts.push(`> ${m.message}`);
      parts.push('');
    }
  }

  return parts.join('\n');
}

function buildPendingAssignmentContext(
  assignments: { id: string; task_description: string; task_type: string; expected_output: string | null; priority: string; status: string; evaluation: string | null; directive_title: string | null }[],
): string {
  const revision = assignments.filter((a) => a.status === 'needs_revision');
  const actionable = assignments.filter((a) => a.status !== 'needs_revision');

  const parts: string[] = [
    `## Pending Work Assignments (${assignments.length})\n`,
    'These assignments were dispatched to you by Sarah (Chief of Staff).',
    'Use `read_my_assignments` for full details, then `submit_assignment_output` when done.\n',
  ];

  if (revision.length > 0) {
    parts.push('### NEEDS REVISION');
    for (const a of revision) {
      parts.push(`**${a.task_type}** [${a.priority}] — ${a.task_description}`);
      if (a.evaluation) parts.push(`  Feedback: ${a.evaluation}`);
      parts.push('');
    }
  }

  if (actionable.length > 0) {
    parts.push('### Assignments');
    for (const a of actionable) {
      parts.push(`**${a.task_type}** [${a.priority}] (${a.status}) — ${a.task_description}`);
      if (a.expected_output) parts.push(`  Expected: ${a.expected_output}`);
      parts.push('');
    }
  }

  return parts.join('\n');
}

function formatTimeAgo(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
