/**
 * Apply a migration directly using the shared pool (inherits env from run-with-local-db-proxy.ps1)
 */
import fs from 'node:fs';
import { pool } from '@glyphor/shared/db';

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: npx tsx scripts/apply-sql-direct.ts <file.sql>');
    process.exit(1);
  }
  
  const sql = fs.readFileSync(filePath, 'utf-8');
  console.log(`Applying: ${filePath}`);
  console.log(`SQL length: ${sql.length} chars`);
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('✅ Migration applied successfully');
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Migration failed:', err.message);
    if (err.detail) console.error('   Detail:', err.detail);
    if (err.hint) console.error('   Hint:', err.hint);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
