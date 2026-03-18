/**
 * Reflection Agent — Analyzes low-scoring runs and proposes surgical prompt mutations.
 *
 * This is the self-improvement engine. When a run scores below threshold,
 * the reflection agent examines the prompt, task, output, and evaluator
 * feedback to identify ONE targeted change that would improve performance.
 *
 * Output is a structured ReflectionResult — consumed by promptMutator.ts
 * to stage a new prompt version for shadow testing.
 */

import { systemQuery } from '@glyphor/shared/db';
import { ModelClient } from './modelClient.js';
import { getActivePrompt } from './activePromptResolver.js';

// ─── Types ──────────────────────────────────────────────────────

export interface ReflectionResult {
  failure_mode: string;
  proposed_change: string;
  change_type: 'add_instruction' | 'clarify_constraint' | 'add_example' | 'remove_ambiguity';
  expected_impact: string;
  confidence: number;
}

interface RunDetails {
  id: string;
  agent_id: string;
  task: string;
  status: string;
  result_summary: string | null;
  duration_ms: number | null;
  error: string | null;
}

interface EvaluationRow {
  evaluator_type: string;
  score_normalized: number | null;
  feedback: string | null;
}

interface ReflectionRow {
  summary: string;
  quality_score: number;
  what_went_well: string[];
  what_could_improve: string[];
  prompt_suggestions: string[];
}

// ─── System Prompt ──────────────────────────────────────────────

const REFLECTION_SYSTEM_PROMPT = `You are a prompt engineering expert analyzing why an AI agent underperformed on a task.

You will be given:
- The agent's current system prompt
- The task that was assigned
- The agent's output (or error)
- Evaluator feedback and scores
- The agent's own reflection (if available)

Your job is to identify ONE specific, surgical change to the system prompt that would most likely have improved the output.

Rules:
- Propose exactly one change. Not a rewrite. One targeted addition, removal, or clarification.
- State WHY this specific change addresses the failure mode you observed.
- Be specific — quote the section of the prompt you'd modify if applicable.
- If the failure was due to external factors (API down, timeout, etc.) and NOT a prompt issue, set confidence to 0.0.
- Output format: JSON only.
{
  "failure_mode": "brief description of what went wrong",
  "proposed_change": "exact text to add/modify/remove",
  "change_type": "add_instruction | clarify_constraint | add_example | remove_ambiguity",
  "expected_impact": "what this change should fix",
  "confidence": 0.0-1.0
}`;

// ─── Rate Limiting ──────────────────────────────────────────────

const RATE_LIMIT_HOURS = 24;

async function isRateLimited(agentId: string): Promise<boolean> {
  const rows = await systemQuery<{ count: string }>(
    `SELECT COUNT(*) AS count FROM agent_prompt_versions
     WHERE agent_id = $1 AND source = 'reflection'
       AND created_at > NOW() - INTERVAL '${RATE_LIMIT_HOURS} hours'`,
    [agentId],
  );
  return Number(rows[0]?.count ?? 0) > 0;
}

// ─── Core ───────────────────────────────────────────────────────

export async function reflect(
  agentId: string,
  runId: string,
): Promise<ReflectionResult | null> {
  // Rate limit: max 1 reflection per agent per 24h
  if (await isRateLimited(agentId)) {
    console.log(`[ReflectionAgent] Rate limited: ${agentId} already has a reflection-sourced version in the last ${RATE_LIMIT_HOURS}h`);
    return null;
  }

  const [prompt, run, evaluations, reflections] = await Promise.all([
    getActivePrompt(agentId),
    getRunDetails(runId),
    getRunEvaluations(runId),
    getRunReflection(agentId, runId),
  ]);

  if (!prompt || !run) {
    console.warn(`[ReflectionAgent] Missing data for ${agentId} run ${runId}`);
    return null;
  }

  const context = buildReflectionContext(prompt, run, evaluations, reflections);

  const modelClient = new ModelClient({
    geminiApiKey: process.env.GOOGLE_AI_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  });

  try {
    const response = await modelClient.generate({
      model: 'claude-sonnet-4-20250514',
      systemInstruction: REFLECTION_SYSTEM_PROMPT,
      contents: [{ role: 'user', content: context, timestamp: Date.now() }],
      source: 'scheduled',
    });

    const text = response.text ?? '';
    const result = parseReflectionJSON(text);

    if (!result) {
      console.warn(`[ReflectionAgent] Failed to parse reflection output for ${agentId}`);
      return null;
    }

    if (result.confidence < 0.6) {
      console.log(`[ReflectionAgent] Low confidence (${result.confidence}) for ${agentId} — discarding`);
      return null;
    }

    return result;
  } catch (err) {
    console.warn(`[ReflectionAgent] LLM call failed for ${agentId}:`, (err as Error).message);
    return null;
  }
}

// ─── Data Loaders ───────────────────────────────────────────────

async function getRunDetails(runId: string): Promise<RunDetails | null> {
  const rows = await systemQuery<RunDetails>(
    `SELECT id, agent_id, task, status, result_summary, duration_ms, error
     FROM agent_runs WHERE id = $1`,
    [runId],
  );
  return rows[0] ?? null;
}

async function getRunEvaluations(runId: string): Promise<EvaluationRow[]> {
  // Join through task_run_outcomes → assignment_evaluations
  return systemQuery<EvaluationRow>(
    `SELECT ae.evaluator_type, ae.score_normalized, ae.feedback
     FROM task_run_outcomes tro
     JOIN assignment_evaluations ae ON ae.assignment_id = tro.assignment_id
     WHERE tro.run_id = $1`,
    [runId],
  );
}

async function getRunReflection(agentId: string, runId: string): Promise<ReflectionRow | null> {
  const rows = await systemQuery<ReflectionRow>(
    `SELECT summary, quality_score, what_went_well, what_could_improve, prompt_suggestions
     FROM agent_reflections WHERE agent_role = $1 AND run_id = $2
     ORDER BY created_at DESC LIMIT 1`,
    [agentId, runId],
  );
  return rows[0] ?? null;
}

// ─── Context Builder ────────────────────────────────────────────

function buildReflectionContext(
  prompt: string,
  run: RunDetails,
  evaluations: EvaluationRow[],
  reflection: ReflectionRow | null,
): string {
  const parts: string[] = [];

  parts.push('## Current System Prompt');
  parts.push(prompt.slice(0, 4000)); // Truncate to avoid token overflow

  parts.push('\n## Task');
  parts.push(run.task ?? 'Unknown task');

  parts.push('\n## Agent Output');
  if (run.error) {
    parts.push(`ERROR: ${run.error}`);
  } else if (run.result_summary) {
    parts.push(run.result_summary.slice(0, 2000));
  } else {
    parts.push('No output recorded');
  }

  if (evaluations.length > 0) {
    parts.push('\n## Evaluator Feedback');
    for (const e of evaluations) {
      parts.push(`- ${e.evaluator_type}: score=${e.score_normalized?.toFixed(2) ?? 'N/A'} — ${e.feedback ?? 'no feedback'}`);
    }
  }

  if (reflection) {
    parts.push('\n## Agent Self-Reflection');
    parts.push(`Summary: ${reflection.summary}`);
    parts.push(`Quality score (self): ${reflection.quality_score}`);
    if (reflection.what_could_improve.length > 0) {
      parts.push(`Areas for improvement: ${reflection.what_could_improve.join(', ')}`);
    }
    if (reflection.prompt_suggestions.length > 0) {
      parts.push(`Agent's own prompt suggestions: ${reflection.prompt_suggestions.join('; ')}`);
    }
  }

  return parts.join('\n');
}

// ─── JSON Parser ────────────────────────────────────────────────

function parseReflectionJSON(text: string): ReflectionResult | null {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);

    const validTypes = ['add_instruction', 'clarify_constraint', 'add_example', 'remove_ambiguity'];
    if (!validTypes.includes(parsed.change_type)) return null;

    return {
      failure_mode: String(parsed.failure_mode ?? ''),
      proposed_change: String(parsed.proposed_change ?? ''),
      change_type: parsed.change_type,
      expected_impact: String(parsed.expected_impact ?? ''),
      confidence: clamp(Number(parsed.confidence) || 0, 0, 1),
    };
  } catch {
    return null;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
