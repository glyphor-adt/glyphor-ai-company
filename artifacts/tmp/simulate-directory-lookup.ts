import { closePool, systemQuery } from '@glyphor/shared/db';

async function main(): Promise<void> {
  const [worldStateColumns, existingAlias] = await Promise.all([
    systemQuery<Record<string, unknown>>(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'world_state'
        ORDER BY ordinal_position`,
    ),
    systemQuery<Record<string, unknown>>(
      `SELECT id, domain, key, entity_id, written_by_agent, confidence, updated_at, valid_until
         FROM world_state
        WHERE key = 'directory.alias.nexus'`,
    ),
  ]);

  process.stdout.write(JSON.stringify({ worldStateColumns, existingAlias }, null, 2));
  process.stdout.write('\n');
}

main()
  .finally(() => closePool().catch(() => {}))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });