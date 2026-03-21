import { closePool, systemQuery } from '@glyphor/shared/db';

type Row = {
  key: string;
  title: string;
  layer: number;
  audience: string;
  is_stale: boolean;
  last_verified_at: string | null;
  owner_agent_id: string | null;
  review_cadence: string | null;
  version: number | string | null;
  content: string;
};

async function main(): Promise<void> {
  const rows = await systemQuery<Row>(
    `SELECT 
      section AS key,
      title,
      layer,
      audience,
      is_stale,
      last_verified_at,
      owner_agent_id,
      review_cadence,
      version,
      content
    FROM company_knowledge_base
    ORDER BY layer ASC, section ASC`,
  );
  process.stdout.write(JSON.stringify(rows, null, 2));
  process.stdout.write('\n');
}

main()
  .finally(() => closePool().catch(() => {}))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
