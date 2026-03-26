import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function main() {
  const { rows } = await pool.query(`SELECT id, status, research_areas, error, started_at, last_heartbeat_at, report IS NOT NULL as has_report FROM deep_dives WHERE id = 'deepdive-1774560866781-apeoa7'`);
  if (!rows.length) { console.log('Not found'); return; }
  const rec = rows[0];
  console.log('Status:', rec.status);
  console.log('Error:', rec.error);
  console.log('Started:', rec.started_at);
  console.log('Last heartbeat:', rec.last_heartbeat_at);
  console.log('Has report:', rec.has_report);
  const areas = typeof rec.research_areas === 'string' ? JSON.parse(rec.research_areas) : rec.research_areas;
  console.log('\nResearch Areas:');
  for (const a of areas) {
    console.log(`  ${a.id}: status=${a.status}, sources=${a.sourcesFound ?? 0}, analysis=${a.analysis ? a.analysis.length + ' chars' : 'none'}`);
  }
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
