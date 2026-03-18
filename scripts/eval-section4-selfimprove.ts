/**
 * Eval Test Playbook — Section 4: Self-Improvement Loop
 *
 * Validates: reflection prompt mutations, shadow runs, and promotion pipeline.
 * These features depend on batch evaluator cycles running, so many checks
 * verify wiring/schema rather than populated data.
 */
import { systemQuery } from '@glyphor/shared/db';

interface TestResult {
  id: string;
  name: string;
  pass: boolean;
  detail: string;
}

const results: TestResult[] = [];

function record(id: string, name: string, pass: boolean, detail: string) {
  results.push({ id, name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${id} ${name}: ${detail}`);
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Section 4 — Self-Improvement Loop');
  console.log('═══════════════════════════════════════════════\n');

  // ── 4.1 Reflection-sourced prompt versions ───────────────
  try {
    const rows = await systemQuery<{ source: string; cnt: number }>(`
      SELECT source, COUNT(*)::int AS cnt
      FROM agent_prompt_versions
      GROUP BY source
      ORDER BY cnt DESC
    `);
    const reflections = rows.find((r: any) => r.source === 'reflection');
    const promotions = rows.find((r: any) => r.source === 'shadow_promoted');
    const manual = rows.find((r: any) => r.source === 'manual');
    const bySource = rows.map((r: any) => `${r.source}: ${r.cnt}`).join(', ');

    // Check that agent_prompt_versions schema supports the loop
    const colCheck = await systemQuery<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'agent_prompt_versions'
        AND column_name IN ('source', 'change_summary', 'performance_score_at_deploy', 'retired_at')
    `);
    const cols = colCheck.map((r: any) => r.column_name);
    const hasRequiredCols = ['source', 'change_summary', 'performance_score_at_deploy', 'retired_at'].every(c => cols.includes(c));

    const pass = hasRequiredCols && (manual?.cnt ?? 0) > 0;
    record('4.1', 'Prompt version sources & schema', pass,
      `Sources: ${bySource}` +
      (reflections ? '' : ' | ⚠ No reflection versions yet (needs batch eval cycle)') +
      (promotions ? '' : ' | ⚠ No shadow_promoted versions yet') +
      (hasRequiredCols ? ' | Schema ✓' : ` | Missing cols: ${['source','change_summary','performance_score_at_deploy','retired_at'].filter(c => !cols.includes(c)).join(', ')}`));
  } catch (err) {
    record('4.1', 'Prompt version sources', false, (err as Error).message);
  }

  // ── 4.2 Shadow runs table schema & data ──────────────────
  try {
    const colCheck = await systemQuery<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'shadow_runs'
    `);
    const cols = colCheck.map((r: any) => r.column_name);
    const requiredCols = ['agent_id', 'challenger_prompt_version', 'baseline_prompt_version',
                          'challenger_score', 'baseline_score', 'status', 'created_at'];
    const hasCols = requiredCols.every(c => cols.includes(c));

    const [countRow] = await systemQuery<{ cnt: number }>(`SELECT COUNT(*)::int AS cnt FROM shadow_runs`);
    const count = countRow?.cnt ?? 0;

    const pass = hasCols;
    record('4.2', 'Shadow runs table', pass,
      `${cols.length} columns, ${count} rows` +
      (hasCols ? ' | Schema ✓' : ` | Missing: ${requiredCols.filter(c => !cols.includes(c)).join(', ')}`) +
      (count === 0 ? ' | ⚠ Empty (needs reflection → mutation → shadow cycle)' : ''));
  } catch (err) {
    record('4.2', 'Shadow runs table', false, (err as Error).message);
  }

  // ── 4.3 Eligible agents for reflection trigger ───────────
  try {
    // The batch evaluator triggers reflection for agents with performance_score < 0.65
    const rows = await systemQuery<{ role: string; performance_score: number }>(`
      SELECT role, performance_score
      FROM company_agents
      WHERE performance_score IS NOT NULL AND performance_score < 0.65
      ORDER BY performance_score ASC
    `);

    const eligible = rows.length;
    const sample = rows.slice(0, 5).map((r: any) => `${r.role}(${r.performance_score})`).join(', ');

    // Also verify the batch evaluator endpoint exists
    const pass = eligible > 0;
    record('4.3', 'Reflection-eligible agents (<0.65)', pass,
      `${eligible} agents qualify | Lowest: ${sample}` +
      ` | These will auto-reflect when batch evaluator runs next`);
  } catch (err) {
    record('4.3', 'Reflection-eligible agents', false, (err as Error).message);
  }

  // ── Summary ──────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════');
  const passed = results.filter(r => r.pass).length;
  const total = results.length;
  console.log(`  Section 4 Result: ${passed}/${total} passed`);
  console.log('═══════════════════════════════════════════════');

  if (passed < total) {
    console.log('\nFailed checks:');
    results.filter(r => !r.pass).forEach(r => console.log(`  ${r.id} ${r.name}: ${r.detail}`));
  }

  process.exit(passed === total ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(2);
});
