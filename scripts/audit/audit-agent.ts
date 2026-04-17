/**
 * scripts/audit/audit-agent.ts
 *
 * Produces a structured AgentAuditReport for a single agent.
 * Usage:  npx tsx scripts/audit/audit-agent.ts <role>
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { systemQuery } from '@glyphor/shared/db';

// ── Interfaces ─────────────────────────────────────────────

export interface AgentAuditReport {
  role: string;
  timestamp: string;

  brief: {
    path: string;
    exists: boolean;
    tokenCount: number;
    hasRelationships: boolean;
    hasAuthority: boolean;
    hasAntiPatterns: boolean;
    containsSkillContent: boolean;
    containsKnowledgeContent: boolean;
    skillIndicators: string[];
    knowledgeIndicators: string[];
    duplicateRelationships: string[];
    sectionBreakdown: SectionAnalysis[];
  };

  systemPrompt: {
    path: string;
    exists: boolean;
    tokenCount: number;
    hasCrisisFabricationRules: boolean;
    overlapsWithBrief: number;
    overlapsWithSkills: number;
    exportedConstants: string[];
  };

  skills: {
    assigned: SkillAssignment[];
    totalTokens: number;
    crossDomainSkills: string[];
    ghostToolRefs: string[];
  };

  tiers: {
    taskTypes: TaskTierInfo[];
  };

  tools: {
    factoryCount: number;
    estimatedToolCount: number;
    factories: string[];
    hasOrchestrationTools: boolean;
    hasAgent365: boolean;
    hasGlyphorMcp: boolean;
    hasSharePoint: boolean;
    grantedByDb: number;
    blockedByDb: number;
  };

  config: {
    runnerType: string;
    temperature: number;
    maxTurns: number;
    maxTurnsOverrides: Record<string, number>;
    isExecutive: boolean;
    hasActiveTeamMembers: boolean;
    teamMemberCount: number;
    teamMembersWithRunners: number;
    runnerMismatch: boolean;
    temperatureOutlier: boolean;
  };

  taskRouting: {
    taskTypes: string[];
    coveredBySkillMap: string[];
    uncoveredTaskTypes: string[];
    coverageRate: number;
  };

  runs: {
    last30Days: {
      total: number;
      completed: number;
      aborted: number;
      timedOut: number;
      maxTurnsReached: number;
      avgTurns: number;
      avgDurationMs: number;
      avgInputTokens: number;
      avgOutputTokens: number;
      estimatedCost30d: number;
    };
    taskBreakdown: Record<string, { count: number; completionRate: number; avgTurns: number }>;
  };

  assignments: {
    last30Days: {
      received: number;
      completed: number;
      needsRevision: number;
      failed: number;
      avgQualityScore: number;
      avgCompletionTimeMs: number;
    };
    commonFailureModes: string[];
  };

  schedule: {
    cronJobs: CronJob[];
    hasScheduleFile: boolean;
    missingCrons: string[];
  };

  recommendations: Recommendation[];
}

interface SectionAnalysis {
  heading: string;
  tokens: number;
  classification: 'identity' | 'skill' | 'knowledge' | 'anti-pattern' | 'mixed';
}

interface SkillAssignment {
  slug: string;
  proficiency: string;
  category: string;
  tokenCount: number;
  isOwnDomain: boolean;
  timesUsed: number;
  successRate: number;
}

interface TaskTierInfo {
  task: string;
  tier: string;
  losesIdentity: boolean;
  losesSkills: boolean;
  losesMemory: boolean;
}

interface CronJob {
  name: string;
  schedule: string;
  task: string;
}

interface Recommendation {
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  category: string;
  description: string;
  effort: 'trivial' | 'small' | 'medium' | 'large';
}

// ── Constants ──────────────────────────────────────────────

const ROOT = path.resolve(process.cwd());
const BRIEFS_DIR = path.join(ROOT, 'packages', 'company-knowledge', 'briefs');
const AGENTS_SRC = path.join(ROOT, 'packages', 'agents', 'src');
const CONTEXT_TIERS: Record<string, string> = {
  on_demand: 'light',
  work_loop: 'task',
  proactive: 'task',
};  // default for scheduled tasks is 'standard', briefing/orchestrate is 'full'
const FULL_TIER_TASKS = new Set(['generate_briefing', 'orchestrate', 'strategic_planning', 'weekly_review', 'monthly_retrospective']);
const STANDARD_TIER_TASKS = new Set(['scheduled']); // placeholder — most scheduled tasks are 'standard'

const ORCHESTRATOR_ROLES = new Set(['chief-of-staff', 'vp-research', 'cto', 'clo', 'ops', 'cpo']);

const PRECISION_ROLES = new Set([
  'quality-engineer', 'design-critic', 'template-architect',
  'seo-analyst', 'competitive-research-analyst', 'market-research-analyst',
  'platform-engineer', 'devops-engineer', 'global-admin', 'm365-admin',
]);
const CREATIVE_ROLES = new Set([
  'content-creator', 'ui-ux-designer', 'frontend-engineer', 'cmo',
]);

const RUNNER_AGENT_DIRS = new Set(
  readdirSync(AGENTS_SRC, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== 'shared')
    .map(d => d.name),
);

// ── Token approximation ────────────────────────────────────

function estimateTokens(text: string): number {
  // GPT-style approximation: ~4 chars per token
  return Math.ceil(text.length / 4);
}

// ── Brief analysis ─────────────────────────────────────────

function resolveBriefPath(role: string, displayName: string): string {
  // Briefs are named by person: sarah-chen.md, not chief-of-staff.md
  const slug = displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const personPath = path.join(BRIEFS_DIR, `${slug}.md`);
  if (existsSync(personPath)) return personPath;

  // Fallback: try role-based name
  const rolePath = path.join(BRIEFS_DIR, `${role}.md`);
  if (existsSync(rolePath)) return rolePath;

  // Fallback: scan briefs for a file that contains the role
  const files = readdirSync(BRIEFS_DIR).filter(f => f.endsWith('.md'));
  for (const f of files) {
    const content = readFileSync(path.join(BRIEFS_DIR, f), 'utf-8');
    if (content.toLowerCase().includes(role.replace(/-/g, ' '))) {
      return path.join(BRIEFS_DIR, f);
    }
  }
  return personPath; // return expected path even if missing
}

const SKILL_PATTERNS = [
  { pattern: /step \d+[.:]/i, label: 'procedural steps' },
  { pattern: /when .{3,40} then .{3,}/i, label: 'conditional procedures' },
  { pattern: /use (?:the )?[`"]?[\w-]+[`"]? tool/i, label: 'tool instructions' },
  { pattern: /call .{3,30} with/i, label: 'API/function calls' },
  { pattern: /format:\s*\n/i, label: 'output format specs' },
  { pattern: /template:/i, label: 'templates' },
  { pattern: /```[\s\S]{50,}```/m, label: 'extended code examples' },
];

const KNOWLEDGE_PATTERNS = [
  { pattern: /\$[\d,]+/, label: 'dollar amounts' },
  { pattern: /\d{2,}%/, label: 'percentages' },
  { pattern: /https?:\/\//i, label: 'URLs' },
  { pattern: /as of \w+ \d{4}/i, label: 'dated facts' },
  { pattern: /current(?:ly)? .{3,30} is/i, label: 'current state claims' },
];

function classifySection(heading: string, content: string): 'identity' | 'skill' | 'knowledge' | 'anti-pattern' | 'mixed' {
  const lower = heading.toLowerCase();
  if (/anti.?pattern|failure.?mode|never\sdo/i.test(lower)) return 'anti-pattern';

  const skillHits = SKILL_PATTERNS.filter(p => p.pattern.test(content)).length;
  const knowledgeHits = KNOWLEDGE_PATTERNS.filter(p => p.pattern.test(content)).length;
  const identitySignals = [
    /your (?:identity|personality|voice|role|name|title)/i,
    /you are/i,
    /reports? to/i,
    /communicat(?:ion|e) style/i,
    /authority/i,
    /sign(?:s)? off with/i,
    /relationship/i,
  ].filter(p => p.test(content)).length;

  if (identitySignals >= 2 && skillHits === 0 && knowledgeHits === 0) return 'identity';
  if (skillHits > knowledgeHits && skillHits > identitySignals) return 'skill';
  if (knowledgeHits > skillHits && knowledgeHits > identitySignals) return 'knowledge';
  if (identitySignals > 0 || (skillHits === 0 && knowledgeHits === 0)) return 'identity';
  return 'mixed';
}

function analyzeBrief(briefPath: string): AgentAuditReport['brief'] {
  const exists = existsSync(briefPath);
  if (!exists) {
    return {
      path: briefPath, exists: false, tokenCount: 0,
      hasRelationships: false, hasAuthority: false, hasAntiPatterns: false,
      containsSkillContent: false, containsKnowledgeContent: false,
      skillIndicators: [], knowledgeIndicators: [],
      duplicateRelationships: [], sectionBreakdown: [],
    };
  }

  const text = readFileSync(briefPath, 'utf-8');
  const tokenCount = estimateTokens(text);

  // Split into sections by headings
  const sections: SectionAnalysis[] = [];
  const headingRegex = /^#{1,3}\s+(.+)/gm;
  const headings: { heading: string; start: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(text)) !== null) {
    headings.push({ heading: match[1].trim(), start: match.index });
  }
  for (let i = 0; i < headings.length; i++) {
    const end = i + 1 < headings.length ? headings[i + 1].start : text.length;
    const content = text.slice(headings[i].start, end);
    sections.push({
      heading: headings[i].heading,
      tokens: estimateTokens(content),
      classification: classifySection(headings[i].heading, content),
    });
  }

  const skillIndicators = SKILL_PATTERNS.filter(p => p.pattern.test(text)).map(p => p.label);
  const knowledgeIndicators = KNOWLEDGE_PATTERNS.filter(p => p.pattern.test(text)).map(p => p.label);

  // Detect duplicate relationships (names appearing 2+ times in relationship section)
  const relSection = text.match(/## (?:Your )?Relationships[\s\S]*?(?=\n## |$)/i)?.[0] ?? '';
  const nameMatches = relSection.match(/\*\*([A-Z][\w-]+ [\w-]+)/g)?.map(n => n.replace('**', '')) ?? [];
  const nameCounts = new Map<string, number>();
  for (const n of nameMatches) nameCounts.set(n, (nameCounts.get(n) ?? 0) + 1);
  const duplicateRelationships = [...nameCounts.entries()].filter(([, c]) => c > 1).map(([n]) => n);

  return {
    path: briefPath,
    exists: true,
    tokenCount,
    hasRelationships: /## (?:Your )?Relationships/i.test(text),
    hasAuthority: /## (?:Authority|Constraints)/i.test(text),
    hasAntiPatterns: /## (?:Anti-?Patterns|Failure Modes)/i.test(text),
    containsSkillContent: skillIndicators.length > 0,
    containsKnowledgeContent: knowledgeIndicators.length > 0,
    skillIndicators,
    knowledgeIndicators,
    duplicateRelationships,
    sectionBreakdown: sections,
  };
}

// ── System prompt analysis ─────────────────────────────────

function analyzeSystemPrompt(role: string, briefText: string, skillTexts: string[]): AgentAuditReport['systemPrompt'] {
  const promptPath = path.join(AGENTS_SRC, role, 'systemPrompt.ts');
  const exists = existsSync(promptPath);
  if (!exists) {
    return {
      path: promptPath, exists: false, tokenCount: 0,
      hasCrisisFabricationRules: false, overlapsWithBrief: 0,
      overlapsWithSkills: 0, exportedConstants: [],
    };
  }

  const text = readFileSync(promptPath, 'utf-8');
  const tokenCount = estimateTokens(text);

  // Detect exported constants
  const exportedConstants = [...text.matchAll(/export\s+(?:const|function)\s+(\w+)/g)].map(m => m[1]);

  // Detect pre-revenue / crisis fabrication rules
  const hasCrisisFabricationRules =
    /PRE-REVENUE/i.test(text) ||
    /\$0\s*MRR/i.test(text) ||
    /NEVER\s+(?:fabricate|invent|hallucinate)/i.test(text) ||
    /No Fabrication Policy/i.test(text);

  // Estimate overlap with brief (sentence-level)
  const overlapsWithBrief = estimateSentenceOverlap(text, briefText);
  const allSkillText = skillTexts.join('\n');
  const overlapsWithSkills = allSkillText.length > 0 ? estimateSentenceOverlap(text, allSkillText) : 0;

  return {
    path: promptPath,
    exists: true,
    tokenCount,
    hasCrisisFabricationRules,
    overlapsWithBrief,
    overlapsWithSkills,
    exportedConstants,
  };
}

function extractSentences(text: string): string[] {
  return text
    .replace(/```[\s\S]*?```/g, '')  // strip code blocks
    .replace(/`[^`]+`/g, '')          // strip inline code
    .split(/[.!?\n]+/)
    .map(s => s.trim().toLowerCase().replace(/\s+/g, ' '))
    .filter(s => s.length > 20);
}

function estimateSentenceOverlap(sourceText: string, targetText: string): number {
  const sourceSentences = extractSentences(sourceText);
  const targetSentences = extractSentences(targetText);
  if (sourceSentences.length === 0) return 0;

  let overlapCount = 0;
  for (const src of sourceSentences) {
    const srcWords = new Set(src.split(' ').filter(w => w.length > 3));
    for (const tgt of targetSentences) {
      const tgtWords = new Set(tgt.split(' ').filter(w => w.length > 3));
      const intersection = [...srcWords].filter(w => tgtWords.has(w)).length;
      const overlap = intersection / Math.max(srcWords.size, 1);
      if (overlap > 0.5) { overlapCount++; break; }
    }
  }
  return Math.round((overlapCount / sourceSentences.length) * 100);
}

// ── Run file analysis ──────────────────────────────────────

interface RunFileAnalysis {
  factories: string[];
  taskTypes: string[];
  temperature: number;
  maxTurns: number;
  maxTurnsOverrides: Record<string, number>;
  runnerType: string;
}

function analyzeRunFile(role: string): RunFileAnalysis {
  const runPath = path.join(AGENTS_SRC, role, 'run.ts');
  const result: RunFileAnalysis = {
    factories: [], taskTypes: [], temperature: 0.3, maxTurns: 10,
    maxTurnsOverrides: {}, runnerType: 'TaskRunner',
  };

  if (!existsSync(runPath)) return result;
  const text = readFileSync(runPath, 'utf-8');

  // Extract tool factory calls
  const factoryMatches = text.matchAll(/create\w+Tools\b/g);
  result.factories = [...new Set([...factoryMatches].map(m => m[0]))];

  // Extract task types from type union or array
  // Pattern 1: type TaskType = 'foo' | 'bar' | 'on_demand';
  const typeUnion = text.match(/type\s+\w*[Tt]ask\w*\s*=\s*([^;]+)/);
  if (typeUnion) {
    result.taskTypes = [...typeUnion[1].matchAll(/'(\w+)'/g)].map(m => m[1]);
  }
  // Pattern 2: task === 'foo' checks
  if (result.taskTypes.length === 0) {
    const taskChecks = [...text.matchAll(/task\s*===?\s*'(\w+)'/g)].map(m => m[1]);
    result.taskTypes = [...new Set(taskChecks)];
  }

  // Extract temperature
  const tempMatch = text.match(/temperature:\s*([\d.]+)/);
  if (tempMatch) result.temperature = parseFloat(tempMatch[1]);

  // Extract maxTurns — default
  const turnsMatch = text.match(/maxTurns:\s*(\d+)/);
  if (turnsMatch) result.maxTurns = parseInt(turnsMatch[1]);

  // Extract maxTurns overrides — pattern: task === 'X' ? N : ...
  const overrideMatches = text.matchAll(/task\s*===\s*'(\w+)'\s*(?:\|\|[^?]+)?\?\s*(\d+)/g);
  for (const m of overrideMatches) {
    result.maxTurnsOverrides[m[1]] = parseInt(m[2]);
  }

  // Determine runner type
  if (ORCHESTRATOR_ROLES.has(role)) {
    result.runnerType = 'OrchestratorRunner';
  }

  return result;
}

// ── Schedule analysis ──────────────────────────────────────

function analyzeSchedule(role: string): { cronJobs: CronJob[]; hasScheduleFile: boolean } {
  const schedulePath = path.join(AGENTS_SRC, role, 'schedule.ts');
  if (!existsSync(schedulePath)) return { cronJobs: [], hasScheduleFile: false };

  const text = readFileSync(schedulePath, 'utf-8');
  const cronJobs: CronJob[] = [];

  // Extract cron entries
  const blocks = text.matchAll(/\{\s*name:\s*'([^']+)',\s*schedule:\s*'([^']+)',[\s\S]*?task:\s*'([^']+)'/g);
  for (const m of blocks) {
    cronJobs.push({ name: m[1], schedule: m[2], task: m[3] });
  }

  return { cronJobs, hasScheduleFile: true };
}

// ── Department mapping ─────────────────────────────────────

function getSkillDomain(category: string): string {
  const map: Record<string, string> = {
    design: 'Design & Frontend',
    engineering: 'Engineering',
    executive: 'Executive Office',
    finance: 'Finance',
    legal: 'Legal',
    marketing: 'Marketing',
    operations: 'Operations',
    research: 'Research & Intelligence',
  };
  return map[category.toLowerCase()] ?? category;
}

// ── Main audit function ────────────────────────────────────

export async function auditAgent(role: string): Promise<AgentAuditReport> {
  // 1. Load agent profile from DB
  const [agent] = await systemQuery<{
    role: string; display_name: string; department: string;
    temperature: number; max_turns: number; reports_to: string;
  }>(
    `SELECT role, display_name, department, temperature, max_turns, reports_to
     FROM company_agents WHERE role = $1`,
    [role],
  );

  if (!agent) throw new Error(`Agent "${role}" not found in company_agents`);

  const displayName = agent.display_name ?? role;
  const department = agent.department ?? 'Unknown';

  // 2. Analyze brief
  const briefPath = resolveBriefPath(role, displayName);
  const brief = analyzeBrief(briefPath);
  const briefText = brief.exists ? readFileSync(briefPath, 'utf-8') : '';

  // 3. Query skills
  const skillRows = await systemQuery<{
    slug: string; proficiency: string; category: string;
    methodology: string; tools_granted: string[];
    times_used: number; successes: number; failures: number;
  }>(
    `SELECT s.slug, s.category, s.methodology, s.tools_granted,
            ask.proficiency, ask.times_used, ask.successes, ask.failures
     FROM agent_skills ask
     JOIN skills s ON s.id = ask.skill_id
     WHERE ask.agent_role = $1`,
    [role],
  );

  const skillTexts = skillRows.map(s => s.methodology ?? '');
  const skillAssignments: SkillAssignment[] = skillRows.map(s => ({
    slug: s.slug,
    proficiency: s.proficiency ?? 'expert',
    category: s.category ?? 'unknown',
    tokenCount: estimateTokens(s.methodology ?? ''),
    isOwnDomain: getSkillDomain(s.category ?? '') === department,
    timesUsed: (s.times_used ?? 0),
    successRate: (s.successes ?? 0) + (s.failures ?? 0) > 0
      ? (s.successes ?? 0) / ((s.successes ?? 0) + (s.failures ?? 0))
      : 1,
  }));

  const crossDomainSkills = skillAssignments
    .filter(s => !s.isOwnDomain && s.category !== 'executive')
    .map(s => s.slug);

  // 4. Detect ghost tool references in skills
  const ghostToolRefs: string[] = [];
  // We'd need KNOWN_TOOLS for a full check — use a simpler heuristic:
  // tools_granted arrays in the DB that reference non-existent tool names
  // For now collect all granted tools for reporting
  const allToolsGranted = new Set(skillRows.flatMap(s => s.tools_granted ?? []));

  // 5. Analyze system prompt
  const systemPrompt = analyzeSystemPrompt(role, briefText, skillTexts);

  // 6. Analyze run.ts
  const runAnalysis = analyzeRunFile(role);

  // 7. Query tool grants
  const grantRows = await systemQuery<{ tool_name: string; is_active: boolean }>(
    `SELECT tool_name, is_active FROM agent_tool_grants WHERE agent_role = $1`,
    [role],
  );
  const grantedByDb = grantRows.filter(g => g.is_active).length;
  const blockedByDb = grantRows.filter(g => !g.is_active).length;

  // 8. Query team members
  const teamRows = await systemQuery<{ role: string; status: string }>(
    `SELECT role, status FROM company_agents WHERE reports_to = $1 AND status = 'active'`,
    [role],
  );
  const teamMemberCount = teamRows.length;
  const teamMembersWithRunners = teamRows.filter(t => RUNNER_AGENT_DIRS.has(t.role)).length;

  // 9. Query run health (last 30 days)
  const runRows = await systemQuery<{
    status: string; task: string; turns: number;
    duration_ms: number; input_tokens: number; output_tokens: number;
    cost: number;
  }>(
    `SELECT status, task, turns, duration_ms, input_tokens, output_tokens, cost
     FROM agent_runs
     WHERE agent_id = $1 AND started_at > NOW() - INTERVAL '30 days'`,
    [role],
  );

  const dbMaxTurns = agent.max_turns ?? runAnalysis.maxTurns;
  const completedRuns = runRows.filter(r => r.status === 'completed');
  const maxTurnsReached = runRows.filter(r => (r.turns ?? 0) >= dbMaxTurns && r.status !== 'completed').length;

  const taskBreakdown: Record<string, { count: number; completionRate: number; avgTurns: number }> = {};
  const taskGroups = new Map<string, typeof runRows>();
  for (const r of runRows) {
    const task = r.task ?? 'unknown';
    if (!taskGroups.has(task)) taskGroups.set(task, []);
    taskGroups.get(task)!.push(r);
  }
  for (const [task, rows] of taskGroups) {
    const completed = rows.filter(r => r.status === 'completed').length;
    taskBreakdown[task] = {
      count: rows.length,
      completionRate: rows.length > 0 ? completed / rows.length : 0,
      avgTurns: rows.length > 0 ? rows.reduce((s, r) => s + (r.turns ?? 0), 0) / rows.length : 0,
    };
  }

  const runs: AgentAuditReport['runs'] = {
    last30Days: {
      total: runRows.length,
      completed: completedRuns.length,
      aborted: runRows.filter(r => r.status === 'aborted').length,
      timedOut: runRows.filter(r => r.status === 'timed_out').length,
      maxTurnsReached,
      avgTurns: runRows.length > 0 ? runRows.reduce((s, r) => s + (r.turns ?? 0), 0) / runRows.length : 0,
      avgDurationMs: runRows.length > 0 ? runRows.reduce((s, r) => s + (r.duration_ms ?? 0), 0) / runRows.length : 0,
      avgInputTokens: runRows.length > 0 ? runRows.reduce((s, r) => s + (r.input_tokens ?? 0), 0) / runRows.length : 0,
      avgOutputTokens: runRows.length > 0 ? runRows.reduce((s, r) => s + (r.output_tokens ?? 0), 0) / runRows.length : 0,
      estimatedCost30d: runRows.reduce((s, r) => s + (r.cost ?? 0), 0),
    },
    taskBreakdown,
  };

  // 10. Query assignments
  const assignmentRows = await systemQuery<{
    status: string; quality_score: number;
    dispatched_at: string; completed_at: string;
    evaluation: string;
  }>(
    `SELECT status, quality_score, dispatched_at, completed_at, evaluation
     FROM work_assignments
     WHERE assigned_to = $1 AND created_at > NOW() - INTERVAL '30 days'`,
    [role],
  );

  const completedAssignments = assignmentRows.filter(a => a.status === 'completed');
  const qualityScores = completedAssignments.filter(a => a.quality_score != null).map(a => a.quality_score);
  const completionTimes = completedAssignments
    .filter(a => a.dispatched_at && a.completed_at)
    .map(a => new Date(a.completed_at).getTime() - new Date(a.dispatched_at).getTime());

  // Extract common failure patterns from evaluations
  const failedEvals = assignmentRows
    .filter(a => a.status === 'failed' || a.status === 'blocked')
    .map(a => a.evaluation)
    .filter(Boolean);
  const commonFailureModes = [...new Set(failedEvals.slice(0, 5))];

  const assignments: AgentAuditReport['assignments'] = {
    last30Days: {
      received: assignmentRows.length,
      completed: completedAssignments.length,
      needsRevision: assignmentRows.filter(a => a.evaluation?.toLowerCase().includes('revision')).length,
      failed: assignmentRows.filter(a => a.status === 'failed').length,
      avgQualityScore: qualityScores.length > 0 ? qualityScores.reduce((s, v) => s + v, 0) / qualityScores.length : 0,
      avgCompletionTimeMs: completionTimes.length > 0 ? completionTimes.reduce((s, v) => s + v, 0) / completionTimes.length : 0,
    },
    commonFailureModes,
  };

  // 11. Schedule analysis
  const scheduleData = analyzeSchedule(role);

  // Find task types defined in run.ts but not in any cron
  const cronTasks = new Set(scheduleData.cronJobs.map(c => c.task));
  const missingCrons = runAnalysis.taskTypes
    .filter(t => t !== 'on_demand' && t !== 'work_loop' && t !== 'proactive' && !cronTasks.has(t));

  // 12. Task routing coverage (check task_skill_map)
  const skillMapRows = await systemQuery<{ task_regex: string; skill_slug: string }>(
    `SELECT task_regex, skill_slug FROM task_skill_map`,
  );

  const coveredTasks: string[] = [];
  const uncoveredTasks: string[] = [];
  for (const task of runAnalysis.taskTypes) {
    if (task === 'on_demand') continue;
    const matched = skillMapRows.some(r => {
      try { return new RegExp(r.task_regex, 'i').test(task); } catch { return false; }
    });
    if (matched) coveredTasks.push(task);
    else uncoveredTasks.push(task);
  }

  // 13. Context tiers per task
  const taskTiers: TaskTierInfo[] = runAnalysis.taskTypes.map(task => {
    let tier: string;
    if (FULL_TIER_TASKS.has(task)) tier = 'full';
    else if (task in CONTEXT_TIERS) tier = CONTEXT_TIERS[task];
    else tier = 'standard';

    return {
      task,
      tier,
      losesIdentity: tier === 'light' || tier === 'task',
      losesSkills: tier === 'light',
      losesMemory: tier === 'light',
    };
  });

  // 14. Generate recommendations
  const isExecutive = ORCHESTRATOR_ROLES.has(role) ||
    ['cfo', 'cmo', 'vp-sales', 'vp-design', 'head-of-hr'].includes(role);

  const hasOrchestrationTools = runAnalysis.factories.some(f =>
    f.includes('TeamOrchestration') || f.includes('ExecutiveOrchestration'),
  );
  const runnerMismatch = hasOrchestrationTools && !ORCHESTRATOR_ROLES.has(role);
  const temperatureOutlier =
    (PRECISION_ROLES.has(role) && runAnalysis.temperature > 0.4) ||
    (CREATIVE_ROLES.has(role) && runAnalysis.temperature < 0.4);

  const recommendations = generateRecommendations({
    role, brief, systemPrompt, skillAssignments, crossDomainSkills,
    ghostToolRefs, runAnalysis, runs, assignments, scheduleData, missingCrons,
    uncoveredTasks, isExecutive, hasOrchestrationTools, runnerMismatch,
    temperatureOutlier, teamMemberCount, teamMembersWithRunners, dbMaxTurns,
  });

  // ── Write P0/P1 findings to fleet_findings for live scoring ──
  try {
    const scorableFindings = recommendations.filter(
      (r: { priority: string }) => r.priority === 'P0' || r.priority === 'P1',
    );
    for (const finding of scorableFindings) {
      const penalty = finding.priority === 'P0' ? 0.15 : 0.05;
      await systemQuery(
        `INSERT INTO fleet_findings (agent_id, severity, finding_type, description, score_penalty)
         SELECT $1, $2, $3, $4, $5
         WHERE NOT EXISTS (
           SELECT 1 FROM fleet_findings
           WHERE agent_id = $1 AND finding_type = $3 AND resolved_at IS NULL
         )`,
        [role, finding.priority, finding.category, finding.description, penalty],
      );
    }
  } catch (err) {
    console.warn(`[audit-agent] fleet_findings write failed for ${role}:`, (err as Error).message);
  }

  return {
    role,
    timestamp: new Date().toISOString(),
    brief,
    systemPrompt,
    skills: {
      assigned: skillAssignments,
      totalTokens: skillAssignments.reduce((s, sk) => s + sk.tokenCount, 0),
      crossDomainSkills,
      ghostToolRefs,
    },
    tiers: { taskTypes: taskTiers },
    tools: {
      factoryCount: runAnalysis.factories.length,
      estimatedToolCount: grantedByDb || runAnalysis.factories.length,
      factories: runAnalysis.factories,
      hasOrchestrationTools,
      hasAgent365: runAnalysis.factories.some(f => f.includes('Agent365')),
      hasGlyphorMcp: runAnalysis.factories.some(f => f.includes('GlyphorMcp')),
      hasSharePoint: runAnalysis.factories.some(f => f.includes('SharePoint')),
      grantedByDb,
      blockedByDb,
    },
    config: {
      runnerType: runAnalysis.runnerType,
      temperature: agent.temperature ?? runAnalysis.temperature,
      maxTurns: dbMaxTurns,
      maxTurnsOverrides: runAnalysis.maxTurnsOverrides,
      isExecutive,
      hasActiveTeamMembers: teamMemberCount > 0,
      teamMemberCount,
      teamMembersWithRunners,
      runnerMismatch,
      temperatureOutlier,
    },
    taskRouting: {
      taskTypes: runAnalysis.taskTypes,
      coveredBySkillMap: coveredTasks,
      uncoveredTaskTypes: uncoveredTasks,
      coverageRate: runAnalysis.taskTypes.filter(t => t !== 'on_demand').length > 0
        ? coveredTasks.length / runAnalysis.taskTypes.filter(t => t !== 'on_demand').length
        : 1,
    },
    runs,
    assignments,
    schedule: {
      cronJobs: scheduleData.cronJobs,
      hasScheduleFile: scheduleData.hasScheduleFile,
      missingCrons,
    },
    recommendations,
  };
}

// ── Recommendation engine ──────────────────────────────────

function generateRecommendations(ctx: {
  role: string;
  brief: AgentAuditReport['brief'];
  systemPrompt: AgentAuditReport['systemPrompt'];
  skillAssignments: SkillAssignment[];
  crossDomainSkills: string[];
  ghostToolRefs: string[];
  runAnalysis: RunFileAnalysis;
  runs: AgentAuditReport['runs'];
  assignments: AgentAuditReport['assignments'];
  scheduleData: { cronJobs: CronJob[]; hasScheduleFile: boolean };
  missingCrons: string[];
  uncoveredTasks: string[];
  isExecutive: boolean;
  hasOrchestrationTools: boolean;
  runnerMismatch: boolean;
  temperatureOutlier: boolean;
  teamMemberCount: number;
  teamMembersWithRunners: number;
  dbMaxTurns: number;
}): Recommendation[] {
  const recs: Recommendation[] = [];

  // Brief bloat
  if (ctx.brief.tokenCount > 1200) {
    recs.push({
      priority: 'P1', category: 'brief',
      description: `Brief is ${ctx.brief.tokenCount} tokens (target: <1200). Audit for skill/knowledge content that should be extracted.`,
      effort: 'small',
    });
  }

  if (ctx.brief.containsSkillContent) {
    recs.push({
      priority: 'P1', category: 'brief',
      description: `Brief contains procedural content (${ctx.brief.skillIndicators.join(', ')}). Move to skill files.`,
      effort: 'medium',
    });
  }

  if (ctx.brief.containsKnowledgeContent) {
    recs.push({
      priority: 'P2', category: 'brief',
      description: `Brief contains knowledge data (${ctx.brief.knowledgeIndicators.join(', ')}). Move to knowledge base.`,
      effort: 'small',
    });
  }

  if (ctx.brief.duplicateRelationships.length > 0) {
    recs.push({
      priority: 'P2', category: 'brief',
      description: `Duplicate relationship entries: ${ctx.brief.duplicateRelationships.join(', ')}.`,
      effort: 'trivial',
    });
  }

  // System prompt
  if (!ctx.systemPrompt.hasCrisisFabricationRules) {
    recs.push({
      priority: 'P1', category: 'prompt',
      description: `System prompt lacks pre-revenue / crisis fabrication guards. Add shared PRE_REVENUE_GUARD.`,
      effort: 'trivial',
    });
  }

  if (ctx.systemPrompt.overlapsWithBrief > 30) {
    recs.push({
      priority: 'P2', category: 'dedup',
      description: `System prompt has ~${ctx.systemPrompt.overlapsWithBrief}% overlap with brief. Deduplicate — brief is identity, prompt is operational rules.`,
      effort: 'medium',
    });
  }

  if (ctx.systemPrompt.overlapsWithSkills > 30) {
    recs.push({
      priority: 'P2', category: 'dedup',
      description: `System prompt has ~${ctx.systemPrompt.overlapsWithSkills}% overlap with skills. Move procedural content to skills.`,
      effort: 'medium',
    });
  }

  // Skills — zero
  if (ctx.skillAssignments.length === 0) {
    recs.push({
      priority: 'P0', category: 'skills',
      description: `Agent has ZERO skills assigned. No procedural guidance — model is winging it.`,
      effort: 'small',
    });
  }

  // Skills — cross domain
  for (const slug of ctx.crossDomainSkills) {
    recs.push({
      priority: 'P2', category: 'skills',
      description: `Skill "${slug}" is from another department. Verify this agent uses it or remove.`,
      effort: 'trivial',
    });
  }

  // Ghost tool references
  for (const tool of ctx.ghostToolRefs) {
    recs.push({
      priority: 'P0', category: 'tools',
      description: `Skill references tool "${tool}" which does not exist. Agent will waste turns trying to call it.`,
      effort: 'trivial',
    });
  }

  // Skill token budget
  const totalSkillTokens = ctx.skillAssignments.reduce((s, sk) => s + sk.tokenCount, 0);
  if (totalSkillTokens > 4500) {
    recs.push({
      priority: 'P2', category: 'context',
      description: `Assigned skills total ~${totalSkillTokens} tokens. Exceeds recommended 3,000-token skill budget.`,
      effort: 'small',
    });
  }

  // Run health
  if (ctx.runs.last30Days.total > 0) {
    const completionRate = ctx.runs.last30Days.completed / ctx.runs.last30Days.total;
    if (completionRate < 0.6) {
      recs.push({
        priority: 'P0', category: 'health',
        description: `Completion rate is ${Math.round(completionRate * 100)}% (target: >80%). Agent is failing/aborting frequently.`,
        effort: 'medium',
      });
    } else if (completionRate < 0.8) {
      recs.push({
        priority: 'P1', category: 'health',
        description: `Completion rate is ${Math.round(completionRate * 100)}% (target: >80%).`,
        effort: 'small',
      });
    }

    if (ctx.runs.last30Days.maxTurnsReached > ctx.runs.last30Days.total * 0.15) {
      const rate = Math.round(ctx.runs.last30Days.maxTurnsReached / ctx.runs.last30Days.total * 100);
      recs.push({
        priority: 'P1', category: 'health',
        description: `${ctx.runs.last30Days.maxTurnsReached} runs hit max_turns (${rate}%). Increase turn budget or simplify task decomposition.`,
        effort: 'small',
      });
    }
  } else {
    recs.push({
      priority: 'P2', category: 'health',
      description: `Zero runs in 30 days. Agent may be broken, unscheduled, or orphaned.`,
      effort: 'medium',
    });
  }

  // Assignment quality
  if (ctx.assignments.last30Days.received > 0) {
    if (ctx.assignments.last30Days.avgQualityScore > 0 && ctx.assignments.last30Days.avgQualityScore < 50) {
      recs.push({
        priority: 'P0', category: 'quality',
        description: `Avg quality score is ${Math.round(ctx.assignments.last30Days.avgQualityScore)}/100. Consistently poor output.`,
        effort: 'large',
      });
    }

    const revisionRate = ctx.assignments.last30Days.needsRevision / ctx.assignments.last30Days.received;
    if (revisionRate > 0.3) {
      recs.push({
        priority: 'P1', category: 'quality',
        description: `${Math.round(revisionRate * 100)}% of assignments need revision.`,
        effort: 'medium',
      });
    }
  }

  // Missing crons
  for (const missing of ctx.missingCrons) {
    recs.push({
      priority: 'P1', category: 'schedule',
      description: `Task "${missing}" is defined in run.ts but has no cron trigger.`,
      effort: 'trivial',
    });
  }

  // Runner mismatch
  if (ctx.runnerMismatch) {
    recs.push({
      priority: ctx.teamMemberCount > 0 ? 'P1' : 'P2',
      category: 'runner',
      description: `Has orchestration tools but uses TaskRunner. ${ctx.teamMemberCount > 0 ? `Has ${ctx.teamMemberCount} team members (${ctx.teamMembersWithRunners} with runners) — promote to OrchestratorRunner.` : 'No active team — strip unused orchestration tools.'}`,
      effort: ctx.teamMemberCount > 0 ? 'large' : 'small',
    });
  }

  // Temperature outlier
  if (ctx.temperatureOutlier) {
    const temp = ctx.runAnalysis.temperature;
    if (PRECISION_ROLES.has(ctx.role)) {
      recs.push({
        priority: 'P2', category: 'config',
        description: `Temperature ${temp} is high for a precision role. Recommend 0.2-0.3.`,
        effort: 'trivial',
      });
    } else if (CREATIVE_ROLES.has(ctx.role)) {
      recs.push({
        priority: 'P3', category: 'config',
        description: `Temperature ${temp} is low for a creative role. Consider 0.5-0.7.`,
        effort: 'trivial',
      });
    }
  }

  // Unrouted task types
  for (const task of ctx.uncoveredTasks) {
    recs.push({
      priority: 'P2', category: 'routing',
      description: `Task type "${task}" has no matching pattern in task_skill_map.`,
      effort: 'trivial',
    });
  }

  // Excessive tool factories
  if (ctx.runAnalysis.factories.length > 15) {
    recs.push({
      priority: 'P2', category: 'tools',
      description: `Agent loads ${ctx.runAnalysis.factories.length} tool factories (~${ctx.runAnalysis.factories.length * 5}+ tools). Heavy reliance on ToolRetriever quality.`,
      effort: 'medium',
    });
  }

  return recs;
}

// ── CLI entry (only runs when executed directly) ───────────

const isDirectRun = process.argv[1]?.replace(/\\/g, '/').includes('audit-agent');

if (isDirectRun) {
  (async () => {
    const role = process.argv[2];
    if (!role) {
      console.error('Usage: npx tsx scripts/audit/audit-agent.ts <role>');
      process.exit(1);
    }

    const report = await auditAgent(role);

  const outputDir = path.join(ROOT, 'audit-reports');
  await mkdir(outputDir, { recursive: true });
  const outFile = path.join(outputDir, `${role}-audit.json`);
  await writeFile(outFile, JSON.stringify(report, null, 2));

  // Print summary
  const p0 = report.recommendations.filter(r => r.priority === 'P0');
  const p1 = report.recommendations.filter(r => r.priority === 'P1');
  console.log(`\n✅ Audit complete for ${role}`);
  console.log(`   Brief: ${report.brief.tokenCount} tokens (${report.brief.exists ? 'found' : 'MISSING'})`);
  console.log(`   System prompt: ${report.systemPrompt.tokenCount} tokens`);
  console.log(`   Skills: ${report.skills.assigned.length} (${report.skills.totalTokens} tokens)`);
  console.log(`   Tools: ${report.tools.factoryCount} factories`);
  console.log(`   Runs (30d): ${report.runs.last30Days.total} (${report.runs.last30Days.completed} completed)`);
  console.log(`   Assignments (30d): ${report.assignments.last30Days.received}`);
  console.log(`   Recommendations: ${p0.length} P0, ${p1.length} P1, ${report.recommendations.length} total`);
  if (p0.length > 0) {
    console.log(`\n🔴 P0 CRITICAL:`);
    for (const r of p0) console.log(`   [${r.category}] ${r.description}`);
  }
  console.log(`\n   Report saved to: ${outFile}`);
  })().catch(err => { console.error(err); process.exit(1); });
}
