import { closePool } from '@glyphor/shared/db';
import { runFullToolHealthCheck } from '../packages/agent-runtime/src/testing/toolTestRunner.ts';

async function main() {
  const summary = await runFullToolHealthCheck({
    triggeredBy: 'manual',
    tiers: [1, 2],
  });
  console.log(JSON.stringify(summary, null, 2));
  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
