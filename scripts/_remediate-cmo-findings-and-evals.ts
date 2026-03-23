/**
 * CMO remediation: resolve bogus fleet_findings, re-run knowledge evals, recompute performance scores.
 *
 * Run: powershell -ExecutionPolicy Bypass -File scripts/run-with-local-db-proxy.ps1 -Run npx tsx scripts/_remediate-cmo-findings-and-evals.ts
 *
 * SCHEDULER_URL is loaded from .env (or VITE_SCHEDULER_URL). Falls back to production Cloud Run URL if unset.
 */
import 'dotenv/config';
import { closePool, systemQuery, pool } from '@glyphor/shared/db';

const SCHEDULER_URL =
  process.env.SCHEDULER_URL ||
  process.env.VITE_SCHEDULER_URL ||
  'https://glyphor-scheduler-610179349713.us-central1.run.app';

async function main(): Promise<void> {
  // ── Fix 1: Resolve bogus fleet_findings for CMO ──
  console.log('=== Fix 1: Resolving bogus fleet_findings for CMO ===');
  const updated = await systemQuery<{ count: string }>(
    `WITH updated AS (
      UPDATE fleet_findings
      SET resolved_at = NOW()
      WHERE agent_id = 'cmo'
        AND resolved_at IS NULL
        AND (
          description ILIKE '%3,344%'
          OR description ILIKE '%2,457%'
          OR description ILIKE '%815 open%'
          OR description ILIKE '%734 open%'
          OR finding_type = 'system_performance_degradation'
          OR finding_type = 'systemic_data_corruption'
        )
      RETURNING id
    )
    SELECT COUNT(*)::text AS count FROM updated`,
  );
  console.log(`Resolved ${updated[0]?.count ?? 0} bogus findings.`);

  // ── Fix 2: Re-run knowledge evals for CMO ──
  if (SCHEDULER_URL) {
    console.log('\n=== Fix 2: Re-running knowledge evals for CMO ===');
    try {
      const res = await fetch(`${SCHEDULER_URL.replace(/\/$/, '')}/agent-evals/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentIds: ['cmo'] }),
      });
      const data = (await res.json()) as { success?: boolean; error?: string; [k: string]: unknown };
      if (res.ok && data.success) {
        console.log('Agent evals run completed:', JSON.stringify(data, null, 2));
      } else {
        console.warn('Agent evals run failed or unexpected response:', res.status, data);
      }
    } catch (err) {
      console.error('Agent evals run failed:', (err as Error).message);
    }
  } else {
    console.log('\n=== Fix 2: SKIPPED (no SCHEDULER_URL) ===');
    console.log('To run manually: POST /agent-evals/run with body { "agentIds": ["cmo"] }');
  }

  // ── Fix 3: Recompute performance scores ──
  console.log('\n=== Fix 3: Recomputing performance scores ===');
  try {
    const { rows } = await pool.query('SELECT * FROM compute_performance_scores()');
    console.log(`Updated ${rows.length} agents`);
    const cmo = rows.find((r: { agent_role: string }) => r.agent_role === 'cmo');
    if (cmo) {
      console.log(`  CMO new score: ${(cmo as { new_score: number }).new_score}`);
    }
  } catch (err) {
    console.error('compute_performance_scores failed:', (err as Error).message);
  }
}

main()
  .finally(() => closePool().catch(() => {}))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
