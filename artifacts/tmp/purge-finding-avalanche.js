/**
 * purge-finding-avalanche.js
 * Emergency cleanup for the finding feedback loop.
 * 
 * The problem: Nexus detects high finding counts → writes a new finding about it
 * → finding count increases → next run detects higher count → repeat.
 * 
 * Strategy:
 * 1. For each agent+finding_type combo, keep only the NEWEST open finding, resolve all older duplicates
 * 2. Bulk-resolve anomaly/meta findings about finding counts themselves
 * 3. Deduplicate pending tool_fix_proposals (keep newest per tool_name+severity)
 *
 * Run: .\scripts\run-with-local-db-proxy.ps1 -Run "node" -RunArgs "artifacts/tmp/purge-finding-avalanche.js"
 */
import pg from 'pg';
const { Client } = pg;

async function main() {
  const c = new Client({
    host: '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '15432', 10),
    database: 'glyphor',
    user: 'glyphor_app',
    password: process.env.DB_PASSWORD,
  });
  await c.connect();

  // Step 0: Current counts
  const before = await c.query(
    `SELECT
       COUNT(*) FILTER (WHERE resolved_at IS NULL) AS open_findings,
       COUNT(*) FILTER (WHERE resolved_at IS NOT NULL) AS resolved_findings,
       COUNT(*) FILTER (WHERE resolved_at IS NULL AND severity='P0') AS open_p0,
       COUNT(*) FILTER (WHERE resolved_at IS NULL AND severity='P1') AS open_p1
     FROM fleet_findings`
  );
  console.log('[Before]', before.rows[0]);

  // Step 1: Deduplicate — for each agent_id+finding_type, keep only the NEWEST open finding
  const dedup = await c.query(
    `WITH ranked AS (
       SELECT id,
              ROW_NUMBER() OVER (PARTITION BY agent_id, finding_type ORDER BY detected_at DESC) AS rn
         FROM fleet_findings
        WHERE resolved_at IS NULL
     )
     UPDATE fleet_findings
        SET resolved_at = NOW()
       FROM ranked
      WHERE fleet_findings.id = ranked.id
        AND ranked.rn > 1
      RETURNING fleet_findings.id`
  );
  console.log(`[Step 1] Deduped: resolved ${dedup.rowCount} duplicate findings (kept newest per agent+type)`);

  // Step 2: Resolve meta-findings about finding counts (the feedback loop itself)
  const metaTypes = [
    'systemic_error', 'systemic_anomaly', 'data_anomaly', 'telemetry_anomaly',
    'system_anomaly', 'system_bug', 'system_performance_degradation', 'anomaly',
    'platform_integrity',
  ];
  const meta = await c.query(
    `UPDATE fleet_findings
        SET resolved_at = NOW()
      WHERE resolved_at IS NULL
        AND finding_type = ANY($1)
      RETURNING id`,
    [metaTypes],
  );
  console.log(`[Step 2] Resolved ${meta.rowCount} meta/anomaly findings (feedback loop artifacts)`);

  // Step 3: Resolve findings whose description mentions finding counts/anomaly
  const countFindings = await c.query(
    `UPDATE fleet_findings
        SET resolved_at = NOW()
      WHERE resolved_at IS NULL
        AND (
          description LIKE '%finding count%'
          OR description LIKE '%P0 findings%'
          OR description LIKE '%P1 findings%'
          OR description LIKE '%open P0s%'
          OR description LIKE '%open P1s%'
          OR description LIKE '%aggregation loop%'
          OR description LIKE '%data corruption%'
          OR description LIKE '%Phantom Recovery%'
          OR description LIKE '%impossible number%'
        )
      RETURNING id`
  );
  console.log(`[Step 3] Resolved ${countFindings.rowCount} findings about finding counts`);

  // Step 4: Deduplicate tool_fix_proposals — keep newest per tool_name+severity
  const proposalDedup = await c.query(
    `WITH ranked AS (
       SELECT id,
              ROW_NUMBER() OVER (PARTITION BY tool_name, severity ORDER BY created_at DESC) AS rn
         FROM tool_fix_proposals
        WHERE status = 'pending'
     )
     UPDATE tool_fix_proposals
        SET status = 'rejected', reviewed_by = 'system-dedup',
            review_notes = 'Auto-deduplicated: superseded by newer proposal for same tool+severity'
       FROM ranked
      WHERE tool_fix_proposals.id = ranked.id
        AND ranked.rn > 1
      RETURNING tool_fix_proposals.id`
  );
  console.log(`[Step 4] Deduped: rejected ${proposalDedup.rowCount} duplicate proposals`);

  // Step 5: After counts
  const after = await c.query(
    `SELECT
       COUNT(*) FILTER (WHERE resolved_at IS NULL) AS open_findings,
       COUNT(*) FILTER (WHERE resolved_at IS NULL AND severity='P0') AS open_p0,
       COUNT(*) FILTER (WHERE resolved_at IS NULL AND severity='P1') AS open_p1
     FROM fleet_findings`
  );
  console.log('\n[After]', after.rows[0]);

  // Step 6: Show remaining open findings (unique per agent+type)
  const remaining = await c.query(
    `SELECT agent_id, severity, finding_type, substring(description from 1 for 100) as desc
       FROM fleet_findings
      WHERE resolved_at IS NULL
      ORDER BY severity, agent_id
      LIMIT 40`
  );
  console.log(`\n[Remaining] ${remaining.rowCount} open findings:`);
  for (const r of remaining.rows) {
    console.log(`  [${r.severity}] ${r.agent_id}: ${r.finding_type} — ${r.desc}`);
  }

  // Step 7: Show remaining pending proposals  
  const proposals = await c.query(
    `SELECT tool_name, severity, substring(root_cause from 1 for 80) as rc
       FROM tool_fix_proposals
      WHERE status = 'pending'
      ORDER BY severity, created_at DESC
      LIMIT 20`
  );
  console.log(`\n[Remaining] ${proposals.rowCount} pending proposals:`);
  for (const r of proposals.rows) {
    console.log(`  [${r.severity}] ${r.tool_name}: ${r.rc}`);
  }

  await c.end();
}

main().catch(err => { console.error(err); process.exit(1); });
