import { systemQuery } from '@glyphor/shared/db';

type Row = {
  name: string;
  implementation_type: string | null;
  is_active: boolean;
};

async function main() {
  const rows = await systemQuery<Row>(
    `SELECT name, implementation_type, is_active
     FROM tool_registry
     WHERE name ILIKE '%watch%'
        OR name ILIKE '%gap%'
        OR name ILIKE '%tool%gap%'
     ORDER BY name`,
  );

  console.log(JSON.stringify(rows, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
