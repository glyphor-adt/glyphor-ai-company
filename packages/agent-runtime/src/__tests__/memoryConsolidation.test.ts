import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { CompanyAgentRole, AgentMemory, AgentReflection } from '../types.js';

// ═══════════════════════════════════════════════════════════════════
// DB MOCK
// ═══════════════════════════════════════════════════════════════════

const dbRows = new Map<string, { value: string; updated_at: string }>();

vi.mock('@glyphor/shared/db', () => ({
  systemQuery: vi.fn(async (sql: string, params?: unknown[]) => {
    const key = params?.[0] as string | undefined;

    // SELECT single key
    if (sql.includes('SELECT') && sql.includes('WHERE key = $1') && key) {
      const row = dbRows.get(key);
      return row ? [row] : [];
    }

    // INSERT/UPSERT
    if (sql.includes('INSERT INTO system_config') && params) {
      const [k, v] = params as [string, string];
      dbRows.set(k, { value: v, updated_at: new Date().toISOString() });
      return [];
    }

    // DELETE system_config
    if (sql.includes('DELETE FROM system_config') && key) {
      dbRows.delete(key);
      return [];
    }

    // DELETE agent_memories with RETURNING
    if (sql.includes('DELETE FROM agent_memories') && sql.includes('RETURNING')) {
      return [{ id: 'pruned-1' }];
    }

    // INSERT agent_memories (synthesized)
    if (sql.includes('INSERT INTO agent_memories')) {
      return [];
    }

    // UPDATE agent_memories
    if (sql.includes('UPDATE agent_memories')) {
      return [];
    }

    return [];
  }),
}));

// ═══════════════════════════════════════════════════════════════════
// MODEL CLIENT MOCK
// ═══════════════════════════════════════════════════════════════════

vi.mock('@glyphor/shared', () => ({
  getTierModel: vi.fn(() => 'gemini-2.5-flash'),
}));

function createMockModelClient() {
  return {
    generate: vi.fn(async () => ({
      text: JSON.stringify({
        merge_groups: [
          {
            source_ids: ['mem-1', 'mem-2'],
            merged_content: 'Merged: project uses TypeScript with strict mode',
            merged_type: 'fact',
            merged_importance: 0.8,
            reason: 'Both refer to TypeScript config',
          },
        ],
        synthesized: [
          {
            content: 'Team consistently uses strict TypeScript with Tailwind CSS',
            type: 'learning',
            importance: 0.7,
            source_ids: ['mem-1', 'mem-3'],
          },
        ],
        contradictions_resolved: [
          {
            keep_id: 'mem-4',
            remove_ids: ['mem-5'],
            reason: 'mem-4 is newer and more accurate',
          },
        ],
        prune_ids: ['mem-6'],
        prune_reasons: { 'mem-6': 'Ephemeral task state, no longer relevant' },
      }),
    })),
  } as any;
}

// ═══════════════════════════════════════════════════════════════════
// MEMORY STORE MOCK
// ═══════════════════════════════════════════════════════════════════

function makeMem(id: string, overrides?: Partial<AgentMemory>): AgentMemory {
  return {
    id,
    agentRole: 'devops-engineer' as CompanyAgentRole,
    memoryType: 'observation',
    content: `Memory content for ${id}`,
    importance: 0.5,
    createdAt: new Date(Date.now() - 7 * 86_400_000).toISOString(), // 7 days ago
    ...overrides,
  };
}

function makeReflection(id: string): AgentReflection {
  return {
    id,
    agentRole: 'devops-engineer' as CompanyAgentRole,
    runId: `run-${id}`,
    summary: `Reflection summary ${id}`,
    qualityScore: 70,
    whatWentWell: ['good thing'],
    whatCouldImprove: ['could improve thing'],
    promptSuggestions: [],
    knowledgeGaps: [],
    createdAt: new Date().toISOString(),
  };
}

function createMockStore(memories: AgentMemory[] = [], reflections: AgentReflection[] = []) {
  return {
    getMemories: vi.fn(async () => memories),
    getReflections: vi.fn(async () => reflections),
    saveMemory: vi.fn(async () => 'new-id'),
    saveReflection: vi.fn(async () => 'ref-id'),
  } as any;
}

// ═══════════════════════════════════════════════════════════════════
// IMPORTS (after mocks)
// ═══════════════════════════════════════════════════════════════════

import {
  tryAcquireConsolidationLock,
  releaseConsolidationLock,
  getLastConsolidatedAt,
  getConsolidationLockInfo,
  recordMemoryCountAtConsolidation,
  getMemoryCountAtConsolidation,
} from '../memory/consolidationLock.js';

import {
  runConsolidation,
  type ConsolidationResult,
} from '../memory/memoryConsolidation.js';

import {
  evaluateGates,
  maybeConsolidate,
  forceConsolidate,
  getConsolidationTriggerConfigFromEnv,
} from '../memory/consolidationTrigger.js';

const ROLE = 'devops-engineer' as CompanyAgentRole;

// ═══════════════════════════════════════════════════════════════════
// CONSOLIDATION LOCK
// ═══════════════════════════════════════════════════════════════════

describe('consolidationLock', () => {
  beforeEach(() => {
    dbRows.clear();
  });

  it('acquires lock when none exists', async () => {
    const token = await tryAcquireConsolidationLock(ROLE);
    expect(token).toBeTruthy();
    expect(typeof token).toBe('string');
  });

  it('returns null when lock is already held', async () => {
    const token1 = await tryAcquireConsolidationLock(ROLE);
    expect(token1).toBeTruthy();
    const token2 = await tryAcquireConsolidationLock(ROLE);
    expect(token2).toBeNull();
  });

  it('releases lock and stamps last-consolidated-at', async () => {
    const token = await tryAcquireConsolidationLock(ROLE);
    expect(token).toBeTruthy();
    const released = await releaseConsolidationLock(ROLE, token!);
    expect(released).toBe(true);

    // Check last-consolidated-at was stamped
    const lastAt = await getLastConsolidatedAt(ROLE);
    expect(lastAt).toBeGreaterThan(0);
  });

  it('refuses to release with wrong token', async () => {
    const token = await tryAcquireConsolidationLock(ROLE);
    expect(token).toBeTruthy();
    const released = await releaseConsolidationLock(ROLE, 'wrong-token');
    expect(released).toBe(false);
  });

  it('returns 0 when no consolidation has occurred', async () => {
    const lastAt = await getLastConsolidatedAt(ROLE);
    expect(lastAt).toBe(0);
  });

  it('records and retrieves memory count at consolidation', async () => {
    await recordMemoryCountAtConsolidation(ROLE, 42);
    const count = await getMemoryCountAtConsolidation(ROLE);
    expect(count).toBe(42);
  });

  it('returns 0 count when none recorded', async () => {
    const count = await getMemoryCountAtConsolidation(ROLE);
    expect(count).toBe(0);
  });

  it('reports lock info correctly', async () => {
    // No lock
    let info = await getConsolidationLockInfo(ROLE);
    expect(info.locked).toBe(false);

    // With lock
    await tryAcquireConsolidationLock(ROLE);
    info = await getConsolidationLockInfo(ROLE);
    expect(info.locked).toBe(true);
    expect(info.holder).toBeTruthy();
    expect(info.stale).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// CONSOLIDATION PIPELINE
// ═══════════════════════════════════════════════════════════════════

describe('runConsolidation', () => {
  beforeEach(() => {
    dbRows.clear();
  });

  it('runs full pipeline and returns success', async () => {
    const memories = [
      makeMem('mem-1', { content: 'TypeScript strict mode enabled', importance: 0.6 }),
      makeMem('mem-2', { content: 'We use strict TypeScript', importance: 0.5 }),
      makeMem('mem-3', { content: 'Tailwind CSS for styling', importance: 0.7 }),
      makeMem('mem-4', { content: 'Deploy via GitHub Actions', importance: 0.8 }),
      makeMem('mem-5', { content: 'Deploy via Jenkins', importance: 0.3 }),
      makeMem('mem-6', { content: 'Ran npm install yesterday', importance: 0.1 }),
    ];
    const reflections = [makeReflection('ref-1')];
    const store = createMockStore(memories, reflections);
    const modelClient = createMockModelClient();

    const result = await runConsolidation(ROLE, store, modelClient);

    expect(result.success).toBe(true);
    expect(result.role).toBe(ROLE);
    expect(result.inventory.total).toBe(6);
    expect(result.merged).toBeGreaterThanOrEqual(1);
    expect(result.synthesized).toBeGreaterThanOrEqual(1);
    expect(result.contradictionsResolved).toBeGreaterThanOrEqual(1);
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it('returns success with no-op when memories are empty', async () => {
    const store = createMockStore([], []);
    const modelClient = createMockModelClient();
    const result = await runConsolidation(ROLE, store, modelClient);
    expect(result.success).toBe(true);
    expect(result.inventory.total).toBe(0);
    expect(result.merged).toBe(0);
  });

  it('fails gracefully if lock cannot be acquired', async () => {
    // Acquire lock first
    await tryAcquireConsolidationLock(ROLE);

    const store = createMockStore([makeMem('m1')], []);
    const modelClient = createMockModelClient();
    const result = await runConsolidation(ROLE, store, modelClient);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Lock not acquired');
  });

  it('handles LLM failure gracefully', async () => {
    const memories = [
      makeMem('mem-1', { importance: 0.1, createdAt: new Date(Date.now() - 90 * 86_400_000).toISOString() }),
    ];
    const store = createMockStore(memories, []);
    const modelClient = {
      generate: vi.fn(async () => { throw new Error('LLM unavailable'); }),
    } as any;

    const result = await runConsolidation(ROLE, store, modelClient);

    // Pipeline should still succeed (LLM failure is non-fatal, prune phase still runs)
    expect(result.success).toBe(true);
  });

  it('cleans up lock on pipeline error', async () => {
    const store = {
      getMemories: vi.fn(async () => [makeMem('m1')]),
      getReflections: vi.fn(async () => { throw new Error('DB crash'); }),
    } as any;
    const modelClient = createMockModelClient();

    const result = await runConsolidation(ROLE, store, modelClient);
    expect(result.success).toBe(false);

    // Lock should be released
    const lockInfo = await getConsolidationLockInfo(ROLE);
    expect(lockInfo.locked).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// CONSOLIDATION TRIGGER / GATES
// ═══════════════════════════════════════════════════════════════════

describe('evaluateGates', () => {
  beforeEach(() => {
    dbRows.clear();
  });

  it('fails on disabled config', async () => {
    const store = createMockStore();
    const result = await evaluateGates(ROLE, store, { enabled: false });
    expect(result.passed).toBe(false);
    expect(result.gate).toBe('disabled');
  });

  it('passes all gates when never consolidated + enough memories', async () => {
    const memories = Array.from({ length: 25 }, (_, i) => makeMem(`m-${i}`));
    const store = createMockStore(memories);
    const result = await evaluateGates(ROLE, store, { minHoursBetween: 24, minNewMemories: 20 });
    expect(result.passed).toBe(true);
    expect(result.gate).toBe('all_passed');
  });

  it('fails time gate when consolidated recently', async () => {
    // Simulate recent consolidation
    dbRows.set(`memory_consolidation_last_at_${ROLE}`, {
      value: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const store = createMockStore([makeMem('m1')]);
    const result = await evaluateGates(ROLE, store, { minHoursBetween: 24 });
    expect(result.passed).toBe(false);
    expect(result.gate).toBe('time');
  });

  it('fails volume gate when not enough new memories', async () => {
    // Simulate old consolidation (time gate passes)
    const oldDate = new Date(Date.now() - 48 * 3_600_000).toISOString();
    dbRows.set(`memory_consolidation_last_at_${ROLE}`, {
      value: oldDate,
      updated_at: oldDate,
    });
    // Record that we had 10 memories at last consolidation
    dbRows.set(`memory_consolidation_count_at_${ROLE}`, {
      value: '10',
      updated_at: oldDate,
    });

    // Only 12 memories now (2 new, need 20)
    const memories = Array.from({ length: 12 }, (_, i) => makeMem(`m-${i}`));
    const store = createMockStore(memories);

    const result = await evaluateGates(ROLE, store, { minHoursBetween: 24, minNewMemories: 20 });
    expect(result.passed).toBe(false);
    expect(result.gate).toBe('volume');
  });

  it('fails lock gate when lock is held', async () => {
    // Old consolidation so time gate passes
    const oldDate = new Date(Date.now() - 48 * 3_600_000).toISOString();
    dbRows.set(`memory_consolidation_last_at_${ROLE}`, {
      value: oldDate,
      updated_at: oldDate,
    });

    // Enough memories
    const memories = Array.from({ length: 30 }, (_, i) => makeMem(`m-${i}`));
    const store = createMockStore(memories);

    // Acquire lock
    await tryAcquireConsolidationLock(ROLE);

    const result = await evaluateGates(ROLE, store, { minHoursBetween: 24, minNewMemories: 20 });
    expect(result.passed).toBe(false);
    expect(result.gate).toBe('lock');
  });
});

describe('getConsolidationTriggerConfigFromEnv', () => {
  it('returns defaults when no env vars set', () => {
    const config = getConsolidationTriggerConfigFromEnv();
    expect(config.enabled).toBe(true);
    expect(config.minHoursBetween).toBe(24);
    expect(config.minNewMemories).toBe(20);
  });
});

describe('forceConsolidate', () => {
  beforeEach(() => {
    dbRows.clear();
  });

  it('runs synchronously and returns result', async () => {
    const memories = [makeMem('m1'), makeMem('m2')];
    const store = createMockStore(memories, [makeReflection('r1')]);
    const modelClient = createMockModelClient();

    const result = await forceConsolidate(ROLE, store, modelClient);
    expect(result.role).toBe(ROLE);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
