/**
 * Agent Dream Consolidator — Per-Agent Cross-Session Pattern Extraction
 *
 * Inspired by Claude Code's DreamTask, which runs in the background to
 * review old sessions and consolidate learnings into persistent memory.
 *
 * While the existing `memoryConsolidator.ts` promotes raw company memories
 * into distilled organizational knowledge, this module focuses on
 * **individual agent improvement**: extracting cross-session patterns,
 * recurring failures, skill mastery trends, and performance insights
 * from each agent's recent runs.
 *
 * Runs as a scheduled task (e.g., nightly at 3 AM) for each agent with
 * sufficient recent run data. Outputs update the agent's world model
 * and procedural memory.
 *
 * Schedule: Called from server.ts cron handler for 'agent_dream_consolidation'
 */

import { systemQuery } from '@glyphor/shared/db';
import { getTierModel } from '@glyphor/shared';
import { ModelClient, getRedisCache } from '@glyphor/agent-runtime';
import type { CompanyAgentRole } from '@glyphor/agent-runtime';
import { recordRunEvent } from '@glyphor/agent-runtime';

// ─── Types ──────────────────────────────────────────────────────

export interface AgentDreamReport {
  agentRole: CompanyAgentRole;
  runsAnalyzed: number;
  skillsExtracted: number;
  weaknessesIdentified: number;
  recurringFailures: number;
  worldModelUpdated: boolean;
  proceduralMemoryUpdated: boolean;
  flaggedForReview: boolean;
  durationMs: number;
}

export interface FleetDreamReport {
  agentsProcessed: number;
  agentsSkipped: number;
  totalRunsAnalyzed: number;
  reports: AgentDreamReport[];
  errors: string[];
  totalDurationMs: number;
}

interface RecentRunSummary {
  run_id: string;
  agent_role: string;
  status: string;
  output_summary: string | null;
  total_turns: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  elapsed_ms: number;
  created_at: string;
}

interface ToolUsagePattern {
  tool_name: string;
  call_count: number;
  success_count: number;
  failure_count: number;
  avg_cost_usd: number;
}

interface RunOutcomePattern {
  status: string;
  count: number;
  avg_turns: number;
  avg_cost_usd: number;
}

// ─── Configuration ──────────────────────────────────────────────

const LOCK_KEY_PREFIX = 'agent-dream-lock:';
const LOCK_TTL_SECONDS = 20 * 60; // 20 minutes
const MIN_RUNS_FOR_DREAM = 5;
const MAX_RUNS_TO_ANALYZE = 30;
const DREAM_MODEL = getTierModel('default');

// ─── Main Entry Point ───────────────────────────────────────────

/**
 * Run dream consolidation for all agents with sufficient recent run data.
 * Called from the scheduler's cron handler.
 */
export async function runFleetDreamConsolidation(): Promise<FleetDreamReport> {
  const startMs = Date.now();
  const report: FleetDreamReport = {
    agentsProcessed: 0,
    agentsSkipped: 0,
    totalRunsAnalyzed: 0,
    reports: [],
    errors: [],
    totalDurationMs: 0,
  };

  // Find agents with enough recent runs since last consolidation
  const eligibleAgents = await findEligibleAgents();

  for (const agentRole of eligibleAgents) {
    try {
      const agentReport = await runAgentDream(agentRole);
      report.reports.push(agentReport);
      report.agentsProcessed++;
      report.totalRunsAnalyzed += agentReport.runsAnalyzed;
    } catch (err) {
      const msg = `[AgentDream] ${agentRole} failed: ${(err as Error).message}`;
      console.error(msg);
      report.errors.push(msg);
      report.agentsSkipped++;
    }
  }

  report.totalDurationMs = Date.now() - startMs;
  console.log('[AgentDream] Fleet consolidation complete:', JSON.stringify({
    processed: report.agentsProcessed,
    skipped: report.agentsSkipped,
    runs: report.totalRunsAnalyzed,
    duration: report.totalDurationMs,
  }));

  return report;
}

/**
 * Run dream consolidation for a single agent.
 */
export async function runAgentDream(agentRole: CompanyAgentRole): Promise<AgentDreamReport> {
  const startMs = Date.now();
  const cache = getRedisCache();
  const lockKey = `${LOCK_KEY_PREFIX}${agentRole}`;

  // Acquire per-agent lock
  const existingLock = await cache.get<string>(lockKey);
  if (existingLock) {
    throw new Error(`Dream already in progress for ${agentRole}`);
  }
  await cache.set(lockKey, new Date().toISOString(), LOCK_TTL_SECONDS);

  try {
    // 1. Gather recent run data
    const runs = await getRecentRuns(agentRole);
    const toolUsage = await getToolUsagePatterns(agentRole);
    const outcomes = await getRunOutcomePatterns(agentRole);

    if (runs.length < MIN_RUNS_FOR_DREAM) {
      return {
        agentRole,
        runsAnalyzed: 0,
        skillsExtracted: 0,
        weaknessesIdentified: 0,
        recurringFailures: 0,
        worldModelUpdated: false,
        proceduralMemoryUpdated: false,
        flaggedForReview: false,
        durationMs: Date.now() - startMs,
      };
    }

    // 2. Use LLM to extract cross-session patterns
    const patterns = await extractPatterns(agentRole, runs, toolUsage, outcomes);

    // 3. Update world model with performance trends
    let worldModelUpdated = false;
    if (patterns.strengths.length > 0 || patterns.weaknesses.length > 0) {
      await updateAgentWorldModel(agentRole, patterns);
      worldModelUpdated = true;
    }

    // 4. Update procedural memory with skill learnings
    let proceduralUpdated = false;
    if (patterns.skills.length > 0) {
      await updateProceduralMemory(agentRole, patterns.skills);
      proceduralUpdated = true;
    }

    // 5. Flag recurring failures for human review
    const flagged = patterns.recurringFailures.length > 0;
    if (flagged) {
      await flagForFounderReview(agentRole, patterns.recurringFailures);
    }

    // 6. Mark consolidation timestamp
    await markDreamComplete(agentRole, runs.length);

    void recordRunEvent({
      runId: `dream-${agentRole}-${Date.now()}`,
      eventType: 'dream.consolidation_completed',
      trigger: 'agent_dream_consolidator',
      component: 'agentDreamConsolidator',
      payload: {
        agent_role: agentRole,
        runs_analyzed: runs.length,
        skills: patterns.skills.length,
        weaknesses: patterns.weaknesses.length,
        recurring_failures: patterns.recurringFailures.length,
      },
    });

    return {
      agentRole,
      runsAnalyzed: runs.length,
      skillsExtracted: patterns.skills.length,
      weaknessesIdentified: patterns.weaknesses.length,
      recurringFailures: patterns.recurringFailures.length,
      worldModelUpdated,
      proceduralMemoryUpdated: proceduralUpdated,
      flaggedForReview: flagged,
      durationMs: Date.now() - startMs,
    };
  } finally {
    await cache.del(lockKey);
  }
}

// ─── Data Gathering ─────────────────────────────────────────────

async function findEligibleAgents(): Promise<CompanyAgentRole[]> {
  const rows = await systemQuery<{ agent_role: string; run_count: number }>(
    `SELECT r.agent_role, COUNT(*) as run_count
     FROM agent_runs r
     LEFT JOIN agent_dream_log d
       ON d.agent_role = r.agent_role
     WHERE r.status = 'completed'
       AND r.created_at > COALESCE(d.last_dream_at, '2000-01-01'::timestamptz)
     GROUP BY r.agent_role
     HAVING COUNT(*) >= $1
     ORDER BY COUNT(*) DESC`,
    [MIN_RUNS_FOR_DREAM],
  );

  return rows.map(r => r.agent_role as CompanyAgentRole);
}

async function getRecentRuns(agentRole: CompanyAgentRole): Promise<RecentRunSummary[]> {
  return systemQuery<RecentRunSummary>(
    `SELECT id as run_id, agent_role, status,
            LEFT(result_summary, 500) as output_summary,
            total_turns, input_tokens, output_tokens,
            estimated_cost_usd, elapsed_ms, created_at
     FROM agent_runs
     WHERE agent_role = $1 AND status IN ('completed', 'aborted', 'error')
     ORDER BY created_at DESC
     LIMIT $2`,
    [agentRole, MAX_RUNS_TO_ANALYZE],
  );
}

async function getToolUsagePatterns(agentRole: CompanyAgentRole): Promise<ToolUsagePattern[]> {
  return systemQuery<ToolUsagePattern>(
    `SELECT tool_name,
            COUNT(*) as call_count,
            SUM(CASE WHEN result_success THEN 1 ELSE 0 END) as success_count,
            SUM(CASE WHEN NOT result_success THEN 1 ELSE 0 END) as failure_count,
            AVG(COALESCE(estimated_cost_usd, 0)) as avg_cost_usd
     FROM tool_call_traces
     WHERE agent_role = $1
       AND created_at > (
         SELECT COALESCE(last_dream_at, '2000-01-01'::timestamptz)
         FROM agent_dream_log WHERE agent_role = $1
         UNION ALL SELECT '2000-01-01'::timestamptz LIMIT 1
       )
     GROUP BY tool_name
     ORDER BY call_count DESC
     LIMIT 50`,
    [agentRole],
  );
}

async function getRunOutcomePatterns(agentRole: CompanyAgentRole): Promise<RunOutcomePattern[]> {
  return systemQuery<RunOutcomePattern>(
    `SELECT status, COUNT(*) as count,
            AVG(total_turns) as avg_turns,
            AVG(estimated_cost_usd) as avg_cost_usd
     FROM agent_runs
     WHERE agent_role = $1
       AND created_at > NOW() - INTERVAL '7 days'
     GROUP BY status`,
    [agentRole],
  );
}

// ─── Pattern Extraction (LLM) ───────────────────────────────────

interface ExtractedPatterns {
  skills: string[];
  strengths: string[];
  weaknesses: string[];
  recurringFailures: Array<{
    pattern: string;
    frequency: number;
    suggestedFix: string;
  }>;
  performanceTrend: 'improving' | 'stable' | 'declining';
}

async function extractPatterns(
  agentRole: CompanyAgentRole,
  runs: RecentRunSummary[],
  toolUsage: ToolUsagePattern[],
  outcomes: RunOutcomePattern[],
): Promise<ExtractedPatterns> {
  const client = new ModelClient({
    geminiApiKey: process.env.GOOGLE_AI_API_KEY,
  });

  const runSummaries = runs.map(r => ({
    status: r.status,
    turns: r.total_turns,
    cost: r.estimated_cost_usd,
    elapsed: r.elapsed_ms,
    summary: r.output_summary,
    date: r.created_at,
  }));

  const highFailTools = toolUsage
    .filter(t => t.failure_count > 0 && t.failure_count / t.call_count > 0.3)
    .map(t => `${t.tool_name}: ${t.failure_count}/${t.call_count} failures`);

  const prompt = `You are analyzing the recent performance of agent "${agentRole}" to extract cross-session patterns for self-improvement.

## Recent Runs (${runs.length} runs)
${JSON.stringify(runSummaries, null, 2)}

## Tool Usage Patterns
${toolUsage.map(t => `- ${t.tool_name}: ${t.call_count} calls, ${t.success_count} success, ${t.failure_count} failures`).join('\n')}

## Outcome Distribution
${outcomes.map(o => `- ${o.status}: ${o.count} runs, avg ${o.avg_turns} turns, avg $${Number(o.avg_cost_usd).toFixed(4)}`).join('\n')}

## High-Failure Tools
${highFailTools.length > 0 ? highFailTools.join('\n') : 'None'}

Analyze these patterns and respond with STRICT JSON:
{
  "skills": ["skills this agent has demonstrated mastery of"],
  "strengths": ["areas where performance is consistently strong"],
  "weaknesses": ["areas needing improvement"],
  "recurringFailures": [{"pattern": "description", "frequency": number, "suggestedFix": "actionable fix"}],
  "performanceTrend": "improving" | "stable" | "declining"
}

Rules:
- Only include patterns supported by the data above.
- Skills must be evidenced by successful tool usage or completed runs.
- Weaknesses must be evidenced by failures, aborts, or high-cost runs.
- Recurring failures must appear in 3+ runs to qualify.
- Output JSON only.`;

  try {
    const response = await client.generate({
      model: DREAM_MODEL,
      systemInstruction: 'You are an agent performance analyst. Extract cross-session patterns from run data. Respond with JSON only.',
      contents: [{
        role: 'user',
        content: prompt,
        timestamp: Date.now(),
      }],
      temperature: 0.1,
      maxTokens: 2000,
    });

    const text = response.text?.trim() ?? '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn(`[AgentDream] ${agentRole}: No JSON in LLM response`);
      return { skills: [], strengths: [], weaknesses: [], recurringFailures: [], performanceTrend: 'stable' };
    }

    const parsed = JSON.parse(jsonMatch[0]) as ExtractedPatterns;
    return {
      skills: Array.isArray(parsed.skills) ? parsed.skills : [],
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
      weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses : [],
      recurringFailures: Array.isArray(parsed.recurringFailures) ? parsed.recurringFailures : [],
      performanceTrend: ['improving', 'stable', 'declining'].includes(parsed.performanceTrend)
        ? parsed.performanceTrend
        : 'stable',
    };
  } catch (err) {
    console.warn(`[AgentDream] ${agentRole}: Pattern extraction failed:`, (err as Error).message);
    return { skills: [], strengths: [], weaknesses: [], recurringFailures: [], performanceTrend: 'stable' };
  }
}

// ─── Persistence ────────────────────────────────────────────────

async function updateAgentWorldModel(
  agentRole: CompanyAgentRole,
  patterns: ExtractedPatterns,
): Promise<void> {
  // Map strengths/weaknesses to the existing agent_world_model schema:
  // strengths: [{dimension, evidence, confidence}]
  // weaknesses: [{dimension, evidence, confidence}]
  // failure_patterns: [{pattern, occurrences, lastSeen}]
  const strengthEntries = patterns.strengths.map(s => ({
    dimension: s,
    evidence: 'dream_consolidation',
    confidence: 0.7,
  }));
  const weaknessEntries = patterns.weaknesses.map(w => ({
    dimension: w,
    evidence: 'dream_consolidation',
    confidence: 0.6,
  }));
  const failureEntries = patterns.recurringFailures.map(f => ({
    pattern: f.pattern,
    occurrences: f.frequency,
    lastSeen: new Date().toISOString(),
  }));

  await systemQuery(
    `UPDATE agent_world_model
     SET strengths = COALESCE(strengths, '[]'::jsonb) || $2::jsonb,
         weaknesses = $3::jsonb,
         failure_patterns = $4::jsonb,
         updated_at = NOW()
     WHERE agent_role = $1`,
    [
      agentRole,
      JSON.stringify(strengthEntries),
      JSON.stringify(weaknessEntries),
      JSON.stringify(failureEntries),
    ],
  );
}

async function updateProceduralMemory(
  agentRole: CompanyAgentRole,
  skills: string[],
): Promise<void> {
  // Use existing shared_procedures table to store discovered skills.
  // Each skill becomes a procedure with the agent as discoverer.
  for (const skill of skills) {
    const slug = `dream-${agentRole}-${skill.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}`;
    await systemQuery(
      `INSERT INTO shared_procedures (slug, name, domain, description, steps, discovered_by, status)
       VALUES ($1, $2, $3, $4, '[]'::jsonb, $5, 'proposed')
       ON CONFLICT (slug) DO UPDATE SET
         times_used = shared_procedures.times_used + 1,
         updated_at = NOW()`,
      [
        slug,
        skill.slice(0, 200),
        getDepartmentForRole(agentRole),
        `Skill learned by ${agentRole} via dream consolidation: ${skill}`,
        agentRole,
      ],
    );
  }
}

function getDepartmentForRole(role: CompanyAgentRole): string {
  const map: Record<string, string> = {
    'chief-of-staff': 'operations', 'cto': 'engineering', 'cpo': 'product',
    'cmo': 'marketing', 'cfo': 'finance', 'clo': 'legal', 'ops': 'operations',
    'vp-sales': 'sales', 'vp-design': 'design', 'vp-research': 'research',
    'platform-engineer': 'engineering', 'quality-engineer': 'engineering',
    'devops-engineer': 'engineering', 'frontend-engineer': 'design',
    'content-creator': 'marketing', 'seo-analyst': 'marketing',
    'competitive-research-analyst': 'research', 'market-research-analyst': 'research',
  };
  return map[role] ?? 'general';
}

async function flagForFounderReview(
  agentRole: CompanyAgentRole,
  recurringFailures: ExtractedPatterns['recurringFailures'],
): Promise<void> {
  for (const failure of recurringFailures) {
    await systemQuery(
      `INSERT INTO founder_review_flags (agent_role, category, description, suggested_fix, created_at)
       VALUES ($1, 'recurring_failure', $2, $3, NOW())`,
      [agentRole, failure.pattern, failure.suggestedFix],
    );
  }
}

async function markDreamComplete(agentRole: CompanyAgentRole, runsAnalyzed: number): Promise<void> {
  await systemQuery(
    `INSERT INTO agent_dream_log (agent_role, last_dream_at, runs_analyzed)
     VALUES ($1, NOW(), $2)
     ON CONFLICT (agent_role) DO UPDATE SET
       last_dream_at = NOW(),
       runs_analyzed = agent_dream_log.runs_analyzed + $2`,
    [agentRole, runsAnalyzed],
  );
}
