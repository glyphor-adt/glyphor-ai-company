import { systemQuery } from '@glyphor/shared/db';

import type { GlyphorEventBus } from './glyphorEventBus.js';
import type { AgentExecutionResult, CompanyAgentRole } from './types.js';

const NOISE_TOOLS = new Set([
  'read_my_assignments',
  'check_messages',
  'save_memory',
  'recall_memories',
  'emit_insight',
  'emit_alert',
  'read_teams_dm',
  'send_agent_message',
]);

const SUPPORTED_SKILL_CATEGORIES = new Set([
  'finance',
  'engineering',
  'marketing',
  'product',
  'customer-success',
  'sales',
  'design',
  'leadership',
  'operations',
  'analytics',
]);

const ROLE_SKILL_CATEGORY: Partial<Record<CompanyAgentRole, string>> = {
  'chief-of-staff': 'leadership',
  'cto': 'engineering',
  'cpo': 'product',
  'cmo': 'marketing',
  'cfo': 'finance',
  'clo': 'leadership',
  'vp-sales': 'sales',
  'vp-design': 'design',
  'platform-engineer': 'engineering',
  'quality-engineer': 'engineering',
  'devops-engineer': 'engineering',
  'user-researcher': 'product',
  'competitive-intel': 'product',
  'content-creator': 'marketing',
  'seo-analyst': 'marketing',
  'social-media-manager': 'marketing',
  'ui-ux-designer': 'design',
  'frontend-engineer': 'design',
  'design-critic': 'design',
  'template-architect': 'design',
  'm365-admin': 'operations',
  'global-admin': 'operations',
  'ops': 'operations',
  'head-of-hr': 'leadership',
  'vp-research': 'analytics',
  'competitive-research-analyst': 'analytics',
  'market-research-analyst': 'analytics',
  'bob-the-tax-pro': 'finance',
  'marketing-intelligence-analyst': 'marketing',
  'adi-rose': 'operations',
};

interface SkillCandidate {
  id: string;
  slug: string;
  name: string;
  tools_granted: string[];
}

interface ProposedSkillPayload {
  slug: string;
  name: string;
  description: string;
  category: string;
  toolSequence: string[];
  contextPatterns: string[];
  successRate: number;
  sourceAgent: string;
  sourceRunIds: string[];
  methodology: string;
}

export async function learnFromAgentRun(params: {
  result: AgentExecutionResult;
  agentRole: CompanyAgentRole;
  runId: string;
  taskType: string;
  taskDescription: string;
  glyphorEventBus?: GlyphorEventBus;
}): Promise<void> {
  const { result, agentRole, runId, taskType, taskDescription, glyphorEventBus } = params;

  if (taskType === 'on_demand' || result.status !== 'completed' || result.totalTurns > 5) return;
  if (estimateQualityScore(result) < 80) return;

  const successfulTools = (result.actions ?? [])
    .filter((action) => action.result === 'success' && !NOISE_TOOLS.has(action.tool))
    .map((action) => action.tool);
  const toolSequence = dedupePreserveOrder(successfulTools).slice(0, 5);
  if (toolSequence.length < 2) return;

  const category = await resolveSkillCategory(agentRole);
  const [existingSkills, priorProposal] = await Promise.all([
    systemQuery<SkillCandidate>(
      `SELECT id, slug, name, tools_granted
       FROM skills
       WHERE category = $1
         AND tools_granted && $2::text[]`,
      [category, toolSequence],
    ),
    systemQuery<{ id: string }>(
      `SELECT id
       FROM proposed_skills
       WHERE status = 'pending'
         AND skill_data->>'slug' = $1
       LIMIT 1`,
      [buildSkillSlug(category, toolSequence)],
    ),
  ]);

  const matchedSkill = pickBestSkillMatch(existingSkills, toolSequence);
  if (matchedSkill) {
    await systemQuery(
      `UPDATE skills
       SET usage_count = usage_count + 1,
           last_used_at = NOW(),
           discovery_source = COALESCE(NULLIF(discovery_source, ''), 'auto_extracted'),
           updated_at = NOW()
       WHERE id = $1`,
      [matchedSkill.id],
    );

    await systemQuery(
      `INSERT INTO agent_skills (agent_role, skill_id, proficiency, times_used, successes, last_used_at)
       VALUES ($1, $2, 'learning', 1, 1, NOW())
       ON CONFLICT (agent_role, skill_id) DO UPDATE
         SET times_used = agent_skills.times_used + 1,
             successes = agent_skills.successes + 1,
             last_used_at = NOW()`,
      [agentRole, matchedSkill.id],
    );

    await glyphorEventBus?.emit({
      type: 'learning.proposal_signal',
      source: agentRole,
      priority: 'normal',
      payload: {
        runId,
        skillId: matchedSkill.id,
        skillSlug: matchedSkill.slug,
        mode: 'existing_skill_reused',
        toolSequence,
      },
    });
    return;
  }

  if (priorProposal.length > 0) return;

  const proposedSkill = buildProposedSkill({
    agentRole,
    runId,
    taskDescription,
    category,
    toolSequence,
  });

  await systemQuery(
    `INSERT INTO proposed_skills (skill_data, source_agent, source_run_ids, status)
     VALUES ($1::jsonb, $2, $3, 'pending')`,
    [JSON.stringify(proposedSkill), agentRole, [runId]],
  );

  await glyphorEventBus?.emit({
    type: 'learning.proposal_signal',
    source: agentRole,
    priority: 'high',
    payload: {
      runId,
      proposedSkill,
      mode: 'new_skill_candidate',
    },
  });
}

function estimateQualityScore(result: AgentExecutionResult): number {
  let score = result.reasoningMeta
    ? Math.round(result.reasoningMeta.confidence * 100)
    : 85;

  const actions = result.actions ?? [];
  if (actions.some((action) => action.result === 'error')) score -= 20;
  if ((result.output ?? '').trim().length < 120) score -= 10;
  if (result.totalTurns <= 3) score += 5;

  return Math.max(0, Math.min(100, score));
}

async function resolveSkillCategory(agentRole: CompanyAgentRole): Promise<string> {
  const mapped = ROLE_SKILL_CATEGORY[agentRole];
  if (mapped) return mapped;

  const [agent] = await systemQuery<{ department: string | null }>(
    'SELECT department FROM company_agents WHERE role = $1 LIMIT 1',
    [agentRole],
  );
  const department = normalizeCategory(agent?.department);
  return department ?? 'operations';
}

function normalizeCategory(category: string | null | undefined): string | null {
  if (!category) return null;
  const normalized = category.toLowerCase();
  if (SUPPORTED_SKILL_CATEGORIES.has(normalized)) return normalized;
  if (normalized === 'people' || normalized === 'legal') return 'leadership';
  if (normalized === 'research') return 'analytics';
  return null;
}

function pickBestSkillMatch(skills: SkillCandidate[], toolSequence: string[]): SkillCandidate | null {
  let best: { skill: SkillCandidate; score: number } | null = null;
  for (const skill of skills) {
    const overlap = toolSequence.filter((tool) => skill.tools_granted.includes(tool)).length;
    const score = overlap / Math.max(toolSequence.length, skill.tools_granted.length, 1);
    if (overlap >= 2 && (!best || score > best.score)) {
      best = { skill, score };
    }
  }
  return best?.score && best.score >= 0.4 ? best.skill : null;
}

function buildProposedSkill(params: {
  agentRole: string;
  runId: string;
  taskDescription: string;
  category: string;
  toolSequence: string[];
}): ProposedSkillPayload {
  const { agentRole, runId, taskDescription, category, toolSequence } = params;
  const summary = taskDescription.trim().slice(0, 160);
  const name = summary
    .split(/\s+/)
    .slice(0, 6)
    .map((word) => word.replace(/[^a-z0-9-]/gi, ''))
    .filter(Boolean)
    .join(' ')
    || `${category} procedure`;

  return {
    slug: buildSkillSlug(category, toolSequence),
    name: toTitleCase(name),
    description: `Auto-extracted ${category} procedure from a successful ${agentRole} run: ${summary}`,
    category,
    toolSequence,
    contextPatterns: [summary],
    successRate: 1,
    sourceAgent: agentRole,
    sourceRunIds: [runId],
    methodology: toolSequence
      .map((tool, index) => `${index + 1}. Execute \`${tool}\` with the same decision framing used in the successful run.`)
      .join('\n'),
  };
}

function buildSkillSlug(category: string, toolSequence: string[]): string {
  const stem = toolSequence
    .slice(0, 3)
    .map((tool) => tool.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, ''))
    .join('-')
    .slice(0, 48);
  return `auto-${category}-${stem || 'procedure'}`;
}

function dedupePreserveOrder(items: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    deduped.push(item);
  }
  return deduped;
}

function toTitleCase(value: string): string {
  return value.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}
