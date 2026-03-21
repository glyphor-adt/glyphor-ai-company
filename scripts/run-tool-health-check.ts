import { closePool } from '@glyphor/shared/db';
import { runFullToolHealthCheck } from '../packages/agent-runtime/src/testing/toolTestRunner.ts';

async function main() {
  const rest = process.argv.slice(2).filter((a) => a !== '--');
  const onlyToolNames = rest.length > 0 ? rest : undefined;

  const summary = await runFullToolHealthCheck({
    triggeredBy: 'manual',
    tiers: [1, 2],
    ...(onlyToolNames ? { onlyToolNames } : {}),
  });
  console.log(JSON.stringify(summary, null, 2));
  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
