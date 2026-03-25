import { Client } from 'pg';

async function main() {
  const client = new Client({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || 'glyphor',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  await client.connect();
  try {
    const result = await client.query(`
      SELECT id, target, status, created_at, completed_at, error,
             jsonb_typeof(report) AS report_type,
             CASE WHEN report IS NULL THEN false ELSE true END AS has_report,
             jsonb_array_length(COALESCE(sources, '[]'::jsonb)) AS source_count,
             jsonb_array_length(COALESCE(research_areas, '[]'::jsonb)) AS area_count,
             CASE
               WHEN jsonb_typeof(COALESCE(framework_outputs, '{}'::jsonb)) = 'object'
                 THEN (SELECT COUNT(*) FROM jsonb_each(COALESCE(framework_outputs, '{}'::jsonb)))
               ELSE 0
             END AS framework_count,
             CASE WHEN framework_convergence IS NULL OR framework_convergence = '' THEN false ELSE true END AS has_convergence
      FROM deep_dives
      ORDER BY created_at DESC
      LIMIT 10
    `);

    console.log(JSON.stringify(result.rows, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});