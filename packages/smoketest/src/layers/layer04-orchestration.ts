/**
 * Layer 4 — Orchestration Loop
 *
 * Creates a real directive and watches the full orchestration pipeline:
 * detection → assignment → execution → evaluation → completion.
 */

import type { SmokeTestConfig, TestResult, LayerResult } from '../types.js';
import { pollUntil } from '../utils/http.js';
import { query, queryTable } from '../utils/supabase.js';

// Module-level state shared across tests
let directiveId: string | null = null;
let directiveCreatedAt: number | null = null;

async function runTest(
  id: string,
  name: string,
  fn: () => Promise<string>,
): Promise<TestResult> {
  const start = Date.now();
  try {
    const message = await fn();
    return { id, name, status: 'pass', message, durationMs: Date.now() - start };
  } catch (err) {
    return { id, name, status: 'fail', message: (err as Error).message, durationMs: Date.now() - start };
  }
}

function blocked(id: string, name: string): TestResult {
  return { id, name, status: 'blocked', message: 'Skipped — directive creation (T4.1) failed', durationMs: 0 };
}

export async function run(config: SmokeTestConfig): Promise<LayerResult> {
  const tests: TestResult[] = [];

  // T4.0 — Direct Work Assignment (CTO assign_task)
  tests.push(
    await runTest('T4.0', 'Direct Work Assignment', async () => {
      // Create a work assignment directly (simulating CTO assign_task tool)
      const rows = await query<{ id: string }>(
        `INSERT INTO work_assignments (assigned_to, assigned_by, task_description, task_type, expected_output, priority, status, directive_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          'platform-engineer',
          'cto',
          'Smoke test: Verify platform health monitoring is operational',
          'on_demand',
          'Confirmation that all health checks are passing',
          'normal',
          'pending',
          null, // CTO assignments don't require a directive
        ],
      );

      if (!rows[0]?.id) {
        throw new Error('No assignment ID returned');
      }

      // Clean up — mark as completed so it doesn't interfere with agent operations
      await query(
        `UPDATE work_assignments SET status = 'completed' WHERE id = $1`,
        [rows[0].id],
      );

      return `Work assignment created successfully (ID: ${rows[0].id})`;
    }),
  );

  // T4.1 — Create Directive
  tests.push(
    await runTest('T4.1', 'Create Directive', async () => {
      const rows = await query<{ id: string }>(
        `INSERT INTO founder_directives (title, description, priority, category, status) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [
          'Smoke Test — Automated ' + new Date().toISOString(),
          'Automated smoke test. Create a brief comparing Glyphor to top 3 competitors.',
          'medium',
          'strategy',
          'active',
        ],
      );

      if (!rows[0]?.id) throw new Error('No directive ID returned');

      directiveId = rows[0].id;
      directiveCreatedAt = Date.now();
      return `Directive created: ${directiveId}`;
    }),
  );

  // If T4.1 failed, block remaining tests
  if (!directiveId) {
    tests.push(blocked('T4.2', 'Sarah Detects'));
    tests.push(blocked('T4.3', 'Assignments Created'));
    tests.push(blocked('T4.4', 'Agents Pick Up'));
    tests.push(blocked('T4.5', 'Dependency Resolution'));
    tests.push(blocked('T4.6', 'Evaluation'));
    tests.push(blocked('T4.7', 'Full Loop Timing'));
    return { layer: 4, name: 'Orchestration Loop', tests };
  }

  // T4.2 — Sarah Detects
  tests.push(
    await runTest('T4.2', 'Sarah Detects', async () => {
      const fifteenMinAgo = new Date(Date.now() - 15 * 60_000).toISOString();
      const runs = await pollUntil(
        () =>
          queryTable<{ id: string; task: string }>('agent_runs', 'id,task', {
            agent_id: 'chief-of-staff',
          }, { order: 'created_at', desc: true, limit: 10 }),
        (rows) =>
          rows.some(
            (r) =>
              r.task?.toLowerCase().includes('orchestrat'),
          ),
        15_000,
        10 * 60_000,
      );
      const match = runs.find((r) => r.task?.toLowerCase().includes('orchestrat'));
      return `Sarah detected orchestration task: ${match?.id}`;
    }),
  );

  // T4.3 — Assignments Created
  tests.push(
    await runTest('T4.3', 'Assignments Created', async () => {
      const assignments = await queryTable<{
        id: string;
        task_description: string;
      }>('work_assignments', 'id,task_description', {
        directive_id: directiveId!,
      });

      if (assignments.length < 2) {
        throw new Error(
          `Expected 2+ assignments, got ${assignments.length}`,
        );
      }

      const short = assignments.filter(
        (a) => !a.task_description || a.task_description.length <= 100,
      );
      if (short.length > 0) {
        throw new Error(
          `${short.length} assignment(s) have task_description ≤ 100 chars`,
        );
      }

      return `${assignments.length} assignments created, all instructions > 100 chars`;
    }),
  );

  // T4.4 — Agents Pick Up
  tests.push(
    await runTest('T4.4', 'Agents Pick Up', async () => {
      const result = await pollUntil(
        () =>
          queryTable<{ id: string; status: string }>(
            'work_assignments',
            'id,status',
            { directive_id: directiveId! },
          ),
        (rows) =>
          rows.some(
            (r) => r.status === 'in_progress' || r.status === 'completed',
          ),
        15_000,
        15 * 60_000,
      );
      const active = result.filter(
        (r) => r.status === 'in_progress' || r.status === 'completed',
      );
      return `${active.length}/${result.length} assignments picked up or completed`;
    }),
  );

  // T4.5 — Dependency Resolution
  tests.push(
    await runTest('T4.5', 'Dependency Resolution', async () => {
      const assignments = await queryTable<{
        id: string;
        status: string;
        sequence_order: number;
        dispatched_at: string | null;
      }>('work_assignments', 'id,status,sequence_order,dispatched_at', {
        directive_id: directiveId!,
      });

      const parallel = assignments.filter((a) => a.sequence_order === 0);
      const sequential = assignments.filter((a) => a.sequence_order === 1);

      if (sequential.length === 0) {
        return 'No sequential assignments — dependency ordering not applicable';
      }

      const allParallelDone = parallel.every((a) => a.status === 'completed');
      if (!allParallelDone) {
        // Sequential should not be dispatched yet
        const premature = sequential.filter((a) => a.dispatched_at !== null);
        if (premature.length > 0) {
          throw new Error(
            `${premature.length} sequential assignment(s) dispatched before parallel ones completed`,
          );
        }
        return 'Sequential assignments correctly waiting for parallel to complete';
      }

      return `Dependency order respected: ${parallel.length} parallel done before ${sequential.length} sequential`;
    }),
  );

  // T4.6 — Evaluation
  tests.push(
    await runTest('T4.6', 'Evaluation', async () => {
      const result = await pollUntil(
        () =>
          queryTable<{ status: string; completion_summary: string | null }>(
            'founder_directives',
            'status,completion_summary',
            { id: directiveId! },
          ),
        (rows) => rows.length > 0 && rows[0].status === 'completed',
        30_000,
        30 * 60_000,
      );

      const directive = result[0];
      if (!directive.completion_summary) {
        throw new Error('Directive completed but completion_summary is empty');
      }

      return `Directive completed with summary (${directive.completion_summary.length} chars)`;
    }),
  );

  // T4.7 — Full Loop Timing
  tests.push(
    await runTest('T4.7', 'Full Loop Timing', async () => {
      const elapsedMs = Date.now() - directiveCreatedAt!;
      const elapsedMin = (elapsedMs / 60_000).toFixed(1);

      if (elapsedMs > 30 * 60_000) {
        throw new Error(
          `Full loop took ${elapsedMin} min — exceeds 30 min threshold`,
        );
      }

      return `Full orchestration loop completed in ${elapsedMin} min`;
    }),
  );

  return { layer: 4, name: 'Orchestration Loop', tests };
}
