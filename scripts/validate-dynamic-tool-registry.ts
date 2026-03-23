/**
 * Validates tool_registry: no active row with empty api_config unless static-backed.
 * Run: npx tsx scripts/run-with-gcp-db-secret.ts --db-user glyphor_app --db-password-secret db-password scripts/validate-dynamic-tool-registry.ts
 * Or locally: npx tsx scripts/validate-dynamic-tool-registry.ts
 */
import { validateDynamicToolRegistry } from '@glyphor/agent-runtime';

async function main(): Promise<void> {
  const result = await validateDynamicToolRegistry();
  console.log(JSON.stringify(result, null, 2));
  if (!result.valid) {
    console.error(`\nFAILED: ${result.broken.length} broken tool(s).`);
    process.exit(1);
  }
  console.log('\nOK: no broken dynamic registry entries.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
