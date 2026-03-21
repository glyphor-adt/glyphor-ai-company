/**
 * Mirrors POST /gtm-readiness/run: runGtmReadinessEval + persistGtmReport, stdout = full JSON.
 * Run: npx tsx scripts/run-with-gcp-db-secret.ts --db-user glyphor_app --db-password-secret db-password scripts/run-gtm-readiness-eval-cli.ts
 */
import { persistGtmReport, runGtmReadinessEval } from '../packages/scheduler/src/gtmReadiness/index.js';

async function main(): Promise<void> {
  const origLog = console.log.bind(console);
  console.log = (...args: unknown[]) => {
    process.stderr.write(`${args.map(String).join(' ')}\n`);
  };
  try {
    const report = await runGtmReadinessEval();
    await persistGtmReport(report);
    const payload = { success: true, ...report };
    process.stdout.write(JSON.stringify(payload, null, 2));
    process.stdout.write('\n');
  } finally {
    console.log = origLog;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
