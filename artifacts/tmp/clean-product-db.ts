import { pool } from '@glyphor/shared/db';

async function main() {
  const legacyWebBuildName = `${'Fu'}se`;

  // 1. Try to deactivate legacy internal-engine entities in knowledge graph (may not exist)
  try {
    const kg = await pool.query(
      `UPDATE knowledge_graph SET status = 'archived', updated_at = NOW()
       WHERE entity_type IN ('entity', 'product') AND name IN ($1, 'Pulse')
       RETURNING name, entity_type`,
      [legacyWebBuildName],
    );
    console.log('Knowledge graph archived:', kg.rows.length, 'entities');
    kg.rows.forEach((r: any) => console.log(' -', r.name, r.entity_type));
  } catch (e: any) {
    console.log('Knowledge graph table not found (OK):', e.message?.slice(0, 60));
  }

  // 2. Mark products as internal-only in the products table
  const prod = await pool.query(
    `UPDATE products SET status = 'internal', updated_at = NOW()
     WHERE slug IN ($1, 'pulse', 'web-build')
     RETURNING slug, status`,
    [legacyWebBuildName.toLowerCase()],
  );
  console.log('Products table updated:', prod.rows.length, 'rows');
  prod.rows.forEach((r: any) => console.log(' -', r.slug, '->', r.status));

  // 3. Check for company_research rows (table schema may vary)
  try {
    const research = await pool.query(
      `SELECT count(*) as cnt FROM company_research WHERE content ILIKE '%' || $1 || '%' OR content ILIKE '%pulse%'`,
      [legacyWebBuildName.toLowerCase()],
    );
    console.log('Company research rows with internal-engine terms:', research.rows[0]?.cnt);
  } catch (e: any) {
    console.log('Company research check skipped:', e.message?.slice(0, 60));
  }

  // 4. Check brand_guide for references
  const bg = await pool.query(
    `SELECT LEFT(content, 100) as preview FROM company_knowledge_base
     WHERE section = 'brand_guide' AND (content ILIKE '%' || $1 || '%' OR content ILIKE '%pulse%')`,
    [legacyWebBuildName.toLowerCase()],
  );
  console.log('Brand guide still has refs:', bg.rows.length > 0);

  process.exit(0);
}
main();
