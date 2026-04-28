/**
 * Run the GTM + platform agent_schedules diagnostic query (no psql).
 *
 *   npx tsx scripts/query-agent-schedules-subset.ts
 */
import 'dotenv/config';

import { pool, closePool } from '@glyphor/shared/db';

const SQL = `
SELECT agent_id, cron_expression, enabled, task, payload
FROM agent_schedules
WHERE agent_id IN (
  'cmo', 'chief-of-staff',
  'cto', 'ops',
  'clo',
  'vp-design'
)
ORDER BY agent_id, cron_expression
`;

async function main(): Promise<void> {
  const { rows } = await pool.query(SQL);
  console.log('row_count:', rows.length);
  console.table(
    rows.map((r: Record<string, unknown>) => ({
      agent_id: r.agent_id,
      cron_expression: r.cron_expression,
      enabled: r.enabled,
      task: r.task,
      payload: typeof r.payload === 'object' ? JSON.stringify(r.payload).slice(0, 80) : String(r.payload ?? '').slice(0, 80),
    })),
  );
  console.log(JSON.stringify(rows, null, 2));
  await closePool();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await closePool().catch(() => {});
  process.exit(1);
});
