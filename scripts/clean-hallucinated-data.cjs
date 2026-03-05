/**
 * Clean hallucinated pipeline data from company_profile and pending decisions.
 * 
 * Usage: node scripts/clean-hallucinated-data.cjs
 * Requires: cloud-sql-proxy running on port 15432
 */
const { Pool } = require('pg');

const connStr = process.env.DATABASE_URL || `postgresql://glyphor_system_user:${process.env.DB_PASSWORD}@127.0.0.1:15432/glyphor`;
const pool = new Pool({ connectionString: connStr });

async function main() {
  try {
    // 1. Show all sales.* keys in company_profile
    console.log('\n=== SALES KEYS IN company_profile ===');
    const salesKeys = await pool.query(
      "SELECT key, updated_by, updated_at, LEFT(value::text, 200) as preview FROM company_profile WHERE key LIKE 'sales.%' ORDER BY updated_at DESC"
    );
    if (salesKeys.rows.length === 0) {
      console.log('(none found)');
    } else {
      for (const row of salesKeys.rows) {
        console.log(`  KEY: ${row.key}`);
        console.log(`  UPDATED BY: ${row.updated_by} at ${row.updated_at}`);
        console.log(`  PREVIEW: ${row.preview}`);
        console.log('');
      }
    }

    // 2. Show all customers.* keys
    console.log('=== CUSTOMER KEYS IN company_profile ===');
    const custKeys = await pool.query(
      "SELECT key, updated_by, updated_at, LEFT(value::text, 200) as preview FROM company_profile WHERE key LIKE 'customers.%' ORDER BY updated_at DESC"
    );
    if (custKeys.rows.length === 0) {
      console.log('(none found)');
    } else {
      for (const row of custKeys.rows) {
        console.log(`  KEY: ${row.key}`);
        console.log(`  UPDATED BY: ${row.updated_by} at ${row.updated_at}`);
        console.log(`  PREVIEW: ${row.preview}`);
        console.log('');
      }
    }

    // 3. Show pending decisions from vp-sales
    console.log('=== PENDING DECISIONS FROM vp-sales ===');
    const decisions = await pool.query(
      "SELECT id, title, tier, status, proposed_by, created_at, LEFT(summary, 200) as summary_preview FROM decisions WHERE proposed_by = 'vp-sales' AND status = 'pending' ORDER BY created_at DESC"
    );
    if (decisions.rows.length === 0) {
      console.log('(none found)');
    } else {
      for (const row of decisions.rows) {
        console.log(`  ID: ${row.id} | ${row.tier} | ${row.status}`);
        console.log(`  TITLE: ${row.title}`);
        console.log(`  SUMMARY: ${row.summary_preview}`);
        console.log(`  CREATED: ${row.created_at}`);
        console.log('');
      }
    }

    // 4. DELETE contaminated data
    console.log('=== CLEANING CONTAMINATED DATA ===');
    
    // Delete sales pipeline keys written by vp-sales agent
    const delSales = await pool.query(
      "DELETE FROM company_profile WHERE key LIKE 'sales.pipeline%' RETURNING key"
    );
    console.log(`Deleted ${delSales.rowCount} sales.pipeline* keys:`, delSales.rows.map(r => r.key));

    // Reject all pending decisions from vp-sales (mark as rejected with reason)
    const rejDecisions = await pool.query(
      "UPDATE decisions SET status = 'rejected', resolved_at = NOW() WHERE proposed_by = 'vp-sales' AND status = 'pending' RETURNING id, title"
    );
    console.log(`Rejected ${rejDecisions.rowCount} pending vp-sales decisions:`, rejDecisions.rows.map(r => `${r.id}: ${r.title}`));

    // Also check and clean decisions from other agents that may reference fabricated data
    const otherFabDecisions = await pool.query(
      "SELECT id, title, proposed_by, LEFT(summary, 150) as summary_preview FROM decisions WHERE status = 'pending' AND (summary ILIKE '%OmniReach%' OR summary ILIKE '%whale deal%' OR summary ILIKE '%pipeline blocked%' OR summary ILIKE '%MRR at risk%')"
    );
    if (otherFabDecisions.rows.length > 0) {
      console.log(`\nFound ${otherFabDecisions.rows.length} other decisions referencing fabricated data:`);
      for (const row of otherFabDecisions.rows) {
        console.log(`  ${row.id} (${row.proposed_by}): ${row.title}`);
      }
      const rejOther = await pool.query(
        "UPDATE decisions SET status = 'rejected', resolved_at = NOW() WHERE status = 'pending' AND (summary ILIKE '%OmniReach%' OR summary ILIKE '%whale deal%' OR summary ILIKE '%pipeline blocked%' OR summary ILIKE '%MRR at risk%') RETURNING id"
      );
      console.log(`Rejected ${rejOther.rowCount} additional fabricated decisions`);
    }

    console.log('\n=== DONE ===');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
