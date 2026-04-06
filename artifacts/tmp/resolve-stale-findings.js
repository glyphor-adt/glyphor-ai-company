/**
 * resolve-stale-findings.js
 * Resolves fleet_findings and tool_fix_proposals for bugs we already fixed:
 * 1. save_memory tenant_id NULL — fixed in store.ts
 * 2. tool_gap findings for tools now in registry (delegate_directive, etc.)
 * 3. Stale tool_gap_escalation findings whose source finding was already resolved
 *
 * Run: .\scripts\run-with-local-db-proxy.ps1 -Run "node" -RunArgs "artifacts/tmp/resolve-stale-findings.js"
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

  // Fix 1: Resolve save_memory findings — bug is fixed in code
  const fix1 = await c.query(
    `UPDATE fleet_findings
        SET resolved_at = NOW()
      WHERE resolved_at IS NULL
        AND description LIKE '%save_memory%'
        AND finding_type IN ('tool_bug', 'tool_gap')
      RETURNING id, agent_id, finding_type, description`
  );
  console.log(`[Fix 1] Resolved ${fix1.rowCount} save_memory findings:`);
  for (const r of fix1.rows) {
    console.log(`  ${r.agent_id}: ${r.finding_type} — ${r.description?.substring(0, 100)}`);
  }

  // Fix 2: Resolve save_memory tool_fix_proposals — already applied
  const fix2 = await c.query(
    `UPDATE tool_fix_proposals
        SET status = 'applied', applied_at = NOW(), reviewed_by = 'kristina-denney',
            review_notes = 'Fixed in code — tenant_id hardcoded to default UUID in store.ts'
      WHERE status = 'pending'
        AND tool_name = 'save_memory'
      RETURNING id, tool_name, severity`
  );
  console.log(`\n[Fix 2] Closed ${fix2.rowCount} save_memory proposals:`);
  for (const r of fix2.rows) {
    console.log(`  ${r.id}: ${r.tool_name} (${r.severity})`);
  }

  // Fix 3: Resolve tool_gap findings for delegate_directive — now in KNOWN_TOOLS
  const fix3 = await c.query(
    `UPDATE fleet_findings
        SET resolved_at = NOW()
      WHERE resolved_at IS NULL
        AND description LIKE '%delegate_directive%'
        AND finding_type IN ('tool_gap', 'tool_gap_escalation', 'tool_bug')
      RETURNING id, agent_id, finding_type`
  );
  console.log(`\n[Fix 3] Resolved ${fix3.rowCount} delegate_directive findings:`);
  for (const r of fix3.rows) {
    console.log(`  ${r.agent_id}: ${r.finding_type}`);
  }

  // Fix 4: Resolve stale tool_gap_escalation findings whose source has been resolved
  const fix4 = await c.query(
    `UPDATE fleet_findings esc
        SET resolved_at = NOW()
      FROM fleet_findings src
      WHERE esc.finding_type = 'tool_gap_escalation'
        AND esc.resolved_at IS NULL
        AND esc.description LIKE '%source finding: ' || src.id::text || '%'
        AND src.resolved_at IS NOT NULL
      RETURNING esc.id, esc.agent_id, esc.description`
  );
  console.log(`\n[Fix 4] Resolved ${fix4.rowCount} orphaned escalation findings`);

  // Fix 5: Show remaining open findings
  const open = await c.query(
    `SELECT agent_id, severity, finding_type, substring(description from 1 for 120) as desc, detected_at
       FROM fleet_findings
      WHERE resolved_at IS NULL
      ORDER BY severity, detected_at
      LIMIT 30`
  );
  console.log(`\n[Status] ${open.rowCount} open findings remaining:`);
  for (const r of open.rows) {
    console.log(`  [${r.severity}] ${r.agent_id}: ${r.finding_type} — ${r.desc}`);
  }

  // Fix 6: Show pending proposals  
  const pending = await c.query(
    `SELECT id, tool_name, severity, status, substring(root_cause from 1 for 100) as rc
       FROM tool_fix_proposals
      WHERE status = 'pending'
      ORDER BY severity, created_at`
  );
  console.log(`\n[Status] ${pending.rowCount} pending fix proposals:`);
  for (const r of pending.rows) {
    console.log(`  [${r.severity}] ${r.tool_name}: ${r.rc}`);
  }

  await c.end();
}

main().catch(err => { console.error(err); process.exit(1); });
