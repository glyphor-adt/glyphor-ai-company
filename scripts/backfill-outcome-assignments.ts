/**
 * Backfill script: Recover assignment_id linkage for historical task_run_outcomes.
 *
 * For each task_run_outcome where assignment_id IS NULL:
 *   1. Get the agent_role and created_at from the outcome row
 *   2. Find work_assignments where assigned_to = agent_role
 *      AND created_at is within ±5 minutes of the outcome's created_at
 *   3. If exactly one match: update assignment_id, set backfill_source = 'timestamp_proximity'
 *   4. If zero or multiple matches: skip and log
 *
 * Run: npx tsx scripts/backfill-outcome-assignments.ts [--execute]
 * Without --execute, runs in dry-run mode (report only).
 */

import { closePool, systemQuery } from '@glyphor/shared/db';

interface OrphanedOutcome {
  id: string;
  agent_role: string;
  created_at: string;
}

interface MatchedAssignment {
  id: string;
}

const PROXIMITY_MINUTES = 5;

function hasExecuteFlag(argv: string[]): boolean {
  return argv.includes('--execute') || argv.includes('-x');
}

async function run() {
  const execute = hasExecuteFlag(process.argv);
  console.log(`[backfill] Mode: ${execute ? 'EXECUTE' : 'DRY RUN'}`);

  // Find all outcomes missing assignment_id
  const orphans = await systemQuery<OrphanedOutcome>(
    `SELECT id, agent_role, created_at
     FROM task_run_outcomes
     WHERE assignment_id IS NULL
     ORDER BY created_at ASC`,
  );

  console.log(`[backfill] Found ${orphans.length} outcomes with NULL assignment_id`);

  let recovered = 0;
  let unrecoverable = 0;
  let multiMatch = 0;
  let noMatch = 0;

  for (const outcome of orphans) {
    // Find assignments within ±5 minutes of the outcome
    const matches = await systemQuery<MatchedAssignment>(
      `SELECT id
       FROM work_assignments
       WHERE assigned_to = $1
         AND created_at BETWEEN ($2::timestamptz - interval '${PROXIMITY_MINUTES} minutes')
                            AND ($2::timestamptz + interval '${PROXIMITY_MINUTES} minutes')`,
      [outcome.agent_role, outcome.created_at],
    );

    if (matches.length === 1) {
      if (execute) {
        await systemQuery(
          `UPDATE task_run_outcomes
           SET assignment_id = $1, backfill_source = 'timestamp_proximity'
           WHERE id = $2`,
          [matches[0].id, outcome.id],
        );
      }
      recovered++;
    } else if (matches.length === 0) {
      noMatch++;
      unrecoverable++;
    } else {
      multiMatch++;
      unrecoverable++;
    }
  }

  console.log(`[backfill] Results:`);
  console.log(`  Recovered:      ${recovered}`);
  console.log(`  No match:       ${noMatch}`);
  console.log(`  Multiple match: ${multiMatch}`);
  console.log(`  Unrecoverable:  ${unrecoverable}`);
  console.log(`  Total:          ${orphans.length}`);

  if (!execute && recovered > 0) {
    console.log(`\nRun with --execute to apply ${recovered} updates.`);
  }

  await closePool();
}

run().catch((err) => {
  console.error('[backfill] Fatal error:', err);
  process.exit(1);
});
