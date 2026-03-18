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

  // Load static prompts by importing each agent's systemPrompt.ts directly.
  // Avoids importing the full agents barrel which triggers runtime side-effects.
  let staticPrompts: Record<string, string> = {};
  try {
    const promptImports: Record<string, string> = {
      'chief-of-staff': '../packages/agents/src/chief-of-staff/systemPrompt.js',
      'cto': '../packages/agents/src/cto/systemPrompt.js',
      'cfo': '../packages/agents/src/cfo/systemPrompt.js',
      'clo': '../packages/agents/src/clo/systemPrompt.js',
      'cpo': '../packages/agents/src/cpo/systemPrompt.js',
      'cmo': '../packages/agents/src/cmo/systemPrompt.js',
      'vp-sales': '../packages/agents/src/vp-sales/systemPrompt.js',
      'vp-design': '../packages/agents/src/vp-design/systemPrompt.js',
      'platform-engineer': '../packages/agents/src/platform-engineer/systemPrompt.js',
      'quality-engineer': '../packages/agents/src/quality-engineer/systemPrompt.js',
      'devops-engineer': '../packages/agents/src/devops-engineer/systemPrompt.js',
      'user-researcher': '../packages/agents/src/user-researcher/systemPrompt.js',
      'competitive-intel': '../packages/agents/src/competitive-intel/systemPrompt.js',
      'content-creator': '../packages/agents/src/content-creator/systemPrompt.js',
      'seo-analyst': '../packages/agents/src/seo-analyst/systemPrompt.js',
      'social-media-manager': '../packages/agents/src/social-media-manager/systemPrompt.js',
      'ui-ux-designer': '../packages/agents/src/ui-ux-designer/systemPrompt.js',
      'frontend-engineer': '../packages/agents/src/frontend-engineer/systemPrompt.js',
      'design-critic': '../packages/agents/src/design-critic/systemPrompt.js',
      'template-architect': '../packages/agents/src/template-architect/systemPrompt.js',
      'm365-admin': '../packages/agents/src/m365-admin/systemPrompt.js',
      'global-admin': '../packages/agents/src/global-admin/systemPrompt.js',
      'head-of-hr': '../packages/agents/src/head-of-hr/systemPrompt.js',
      'ops': '../packages/agents/src/ops/systemPrompt.js',
      'vp-research': '../packages/agents/src/vp-research/systemPrompt.js',
      'competitive-research-analyst': '../packages/agents/src/competitive-research-analyst/systemPrompt.js',
      'market-research-analyst': '../packages/agents/src/market-research-analyst/systemPrompt.js',
    };

    for (const [role, path] of Object.entries(promptImports)) {
      try {
        const mod = await import(path);
        // Find the exported constant ending in _SYSTEM_PROMPT
        const promptKey = Object.keys(mod).find(k => k.endsWith('_SYSTEM_PROMPT'));
        if (promptKey && typeof mod[promptKey] === 'string') {
          staticPrompts[role] = mod[promptKey];
        }
      } catch {
        // Individual prompt file missing — skip
      }
    }
    console.log(`[backfill-prompt-versions] Loaded ${Object.keys(staticPrompts).length} static prompts`);
  } catch (err) {
    console.warn(`[backfill-prompt-versions] Could not load static prompts:`, (err as Error).message);
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
