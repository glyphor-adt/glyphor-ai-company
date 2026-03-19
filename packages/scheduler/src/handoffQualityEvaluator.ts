/**
 * Handoff Quality Evaluator — Scores whether downstream agents effectively
 * used upstream agent output. Detects "silent context loss".
 */

import { systemQuery } from '@glyphor/shared/db';
import { ModelClient } from '@glyphor/agent-runtime';

const LOG_PREFIX = '[HandoffQualityEvaluator]';
const EVAL_MODEL = 'gpt-5-nano';

const HANDOFF_EVAL_PROMPT = `You are evaluating whether an AI agent effectively used the output provided by a preceding agent in a multi-agent workflow.

You will be given:
- What the upstream agent produced (summary of output)
- What the downstream agent was asked to do
- What the downstream agent actually did

Score 0.0-1.0:
1.0 — Downstream agent clearly built on upstream output. Referenced it. Extended it.
0.75 — Mostly used upstream output with minor gaps.
0.50 — Partially used upstream output. Some relevant context ignored.
0.25 — Upstream output largely ignored. Downstream agent started from scratch.
0.0 — No evidence upstream output was used. Complete context loss.

Also flag context_loss_detected: true if the downstream agent appears to have lacked information that the upstream agent produced.

Output JSON only:
{"score": 0.0-1.0, "reasoning": "one sentence", "context_loss_detected": true/false}`;

interface HandoffRow {
  id: string;
  upstream_run_id: string | null;
  downstream_run_id: string | null;
  downstream_assignment_id: string | null;
  downstream_input_usability: number | null;
}

export async function evaluateHandoff(handoffId: string): Promise<void> {
  const rows = await systemQuery<HandoffRow>(
    `SELECT id, upstream_run_id, downstream_run_id, downstream_assignment_id, downstream_input_usability
     FROM handoff_traces WHERE id = $1`,
    [handoffId],
  );
  const handoff = rows[0];
  if (!handoff || handoff.downstream_input_usability != null) return;

  const [upstreamOutput, downstreamTask, downstreamOutput] = await Promise.all([
    getRunOutputSummary(handoff.upstream_run_id),
    getAssignmentTask(handoff.downstream_assignment_id),
    getRunOutputSummary(handoff.downstream_run_id),
  ]);

  if (!upstreamOutput || !downstreamOutput) return;

  const modelClient = new ModelClient({
    openaiApiKey: process.env.OPENAI_API_KEY,
    geminiApiKey: process.env.GOOGLE_AI_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  });

  try {
    const response = await modelClient.generate({
      model: EVAL_MODEL,
      systemInstruction: HANDOFF_EVAL_PROMPT,
      contents: [{
        role: 'user',
        content: JSON.stringify({
          upstream_output: upstreamOutput.slice(0, 2000),
          downstream_task: downstreamTask?.slice(0, 1000) ?? 'Unknown task',
          downstream_output: downstreamOutput.slice(0, 2000),
        }),
        timestamp: Date.now(),
      }],
      temperature: 0.1,
      maxTokens: 300,
      fallbackScope: 'same-provider',
    });

    const text = response.text ?? '';
    const result = parseEvalJSON(text);
    if (!result) return;

    await systemQuery(`
      UPDATE handoff_traces
      SET downstream_input_usability = $2,
          context_loss_detected = $3
      WHERE id = $1
    `, [handoffId, result.score, result.context_loss_detected]);
  } catch (err) {
    console.warn(`${LOG_PREFIX} LLM eval failed for handoff ${handoffId}:`, (err as Error).message);
  }
}

export async function evaluateUnevaluatedHandoffs(limit = 50): Promise<number> {
  const rows = await systemQuery<{ id: string }>(
    `SELECT id FROM handoff_traces WHERE downstream_input_usability IS NULL LIMIT $1`,
    [limit],
  );

  if (rows.length === 0) return 0;

  const results = await Promise.allSettled(
    rows.map(h => evaluateHandoff(h.id)),
  );

  const succeeded = results.filter(r => r.status === 'fulfilled').length;
  console.log(`${LOG_PREFIX} Evaluated ${succeeded}/${rows.length} handoffs`);
  return succeeded;
}

// ── Helpers ────────────────────────────────────────────────────

async function getRunOutputSummary(runId: string | null): Promise<string | null> {
  if (!runId) return null;
  const rows = await systemQuery<{ output: string | null; result_summary: string | null }>(
    `SELECT output, result_summary FROM agent_runs WHERE id = $1`,
    [runId],
  );
  const row = rows[0];
  if (!row) return null;
  return row.result_summary ?? row.output ?? null;
}

async function getAssignmentTask(assignmentId: string | null): Promise<string | null> {
  if (!assignmentId) return null;
  const rows = await systemQuery<{ task_description: string | null }>(
    `SELECT task_description FROM work_assignments WHERE id = $1`,
    [assignmentId],
  );
  return rows[0]?.task_description ?? null;
}

function parseEvalJSON(text: string): { score: number; context_loss_detected: boolean } | null {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    const score = Number(parsed.score);
    if (isNaN(score) || score < 0 || score > 1) return null;
    return {
      score,
      context_loss_detected: parsed.context_loss_detected === true,
    };
  } catch {
    return null;
  }
}
