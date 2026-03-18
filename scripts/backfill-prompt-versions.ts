/**
 * Backfill script: Seed agent_prompt_versions v1 for every known agent.
 *
 * Reads from two sources in priority order:
 *   1. agent_briefs.system_prompt (DB overrides from dashboard edits)
 *   2. Static SYSTEM_PROMPTS map (code-defined defaults)
 *
 * DB overrides take precedence — if an agent has a row in agent_briefs with
 * a non-null system_prompt, that text becomes v1.
 *
 * Run: npx tsx scripts/backfill-prompt-versions.ts [--execute]
 * Without --execute, runs in dry-run mode (report only).
 */

import { createDbPool } from './lib/migrationLedger.js';

// Static prompt map — keyed by agent role slug
const CORE_AGENT_ROLES = [
  'chief-of-staff', 'cto', 'cfo', 'clo', 'cpo', 'cmo',
  'vp-sales', 'vp-design', 'vp-research',
  'platform-engineer', 'quality-engineer', 'devops-engineer',
  'user-researcher', 'competitive-intel',
  'content-creator', 'seo-analyst', 'social-media-manager',
  'ui-ux-designer', 'frontend-engineer', 'design-critic', 'template-architect',
  'm365-admin', 'global-admin',
  'head-of-hr', 'ops',
  'competitive-research-analyst', 'market-research-analyst',
];

function hasExecuteFlag(argv: string[]): boolean {
  return argv.includes('--execute') || argv.includes('-x');
}

async function run() {
  const execute = hasExecuteFlag(process.argv);
  console.log(`[backfill-prompt-versions] Mode: ${execute ? 'EXECUTE' : 'DRY RUN'}`);

  const pool = createDbPool();
  const query = async <T extends Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> => {
    const result = await pool.query(sql, params);
    return result.rows as T[];
  };

  // Load DB overrides from agent_briefs
  const briefs = await query<{ agent_id: string; system_prompt: string }>(
    `SELECT agent_id, system_prompt FROM agent_briefs WHERE system_prompt IS NOT NULL`,
  );
  const briefMap = new Map(briefs.map(b => [b.agent_id, b.system_prompt]));
  console.log(`[backfill-prompt-versions] Found ${briefMap.size} agent_briefs override(s)`);

  // Load static prompts by importing SYSTEM_PROMPTS — use dynamic import since
  // agent package is TypeScript + ESM. To keep this script simple, we read the
  // compiled JS output. If not compiled, the caller should build first.
  let staticPrompts: Record<string, string> = {};
  try {
    const mod = await import('../packages/agents/src/index.js');
    staticPrompts = mod.SYSTEM_PROMPTS ?? {};
    console.log(`[backfill-prompt-versions] Loaded ${Object.keys(staticPrompts).length} static prompts`);
  } catch (err) {
    console.warn(`[backfill-prompt-versions] Could not import SYSTEM_PROMPTS — using DB briefs only:`, (err as Error).message);
  }

  // Check existing rows so we don't double-insert
  const existing = await query<{ agent_id: string }>(
    `SELECT DISTINCT agent_id FROM agent_prompt_versions WHERE version = 1`,
  );
  const existingSet = new Set(existing.map(r => r.agent_id));

  // Also discover any dynamic agents registered in company_agents but not in our static list
  const dbAgents = await query<{ role: string }>(
    `SELECT role FROM company_agents WHERE status = 'active'`,
  );
  const allRoles = new Set([...CORE_AGENT_ROLES, ...dbAgents.map(a => a.role)]);

  let inserted = 0;
  let skipped = 0;
  let noPrompt = 0;

  for (const role of allRoles) {
    if (existingSet.has(role)) {
      console.log(`  [skip] ${role} — already has v1`);
      skipped++;
      continue;
    }

    // Priority: DB override > static
    const promptText = briefMap.get(role) ?? staticPrompts[role];
    if (!promptText) {
      console.log(`  [no-prompt] ${role} — not in agent_briefs or SYSTEM_PROMPTS`);
      noPrompt++;
      continue;
    }

    const source = briefMap.has(role) ? 'agent_briefs' : 'static';
    console.log(`  [v1] ${role} — source: ${source}, length: ${promptText.length}`);

    if (execute) {
      await query(
        `INSERT INTO agent_prompt_versions (agent_id, version, prompt_text, change_summary, source, deployed_at)
         VALUES ($1, 1, $2, 'Initial v1 backfill from ${source}', 'manual', NOW())
         ON CONFLICT (tenant_id, agent_id, version) DO NOTHING`,
        [role, promptText],
      );
    }
    inserted++;
  }

  console.log(`\n[backfill-prompt-versions] Summary:`);
  console.log(`  Inserted: ${inserted}`);
  console.log(`  Skipped (already v1): ${skipped}`);
  console.log(`  No prompt found: ${noPrompt}`);

  // Verify
  if (execute) {
    const count = await query<{ count: string }>(
      `SELECT COUNT(DISTINCT agent_id) AS count FROM agent_prompt_versions WHERE deployed_at IS NOT NULL`,
    );
    console.log(`  Agents with active prompt versions: ${count[0]?.count ?? 0}`);
  }

  await pool.end();
}

run().catch((err) => {
  console.error('[backfill-prompt-versions] FATAL:', err);
  process.exit(1);
});
