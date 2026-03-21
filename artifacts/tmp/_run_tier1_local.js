import { runTier1ForAllTools } from './packages/agent-runtime/dist/testing/tier1SchemaValidator.js';
import { systemQuery as pool } from '@glyphor/shared/db';

async function main() {
  console.log('Starting tier 1 tests locally...');
  const results = await runTier1ForAllTools();
  console.log(JSON.stringify(results, null, 2));
  
  // Clean up pg pool
  try { await pool.end(); } catch (e) {}
}

main().catch(console.error);
