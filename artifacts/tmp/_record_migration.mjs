import crypto from 'crypto';
import fs from 'fs';
import pg from 'pg';

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const name = '20260315210000_sync_all_skill_playbooks_full.sql';
const sql = fs.readFileSync(`db/migrations/${name}`, 'utf8');
const checksum = crypto.createHash('sha256').update(sql).digest('hex');

await c.query(
  'INSERT INTO schema_migrations(name, checksum, applied_by, source) VALUES($1, $2, $3, $4)',
  [name, checksum, 'glyphor_app', 'manual']
);
console.log('Migration recorded:', name);
await c.end();
