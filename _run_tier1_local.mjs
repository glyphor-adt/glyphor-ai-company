import { runTier1ForAllTools } from './packages/agent-runtime/dist/testing/tier1SchemaValidator.js';
import { systemQuery } from './packages/shared/dist/db/index.js';

async function main() {
  const results = await runTier1ForAllTools();
  console.log(JSON.stringify(results, null, 2));
  
  // Clean up pg pool
  try { if (systemQuery.end) await systemQuery.end(); } catch (e) {}
}

main().catch(console.error);
