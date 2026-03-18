import { systemQuery } from '@glyphor/shared/db';

async function main() {
  const skills = [
    'cross-team-coordination','decision-routing','advanced-web-creation',
    'sharepoint-site-management','brand-management','frontend-development',
    'access-management','talent-management','tenant-administration',
    'incident-response','platform-monitoring'
  ];
  for (const s of skills) {
    const r = await systemQuery('SELECT slug, name, category FROM skills WHERE slug = $1', [s]);
    if (r && r.length > 0) console.log(`${s}: category=${r[0].category}`);
    else console.log(`${s}: NOT FOUND`);
  }

  // Also check agent_skills for these specific assignments
  console.log('\n=== Cross-domain assignments per audit ===');
  const xd = [
    ['chief-of-staff', 'cross-team-coordination'],
    ['chief-of-staff', 'decision-routing'],
    ['cmo', 'advanced-web-creation'],
    ['cmo', 'sharepoint-site-management'],
    ['cmo', 'brand-management'],
    ['cto', 'advanced-web-creation'],
    ['frontend-engineer', 'frontend-development'],
    ['global-admin', 'access-management'],
    ['head-of-hr', 'talent-management'],
    ['m365-admin', 'tenant-administration'],
    ['m365-admin', 'sharepoint-site-management'],
    ['ops', 'incident-response'],
    ['ops', 'platform-monitoring'],
  ];
  for (const [agent, skill] of xd) {
    const r = await systemQuery(
      `SELECT ask.agent_role, s.slug, s.category, ca.department
       FROM agent_skills ask
       JOIN skills s ON s.id = ask.skill_id
       JOIN company_agents ca ON ca.role = ask.agent_role
       WHERE ask.agent_role = $1 AND s.slug = $2`, [agent, skill]);
    if (r && r.length > 0) {
      console.log(`  ${agent} -> ${skill}: skill_cat=${r[0].category} agent_dept=${r[0].department}`);
    }
  }

  process.exit(0);
}

main();
