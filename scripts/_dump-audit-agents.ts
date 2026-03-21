/**
 * One-shot audit dump — prompts + KB query + static config slices. Run with run-with-gcp-db-secret.
 */
import type { CompanyAgentRole } from '../packages/agent-runtime/src/types.js';
import { getAlwaysLoadedTools } from '../packages/agent-runtime/src/toolSearchConfig.js';
import { closePool, systemQuery } from '@glyphor/shared/db';

const AGENTS = ['cto', 'ops', 'chief-of-staff', 'clo', 'm365-admin', 'global-admin'] as const;

/** Mirrors toolRetriever.ts DEPARTMENT_PINS + ROLE_TO_DEPARTMENT for combined pin list. */
const DEPARTMENT_PINS: Record<string, string[]> = {
  marketing: ['search_sharepoint'],
  finance: ['search_sharepoint', 'revenue_lookup'],
  engineering: ['search_sharepoint'],
  operations: ['search_sharepoint'],
  sales: ['search_sharepoint'],
  design: ['search_sharepoint'],
  product: ['search_sharepoint'],
  legal: ['search_sharepoint'],
  research: ['search_sharepoint'],
  hr: ['search_sharepoint'],
};

const ROLE_TO_DEPARTMENT: Partial<Record<CompanyAgentRole, string>> = {
  'chief-of-staff': 'operations',
  ops: 'operations',
  'global-admin': 'operations',
  cto: 'engineering',
  'm365-admin': 'engineering',
  clo: 'legal',
};

async function main(): Promise<void> {
  try {
    process.stdout.write('========== 1. getActivePrompt (DB) — full prompt_text ==========\n\n');

    for (const agentId of AGENTS) {
      const rows = await systemQuery<{ prompt_text: string | null }>(
        `SELECT prompt_text FROM agent_prompt_versions
         WHERE agent_id = $1 AND deployed_at IS NOT NULL AND retired_at IS NULL
         ORDER BY deployed_at DESC LIMIT 1`,
        [agentId],
      );
      const text = rows[0]?.prompt_text ?? null;
      process.stdout.write(`---------- agent_id: ${agentId} ----------\n`);
      if (text === null) {
        process.stdout.write('<<NULL — no active versioned prompt>>\n\n');
      } else {
        process.stdout.write(text);
        process.stdout.write('\n\n');
      }
    }

    process.stdout.write('========== 2. company_knowledge_base query ==========\n\n');

    const kbRows = await systemQuery<{
      key: string;
      title: string;
      layer: number;
      audience: string;
      is_stale: boolean;
    }>(
      `SELECT section AS key, title, layer, audience, is_stale
       FROM company_knowledge_base
       WHERE layer IN (1, 2)
       AND (
         audience = 'all'
         OR audience LIKE '%engineering%'
         OR audience LIKE '%operations%'
         OR audience LIKE '%legal%'
       )
       AND is_stale = FALSE
       ORDER BY layer, key`,
    );

    for (const row of kbRows) {
      process.stdout.write(
        JSON.stringify({
          key: row.key,
          title: row.title,
          layer: row.layer,
          audience: row.audience,
          is_stale: row.is_stale,
        }) + '\n',
      );
    }
    process.stdout.write(`\n(row count: ${kbRows.length})\n`);

    process.stdout.write('\n========== 3. AGENT_WORLD_STATE_KEYS (worldStateKeys.ts) ==========\n\n');
    const wsStatic: Record<string, string[] | 'none'> = {
      cto: 'none',
      ops: 'none',
      'chief-of-staff': [
        'brand_voice',
        'marketing_strategy',
        'active_campaigns',
        'content_calendar',
        'audience_segments',
        'social_calendar',
        'keyword_targets',
      ],
      clo: 'none',
      'm365-admin': 'none',
      'global-admin': 'none',
    };
    for (const id of AGENTS) {
      const v = wsStatic[id];
      process.stdout.write(`${id}: ${typeof v === 'string' ? v : JSON.stringify(v)}\n`);
    }

    process.stdout.write('\n========== 4. ALWAYS_LOADED + DEPARTMENT_PINS (combined, deduped) ==========\n\n');
    for (const id of AGENTS) {
      const role = id as CompanyAgentRole;
      const always = [...getAlwaysLoadedTools(role)];
      const dept = ROLE_TO_DEPARTMENT[role];
      const deptPins = dept ? DEPARTMENT_PINS[dept] ?? [] : [];
      const combined = [...new Set([...always, ...deptPins])].sort();
      process.stdout.write(`${id} (department=${dept ?? 'none'}):\n`);
      process.stdout.write(JSON.stringify(combined, null, 2));
      process.stdout.write('\n\n');
    }
  } finally {
    await closePool().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
