import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const { rows } = await pool.query(`
    SELECT id, target, status, research_areas, last_heartbeat_at, started_at, error
    FROM deep_dives
    WHERE id = 'deepdive-1774560866781-apeoa7'
  `);

  const r = rows[0];
  if (!r) { console.log('Not found'); return; }

  const areas = r.research_areas as Array<{ id: string; label: string; status: string; analysis?: string }>;
  const completed = areas.filter(a => a.status === 'completed').length;
  const pending = areas.filter(a => a.status === 'pending').length;
  const analyzing = areas.filter(a => a.status === 'analyzing').length;
  const failed = areas.filter(a => a.status === 'failed' || a.status === 'error').length;

  console.log(`Status: ${r.status}`);
  console.log(`Started: ${r.started_at}`);
  console.log(`Last heartbeat: ${r.last_heartbeat_at}`);
  console.log(`Heartbeat age: ${Math.round((Date.now() - new Date(r.last_heartbeat_at).getTime()) / 60000)} minutes ago`);
  console.log(`\nAreas: ${areas.length} total`);
  console.log(`  Completed: ${completed}`);
  console.log(`  Analyzing: ${analyzing}`);
  console.log(`  Pending:   ${pending}`);
  console.log(`  Failed:    ${failed}`);
  console.log('');

  for (const a of areas) {
    const hasAnalysis = a.analysis ? `(${a.analysis.length} chars)` : '(no analysis)';
    console.log(`  [${a.status.padEnd(10)}] ${a.id} - ${a.label} ${hasAnalysis}`);
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
