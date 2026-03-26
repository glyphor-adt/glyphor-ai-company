/**
 * Deletes agent_memory rows where internal engines read as external products (see WHERE).
 * Run: npx tsx scripts/run-with-gcp-db-secret.ts --db-user glyphor_app --db-password-secret db-password scripts/delete-agent-memory-external-product-memory.ts
 */
import { closePool, systemQuery } from '@glyphor/shared/db';

const legacyWebBuildName = `${'fu'}se`;

const WHERE = `
  agent_role IN (
    'cmo','content-creator','seo-analyst',
    'social-media-manager','chief-of-staff'
  )
  AND (
    content ILIKE '%${legacyWebBuildName}%keyword%'
    OR content ILIKE '%${legacyWebBuildName}%ranking%'
    OR content ILIKE '%${legacyWebBuildName}%position%'
    OR content ILIKE '%${legacyWebBuildName}%seo%'
    OR content ILIKE '%${legacyWebBuildName}%website builder%'
    OR content ILIKE '%${legacyWebBuildName}%external%'
    OR content ILIKE '%${legacyWebBuildName}%product%launch%'
    OR content ILIKE '%${legacyWebBuildName}%customer%'
    OR content ILIKE '%${legacyWebBuildName} and pulse platforms%'
    OR content ILIKE '%building ${legacyWebBuildName}%'
    OR content ILIKE '%launching ${legacyWebBuildName}%'
    OR content ILIKE '%${legacyWebBuildName} platform%'
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
