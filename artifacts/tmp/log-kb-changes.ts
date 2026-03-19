import { pool } from '@glyphor/shared/db';

async function main() {
  const sections = ['products', 'scope_definition', 'mission', 'glossary'];
  for (const s of sections) {
    await pool.query(
      'INSERT INTO knowledge_change_log (section_key, version, change_summary, changed_by) VALUES ($1, $2, $3, $4)',
      [s, 1, 'Removed internal engine codenames (Fuse/Pulse) from content', 'founder:kristina'],
    );
  }
  console.log('Logged', sections.length, 'change entries');
  process.exit(0);
}
main();
