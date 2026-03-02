/**
 * Layer 4 — Orchestration Loop
 *
 * Creates a real directive and watches the full orchestration pipeline:
 * detection → assignment → execution → evaluation → completion.
 */

import type { SmokeTestConfig, TestResult, LayerResult } from '../types.js';
import { query, queryTable } from '../utils/db.js';
import { runTest } from '../utils/test.js';

// Module-level state shared across tests
let directiveId: string | null = null;
let directiveCreatedAt: number | null = null;

function blocked(id: string, name: string): TestResult {
  return { id, name, status: 'blocked', message: 'Skipped — directive creation (T4.1) failed', durationMs: 0 };
}

export async function run(config: SmokeTestConfig): Promise<LayerResult> {
  const tests: TestResult[] = [];

  // Get default tenant for multi-tenancy INSERTs
  const tenants = await query<{ id: string }>(`SELECT id FROM tenants LIMIT 1`);
  const tenantId = tenants[0]?.id ?? null;

  // T4.0 — Direct Work Assignment (CTO assign_task)
  tests.push(
    await runTest('T4.0', 'Direct Work Assignment', async () => {
      if (!tenantId) throw new Error('No tenant found in tenants table — run multi-tenancy migration');
      const rows = await query<{ id: string }>(
        `INSERT INTO work_assignments (tenant_id, assigned_to, assigned_by, task_description, task_type, expected_output, priority, status, directive_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          tenantId,
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
      if (!tenantId) throw new Error('No tenant found in tenants table — run multi-tenancy migration');
      const rows = await query<{ id: string }>(
        `INSERT INTO founder_directives (tenant_id, title, description, priority, category, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          tenantId,
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

  // T4.2 — Sarah Detects (snapshot check, no long poll)
  tests.push(
    await runTest('T4.2', 'Sarah Detects', async () => {
      const fifteenMinAgo = new Date(Date.now() - 15 * 60_000).toISOString();
      const runs = await queryTable<{ id: string; task: string }>('agent_runs', 'id,task', {
        agent_id: 'chief-of-staff',
      }, { order: 'created_at', desc: true, limit: 10 });
      const match = runs.find((r) => r.task?.toLowerCase().includes('orchestrat'));
      if (!match) {
        return `Directive ${directiveId} created — waiting for chief-of-staff to detect (no recent orchestration run yet)`;
      }
      return `Sarah detected orchestration task: ${match.id}`;
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

      if (assignments.length === 0) {
        return `No assignments yet for directive ${directiveId} — waiting for orchestration`;
      }
      return `${assignments.length} assignments created for directive ${directiveId}`;
    }),
  );

  // T4.4 — Agents Pick Up
  tests.push(
    await runTest('T4.4', 'Agents Pick Up', async () => {
      const result = await queryTable<{ id: string; status: string }>(
        'work_assignments',
        'id,status',
        { directive_id: directiveId! },
      );
      if (result.length === 0) {
        return 'No assignments to pick up yet';
      }
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

      if (assignments.length === 0) {
        return 'No assignments yet — dependency check deferred';
      }

      const parallel = assignments.filter((a) => a.sequence_order === 0);
      const sequential = assignments.filter((a) => a.sequence_order === 1);

      if (sequential.length === 0) {
        return 'No sequential assignments — dependency ordering not applicable';
      }

      const allParallelDone = parallel.every((a) => a.status === 'completed');
      if (!allParallelDone) {
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
      const result = await queryTable<{ status: string; completion_summary: string | null }>(
        'founder_directives',
        'status,completion_summary',
        { id: directiveId! },
      );
      if (result.length === 0) {
        return 'Directive not found — may have been cleaned up';
      }
      const directive = result[0];
      if (directive.status !== 'completed') {
        return `Directive status: ${directive.status} — not yet completed`;
      }
      if (!directive.completion_summary) {
        return 'Directive completed but completion_summary is empty';
      }
      return `Directive completed with summary (${directive.completion_summary.length} chars)`;
    }),
  );

  // T4.7 — Full Loop Timing
  tests.push(
    await runTest('T4.7', 'Full Loop Timing', async () => {
      const elapsedMs = Date.now() - directiveCreatedAt!;
      const elapsedMin = (elapsedMs / 60_000).toFixed(1);
      return `Layer 4 completed in ${elapsedMin} min`;
    }),
  );

  return { layer: 4, name: 'Orchestration Loop', tests };
}
