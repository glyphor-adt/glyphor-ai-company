import { describe, expect, it, beforeEach } from 'vitest';
import {
  CoordinatorSession,
  createCoordinatorSession,
  validateWorkerPrompt,
  validateSynthesisSpec,
  isCoordinatorEligible,
  COORDINATOR_ELIGIBLE_ROLES,
  COORDINATOR_PROMPT,
  buildWorkerCapabilityContext,
  type CoordinatorPhase,
  type SynthesisSpec,
  type CoordinatorSessionConfig,
} from '../coordinatorMode.js';
import type { CompanyAgentRole } from '../types.js';

// ─── Helpers ─────────────────────────────────────────────────────

const CTO: CompanyAgentRole = 'cto';
const DEVOPS: CompanyAgentRole = 'devops-engineer';
const COS: CompanyAgentRole = 'chief-of-staff';
const CMO: CompanyAgentRole = 'cmo';
const FRONTEND: CompanyAgentRole = 'platform-engineer';

function defaultConfig(overrides?: Partial<CoordinatorSessionConfig>): CoordinatorSessionConfig {
  return {
    runId: 'test-run-001',
    coordinatorRole: CTO,
    ...overrides,
  };
}

function validSynthesisSpec(overrides?: Partial<SynthesisSpec>): SynthesisSpec {
  return {
    objective: 'Fix null pointer in auth validation',
    fileChanges: [{
      filePath: 'src/auth/validate.ts',
      changeDescription: 'Add null check for Session.user before accessing user.id on line 42',
      rationale: 'Research worker r-test-001 found that expired sessions have null user field',
      sourceWorkerId: 'r-test-001',
    }],
    ...overrides,
  };
}

let session: CoordinatorSession;

beforeEach(() => {
  session = createCoordinatorSession(defaultConfig());
});

// ═════════════════════════════════════════════════════════════════
// Factory
// ═════════════════════════════════════════════════════════════════

describe('createCoordinatorSession()', () => {
  it('creates a session starting in planning phase', () => {
    expect(session.getPhase()).toBe('planning');
  });

  it('uses provided config values', () => {
    const s = createCoordinatorSession({
      runId: 'custom-123',
      coordinatorRole: COS,
      maxConcurrentWorkers: 3,
      maxTotalWorkers: 10,
      workerTimeoutMs: 60_000,
    });
    expect(s.runId).toBe('custom-123');
    expect(s.coordinatorRole).toBe('chief-of-staff');
    expect(s.workerTimeoutMs).toBe(60_000);
  });
});

// ═════════════════════════════════════════════════════════════════
// Phase Management
// ═════════════════════════════════════════════════════════════════

describe('phase management', () => {
  it('allows planning → research transition', () => {
    session.advancePhase('research');
    expect(session.getPhase()).toBe('research');
  });

  it('allows planning → implementation (skip research for simple tasks)', () => {
    session.advancePhase('implementation');
    expect(session.getPhase()).toBe('implementation');
  });

  it('allows research → synthesis transition', () => {
    session.advancePhase('research');
    session.advancePhase('synthesis');
    expect(session.getPhase()).toBe('synthesis');
  });

  it('blocks research → implementation (must go through synthesis)', () => {
    session.advancePhase('research');
    expect(() => session.advancePhase('implementation')).toThrow('Invalid phase transition');
  });

  it('blocks synthesis → research (no going back)', () => {
    session.advancePhase('research');
    session.advancePhase('synthesis');
    expect(() => session.advancePhase('research')).toThrow('Invalid phase transition');
  });

  it('blocks implementation without synthesis spec', () => {
    session.advancePhase('research');
    session.advancePhase('synthesis');
    expect(() => session.advancePhase('implementation')).toThrow('synthesis spec');
  });

  it('allows implementation after setting synthesis spec', () => {
    session.advancePhase('research');
    session.advancePhase('synthesis');
    session.setSynthesisSpec(validSynthesisSpec());
    session.advancePhase('implementation');
    expect(session.getPhase()).toBe('implementation');
  });

  it('blocks synthesis while research workers are still active', () => {
    session.advancePhase('research');
    session.spawnWorker({
      description: 'Read codebase',
      prompt: 'Read src/auth/validate.ts and report findings about Session handling',
      assignedRole: DEVOPS,
      workerType: 'read_only',
    });
    expect(() => session.advancePhase('synthesis')).toThrow('research worker(s) still active');
  });

  it('allows synthesis after all research workers complete', () => {
    session.advancePhase('research');
    const w = session.spawnWorker({
      description: 'Read codebase',
      prompt: 'Read src/auth/validate.ts and report findings about Session handling',
      assignedRole: DEVOPS,
      workerType: 'read_only',
    });
    session.markWorkerRunning(w.id);
    session.markWorkerComplete(w.id, 'Found null pointer issue');
    session.advancePhase('synthesis');
    expect(session.getPhase()).toBe('synthesis');
  });

  it('records phase history', () => {
    session.advancePhase('research');
    session.advancePhase('synthesis');
    const stats = session.getStats();
    expect(stats.phaseHistory).toHaveLength(3); // planning + research + synthesis
    expect(stats.phaseHistory[0].phase).toBe('planning');
    expect(stats.phaseHistory[1].phase).toBe('research');
    expect(stats.phaseHistory[2].phase).toBe('synthesis');
  });

  it('complete is terminal (no transitions out)', () => {
    session.advancePhase('implementation');
    session.advancePhase('complete');
    expect(() => session.advancePhase('verification')).toThrow('Invalid phase transition');
  });
});

// ═════════════════════════════════════════════════════════════════
// Worker Lifecycle
// ═════════════════════════════════════════════════════════════════

describe('worker lifecycle', () => {
  it('spawns a worker in pending status', () => {
    session.advancePhase('research');
    const w = session.spawnWorker({
      description: 'Analyze auth module',
      prompt: 'Read src/auth/validate.ts and find null handling issues',
      assignedRole: DEVOPS,
      workerType: 'read_only',
    });
    expect(w.status).toBe('pending');
    expect(w.assignedRole).toBe('devops-engineer');
    expect(w.workerType).toBe('read_only');
    expect(w.id).toMatch(/^r-/); // read_only prefix
  });

  it('generates sequential IDs with type prefix', () => {
    session.advancePhase('research');
    const w1 = session.spawnWorker({
      description: 'Task 1',
      prompt: 'Read src/auth/validate.ts file',
      assignedRole: DEVOPS,
      workerType: 'read_only',
    });
    const w2 = session.spawnWorker({
      description: 'Task 2',
      prompt: 'Read src/auth/session.ts file',
      assignedRole: DEVOPS,
      workerType: 'read_only',
    });
    expect(w1.id).toContain('-001');
    expect(w2.id).toContain('-002');
  });

  it('transitions pending → running → completed', () => {
    session.advancePhase('research');
    const w = session.spawnWorker({
      description: 'Task',
      prompt: 'Read src/auth/validate.ts and find issues',
      assignedRole: DEVOPS,
      workerType: 'read_only',
    });
    session.markWorkerRunning(w.id);
    expect(session.getWorker(w.id)!.status).toBe('running');

    session.markWorkerComplete(w.id, 'Found issues on line 42', {
      totalTokens: 500,
      toolUses: 3,
      durationMs: 5000,
    });
    const completed = session.getWorker(w.id)!;
    expect(completed.status).toBe('completed');
    expect(completed.result).toBe('Found issues on line 42');
    expect(completed.usage?.totalTokens).toBe(500);
    expect(completed.completedAt).toBeGreaterThan(0);
  });

  it('transitions to failed status', () => {
    session.advancePhase('research');
    const w = session.spawnWorker({
      description: 'Task',
      prompt: 'Read src/auth/validate.ts and find issues',
      assignedRole: DEVOPS,
      workerType: 'read_only',
    });
    session.markWorkerRunning(w.id);
    session.markWorkerFailed(w.id, 'Timeout exceeded');
    expect(session.getWorker(w.id)!.status).toBe('failed');
    expect(session.getWorker(w.id)!.error).toBe('Timeout exceeded');
  });

  it('kill is idempotent on terminal workers', () => {
    session.advancePhase('research');
    const w = session.spawnWorker({
      description: 'Task',
      prompt: 'Read src/auth/validate.ts and find issues',
      assignedRole: DEVOPS,
      workerType: 'read_only',
    });
    session.markWorkerRunning(w.id);
    session.markWorkerComplete(w.id, 'Done');
    session.killWorker(w.id, 'Too late'); // Should not throw
    expect(session.getWorker(w.id)!.status).toBe('completed'); // Still completed
  });

  it('throws when marking non-pending worker as running', () => {
    session.advancePhase('research');
    const w = session.spawnWorker({
      description: 'Task',
      prompt: 'Read src/auth/validate.ts and find issues',
      assignedRole: DEVOPS,
      workerType: 'read_only',
    });
    session.markWorkerRunning(w.id);
    expect(() => session.markWorkerRunning(w.id)).toThrow('expected pending');
  });

  it('throws when accessing non-existent worker', () => {
    expect(() => session.markWorkerRunning('nonexistent')).toThrow('Worker not found');
  });
});

// ═════════════════════════════════════════════════════════════════
// Worker Limits & Phase Compatibility
// ═════════════════════════════════════════════════════════════════

describe('worker limits', () => {
  it('enforces max total workers', () => {
    const s = createCoordinatorSession(defaultConfig({ maxTotalWorkers: 2 }));
    s.advancePhase('research');
    s.spawnWorker({ description: 'A', prompt: 'Read src/a.ts', assignedRole: DEVOPS, workerType: 'read_only' });
    s.spawnWorker({ description: 'B', prompt: 'Read src/b.ts', assignedRole: DEVOPS, workerType: 'read_only' });
    expect(() =>
      s.spawnWorker({ description: 'C', prompt: 'Read src/c.ts', assignedRole: DEVOPS, workerType: 'read_only' }),
    ).toThrow('Worker limit reached');
  });

  it('enforces max concurrent workers', () => {
    const s = createCoordinatorSession(defaultConfig({ maxConcurrentWorkers: 1, maxTotalWorkers: 10 }));
    s.advancePhase('research');
    s.spawnWorker({ description: 'A', prompt: 'Read src/a.ts', assignedRole: DEVOPS, workerType: 'read_only' });
    expect(() =>
      s.spawnWorker({ description: 'B', prompt: 'Read src/b.ts', assignedRole: DEVOPS, workerType: 'read_only' }),
    ).toThrow('Concurrent worker limit');
  });

  it('allows spawning after previous workers complete', () => {
    const s = createCoordinatorSession(defaultConfig({ maxConcurrentWorkers: 1, maxTotalWorkers: 10 }));
    s.advancePhase('research');
    const w1 = s.spawnWorker({ description: 'A', prompt: 'Read src/a.ts', assignedRole: DEVOPS, workerType: 'read_only' });
    s.markWorkerRunning(w1.id);
    s.markWorkerComplete(w1.id, 'Done');
    // Now slot is free
    const w2 = s.spawnWorker({ description: 'B', prompt: 'Read src/b.ts', assignedRole: DEVOPS, workerType: 'read_only' });
    expect(w2.status).toBe('pending');
  });

  it('blocks write workers in research phase', () => {
    session.advancePhase('research');
    expect(() =>
      session.spawnWorker({
        description: 'Write task',
        prompt: 'Edit src/auth/validate.ts line 42',
        assignedRole: DEVOPS,
        workerType: 'write',
      }),
    ).toThrow('Cannot spawn write worker in research phase');
  });

  it('blocks read_only workers in implementation phase', () => {
    session.advancePhase('implementation');
    expect(() =>
      session.spawnWorker({
        description: 'Read task',
        prompt: 'Read src/auth/validate.ts',
        assignedRole: DEVOPS,
        workerType: 'read_only',
      }),
    ).toThrow('Cannot spawn read_only worker in implementation phase');
  });

  it('allows write workers in implementation phase', () => {
    session.advancePhase('implementation');
    const w = session.spawnWorker({
      description: 'Fix null pointer',
      prompt: 'In src/auth/validate.ts, add null check at line 42 for Session.user',
      assignedRole: DEVOPS,
      workerType: 'write',
      filePaths: ['src/auth/validate.ts'],
    });
    expect(w.workerType).toBe('write');
    expect(w.id).toMatch(/^w-/);
  });

  it('allows verify workers in verification phase', () => {
    session.advancePhase('implementation');
    session.advancePhase('verification');
    const w = session.spawnWorker({
      description: 'Run tests',
      prompt: 'Run vitest for src/auth/ and report results',
      assignedRole: DEVOPS,
      workerType: 'verify',
    });
    expect(w.workerType).toBe('verify');
    expect(w.id).toMatch(/^v-/);
  });
});

// ═════════════════════════════════════════════════════════════════
// Write Conflict Detection
// ═════════════════════════════════════════════════════════════════

describe('write conflict detection', () => {
  it('detects file conflicts between active write workers', () => {
    session.advancePhase('implementation');
    session.spawnWorker({
      description: 'Edit A',
      prompt: 'In src/auth/validate.ts, fix null pointer at line 42',
      assignedRole: DEVOPS,
      workerType: 'write',
      filePaths: ['src/auth/validate.ts'],
    });
    expect(() =>
      session.spawnWorker({
        description: 'Edit B',
        prompt: 'In src/auth/validate.ts, add logging at line 10',
        assignedRole: FRONTEND,
        workerType: 'write',
        filePaths: ['src/auth/validate.ts'],
      }),
    ).toThrow('Write conflict');
  });

  it('allows different files to be written concurrently', () => {
    session.advancePhase('implementation');
    session.spawnWorker({
      description: 'Edit A',
      prompt: 'In src/auth/validate.ts, fix null pointer at line 42',
      assignedRole: DEVOPS,
      workerType: 'write',
      filePaths: ['src/auth/validate.ts'],
    });
    const w2 = session.spawnWorker({
      description: 'Edit B',
      prompt: 'In src/auth/session.ts, add expiry check at line 15',
      assignedRole: FRONTEND,
      workerType: 'write',
      filePaths: ['src/auth/session.ts'],
    });
    expect(w2.status).toBe('pending');
  });

  it('allows same file after previous writer completes', () => {
    session.advancePhase('implementation');
    const w1 = session.spawnWorker({
      description: 'Edit A',
      prompt: 'In src/auth/validate.ts, fix null pointer at line 42',
      assignedRole: DEVOPS,
      workerType: 'write',
      filePaths: ['src/auth/validate.ts'],
    });
    session.markWorkerRunning(w1.id);
    session.markWorkerComplete(w1.id, 'Fixed');
    // Now same file is available
    const w2 = session.spawnWorker({
      description: 'Edit A again',
      prompt: 'In src/auth/validate.ts, add logging at line 10',
      assignedRole: FRONTEND,
      workerType: 'write',
      filePaths: ['src/auth/validate.ts'],
    });
    expect(w2.status).toBe('pending');
  });
});

// ═════════════════════════════════════════════════════════════════
// Synthesis
// ═════════════════════════════════════════════════════════════════

describe('synthesis spec', () => {
  it('rejects setting spec outside synthesis phase', () => {
    expect(() => session.setSynthesisSpec(validSynthesisSpec())).toThrow('synthesis phase');
  });

  it('accepts valid spec in synthesis phase', () => {
    session.advancePhase('research');
    session.advancePhase('synthesis');
    session.setSynthesisSpec(validSynthesisSpec());
    expect(session.getSynthesisSpec()).not.toBeNull();
    expect(session.getSynthesisSpec()!.objective).toBe('Fix null pointer in auth validation');
  });

  it('rejects spec with no file changes', () => {
    session.advancePhase('research');
    session.advancePhase('synthesis');
    expect(() =>
      session.setSynthesisSpec({ ...validSynthesisSpec(), fileChanges: [] }),
    ).toThrow('at least one file change');
  });

  it('rejects spec with missing filePath', () => {
    session.advancePhase('research');
    session.advancePhase('synthesis');
    expect(() =>
      session.setSynthesisSpec({
        ...validSynthesisSpec(),
        fileChanges: [{ filePath: '', changeDescription: 'Fix something important here', rationale: 'Research found it' }],
      }),
    ).toThrow('filePath and changeDescription');
  });

  it('returns null before spec is set', () => {
    expect(session.getSynthesisSpec()).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════
// Task Notifications
// ═════════════════════════════════════════════════════════════════

describe('task notifications', () => {
  it('formats completed worker as XML notification', () => {
    session.advancePhase('research');
    const w = session.spawnWorker({
      description: 'Analyze auth',
      prompt: 'Read src/auth/validate.ts and find issues',
      assignedRole: DEVOPS,
      workerType: 'read_only',
    });
    session.markWorkerRunning(w.id);
    session.markWorkerComplete(w.id, 'Found null issue on line 42', {
      totalTokens: 500,
      toolUses: 3,
      durationMs: 2000,
    });

    const xml = session.formatTaskNotification(w.id);
    expect(xml).toContain('<task-notification>');
    expect(xml).toContain(`<worker-id>${w.id}</worker-id>`);
    expect(xml).toContain('<status>completed</status>');
    expect(xml).toContain('Found null issue on line 42');
    expect(xml).toContain('<total_tokens>500</total_tokens>');
    expect(xml).toContain('</task-notification>');
  });

  it('formats failed worker notification', () => {
    session.advancePhase('research');
    const w = session.spawnWorker({
      description: 'Task',
      prompt: 'Read src/auth/validate.ts and analyze',
      assignedRole: DEVOPS,
      workerType: 'read_only',
    });
    session.markWorkerRunning(w.id);
    session.markWorkerFailed(w.id, 'Timed out after 5 minutes');

    const xml = session.formatTaskNotification(w.id);
    expect(xml).toContain('<status>failed</status>');
    expect(xml).toContain('Timed out after 5 minutes');
  });

  it('throws for non-terminal workers', () => {
    session.advancePhase('research');
    const w = session.spawnWorker({
      description: 'Task',
      prompt: 'Read src/auth/validate.ts and analyze',
      assignedRole: DEVOPS,
      workerType: 'read_only',
    });
    expect(() => session.formatTaskNotification(w.id)).toThrow('not in terminal state');
  });

  it('escapes XML special characters in results', () => {
    session.advancePhase('research');
    const w = session.spawnWorker({
      description: 'Task',
      prompt: 'Read src/auth/validate.ts analysis',
      assignedRole: DEVOPS,
      workerType: 'read_only',
    });
    session.markWorkerRunning(w.id);
    session.markWorkerComplete(w.id, 'Found <script>alert("xss")</script> in output');
    const xml = session.formatTaskNotification(w.id);
    expect(xml).not.toContain('<script>');
    expect(xml).toContain('&lt;script&gt;');
  });
});

// ═════════════════════════════════════════════════════════════════
// Stats
// ═════════════════════════════════════════════════════════════════

describe('getStats()', () => {
  it('reports correct counts across statuses', () => {
    session.advancePhase('research');
    const w1 = session.spawnWorker({ description: 'A', prompt: 'Read src/a.ts', assignedRole: DEVOPS, workerType: 'read_only' });
    const w2 = session.spawnWorker({ description: 'B', prompt: 'Read src/b.ts', assignedRole: DEVOPS, workerType: 'read_only' });
    const w3 = session.spawnWorker({ description: 'C', prompt: 'Read src/c.ts', assignedRole: DEVOPS, workerType: 'read_only' });

    session.markWorkerRunning(w1.id);
    session.markWorkerComplete(w1.id, 'Done', { totalTokens: 100, toolUses: 2, durationMs: 1000 });
    session.markWorkerRunning(w2.id);
    session.markWorkerFailed(w2.id, 'Error', { totalTokens: 50, toolUses: 1, durationMs: 500 });
    session.killWorker(w3.id, 'Cancelled');

    const stats = session.getStats();
    expect(stats.totalWorkers).toBe(3);
    expect(stats.completedWorkers).toBe(1);
    expect(stats.failedWorkers).toBe(1);
    expect(stats.killedWorkers).toBe(1);
    expect(stats.activeWorkers).toBe(0);
    expect(stats.totalTokens).toBe(150);
    expect(stats.totalToolUses).toBe(3);
    expect(stats.totalDurationMs).toBe(1500);
  });
});

// ═════════════════════════════════════════════════════════════════
// validateWorkerPrompt
// ═════════════════════════════════════════════════════════════════

describe('validateWorkerPrompt()', () => {
  it('rejects lazy delegation language', () => {
    const result = validateWorkerPrompt(
      'Based on your findings in the auth module, fix the issues that were discovered during research.',
    );
    expect(result).not.toBeNull();
    expect(result).toContain('lazy delegation');
  });

  it('rejects "implement the recommendations"', () => {
    const result = validateWorkerPrompt(
      'Implement the recommendations from the research phase in the codebase.',
    );
    expect(result).not.toBeNull();
  });

  it('accepts specific, self-contained prompts', () => {
    const result = validateWorkerPrompt(
      'In src/auth/validate.ts, line 42: Session.user is undefined when expired. ' +
      'Add a null check before user.id access. Return 401 with "Session expired" message.',
    );
    expect(result).toBeNull();
  });

  it('rejects prompts that are too short', () => {
    const result = validateWorkerPrompt('Fix the bug.');
    expect(result).not.toBeNull();
    expect(result).toContain('too short');
  });

  it('accepts long research prompts without file references', () => {
    const result = validateWorkerPrompt(
      'Search the authentication and authorization modules for any places where Session objects ' +
      'are accessed without null checks. Look for patterns like session.user.id, session.token, ' +
      'and similar property access chains. Report all locations found with file names and line numbers.',
    );
    expect(result).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════
// validateSynthesisSpec
// ═════════════════════════════════════════════════════════════════

describe('validateSynthesisSpec()', () => {
  it('accepts a valid spec', () => {
    expect(validateSynthesisSpec(validSynthesisSpec())).toBeNull();
  });

  it('rejects missing objective', () => {
    const result = validateSynthesisSpec({ ...validSynthesisSpec(), objective: '' });
    expect(result).toContain('objective');
  });

  it('rejects empty file changes', () => {
    const result = validateSynthesisSpec({ ...validSynthesisSpec(), fileChanges: [] });
    expect(result).toContain('at least one file change');
  });

  it('rejects file change with short description', () => {
    const result = validateSynthesisSpec({
      ...validSynthesisSpec(),
      fileChanges: [{
        filePath: 'src/auth/validate.ts',
        changeDescription: 'Fix it',
        rationale: 'It is broken',
      }],
    });
    expect(result).toContain('more specific');
  });

  it('rejects file change without rationale', () => {
    const result = validateSynthesisSpec({
      ...validSynthesisSpec(),
      fileChanges: [{
        filePath: 'src/auth/validate.ts',
        changeDescription: 'Add null check for Session.user before accessing user.id on line 42',
        rationale: '',
      }],
    });
    expect(result).toContain('rationale');
  });
});

// ═════════════════════════════════════════════════════════════════
// isCoordinatorEligible
// ═════════════════════════════════════════════════════════════════

describe('isCoordinatorEligible()', () => {
  it('returns true for orchestrator roles', () => {
    expect(isCoordinatorEligible(CTO)).toBe(true);
    expect(isCoordinatorEligible(COS)).toBe(true);
    expect(isCoordinatorEligible('vp-research')).toBe(true);
    expect(isCoordinatorEligible('ops')).toBe(true);
    expect(isCoordinatorEligible('clo')).toBe(true);
  });

  it('returns false for task-tier roles', () => {
    expect(isCoordinatorEligible(DEVOPS)).toBe(false);
    expect(isCoordinatorEligible(FRONTEND)).toBe(false);
    expect(isCoordinatorEligible(CMO)).toBe(false);
    expect(isCoordinatorEligible('cmo')).toBe(false);
  });

  it('COORDINATOR_ELIGIBLE_ROLES set contains exactly 5 roles', () => {
    expect(COORDINATOR_ELIGIBLE_ROLES.size).toBe(5);
  });
});

// ═════════════════════════════════════════════════════════════════
// Prompt Generation
// ═════════════════════════════════════════════════════════════════

describe('COORDINATOR_PROMPT', () => {
  it('contains key instruction sections', () => {
    expect(COORDINATOR_PROMPT).toContain('Coordinator Mode');
    expect(COORDINATOR_PROMPT).toContain('Synthesis');
    expect(COORDINATOR_PROMPT).toContain('NEVER delegate lazily');
    expect(COORDINATOR_PROMPT).toContain('Workers are stateless');
  });
});

describe('buildWorkerCapabilityContext()', () => {
  it('lists available tools and roles', () => {
    const ctx = buildWorkerCapabilityContext(
      ['read_file', 'write_file', 'search_code'],
      [DEVOPS, FRONTEND],
    );
    expect(ctx).toContain('read_file');
    expect(ctx).toContain('write_file');
    expect(ctx).toContain('devops-engineer');
    expect(ctx).toContain('platform-engineer');
  });

  it('truncates long tool lists with count', () => {
    const tools = Array.from({ length: 40 }, (_, i) => `tool_${i}`);
    const ctx = buildWorkerCapabilityContext(tools, []);
    expect(ctx).toContain('tool_0');
    expect(ctx).toContain('tool_29');
    expect(ctx).toContain('and 10 more');
    expect(ctx).not.toContain('tool_30');
  });
});

// ═════════════════════════════════════════════════════════════════
// Full Workflow Integration
// ═════════════════════════════════════════════════════════════════

describe('full coordinator workflow', () => {
  it('completes research → synthesis → implementation → verification → complete', () => {
    // Phase 1: Research
    session.advancePhase('research');
    const r1 = session.spawnWorker({
      description: 'Investigate auth module',
      prompt: 'Read src/auth/validate.ts, src/auth/session.ts. Find null pointer issues.',
      assignedRole: DEVOPS,
      workerType: 'read_only',
    });
    const r2 = session.spawnWorker({
      description: 'Investigate tests',
      prompt: 'Read src/auth/__tests__/ and list which functions lack null checks in tests.',
      assignedRole: FRONTEND,
      workerType: 'read_only',
    });
    session.markWorkerRunning(r1.id);
    session.markWorkerRunning(r2.id);
    session.markWorkerComplete(r1.id, 'Line 42: Session.user nullable, Line 87: token.exp unchecked', {
      totalTokens: 400, toolUses: 5, durationMs: 3000,
    });
    session.markWorkerComplete(r2.id, 'No test for expired session path', {
      totalTokens: 200, toolUses: 2, durationMs: 1500,
    });

    // Phase 2: Synthesis
    session.advancePhase('synthesis');
    session.setSynthesisSpec({
      objective: 'Fix null pointer crashes in auth validation',
      fileChanges: [
        {
          filePath: 'src/auth/validate.ts',
          changeDescription: 'Add `if (!session.user) return { status: 401, message: "Session expired" }` before line 42',
          rationale: 'Worker r1 found Session.user is nullable when expired',
          sourceWorkerId: r1.id,
        },
        {
          filePath: 'src/auth/validate.ts',
          changeDescription: 'Add `if (!token.exp || token.exp < Date.now()) throw new TokenExpiredError()` at line 87',
          rationale: 'Worker r1 found token.exp unchecked',
          sourceWorkerId: r1.id,
        },
      ],
    });

    // Phase 3: Implementation
    session.advancePhase('implementation');
    const w1 = session.spawnWorker({
      description: 'Fix validate.ts null checks',
      prompt: 'In src/auth/validate.ts:\n1. Line 42: Add `if (!session.user) return { status: 401 }`\n2. Line 87: Add token.exp check',
      assignedRole: DEVOPS,
      workerType: 'write',
      filePaths: ['src/auth/validate.ts'],
    });
    session.markWorkerRunning(w1.id);
    session.markWorkerComplete(w1.id, 'Fixed both issues, committed', {
      totalTokens: 600, toolUses: 4, durationMs: 8000,
    });

    // Phase 4: Verification
    session.advancePhase('verification');
    const v1 = session.spawnWorker({
      description: 'Run auth tests',
      prompt: 'Run `npx vitest run src/auth/` and report pass/fail status',
      assignedRole: DEVOPS,
      workerType: 'verify',
    });
    session.markWorkerRunning(v1.id);
    session.markWorkerComplete(v1.id, 'All 12 tests pass', {
      totalTokens: 150, toolUses: 1, durationMs: 2000,
    });

    // Phase 5: Complete
    session.advancePhase('complete');

    const stats = session.getStats();
    expect(stats.phase).toBe('complete');
    expect(stats.totalWorkers).toBe(4);
    expect(stats.completedWorkers).toBe(4);
    expect(stats.failedWorkers).toBe(0);
    expect(stats.totalTokens).toBe(1350);
    expect(stats.phaseHistory).toHaveLength(6); // all 6 phases
  });
});
