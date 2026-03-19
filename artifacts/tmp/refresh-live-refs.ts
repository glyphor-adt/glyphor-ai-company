import { pool } from '@glyphor/shared/db';

async function main() {
  const refs = await pool.query('SELECT key, query FROM knowledge_live_refs');
  for (const ref of refs.rows) {
    try {
      const result = await pool.query(ref.query);
      const value = result.rows[0] ? String(Object.values(result.rows[0])[0]) : '—';
      await pool.query(
        'UPDATE knowledge_live_refs SET cached_value = $2, last_resolved_at = NOW() WHERE key = $1',
        [ref.key, value],
      );
      console.log(`${ref.key} = ${value}`);
    } catch (err: any) {
      console.warn(`${ref.key}: ${err.message}`);
    }
  }
  process.exit(0);
}
main();
