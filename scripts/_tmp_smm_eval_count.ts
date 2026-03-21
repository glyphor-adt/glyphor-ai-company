import { closePool, systemQuery } from '@glyphor/shared/db';

async function main(): Promise<void> {
  const rows = await systemQuery<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM assignment_evaluations ae
     JOIN work_assignments wa ON wa.id = ae.assignment_id
     WHERE wa.assigned_to = 'social-media-manager'`,
  );
  console.log(JSON.stringify(rows[0] ?? { count: '0' }, null, 2));
  await closePool().catch(() => undefined);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
