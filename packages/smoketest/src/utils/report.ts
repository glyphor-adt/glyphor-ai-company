/**
 * Console report printer — outputs test results in a structured table.
 */

import type { LayerResult, TestStatus } from '../types.js';

const STATUS_ICONS: Record<TestStatus, string> = {
  pass: '✅',
  fail: '❌',
  skipped: '⏭️',
  blocked: '🚫',
};

/**
 * Print detailed results for each layer.
 */
export function printLayerResults(layers: LayerResult[]): void {
  for (const layer of layers) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`Layer ${layer.layer} — ${layer.name}`);
    console.log('═'.repeat(60));

    for (const test of layer.tests) {
      const icon = STATUS_ICONS[test.status];
      const duration = test.durationMs > 0 ? ` (${(test.durationMs / 1000).toFixed(1)}s)` : '';
      console.log(`  ${icon} ${test.id} ${test.name}${duration}`);
      if (test.status === 'fail' || test.status === 'blocked') {
        console.log(`     └─ ${test.message}`);
      }
    }
  }
}

/**
 * Print the summary table matching the smoketest doc template.
 */
export function printSummaryTable(layers: LayerResult[]): void {
  console.log(`\n${'═'.repeat(70)}`);
  console.log('RESULTS SUMMARY');
  console.log('═'.repeat(70));

  const header = '| Layer                        | Tests | Pass | Fail | Skip | Block |';
  const divider = '|------------------------------|-------|------|------|------|-------|';
  console.log(header);
  console.log(divider);

  let totalTests = 0;
  let totalPass = 0;
  let totalFail = 0;
  let totalSkip = 0;
  let totalBlock = 0;

  for (const layer of layers) {
    const pass = layer.tests.filter(t => t.status === 'pass').length;
    const fail = layer.tests.filter(t => t.status === 'fail').length;
    const skip = layer.tests.filter(t => t.status === 'skipped').length;
    const block = layer.tests.filter(t => t.status === 'blocked').length;
    const total = layer.tests.length;

    const label = `${layer.layer} — ${layer.name}`.padEnd(28);
    console.log(
      `| ${label} | ${pad(total)} | ${pad(pass)} | ${pad(fail)} | ${pad(skip)} | ${pad(block)} |`,
    );

    totalTests += total;
    totalPass += pass;
    totalFail += fail;
    totalSkip += skip;
    totalBlock += block;
  }

  console.log(divider);
  console.log(
    `| ${'TOTAL'.padEnd(28)} | ${pad(totalTests)} | ${pad(totalPass)} | ${pad(totalFail)} | ${pad(totalSkip)} | ${pad(totalBlock)} |`,
  );
  console.log('');

  if (totalFail > 0) {
    console.log(`⚠️  ${totalFail} test(s) FAILED — review details above.`);
  } else if (totalBlock > 0) {
    console.log(`⚠️  All runnable tests passed, but ${totalBlock} test(s) were blocked.`);
  } else if (totalSkip > 0) {
    console.log(`✅ All runnable tests passed. ${totalSkip} test(s) skipped (manual/interactive).`);
  } else {
    console.log('✅ All tests passed!');
  }
}

function pad(n: number): string {
  return String(n).padStart(4).padEnd(5);
}
