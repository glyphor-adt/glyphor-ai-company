/**
 * Wipe seo-analyst agent_memory rows before doctrine cutoff (2026-03-18 UTC).
 * Run: npx tsx scripts/run-with-gcp-db-secret.ts --db-user glyphor_app --db-password-secret db-password scripts/delete-seo-analyst-memory-predoc.ts
 */
import { closePool, systemQuery } from '@glyphor/shared/db';

const WHERE = `
  agent_role = 'seo-analyst'
  AND created_at < '2026-03-18T00:00:00Z'
`;

async function main(): Promise<void> {
  const [{ count: preview }] = await systemQuery<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM agent_memory WHERE ${WHERE}`,
  );
  const n = Number(preview);
  console.log(JSON.stringify({ previewCount: n }, null, 2));

  if (n === 0) {
    console.log('Nothing to delete.');
    return;
  }

  const deleted = await systemQuery<{ id: string }>(
    `DELETE FROM agent_memory WHERE ${WHERE} RETURNING id`,
  );
  console.log(JSON.stringify({ deletedCount: deleted.length }, null, 2));
}

main()
  .finally(() => closePool().catch(() => {}))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
