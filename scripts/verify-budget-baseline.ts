import 'dotenv/config';
import { systemQuery, closePool } from '@glyphor/shared/db';

async function main() {
  const rows = await systemQuery<{ section: string; title: string }>(
    'SELECT section, title FROM company_knowledge_base WHERE section = $1',
    ['budget_baseline'],
  );
  console.log('budget_baseline:', rows.length ? rows[0] : 'NOT FOUND');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closePool().catch(() => {}));
