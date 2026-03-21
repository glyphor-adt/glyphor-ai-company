import { systemQuery as dbQuery } from '@glyphor/shared/db';
import { closePool } from '@glyphor/shared/db';

async function main() {
  const updated = await dbQuery<{ id: string }>(
    `UPDATE fleet_findings
     SET resolved_at = NOW()
     WHERE finding_type LIKE '%agents%'
       AND resolved_at IS NULL
       AND severity = 'P0'
     RETURNING id`,
  );
  console.log(JSON.stringify({ ok: true, rows_updated: updated.length, ids: updated.map((r) => r.id) }, null, 2));
  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
