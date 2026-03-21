import { closePool, systemQuery } from '@glyphor/shared/db';

async function main(): Promise<void> {
  const rows = await systemQuery(
    `SELECT id, version, source, deployed_at, retired_at,
            LENGTH(prompt_text) AS prompt_length
     FROM agent_prompt_versions
     WHERE agent_id = 'cto'
     ORDER BY created_at DESC`,
  );
  console.log(JSON.stringify(rows, null, 2));
}

main()
  .finally(() => closePool().catch(() => {}))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
