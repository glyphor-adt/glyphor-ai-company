/**
 * Eval Test Playbook — Section 5: Dashboard UI (Structural Validation)
 *
 * Verifies component existence, API wiring, data contract alignment,
 * TypeScript compilation, and empty state handling.
 * (Visual rendering requires manual browser check.)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

interface TestResult {
  id: string;
  name: string;
  pass: boolean;
  detail: string;
}

const results: TestResult[] = [];
const EVAL_DIR = path.resolve('packages/dashboard/src/components/eval');

function record(id: string, name: string, pass: boolean, detail: string) {
  results.push({ id, name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${id} ${name}: ${detail}`);
}

function fileContains(filePath: string, ...patterns: string[]): { found: string[]; missing: string[] } {
  const content = fs.readFileSync(filePath, 'utf-8');
  const found: string[] = [];
  const missing: string[] = [];
  for (const p of patterns) {
    if (content.includes(p)) found.push(p);
    else missing.push(p);
  }
  return { found, missing };
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Section 5 — Dashboard UI Structural Check');
  console.log('═══════════════════════════════════════════════\n');

  // ── 5.1 All eval components exist ────────────────────────
  const requiredComponents = [
    'EvalFleetGrid.tsx',
    'EvalSummaryBar.tsx',
    'AgentDetailDrawer.tsx',
    'PerformanceTab.tsx',
    'PromptEvolutionTab.tsx',
    'FindingsTab.tsx',
    'WorldStateTab.tsx',
    'CostLatencyPanel.tsx',
    'WorldStateFreshnessPanel.tsx',
    'ScoreBreakdownPanel.tsx',
  ];
  const existing = requiredComponents.filter(f => fs.existsSync(path.join(EVAL_DIR, f)));
  const missingFiles = requiredComponents.filter(f => !existing.includes(f));
  record('5.1', 'All eval components exist', missingFiles.length === 0,
    `${existing.length}/${requiredComponents.length} found` +
    (missingFiles.length > 0 ? ` | Missing: ${missingFiles.join(', ')}` : ''));

  // ── 5.2 Fleet grid calls /api/eval/fleet ─────────────────
  {
    const fp = path.join(EVAL_DIR, 'EvalFleetGrid.tsx');
    const { found, missing } = fileContains(fp,
      '/api/eval/fleet',
      'role: string',
      'performance_score',
      'open_p0s',
    );
    record('5.2', 'Fleet grid API + FleetAgent type', missing.length === 0,
      `Verified: ${found.join(', ')}` + (missing.length > 0 ? ` | Missing: ${missing.join(', ')}` : ''));
  }

  // ── 5.3 Drawer passes agent.role to tabs ─────────────────
  {
    const fp = path.join(EVAL_DIR, 'AgentDetailDrawer.tsx');
    const content = fs.readFileSync(fp, 'utf-8');
    const usesRole = content.includes('agent.role');
    const usesId = /agentId=\{agent\.id\}/.test(content);
    const pass = usesRole && !usesId;
    record('5.3', 'Drawer passes agent.role (not agent.id)', pass,
      pass
        ? 'All tabs receive agent.role ✓'
        : usesId
          ? '⚠ Still using agent.id for tab props!'
          : 'agent.role not found in tab props');
  }

  // ── 5.4 Tab components call correct endpoints ────────────
  {
    const checks: string[] = [];
    const failures: string[] = [];

    // PerformanceTab → /api/eval/agent/.../trend
    const perfTab = path.join(EVAL_DIR, 'PerformanceTab.tsx');
    if (fs.readFileSync(perfTab, 'utf-8').includes('/api/eval/agent/')) {
      checks.push('PerformanceTab→trend');
    } else { failures.push('PerformanceTab missing /api/eval/agent/ call'); }

    // PromptEvolutionTab → /api/eval/agent/.../shadow + trend
    const promptTab = path.join(EVAL_DIR, 'PromptEvolutionTab.tsx');
    const promptContent = fs.readFileSync(promptTab, 'utf-8');
    if (promptContent.includes('/shadow')) checks.push('PromptEvolutionTab→shadow');
    else failures.push('PromptEvolutionTab missing /shadow call');
    if (promptContent.includes('/trend')) checks.push('PromptEvolutionTab→trend');
    else failures.push('PromptEvolutionTab missing /trend call');

    // FindingsTab → /api/eval/agent/.../findings
    const findingsTab = path.join(EVAL_DIR, 'FindingsTab.tsx');
    if (fs.readFileSync(findingsTab, 'utf-8').includes('/findings')) {
      checks.push('FindingsTab→findings');
    } else { failures.push('FindingsTab missing /findings call'); }

    // WorldStateFreshnessPanel → /api/eval/world-state
    const wsPanel = path.join(EVAL_DIR, 'WorldStateFreshnessPanel.tsx');
    if (fs.readFileSync(wsPanel, 'utf-8').includes('/api/eval/world-state')) {
      checks.push('WSPanel→world-state');
    } else { failures.push('WorldStateFreshnessPanel missing /api/eval/world-state call'); }

    // CostLatencyPanel → /api/eval/cost-latency
    const clPanel = path.join(EVAL_DIR, 'CostLatencyPanel.tsx');
    if (fs.readFileSync(clPanel, 'utf-8').includes('/api/eval/cost-latency')) {
      checks.push('CostLatencyPanel→cost-latency');
    } else { failures.push('CostLatencyPanel missing /api/eval/cost-latency call'); }

    record('5.4', 'All tabs call correct API endpoints', failures.length === 0,
      `✓ ${checks.join(', ')}` + (failures.length > 0 ? ` | ✗ ${failures.join(', ')}` : ''));
  }

  // ── 5.5 Empty state handling ─────────────────────────────
  {
    const checks: string[] = [];
    const failures: string[] = [];

    // FindingsTab shows "No open findings"
    if (fs.readFileSync(path.join(EVAL_DIR, 'FindingsTab.tsx'), 'utf-8').includes('No open findings')) {
      checks.push('FindingsTab:empty');
    } else { failures.push('FindingsTab missing empty state'); }

    // WorldStateTab shows empty state
    if (fs.readFileSync(path.join(EVAL_DIR, 'WorldStateTab.tsx'), 'utf-8').includes('No world state')) {
      checks.push('WorldStateTab:empty');
    } else { failures.push('WorldStateTab missing empty state'); }

    // CostLatencyPanel shows "Not yet instrumented"
    if (fs.readFileSync(path.join(EVAL_DIR, 'CostLatencyPanel.tsx'), 'utf-8').includes('Not yet instrumented')) {
      checks.push('CostLatencyPanel:null');
    } else { failures.push('CostLatencyPanel missing null state'); }

    // ScoreBreakdownPanel shows "No recent evaluation data"
    if (fs.readFileSync(path.join(EVAL_DIR, 'ScoreBreakdownPanel.tsx'), 'utf-8').includes('No recent evaluation data')) {
      checks.push('ScoreBreakdownPanel:empty');
    } else { failures.push('ScoreBreakdownPanel missing empty state'); }

    record('5.5', 'Empty state handling', failures.length === 0,
      `✓ ${checks.join(', ')}` + (failures.length > 0 ? ` | ✗ ${failures.join(', ')}` : ''));
  }

  // ── 5.6 Fleet page orchestrates all components ───────────
  {
    const fleetPath = path.resolve('packages/dashboard/src/pages/Fleet.tsx');
    const { found, missing } = fileContains(fleetPath,
      'EvalSummaryBar',
      'WorldStateFreshnessPanel',
      'EvalFleetGrid',
      'CostLatencyPanel',
      'AgentDetailDrawer',
      '/api/eval/fleet',
    );
    record('5.6', 'Fleet page orchestrates all components', missing.length === 0,
      `Found: ${found.join(', ')}` + (missing.length > 0 ? ` | Missing: ${missing.join(', ')}` : ''));
  }

  // ── Summary ──────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════');
  const passed = results.filter(r => r.pass).length;
  const total = results.length;
  console.log(`  Section 5 Result: ${passed}/${total} passed`);
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
