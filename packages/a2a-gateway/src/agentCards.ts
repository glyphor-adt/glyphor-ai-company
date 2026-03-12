import { systemQuery } from '@glyphor/shared/db';

export interface AgentSkillCard {
  name: string;
  slug: string;
  category: string;
  proficiency: string;
}

export interface AgentRubricCard {
  taskType: string;
  passingScore: number;
  excellenceScore: number;
}

export interface AgentCard {
  id: string;
  name: string;
  description: string;
  url: string;
  department: string | null;
  skills: AgentSkillCard[];
  qualityStandards: AgentRubricCard[];
  authentication: {
    schemes: string[];
  };
  defaultInputModes: string[];
  defaultOutputModes: string[];
}

interface AgentRow {
  role: string;
  display_name: string | null;
  name: string | null;
  title: string | null;
  department: string | null;
  personality_summary: string | null;
}

export async function listAgentCards(baseUrl: string): Promise<AgentCard[]> {
  const [agents, skills, rubrics] = await Promise.all([
    systemQuery<AgentRow>(
      `SELECT ca.role, ca.display_name, ca.name, ca.title, ca.department, ap.personality_summary
       FROM company_agents ca
       LEFT JOIN agent_profiles ap ON ap.agent_id = ca.role
       WHERE ca.status = 'active'
       ORDER BY ca.role`,
      [],
    ),
    systemQuery<{ agent_role: string; skill_name: string; skill_slug: string; category: string; proficiency: string }>(
      `SELECT ags.agent_role, s.name AS skill_name, s.slug AS skill_slug, s.category, ags.proficiency
       FROM agent_skills ags
       JOIN skills s ON s.id = ags.skill_id`,
      [],
    ),
    systemQuery<{ role: string; task_type: string; passing_score: number; excellence_score: number }>(
      `SELECT role, task_type, passing_score, excellence_score
       FROM role_rubrics`,
      [],
    ),
  ]);

  const skillsByRole = new Map<string, AgentSkillCard[]>();
  for (const row of skills) {
    const list = skillsByRole.get(row.agent_role) ?? [];
    list.push({
      name: row.skill_name,
      slug: row.skill_slug,
      category: row.category,
      proficiency: row.proficiency,
    });
    skillsByRole.set(row.agent_role, list);
  }

  const rubricsByRole = new Map<string, AgentRubricCard[]>();
  for (const row of rubrics) {
    const list = rubricsByRole.get(row.role) ?? [];
    list.push({
      taskType: row.task_type,
      passingScore: Number(row.passing_score ?? 0),
      excellenceScore: Number(row.excellence_score ?? 0),
    });
    rubricsByRole.set(row.role, list);
  }

  return agents.map((agent) => buildAgentCard(agent, baseUrl, skillsByRole, rubricsByRole));
}

export async function getAgentCard(baseUrl: string, agentId: string): Promise<AgentCard | null> {
  const cards = await listAgentCards(baseUrl);
  return cards.find((card) => card.id === agentId) ?? null;
}

export async function getGatewayCard(baseUrl: string): Promise<AgentCard> {
  const cards = await listAgentCards(baseUrl);
  return {
    id: 'glyphor',
    name: 'Glyphor Agent Gateway',
    description: `External A2A gateway for discovering and delegating work to ${cards.length} Glyphor organizational agents.`,
    url: `${baseUrl}/agents`,
    department: 'general',
    skills: [],
    qualityStandards: [],
    authentication: { schemes: ['bearer'] },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
  };
}

function buildAgentCard(
  agent: AgentRow,
  baseUrl: string,
  skillsByRole: Map<string, AgentSkillCard[]>,
  rubricsByRole: Map<string, AgentRubricCard[]>,
): AgentCard {
  const displayName = agent.display_name ?? agent.name ?? agent.role;
  const titleSuffix = agent.title ? ` - ${agent.title}` : '';

  return {
    id: agent.role,
    name: `${displayName}${titleSuffix}`,
    description: agent.personality_summary ?? `${displayName} handles ${agent.department ?? 'general'} work for Glyphor.`,
    url: `${baseUrl}/agents/${encodeURIComponent(agent.role)}`,
    department: agent.department,
    skills: skillsByRole.get(agent.role) ?? [],
    qualityStandards: rubricsByRole.get(agent.role) ?? [],
    authentication: { schemes: ['bearer'] },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
  };
}
