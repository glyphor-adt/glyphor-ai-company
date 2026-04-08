/**
 * Verify vp-design (Mia) has required tool grants for the web pipeline.
 *
 *   npx tsx scripts/check-vp-design-tool-grants.ts
 *   npm run validate:vp-design-grants
 *
 * With GCP database:
 *   npx tsx scripts/run-with-gcp-db-secret.ts --db-user glyphor_app --db-password-secret db-password scripts/check-vp-design-tool-grants.ts
 */
import 'dotenv/config';

import { pool, closePool } from '@glyphor/shared/db';

/** Failing the script if any of these are missing, blocked, inactive, or expired. */
const REQUIRED_WEB_TOOLS = [
  'normalize_design_brief',
  'plan_website_build',
  'invoke_web_build',
  'invoke_web_iterate',
  'github_create_from_template',
  'github_push_files',
  'github_create_pull_request',
  'vercel_create_project',
  'vercel_get_preview_url',
  'deploy_preview',
  'save_memory',
] as const;

/** Reported as warnings (recommended for full design/exec surface) but do not fail. */
const RECOMMENDED_TOOLS = [
  'list_my_tools',
  'tool_search',
  'invoke_web_coding_loop',
  'github_merge_pull_request',
  'github_get_pull_request_status',
  'github_wait_for_pull_request_checks',
  'vercel_wait_for_preview_ready',
  'vercel_get_production_url',
  'vercel_get_deployment_logs',
  'get_file_contents',
  'list_open_prs',
  'comment_on_pr',
  'screenshot_page',
  'run_accessibility_audit',
  'check_ai_smell',
  'send_agent_message',
  'check_messages',
  'read_inbox',
  'reply_to_email',
  'create_git_branch',
] as const;

async function main(): Promise<void> {
  const role = 'vp-design';

  const { rows } = await pool.query<{
    tool_name: string;
    is_active: boolean | null;
    is_blocked: boolean | null;
    expires_at: string | null;
  }>(
    `SELECT tool_name, is_active, is_blocked, expires_at
       FROM agent_tool_grants
      WHERE agent_role = $1`,
    [role],
  );

  const byName = new Map(rows.map((r) => [r.tool_name, r]));
  const fatal: string[] = [];
  const expired: string[] = [];

  for (const tool of REQUIRED_WEB_TOOLS) {
    const row = byName.get(tool);
    if (!row) {
      fatal.push(`missing grant: ${tool}`);
      continue;
    }
    if (row.is_active === false) {
      fatal.push(`inactive: ${tool}`);
    }
    if (row.is_blocked === true) {
      fatal.push(`blocked: ${tool}`);
    }
    if (row.expires_at && new Date(row.expires_at) <= new Date()) {
      expired.push(tool);
      fatal.push(`expired: ${tool}`);
    }
  }

  const warn: string[] = [];
  for (const tool of RECOMMENDED_TOOLS) {
    const row = byName.get(tool);
    if (!row || row.is_active === false || row.is_blocked === true) {
      warn.push(tool);
    } else if (row.expires_at && new Date(row.expires_at) <= new Date()) {
      warn.push(`${tool} (expired)`);
    }
  }

  const grantCount = rows.filter(
    (r) => r.is_active !== false && r.is_blocked !== true && (!r.expires_at || new Date(r.expires_at) > new Date()),
  ).length;

  console.log(`agent_role=${role} total_rows=${rows.length} effective_grants~=${grantCount}`);

  if (warn.length > 0) {
    console.warn(`Recommended grants missing or blocked (non-fatal): ${warn.join(', ')}`);
  }

  if (fatal.length > 0) {
    console.error('VP Design tool grant check FAILED:\n' + fatal.map((l) => `  - ${l}`).join('\n'));
    process.exitCode = 1;
  } else {
    console.log('VP Design required web pipeline grants: OK');
  }

  await closePool();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await closePool().catch(() => {});
  process.exit(1);
});
