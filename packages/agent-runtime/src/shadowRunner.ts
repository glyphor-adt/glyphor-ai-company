/**
 * Shadow Runner — A/B test a challenger prompt version against the live baseline.
 *
 * Fires both prompts in parallel against the same task input, scores both
 * outputs via LLM judge, and records results in the shadow_runs table.
 */

import { systemQuery } from '@glyphor/shared/db';
import { ModelClient } from './modelClient.js';
import { getActivePrompt, getPromptVersion, getCurrentVersionNumber } from './activePromptResolver.js';

// ─── Types ──────────────────────────────────────────────────────

interface ShadowRunResult {
  agentId: string;
  challengerVersion: number;
  baselineVersion: number;
  challengerScore: number;
  baselineScore: number;
}

// ─── Judge Prompt ───────────────────────────────────────────────

const SHADOW_JUDGE_SYSTEM = `You are an expert evaluator comparing two AI agent outputs for the SAME task.

Score each output on a 0.0–1.0 scale across these dimensions:
- correctness (weight: 0.40): Factual accuracy, no hallucinations
- instruction_following (weight: 0.25): Did the output follow the task requirements?
- completeness (weight: 0.20): Are all requested parts present?
- clarity (weight: 0.15): Is the output clear, well-structured, and actionable?

Return JSON only:
{
  "output_a_score": <0.0-1.0 weighted total>,
  "output_b_score": <0.0-1.0 weighted total>,
  "reasoning": "<brief comparison>"
}`;

// ─── Core ───────────────────────────────────────────────────────

export async function runShadow(
  agentId: string,
  taskInput: string,
  challengerVersion: number,
): Promise<ShadowRunResult | null> {
  const [baselinePrompt, challengerPrompt] = await Promise.all([
    getActivePrompt(agentId),
    getPromptVersion(agentId, challengerVersion),
  ]);

  if (!baselinePrompt) {
    console.warn(`[ShadowRunner] No active baseline prompt for ${agentId}`);
    return null;
  }

  const baselineVersion = await getCurrentVersionNumber(agentId);

  // Generate outputs in parallel using a lightweight LLM call (not full runner)
  const modelClient = new ModelClient({
    geminiApiKey: process.env.GOOGLE_AI_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
  });

  const [baselineResult, challengerResult] = await Promise.all([
    generateWithPrompt(modelClient, baselinePrompt, taskInput),
    generateWithPrompt(modelClient, challengerPrompt, taskInput),
  ]);

  // Score both via LLM judge
  const scores = await judgeOutputs(modelClient, taskInput, baselineResult, challengerResult);
  if (!scores) return null;

  // Persist
  await systemQuery(
    `INSERT INTO shadow_runs
     (agent_id, challenger_prompt_version, baseline_prompt_version,
      challenger_score, baseline_score, task_input, status, evaluated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'evaluated', NOW())`,
    [agentId, challengerVersion, baselineVersion,
     scores.challengerScore, scores.baselineScore, taskInput],
  );

  return {
    agentId,
    challengerVersion,
    baselineVersion,
    challengerScore: scores.challengerScore,
    baselineScore: scores.baselineScore,
  };
}

// ─── Helpers ────────────────────────────────────────────────────

async function generateWithPrompt(
  modelClient: ModelClient,
  systemPrompt: string,
  taskInput: string,
): Promise<string> {
  try {
    const response = await modelClient.generate({
      model: 'gemini-2.5-flash',
      systemInstruction: systemPrompt,
      contents: [{ role: 'user', content: taskInput, timestamp: Date.now() }],
      source: 'scheduled',
    });

    return response.text ?? '';
  } catch (err) {
    console.warn('[ShadowRunner] Generation failed:', (err as Error).message);
    return '[GENERATION FAILED]';
  }
}

async function judgeOutputs(
  modelClient: ModelClient,
  taskInput: string,
  baselineOutput: string,
  challengerOutput: string,
): Promise<{ baselineScore: number; challengerScore: number } | null> {
  try {
    const response = await modelClient.generate({
      model: 'gemini-2.5-flash',
      systemInstruction: SHADOW_JUDGE_SYSTEM,
      contents: [{
        role: 'user',
        content: [
          '## Task',
          taskInput,
          '',
          '## Output A (Baseline)',
          baselineOutput,
          '',
          '## Output B (Challenger)',
          challengerOutput,
        ].join('\n'),
        timestamp: Date.now(),
      }],
      source: 'scheduled',
    });

    const text = response.text ?? '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    const baselineScore = clamp(Number(parsed.output_a_score) || 0, 0, 1);
    const challengerScore = clamp(Number(parsed.output_b_score) || 0, 0, 1);

    return { baselineScore, challengerScore };
  } catch (err) {
    console.warn('[ShadowRunner] Judge failed:', (err as Error).message);
    return null;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Get pending shadow run task inputs for a given agent + version.
 * Used by the scheduler to feed runShadow() with real task inputs.
 */
export async function getPendingShadowTasks(
  agentId: string,
  limit = 5,
): Promise<string[]> {
  const rows = await systemQuery<{ task: string }>(
    `SELECT DISTINCT ar.task
     FROM agent_runs ar
     WHERE ar.agent_id = $1
       AND ar.status = 'completed'
       AND ar.task IS NOT NULL
     ORDER BY ar.task
     LIMIT $2`,
    [agentId, limit],
  );
  return rows.map(r => r.task);
}
