import { pool } from '@glyphor/shared/db';

async function main() {
  console.log('\n=== 1. Layer distribution ===');
  const layers = await pool.query(`
    SELECT layer, COUNT(*) AS section_count, SUM(LENGTH(content)) AS total_chars
    FROM company_knowledge_base
    WHERE is_active = true
    GROUP BY layer ORDER BY layer
  `);
  console.table(layers.rows);

  console.log('\n=== 2. Hardcoded agent counts in Layer 1/2 (should be 0) ===');
  const hardcoded = await pool.query(`
    SELECT section, substring(content from '\\d+ (AI )?agents') AS match
    FROM company_knowledge_base
    WHERE layer IN (1,2)
      AND is_active = true
      AND content ~ '\\d+ (AI )?agents'
      AND content NOT LIKE '%{active_agent_count}%'
  `);
  console.log(`Found: ${hardcoded.rows.length} rows`);
  if (hardcoded.rows.length > 0) console.table(hardcoded.rows);

  console.log('\n=== 3. Auto-expire stale sections ===');
  const autoExpire = await pool.query(`
    SELECT section, title, is_stale, auto_expire, last_verified_at
    FROM company_knowledge_base
    WHERE auto_expire = TRUE
    ORDER BY is_stale DESC, last_verified_at ASC
  `);
  console.table(autoExpire.rows);

  console.log('\n=== 4. Pricing section status ===');
  const pricing = await pool.query(`
    SELECT section, is_stale, auto_expire, last_verified_at
    FROM company_knowledge_base WHERE section = 'pricing'
  `);
  console.table(pricing.rows);

  console.log('\n=== 5. Live refs ===');
  const refs = await pool.query(`SELECT key, cached_value, last_resolved_at FROM knowledge_live_refs`);
  console.table(refs.rows);

  console.log('\n=== 6. Standing orders split ===');
  const standing = await pool.query(`
    SELECT section, layer, audience FROM company_knowledge_base
    WHERE section LIKE 'standing_orders%'
    ORDER BY section
  `);
  console.table(standing.rows);

  console.log('\n=== 7. Knowledge change log entries ===');
  const changelog = await pool.query(`
    SELECT section_key, version, changed_by, changed_at
    FROM knowledge_change_log
    ORDER BY changed_at DESC LIMIT 10
  `);
  console.table(changelog.rows);

  console.log('\n=== 8. Full section inventory ===');
  const all = await pool.query(`
    SELECT section, layer, audience, is_stale, auto_expire, 
           owner_agent_id, review_cadence, LENGTH(content) as chars
    FROM company_knowledge_base
    WHERE is_active = true
    ORDER BY layer, section
  `);
  console.table(all.rows);

  process.exit(0);
}
main();
