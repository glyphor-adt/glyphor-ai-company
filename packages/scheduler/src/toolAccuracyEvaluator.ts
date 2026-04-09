/**
 * Tool Accuracy Evaluator — Scores whether an agent selected appropriate tools for a task.
 *
 * Reads from tool_call_traces for the run, sends traces + task context to a judge LLM,
 * and writes a tool_accuracy evaluation to assignment_evaluations.
 *
 * Fire-and-forget — never blocks the batch eval pipeline.
 */

import { systemQuery } from '@glyphor/shared/db';
import { getTierModel } from '@glyphor/shared';
import { ModelClient } from '@glyphor/agent-runtime';

// ─── Types ──────────────────────────────────────────────────────

interface ToolTrace {
  tool_name: string;
  args: Record<string, unknown>;
  result_success: boolean;
  result_error: string | null;
  turn_number: number;
  retrieval_method: string | null;
  tools_available: number | null;
  model_cap: number | null;
}

interface ToolAccuracyJudgment {
  score: number;
  reasoning: string;
  repeated_failures: string[];
  missed_tools: string[];
  redundant_calls: string[];
}

// ─── Prompt ─────────────────────────────────────────────────────

const TOOL_ACCURACY_SYSTEM_PROMPT = `You are evaluating whether an AI agent selected appropriate tools to complete a task.

You will be given:
- The task description
- The agent's role
- The number of tools available to the agent
- The sequence of tools the agent actually called, in order, with success/failure status
- How each tool was selected (pinned or semantic retrieval)

Score the tool usage on a 0.0-1.0 scale using these criteria:

1.0 — Every tool called was necessary and appropriate. No redundant calls. Correct sequence.
0.75 — Mostly appropriate tools. Minor inefficiency (one redundant call or slightly suboptimal sequence).
0.50 — Some appropriate tools but notable gaps or substitutions. Task completed despite suboptimal selection.
0.25 — Significant tool selection problems. Wrong tools attempted, important tools missed, excessive failed calls.
0.0 — Tool selection was counterproductive or completely mismatched to the task.

Also flag:
- repeated_failures: tools that failed and were retried more than twice
- missed_tools: obvious tools that should have been called but weren't (based on task description)
- redundant_calls: same tool called multiple times with identical or near-identical args

Output JSON only:
{
  "score": 0.0-1.0,
  "reasoning": "one sentence explanation",
  "repeated_failures": ["tool_name"],
  "missed_tools": ["tool_name"],
  "redundant_calls": ["tool_name"]
}`;

// ─── Judge Model ────────────────────────────────────────────────

const JUDGE_MODEL = getTierModel('fast');
const LOG_PREFIX = '[ToolAccuracyEvaluator]';

// ─── Main Entry ─────────────────────────────────────────────────

export async function evaluateToolAccuracy(
  runId: string,
  assignmentId: string,
  agentId: string,
  taskDescription: string,
  agentRole: string,
): Promise<void> {
  // Pull traces for this run
  const traces = await systemQuery<ToolTrace>(
    `SELECT tool_name, args, result_success, result_error, turn_number,
            retrieval_method, tools_available, model_cap
     FROM tool_call_traces
     WHERE run_id = $1
     ORDER BY turn_number ASC, called_at ASC`,
    [runId],
  );

  if (traces.length === 0) return; // no tool calls — skip

  const toolsAvailable = traces[0].tools_available;
  const modelCap = traces[0].model_cap;

  // Build tool sequence summary
  const toolSequence = traces.map(t => ({
    name: t.tool_name,
    success: t.result_success,
    error: t.result_error ?? undefined,
    turn: t.turn_number,
    how_selected: t.retrieval_method,
  }));

  const judgeClient = new ModelClient({    geminiApiKey: process.env.GOOGLE_AI_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  });

  const response = await judgeClient.generate({
    model: JUDGE_MODEL,
    systemInstruction: TOOL_ACCURACY_SYSTEM_PROMPT,
    contents: [{
      role: 'user',
      content: JSON.stringify({
        task: taskDescription,
        agent_role: agentRole,
        tools_in_context: toolsAvailable,
        model_cap: modelCap,
        tool_sequence: toolSequence,
      }),
      timestamp: Date.now(),
    }],
    temperature: 0.1,
    maxTokens: 500,
    fallbackScope: 'same-provider',
  });

  const evaluation = parseJudgment(response.text ?? '');
  if (!evaluation || typeof evaluation.score !== 'number') {
    console.warn(`${LOG_PREFIX} Failed to parse judgment for run ${runId}`);
    return;
  }

  // Write to assignment_evaluations
  await systemQuery(
    `INSERT INTO assignment_evaluations
     (assignment_id, run_id, evaluator_type, evaluator_agent_id, score_raw, score_normalized, feedback)
     VALUES ($1, $2, 'tool_accuracy', 'tool-accuracy-evaluator', $3, $3, $4)`,
    [
      assignmentId,
      runId,
      evaluation.score,
      JSON.stringify({
        reasoning: evaluation.reasoning,
        repeated_failures: evaluation.repeated_failures,
        missed_tools: evaluation.missed_tools,
        redundant_calls: evaluation.redundant_calls,
      }),
    ],
  );

  console.log(
    `${LOG_PREFIX} Scored run ${runId} for ${agentRole}: ${evaluation.score.toFixed(2)}`,
  );
}

// ─── Parser ─────────────────────────────────────────────────────

function parseJudgment(text: string): ToolAccuracyJudgment | null {
  try {
    const cleaned = text.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned) as Partial<ToolAccuracyJudgment>;
    if (typeof parsed.score !== 'number' || parsed.score < 0 || parsed.score > 1) return null;
    return {
      score: parsed.score,
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
      repeated_failures: Array.isArray(parsed.repeated_failures)
        ? parsed.repeated_failures.filter((s): s is string => typeof s === 'string')
        : [],
      missed_tools: Array.isArray(parsed.missed_tools)
        ? parsed.missed_tools.filter((s): s is string => typeof s === 'string')
        : [],
      redundant_calls: Array.isArray(parsed.redundant_calls)
        ? parsed.redundant_calls.filter((s): s is string => typeof s === 'string')
        : [],
    };
  } catch {
    return null;
  }
}
