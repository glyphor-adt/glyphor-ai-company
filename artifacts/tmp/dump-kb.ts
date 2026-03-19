import { pool } from '@glyphor/shared/db';

async function main() {
  const r = await pool.query(
    `SELECT section, audience, title, length(content) as chars, content
     FROM company_knowledge_base
     WHERE is_active = true
     ORDER BY length(content) DESC`
  );
  for (const row of r.rows) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`SECTION: ${row.section}  |  AUDIENCE: ${row.audience}  |  CHARS: ${row.chars}`);
    console.log(`TITLE: ${row.title}`);
    console.log('='.repeat(80));
    console.log(row.content);
  }
  process.exit(0);
}
main();
