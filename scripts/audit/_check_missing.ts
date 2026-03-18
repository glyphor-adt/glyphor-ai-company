import { systemQuery } from '@glyphor/shared/db';

async function main() {
  const agents = ['cpo','competitive-intel','social-media-manager','user-researcher','vp-design','vp-sales'];
  for (const a of agents) {
    const ca = await systemQuery('SELECT role, status FROM company_agents WHERE role = $1', [a]);
    const sk = await systemQuery(
      'SELECT s.slug FROM agent_skills ask JOIN skills s ON s.id = ask.skill_id WHERE ask.agent_role = $1',
      [a]
    );
    const status = ca?.[0]?.status ?? 'NOT FOUND';
    const skills = sk?.map((r: any) => r.slug) ?? [];
    console.log(`${a}: status=${status} skills=[${skills.join(', ')}]`);
  }
  process.exit(0);
}
main();
