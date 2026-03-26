import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function main() {
  await pool.query(`ALTER TABLE strategy_analyses DROP CONSTRAINT IF EXISTS strategy_analyses_status_check`);
  await pool.query(`ALTER TABLE strategy_analyses ADD CONSTRAINT strategy_analyses_status_check CHECK (
    status IN ('planning', 'framing', 'decomposing', 'researching', 'quality-check', 'analyzing', 'framework-analysis', 'synthesizing', 'deepening', 'completed', 'failed')
  )`);
  console.log('✅ strategy_analyses_status_check updated — "framework-analysis" now allowed');
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
