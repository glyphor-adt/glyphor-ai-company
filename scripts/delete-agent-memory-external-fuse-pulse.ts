/**
 * Deletes agent_memory rows where Fuse/Pulse read as external products (see WHERE).
 * Run: npx tsx scripts/run-with-gcp-db-secret.ts --db-user glyphor_app --db-password-secret db-password scripts/delete-agent-memory-external-fuse-pulse.ts
 */
import { closePool, systemQuery } from '@glyphor/shared/db';

const WHERE = `
  agent_role IN (
    'cmo','content-creator','seo-analyst',
    'social-media-manager','chief-of-staff'
  )
  AND (
    content ILIKE '%fuse%keyword%'
    OR content ILIKE '%fuse%ranking%'
    OR content ILIKE '%fuse%position%'
    OR content ILIKE '%fuse%seo%'
    OR content ILIKE '%fuse%website builder%'
    OR content ILIKE '%fuse%external%'
    OR content ILIKE '%fuse%product%launch%'
    OR content ILIKE '%fuse%customer%'
    OR content ILIKE '%fuse and pulse platforms%'
    OR content ILIKE '%building fuse%'
    OR content ILIKE '%launching fuse%'
    OR content ILIKE '%fuse platform%'
    OR content ILIKE '%powered by pulse%'
    OR content ILIKE '%pulse product%'
    OR content ILIKE '%pulse launch%'
    OR content ILIKE '%pulse for customers%'
  )
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
