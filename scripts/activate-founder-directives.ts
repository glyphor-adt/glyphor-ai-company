/**
 * One-off: set two founder_directives to active. Run via:
 *   npx tsx scripts/run-with-gcp-db-secret.ts --db-user glyphor_app --db-password-secret db-password scripts/activate-founder-directives.ts
 */
import pg from 'pg';

const IDS = [
  'a72d4724-4a04-4437-86b7-11f9c81fe7b0',
  '505b1a65-3d2e-4d44-b40f-875eaed61b0f',
] as const;

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error('DATABASE_URL is not set. Run this script through run-with-gcp-db-secret.ts.');
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: url });
  try {
    const update = await pool.query(
      `UPDATE founder_directives
       SET status = 'active'
       WHERE id = ANY($1::uuid[])`,
      [IDS],
    );
    console.log(`UPDATE founder_directives: ${update.rowCount} row(s) updated.`);

    const sel = await pool.query(
      `SELECT id, title, status FROM founder_directives WHERE id = ANY($1::uuid[])`,
      [IDS],
    );
    console.log(JSON.stringify(sel.rows, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
