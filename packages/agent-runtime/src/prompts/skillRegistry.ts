/**
 * Skill Registry — in-code skill definitions and task-based selection.
 *
 * Complements the DB-driven skill loading in createRunDeps.ts.
 * DB skills are the primary source; this registry provides:
 * 1. A typed interface for skill metadata
 * 2. A programmatic selectSkillsForTask() for code-path selection
 * 3. Trigger keyword/task-type matching without DB round-trip
 *
 * Skills registered here can be used by buildSystemPrompt() when
 * the DB skill context is unavailable (e.g. local dev, tests).
 */

export interface SkillDefinition {
  id: string;
  name: string;
  category: string;
  triggerKeywords: string[];
  triggerTaskTypes: string[];
  agentIds: string[];
  content: string;
  tokenEstimate: number;
}

const SKILL_REGISTRY = new Map<string, SkillDefinition>();

export function registerSkill(skill: SkillDefinition): void {
  SKILL_REGISTRY.set(skill.id, skill);
}

export function getSkillsForAgent(agentId: string): SkillDefinition[] {
  return Array.from(SKILL_REGISTRY.values())
    .filter(s => s.agentIds.includes(agentId) || s.agentIds.includes('*'));
}

/**
 * Select the most relevant skill(s) for a given task.
 * Returns at most `maxSkills` skills, ranked by keyword + task-type match score.
 */
export function selectSkillsForTask(
  agentId: string,
  taskDescription: string,
  taskType?: string,
  maxSkills = 1,
): SkillDefinition[] {
  const available = getSkillsForAgent(agentId);
  const taskLower = taskDescription.toLowerCase();

  const scored = available.map(skill => ({
    skill,
    score: skill.triggerKeywords.filter(kw =>
      taskLower.includes(kw.toLowerCase()),
    ).length + (taskType && skill.triggerTaskTypes.includes(taskType) ? 10 : 0),
  }));

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSkills)
    .map(s => s.skill);
}

export function getRegisteredSkillCount(): number {
  return SKILL_REGISTRY.size;
}
