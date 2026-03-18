import { systemQuery } from '@glyphor/shared/db';

async function main() {
  const slugs = [
    'account-research', 'proposal-generation', 'user-research',
    'competitive-analysis', 'pipeline-management', 'competitive-intelligence'
  ];
  for (const s of slugs) {
    const r = await systemQuery('SELECT id, slug, name, category FROM skills WHERE slug = $1', [s]);
    if (r && r.length > 0) console.log(`${s}: id=${r[0].id} name=${r[0].name} cat=${r[0].category}`);
    else console.log(`${s}: NOT FOUND`);
  }
  process.exit(0);
}
main();
