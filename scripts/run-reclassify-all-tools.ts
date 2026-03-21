import { closePool } from '@glyphor/shared/db';
import { reclassifyAllTools } from '../packages/agent-runtime/src/testing/toolClassifier.ts';

async function main() {
  const r = await reclassifyAllTools();
  console.log(JSON.stringify(r, null, 2));
  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
