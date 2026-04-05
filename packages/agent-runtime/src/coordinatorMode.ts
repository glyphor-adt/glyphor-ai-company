/**
 * Coordinator Mode — Multi-Agent Task Orchestration
 *
 * Inspired by Claude Code's coordinator/worker pattern.
 * Provides structured multi-phase orchestration for Glyphor's
 * OrchestratorRunner agents: spawn parallel workers, enforce
 * synthesis gates, track worker lifecycle, prevent lazy delegation.
 *
 * Key concepts:
 *   - **Coordinator**: An orchestrator agent that breaks work into phases,
 *     dispatches workers, synthesizes findings, and drives to completion.
 *   - **Worker**: A task-tier agent spawned by the coordinator for a
 *     specific, self-contained sub-task.
 *   - **Synthesis Gate**: After research workers complete, the coordinator
 *     MUST synthesize — writing exact specs (file paths, line numbers,
 *     context) — before continuing to implementation workers.
 *   - **Task Notification**: XML-formatted result messages from workers
 *     back to the coordinator, including status, result, and usage stats.
 *
 * Lifecycle:
 *   1. Coordinator receives objective
 *   2. RESEARCH phase: spawn read-only workers in parallel
 *   3. SYNTHESIS phase: coordinator reads findings, writes exact specs
 *   4. IMPLEMENTATION phase: spawn write workers (sequential per file set)
 *   5. VERIFICATION phase: spawn verification workers
 *   6. Coordinator produces final deliverable
 *
 * Usage:
 *
 *   const session = createCoordinatorSession(config);
 *   const worker = session.spawnWorker({ ... });
 *   session.markWorkerComplete(worker.id, result);
 *   session.advancePhase('synthesis');
 *   const spec = session.buildSynthesisSpec(findings);
 */

import type { CompanyAgentRole } from './types.js';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

/** Coordinator workflow phases — strict ordering enforced. */
export type CoordinatorPhase =
  | 'planning'
  | 'research'
  | 'synthesis'
  | 'implementation'
  | 'verification'
  | 'complete';

/** Valid worker status lifecycle: pending → running → terminal. */
export type WorkerStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'killed';

/** Worker concurrency classification. */
export type WorkerType =
  | 'read_only'    // Can run in parallel (research, analysis)
  | 'write'        // Sequential per file-set (implementation)
  | 'verify';      // Can run in parallel (test, review)

export interface WorkerDescriptor {
  /** Auto-generated ID (prefix + random). */
  id: string;
  /** Human-readable description of the worker's task. */
  description: string;
  /** The self-contained prompt sent to the worker agent. */
  prompt: string;
  /** Agent role assigned to perform the work. */
  assignedRole: CompanyAgentRole;
  /** Worker type drives concurrency rules. */
  workerType: WorkerType;
  /** File paths this worker will modify (for write conflict detection). */
  filePaths?: string[];
  /** Current lifecycle status. */
  status: WorkerStatus;
  /** When the worker was spawned. */
  spawnedAt: number;
  /** When the worker completed (terminal status). */
  completedAt?: number;
  /** Result from the worker (final output text). */
  result?: string;
  /** Error message if failed/killed. */
  error?: string;
  /** Resource usage stats. */
  usage?: WorkerUsage;
}

export interface WorkerUsage {
  totalTokens: number;
  toolUses: number;
  durationMs: number;
}

/**
 * Task notification — XML-formatted result from a worker to the coordinator.
 * Matches Claude Code's <task-notification> format for consistency.
 */
export interface TaskNotification {
  workerId: string;
  status: 'completed' | 'failed' | 'killed';
  summary: string;
  result: string;
  usage: WorkerUsage;
}

/** Synthesis spec — the coordinator's output after the synthesis gate. */
export interface SynthesisSpec {
  /** High-level objective being addressed. */
  objective: string;
  /** Per-file change specs with exact details. */
  fileChanges: FileChangeSpec[];
  /** Any additional context workers need. */
  additionalContext?: string;
  /** When the spec was produced (set automatically by setSynthesisSpec). */
  createdAt?: number;
}

export interface FileChangeSpec {
  /** Absolute or repo-relative file path. */
  filePath: string;
  /** What to change (line numbers, function names, etc.). */
  changeDescription: string;
  /** Why this change is needed (ties back to research findings). */
  rationale: string;
  /** Which worker ID produced the finding driving this change. */
  sourceWorkerId?: string;
}

export interface CoordinatorSessionConfig {
  /** Run ID for the coordinator session. */
  runId: string;
  /** The coordinator's agent role. */
  coordinatorRole: CompanyAgentRole;
  /** Maximum number of concurrent workers. */
  maxConcurrentWorkers?: number;
  /** Maximum total workers across all phases. */
  maxTotalWorkers?: number;
  /** Timeout for individual workers (ms). */
  workerTimeoutMs?: number;
}

export interface CoordinatorSessionStats {
  phase: CoordinatorPhase;
  totalWorkers: number;
  activeWorkers: number;
  completedWorkers: number;
  failedWorkers: number;
  killedWorkers: number;
  totalTokens: number;
  totalToolUses: number;
  totalDurationMs: number;
  phaseHistory: { phase: CoordinatorPhase; enteredAt: number }[];
}

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

/** Valid phase transitions — enforce strict ordering. */
const VALID_TRANSITIONS: Record<CoordinatorPhase, CoordinatorPhase[]> = {
  planning:       ['research', 'implementation'], // Can skip research for simple tasks
  research:       ['synthesis'],                  // Must go through synthesis
  synthesis:      ['implementation'],             // Only forward to implementation
  implementation: ['verification', 'complete'],   // Can skip verification
  verification:   ['complete'],
  complete:       [],                             // Terminal
};

/** Worker type determines what phase they belong to. */
const WORKER_PHASE_MAP: Record<WorkerType, CoordinatorPhase[]> = {
  read_only: ['research', 'planning'],
  write:     ['implementation'],
  verify:    ['verification'],
};

/** Default limits. */
const DEFAULT_MAX_CONCURRENT_WORKERS = 5;
const DEFAULT_MAX_TOTAL_WORKERS = 20;
const DEFAULT_WORKER_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/** Terminal worker statuses. */
const TERMINAL_STATUSES = new Set<WorkerStatus>(['completed', 'failed', 'killed']);

/** Worker ID prefixes by type (for human-readable IDs). */
const WORKER_ID_PREFIX: Record<WorkerType, string> = {
  read_only: 'r',
  write:     'w',
  verify:    'v',
};

// ═══════════════════════════════════════════════════════════════════
// COORDINATOR SESSION
// ═══════════════════════════════════════════════════════════════════

/**
 * Manages the state and lifecycle of a coordinator session.
 *
 * A coordinator session tracks phases, workers, synthesis specs,
 * and enforces the coordination protocol (e.g., synthesis gate).
 */
export class CoordinatorSession {
  readonly runId: string;
  readonly coordinatorRole: CompanyAgentRole;
  private readonly maxConcurrent: number;
  private readonly maxTotal: number;
  readonly workerTimeoutMs: number;

  private phase: CoordinatorPhase = 'planning';
  private workers = new Map<string, WorkerDescriptor>();
  private phaseHistory: { phase: CoordinatorPhase; enteredAt: number }[] = [
    { phase: 'planning', enteredAt: Date.now() },
  ];
  private synthesisSpec: SynthesisSpec | null = null;
  private nextWorkerId = 0;

  constructor(config: CoordinatorSessionConfig) {
    this.runId = config.runId;
    this.coordinatorRole = config.coordinatorRole;
    this.maxConcurrent = config.maxConcurrentWorkers ?? DEFAULT_MAX_CONCURRENT_WORKERS;
    this.maxTotal = config.maxTotalWorkers ?? DEFAULT_MAX_TOTAL_WORKERS;
    this.workerTimeoutMs = config.workerTimeoutMs ?? DEFAULT_WORKER_TIMEOUT_MS;
  }

  // ─── Phase Management ──────────────────────────────────────

  /** Current coordinator phase. */
  getPhase(): CoordinatorPhase {
    return this.phase;
  }

  /**
   * Advance to the next phase. Validates transition legality.
   * Throws if the transition is invalid or if prerequisites aren't met.
   */
  advancePhase(nextPhase: CoordinatorPhase): void {
    const allowed = VALID_TRANSITIONS[this.phase];
    if (!allowed.includes(nextPhase)) {
      throw new Error(
        `[CoordinatorMode] Invalid phase transition: ${this.phase} → ${nextPhase}. ` +
        `Allowed: ${allowed.join(', ') || '(none — terminal)'}`,
      );
    }

    // Synthesis gate: must have all research workers done before synthesis
    if (nextPhase === 'synthesis') {
      const pending = this.getWorkersInPhase('research')
        .filter(w => !TERMINAL_STATUSES.has(w.status));
      if (pending.length > 0) {
        throw new Error(
          `[CoordinatorMode] Cannot enter synthesis: ${pending.length} research ` +
          `worker(s) still active (${pending.map(w => w.id).join(', ')})`,
        );
      }
    }

    // Implementation gate: must have a synthesis spec
    if (nextPhase === 'implementation' && this.phase === 'synthesis') {
      if (!this.synthesisSpec) {
        throw new Error(
          '[CoordinatorMode] Cannot enter implementation without a synthesis spec. ' +
          'Call setSynthesisSpec() with exact file paths, line numbers, and change descriptions.',
        );
      }
    }

    this.phase = nextPhase;
    this.phaseHistory.push({ phase: nextPhase, enteredAt: Date.now() });
  }

  // ─── Worker Management ─────────────────────────────────────

  /**
   * Spawn a new worker. Returns the worker descriptor.
   * Validates concurrency limits and phase compatibility.
   */
  spawnWorker(input: {
    description: string;
    prompt: string;
    assignedRole: CompanyAgentRole;
    workerType: WorkerType;
    filePaths?: string[];
  }): WorkerDescriptor {
    // Capacity check
    if (this.workers.size >= this.maxTotal) {
      throw new Error(
        `[CoordinatorMode] Worker limit reached (${this.maxTotal}). ` +
        'Kill or wait for existing workers before spawning new ones.',
      );
    }

    const active = this.getActiveWorkers();
    if (active.length >= this.maxConcurrent) {
      throw new Error(
        `[CoordinatorMode] Concurrent worker limit reached (${this.maxConcurrent}). ` +
        `Active: ${active.map(w => w.id).join(', ')}`,
      );
    }

    // Phase compatibility check
    const allowedPhases = WORKER_PHASE_MAP[input.workerType];
    if (!allowedPhases.includes(this.phase)) {
      throw new Error(
        `[CoordinatorMode] Cannot spawn ${input.workerType} worker in ${this.phase} phase. ` +
        `Allowed phases for ${input.workerType}: ${allowedPhases.join(', ')}`,
      );
    }

    // Write conflict detection
    if (input.workerType === 'write' && input.filePaths?.length) {
      const conflict = this.detectWriteConflict(input.filePaths);
      if (conflict) {
        throw new Error(
          `[CoordinatorMode] Write conflict: worker ${conflict.workerId} is already ` +
          `modifying ${conflict.filePath}. Wait for it to complete first.`,
        );
      }
    }

    // Generate ID
    const prefix = WORKER_ID_PREFIX[input.workerType];
    const seq = ++this.nextWorkerId;
    const id = `${prefix}-${this.runId.slice(0, 8)}-${seq.toString().padStart(3, '0')}`;

    const worker: WorkerDescriptor = {
      id,
      description: input.description,
      prompt: input.prompt,
      assignedRole: input.assignedRole,
      workerType: input.workerType,
      filePaths: input.filePaths,
      status: 'pending',
      spawnedAt: Date.now(),
    };

    this.workers.set(id, worker);
    return worker;
  }

  /** Mark a worker as running (dispatcher calls this after actual spawn). */
  markWorkerRunning(workerId: string): void {
    const worker = this.getWorkerOrThrow(workerId);
    if (worker.status !== 'pending') {
      throw new Error(`[CoordinatorMode] Worker ${workerId} is ${worker.status}, expected pending`);
    }
    worker.status = 'running';
  }

  /** Mark a worker as completed with its result. */
  markWorkerComplete(workerId: string, result: string, usage?: WorkerUsage): void {
    const worker = this.getWorkerOrThrow(workerId);
    if (TERMINAL_STATUSES.has(worker.status)) {
      return; // Already terminal — idempotent
    }
    worker.status = 'completed';
    worker.completedAt = Date.now();
    worker.result = result;
    worker.usage = usage;
  }

  /** Mark a worker as failed. */
  markWorkerFailed(workerId: string, error: string, usage?: WorkerUsage): void {
    const worker = this.getWorkerOrThrow(workerId);
    if (TERMINAL_STATUSES.has(worker.status)) return;
    worker.status = 'failed';
    worker.completedAt = Date.now();
    worker.error = error;
    worker.usage = usage;
  }

  /** Kill a worker (e.g., timed out or redirected). */
  killWorker(workerId: string, reason?: string): void {
    const worker = this.getWorkerOrThrow(workerId);
    if (TERMINAL_STATUSES.has(worker.status)) return;
    worker.status = 'killed';
    worker.completedAt = Date.now();
    worker.error = reason ?? 'Killed by coordinator';
  }

  /** Get a worker by ID. */
  getWorker(workerId: string): WorkerDescriptor | undefined {
    return this.workers.get(workerId);
  }

  /** Get all workers. */
  getAllWorkers(): WorkerDescriptor[] {
    return Array.from(this.workers.values());
  }

  /** Get workers currently running or pending. */
  getActiveWorkers(): WorkerDescriptor[] {
    return this.getAllWorkers().filter(w => !TERMINAL_STATUSES.has(w.status));
  }

  /** Get workers in a specific phase (by their worker type). */
  getWorkersInPhase(phase: CoordinatorPhase): WorkerDescriptor[] {
    return this.getAllWorkers().filter(w => {
      const phases = WORKER_PHASE_MAP[w.workerType];
      return phases.includes(phase);
    });
  }

  // ─── Synthesis ──────────────────────────────────────────────

  /**
   * Set the synthesis spec. This is REQUIRED before entering implementation.
   * The coordinator must produce this after reading all research worker results.
   */
  setSynthesisSpec(spec: SynthesisSpec): void {
    if (this.phase !== 'synthesis') {
      throw new Error(
        `[CoordinatorMode] Synthesis spec can only be set in synthesis phase (current: ${this.phase})`,
      );
    }
    // Validate: spec must have concrete file changes, not vague descriptions
    if (spec.fileChanges.length === 0) {
      throw new Error(
        '[CoordinatorMode] Synthesis spec must include at least one file change. ' +
        'Read research findings and produce concrete change specs with file paths.',
      );
    }
    for (const change of spec.fileChanges) {
      if (!change.filePath || !change.changeDescription) {
        throw new Error(
          '[CoordinatorMode] Each file change must have a filePath and changeDescription. ' +
          'Be specific: include line numbers, function names, and exact changes.',
        );
      }
    }
    this.synthesisSpec = { ...spec, createdAt: Date.now() };
  }

  /** Get the current synthesis spec (null if not yet produced). */
  getSynthesisSpec(): SynthesisSpec | null {
    return this.synthesisSpec;
  }

  // ─── Notifications ──────────────────────────────────────────

  /**
   * Format a task notification for the coordinator's conversation history.
   * Uses XML format compatible with Claude Code's <task-notification> pattern.
   */
  formatTaskNotification(workerId: string): string {
    const worker = this.getWorkerOrThrow(workerId);
    if (!TERMINAL_STATUSES.has(worker.status)) {
      throw new Error(`[CoordinatorMode] Worker ${workerId} is not in terminal state`);
    }

    const usage = worker.usage ?? { totalTokens: 0, toolUses: 0, durationMs: 0 };
    const statusText = worker.status;
    const summary = worker.status === 'completed'
      ? `Worker completed: ${worker.description}`
      : `Worker ${worker.status}: ${worker.error ?? worker.description}`;

    return [
      '<task-notification>',
      `  <worker-id>${escapeXml(worker.id)}</worker-id>`,
      `  <status>${statusText}</status>`,
      `  <description>${escapeXml(worker.description)}</description>`,
      `  <summary>${escapeXml(summary)}</summary>`,
      `  <result>${escapeXml(worker.result ?? worker.error ?? '')}</result>`,
      '  <usage>',
      `    <total_tokens>${usage.totalTokens}</total_tokens>`,
      `    <tool_uses>${usage.toolUses}</tool_uses>`,
      `    <duration_ms>${usage.durationMs}</duration_ms>`,
      '  </usage>',
      '</task-notification>',
    ].join('\n');
  }

  // ─── Stats ──────────────────────────────────────────────────

  /** Get session statistics. */
  getStats(): CoordinatorSessionStats {
    const all = this.getAllWorkers();
    let totalTokens = 0;
    let totalToolUses = 0;
    let totalDurationMs = 0;

    for (const w of all) {
      if (w.usage) {
        totalTokens += w.usage.totalTokens;
        totalToolUses += w.usage.toolUses;
        totalDurationMs += w.usage.durationMs;
      }
    }

    return {
      phase: this.phase,
      totalWorkers: all.length,
      activeWorkers: all.filter(w => !TERMINAL_STATUSES.has(w.status)).length,
      completedWorkers: all.filter(w => w.status === 'completed').length,
      failedWorkers: all.filter(w => w.status === 'failed').length,
      killedWorkers: all.filter(w => w.status === 'killed').length,
      totalTokens,
      totalToolUses,
      totalDurationMs,
      phaseHistory: [...this.phaseHistory],
    };
  }

  // ─── Internal ───────────────────────────────────────────────

  private getWorkerOrThrow(workerId: string): WorkerDescriptor {
    const worker = this.workers.get(workerId);
    if (!worker) {
      throw new Error(`[CoordinatorMode] Worker not found: ${workerId}`);
    }
    return worker;
  }

  /** Check if any active write worker conflicts with the given file paths. */
  private detectWriteConflict(filePaths: string[]): { workerId: string; filePath: string } | null {
    const active = this.getActiveWorkers().filter(w => w.workerType === 'write');
    for (const worker of active) {
      if (!worker.filePaths) continue;
      for (const fp of filePaths) {
        if (worker.filePaths.includes(fp)) {
          return { workerId: worker.id, filePath: fp };
        }
      }
    }
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a new coordinator session.
 */
export function createCoordinatorSession(
  config: CoordinatorSessionConfig,
): CoordinatorSession {
  return new CoordinatorSession(config);
}

// ═══════════════════════════════════════════════════════════════════
// SYNTHESIS VALIDATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Anti-patterns that indicate lazy delegation in synthesis specs.
 * The coordinator MUST synthesize findings into specific, actionable specs.
 */
const LAZY_DELEGATION_PATTERNS = [
  /based on (?:your|the) (?:findings|research|analysis)/i,
  /as (?:you|the worker) (?:found|discovered|identified)/i,
  /implement (?:the|your) (?:findings|recommendations)/i,
  /fix (?:the|all) (?:issues|problems|bugs) (?:you|they) found/i,
  /do what (?:you|they) suggested/i,
  /follow up on (?:the|your) (?:previous|earlier) work/i,
];

/**
 * Validate that worker prompts are self-contained and not lazily delegated.
 * Returns null if valid, or an error message describing the problem.
 */
export function validateWorkerPrompt(prompt: string): string | null {
  for (const pattern of LAZY_DELEGATION_PATTERNS) {
    if (pattern.test(prompt)) {
      return (
        'Worker prompt contains lazy delegation language: workers cannot see ' +
        'coordinator context or other workers\' outputs. Rewrite the prompt with ' +
        'specific file paths, line numbers, and exact changes. ' +
        `Matched: ${pattern.source}`
      );
    }
  }

  // Minimum specificity: prompt should mention at least one concrete reference
  const hasFilePath = /(?:\/[\w.-]+){2,}|[\w.-]+\.\w{1,4}(?:\s|$|:)/m.test(prompt);
  const hasLineRef = /line\s+\d+|L\d+|#L\d+/i.test(prompt);
  const hasFunctionRef = /function\s+\w+|class\s+\w+|method\s+\w+|`\w+\(\)`/i.test(prompt);
  const hasCodeBlock = /```[\s\S]*?```/.test(prompt);

  // For write workers, require at least one concrete reference
  // (read_only workers are allowed to be more exploratory)
  const hasConcreteRef = hasFilePath || hasLineRef || hasFunctionRef || hasCodeBlock;

  if (prompt.length < 50) {
    return 'Worker prompt is too short. Include full context — workers have no shared state.';
  }

  return null; // Valid
}

/**
 * Validate a synthesis spec for completeness and specificity.
 * Returns null if valid, or an error message.
 */
export function validateSynthesisSpec(spec: SynthesisSpec): string | null {
  if (!spec.objective || spec.objective.length < 10) {
    return 'Synthesis spec must have a clear objective (at least 10 characters).';
  }

  if (spec.fileChanges.length === 0) {
    return 'Synthesis spec must include at least one file change.';
  }

  for (let i = 0; i < spec.fileChanges.length; i++) {
    const change = spec.fileChanges[i];
    if (!change.filePath) {
      return `File change #${i + 1} is missing filePath.`;
    }
    if (!change.changeDescription || change.changeDescription.length < 20) {
      return `File change #${i + 1} (${change.filePath}) needs a more specific changeDescription (at least 20 chars).`;
    }
    if (!change.rationale) {
      return `File change #${i + 1} (${change.filePath}) is missing rationale. Explain WHY this change is needed.`;
    }
  }

  return null; // Valid
}

// ═══════════════════════════════════════════════════════════════════
// PROMPT GENERATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Coordinator system prompt section — injected into orchestrator agents
 * when coordinator mode is active. Teaches the research → synthesis →
 * implementation → verification workflow.
 */
export const COORDINATOR_PROMPT = `## Coordinator Mode

You are operating in **Coordinator Mode** — you orchestrate work by spawning
parallel workers, synthesizing their findings, and driving to completion.

### Your Workflow Phases

| Phase | Who Does It | Purpose |
|-------|-------------|---------|
| **Research** | Workers (parallel) | Investigate, read files, understand the codebase |
| **Synthesis** | **You** (coordinator) | Read findings, understand deeply, write exact specs |
| **Implementation** | Workers (sequential per file) | Make changes per your spec |
| **Verification** | Workers (parallel) | Test, review, validate |

### Critical Rules

1. **Workers are stateless**: Each worker starts fresh. They cannot see your
   conversation, other workers' outputs, or previous turns. Every prompt must
   be completely self-contained.

2. **Synthesis is YOUR job**: After research workers complete, YOU must read
   their findings and produce a specific implementation spec with:
   - Exact file paths
   - Line numbers or function names
   - What to change and why
   - Code examples where helpful

3. **NEVER delegate lazily**: Do NOT write prompts like:
   - ❌ "Based on your findings, fix the issues"
   - ❌ "Implement the recommendations from the research"
   - ❌ "Fix the bugs they found"
   
   Instead, write prompts like:
   - ✅ "In src/auth/validate.ts, line 42: Session.user is undefined when expired.
     Add a null check before user.id access. Return 401 with 'Session expired' message."

4. **Parallelism**: Read-only tasks run in parallel freely. Write tasks
   run one at a time per file to prevent conflicts.

5. **Cost awareness**: Every worker call costs money. Don't spawn workers
   for things you can answer directly from existing context.`;

/**
 * Build a worker context block — tells the coordinator what capabilities
 * its workers have access to.
 */
export function buildWorkerCapabilityContext(
  availableTools: string[],
  availableRoles: CompanyAgentRole[],
): string {
  const parts = [
    '### Worker Capabilities',
    '',
    '**Available worker roles:**',
    ...availableRoles.map(r => `- \`${r}\``),
    '',
    '**Tools workers can use:**',
    ...availableTools.slice(0, 30).map(t => `- \`${t}\``),
  ];

  if (availableTools.length > 30) {
    parts.push(`- ... and ${availableTools.length - 30} more`);
  }

  return parts.join('\n');
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

/** Minimal XML escaping for task notification content. */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Check whether an agent role is eligible to be a coordinator.
 * Only orchestrator-archetype roles can enter coordinator mode.
 */
export const COORDINATOR_ELIGIBLE_ROLES = new Set<CompanyAgentRole>([
  'chief-of-staff',
  'cto',
  'clo',
  'vp-research',
  'ops',
]);

export function isCoordinatorEligible(role: CompanyAgentRole): boolean {
  return COORDINATOR_ELIGIBLE_ROLES.has(role);
}
