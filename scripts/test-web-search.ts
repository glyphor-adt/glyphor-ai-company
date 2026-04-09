import 'dotenv/config';
import { searchWeb } from '@glyphor/integrations';

async function main() {
  console.log('Testing searchWeb...');
  const results = await searchWeb(
    'AI marketing tools funded 2026',
    { num: 5 }
  );
  console.log('Results count:', results.length);
  console.log('First result:', results[0]);
  console.log('Raw results:', JSON.stringify(results, null, 2));
}

main().catch(console.error);
