import { systemQuery } from '@glyphor/shared/db';

const RUNNER_AGENTS = [
  'chief-of-staff','cfo','cmo','cto','cpo','clo','vp-sales','vp-design','vp-research',
  'head-of-hr','ops','global-admin','m365-admin','platform-engineer','quality-engineer',
  'devops-engineer','user-researcher','competitive-intel','competitive-research-analyst',
  'market-research-analyst','content-creator','seo-analyst','social-media-manager',
  'ui-ux-designer','frontend-engineer','design-critic','template-architect'
];

async function main() {
  const placeholders = RUNNER_AGENTS.map((_, i) => `$${i + 1}`).join(',');
  const q = `SELECT role, display_name, status, department FROM company_agents WHERE role NOT IN (${placeholders}) ORDER BY status, role`;
  const r = await systemQuery(q, RUNNER_AGENTS);
  if (!r || !r.rows) {
    console.log('Query returned:', JSON.stringify(r)?.slice(0, 500));
    // Try simpler query
    const r2 = await systemQuery('SELECT role, display_name, status FROM company_agents ORDER BY status, role');
    const allRoles = r2.rows.map((x: any) => x.role);
    const dbOnly = allRoles.filter((role: string) => !RUNNER_AGENTS.includes(role));
    console.log('All roles:', allRoles.length);
    console.log('DB-only roles:', dbOnly);
    process.exit(0);
  }
  console.table(r.rows);

  for (const row of r.rows) {
    const runs = await systemQuery(
      `SELECT COUNT(*) as cnt FROM agent_runs WHERE agent_id = $1 AND created_at > NOW() - INTERVAL '30 days'`,
      [row.role]
    );
    const msgs = await systemQuery(
      `SELECT COUNT(*) as cnt FROM agent_messages WHERE sender_role = $1 AND created_at > NOW() - INTERVAL '30 days'`,
      [row.role]
    );
    const assigns = await systemQuery(
      `SELECT COUNT(*) as cnt FROM work_assignments WHERE assigned_to = $1 AND created_at > NOW() - INTERVAL '30 days'`,
      [row.role]
    );
    console.log(`  ${row.role}: runs=${runs.rows[0].cnt} msgs=${msgs.rows[0].cnt} assigns=${assigns.rows[0].cnt} status=${row.status}`);
  }

  process.exit(0);
}

main();
