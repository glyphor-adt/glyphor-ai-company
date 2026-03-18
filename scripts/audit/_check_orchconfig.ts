import { systemQuery } from '@glyphor/shared/db';

async function main() {
  // Check executive_orchestration_config
  try {
    const rows = await systemQuery('SELECT * FROM executive_orchestration_config');
    console.log('=== executive_orchestration_config ===');
    for (const r of rows) console.log(JSON.stringify(r));
  } catch (e: any) {
    console.log('Table query error:', e.message);
  }
  process.exit(0);
}
main();
