import { pool } from '@glyphor/shared/db';

async function main() {
  const r = await pool.query("SELECT section, audience, length(content) as chars FROM company_knowledge_base WHERE section = 'brand_guide'");
  console.log(r.rows);
  process.exit(0);
}
main();
