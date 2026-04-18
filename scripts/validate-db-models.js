/**
 * DB Model Validation Script
 * Checks that no deprecated or retired models remain in company_agents or routing_config.
 * Run before production deploys: node scripts/validate-db-models.js
 */
const { Client } = require('pg');

const DEPRECATED = [
  'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo',
  'gpt-4.1-nano', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-5.4-nano',
  'claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-6',
  'claude-3-5-haiku-20241022', 'claude-3-5-haiku-latest',
  'claude-3-opus-20240229', 'claude-3-haiku-20240307',
  'claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-5-sonnet-latest',
  'claude-opus-4-20250514', 'claude-opus-4-6-20260205', 'claude-sonnet-4-6-20260217',
  'gemini-2.0-flash-001', 'gemini-2.0-flash', 'gemini-2.0-flash-exp', 'gemini-2.0-pro',
  'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-3.0-flash-preview',
  'gemini-3-pro-preview', 'gemini-2.5-pro',
  'gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-3-flash-preview',
];

async function main() {
  const c = new Client({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '6543', 10),
    database: process.env.DB_NAME || 'glyphor',
    user: process.env.DB_USER || 'glyphor_app',
    password: process.env.DB_PASS || 'TempAuth2026x',
  });

  await c.connect();
  let failures = 0;

  // Check company_agents
  const placeholders = DEPRECATED.map((_, i) => `$${i + 1}`).join(',');
  const agentResult = await c.query(
    `SELECT role, display_name, model FROM company_agents WHERE model IN (${placeholders})`,
    DEPRECATED
  );
  if (agentResult.rows.length > 0) {
    console.error('FAIL: company_agents has deprecated models:');
    console.table(agentResult.rows);
    failures++;
  } else {
    console.log('OK: company_agents — no deprecated models');
  }

  // Check routing_config
  const routingResult = await c.query(
    `SELECT task_type, model FROM routing_config WHERE model IN (${placeholders})`,
    DEPRECATED
  );
  if (routingResult.rows.length > 0) {
    console.error('FAIL: routing_config has deprecated models:');
    console.table(routingResult.rows);
    failures++;
  } else {
    console.log('OK: routing_config — no deprecated models');
  }

  // Summary
  const agentSummary = await c.query('SELECT role, display_name, model FROM company_agents ORDER BY role');
  console.log('\n--- company_agents ---');
  console.table(agentSummary.rows);

  const routingSummary = await c.query('SELECT task_type, model FROM routing_config ORDER BY task_type');
  console.log('\n--- routing_config ---');
  console.table(routingSummary.rows);

  await c.end();

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log('\nAll checks passed');
}

main().catch(e => { console.error(e); process.exit(1); });
