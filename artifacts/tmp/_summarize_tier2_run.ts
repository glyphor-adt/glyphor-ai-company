import { systemQuery as dbQuery } from '../../packages/shared/src/db.ts';

async function main() {
  const runId = process.argv[2];
  if (!runId) {
    throw new Error('Usage: tsx artifacts/tmp/_summarize_tier2_run.ts <runId>');
  }

  const statusCounts = await dbQuery<{
    status: string;
    count: number;
  }>(
    `
      SELECT status, COUNT(*)::int AS count
      FROM tool_test_results
      WHERE test_run_id = $1
      GROUP BY status
      ORDER BY status
    `,
    [runId],
  );

  const skipReasons = await dbQuery<{
    reason: string;
    count: number;
  }>(
    `
      SELECT COALESCE(error_message, '<none>') AS reason, COUNT(*)::int AS count
      FROM tool_test_results
      WHERE test_run_id = $1 AND status = 'skip'
      GROUP BY COALESCE(error_message, '<none>')
      ORDER BY count DESC, reason ASC
    `,
    [runId],
  );

  const failures = await dbQuery<{
    tool_name: string;
    error_type: string | null;
    error_message: string | null;
  }>(
    `
      SELECT tool_name, error_type, error_message
      FROM tool_test_results
      WHERE test_run_id = $1 AND status = 'fail'
      ORDER BY tool_name ASC
    `,
    [runId],
  );

  const skippedTools = await dbQuery<{ tool_name: string }>(
    `
      SELECT tool_name
      FROM tool_test_results
      WHERE test_run_id = $1 AND status = 'skip'
      ORDER BY tool_name ASC
    `,
    [runId],
  );

  console.log(JSON.stringify({ runId, statusCounts, skipReasons, failures, skippedTools }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
