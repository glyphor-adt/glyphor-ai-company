import { runFullToolHealthCheck } from '../../packages/agent-runtime/src/testing/toolTestRunner.js';

async function main() {
  console.log('Running Tier 2 connectivity tests...');
  const summary = await runFullToolHealthCheck({ triggeredBy: 'manual', tiers: [2] });
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
