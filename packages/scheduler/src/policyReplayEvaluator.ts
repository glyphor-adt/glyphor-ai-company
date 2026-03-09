/**
 * Policy Replay Evaluator — Offline evaluation of draft policy proposals
 *
 * Runs daily at 5 AM UTC to evaluate draft policy_versions using type-specific
 * evaluation methods. Promotes passing drafts to 'candidate' status and rejects
 * stale or low-scoring ones.
 *
 * Evaluation Methods by Policy Type:
 *  1. prompt     — Verifier model compares old vs new prompt approach using recent runs
 *  2. constitution — Auto-promote if approved via episodic replay process
 *  3. routing    — Pure statistics: compare historical task quality across agents
 *  4. model_selection — Auto-promote if statistical evidence is strong
 *  5. rubric     — Verifier model judges rubric against historical task outputs
 */

import { systemQuery } from '@glyphor/shared/db';
import { getRedisCache, ModelClient } from '@glyphor/agent-runtime';

// ─── Types ──────────────────────────────────────────────────────

export interface EvalReport {
  evaluated: number;
  promoted_to_candidate: number;
  rejected: number;
  skipped: number;
}

interface DraftPolicy {
  id: string;
  policy_type: string;
  agent_role: string | null;
  content: Record<string, unknown>;
  source: string;
  created_at: string;
}

interface EvalOutcome {
  score: number;
  status: 'candidate' | 'draft' | 'rejected';
  details: {
    method: string;
    sample_size: number;
    comparison: string;
    notes: string;
  };
}

// ─── Configuration ──────────────────────────────────────────────

const LOCK_KEY = 'policy-replay-eval-lock';
const LOCK_TTL_SECONDS = 30 * 60; // 30 minutes
const LOG_PREFIX = '[PolicyReplayEvaluator]';

const DRAFT_BATCH_LIMIT = 10;
const PASS_THRESHOLD = 0.6;
const REJECT_THRESHOLD = 0.3;
const DRAFT_MAX_AGE_DAYS = 14;
const LLM_BUDGET_PER_CYCLE = 5;
const VERIFIER_MODEL = 'gpt-5-mini-2025-08-07';

// Model selection auto-promote thresholds
const MODEL_SEL_MIN_RUNS = 20;
const MODEL_SEL_MIN_DELTA = 0.5;

// ─── Main Entry Point ───────────────────────────────────────────

export async function evaluateDraftPolicies(): Promise<EvalReport> {
  const report: EvalReport = {
    evaluated: 0,
    promoted_to_candidate: 0,
    rejected: 0,
    skipped: 0,
  };

  // Acquire Redis lock to prevent concurrent runs
  const cache = getRedisCache();
  const existingLock = await cache.get<string>(LOCK_KEY);
  if (existingLock) {
    console.log(`${LOG_PREFIX} Skipping — another evaluation is in progress`);
    return report;
  }
  await cache.set(LOCK_KEY, new Date().toISOString(), LOCK_TTL_SECONDS);

  try {
    const drafts = await systemQuery<DraftPolicy>(
      `SELECT id, policy_type, agent_role, content, source, created_at
       FROM policy_versions
       WHERE status = 'draft'
       ORDER BY created_at
       LIMIT $1`,
      [DRAFT_BATCH_LIMIT],
    );

    if (drafts.length === 0) {
      console.log(`${LOG_PREFIX} No draft policies to evaluate`);
      return report;
    }

    let llmCallsUsed = 0;

    for (const draft of drafts) {
      try {
        // Check if draft is too old — reject immediately
        const ageMs = Date.now() - new Date(draft.created_at).getTime();
        const ageDays = ageMs / (1000 * 60 * 60 * 24);
        if (ageDays > DRAFT_MAX_AGE_DAYS) {
          await updatePolicyEval(draft.id, {
            score: 0,
            status: 'rejected',
            details: {
              method: 'age_check',
              sample_size: 0,
              comparison: 'n/a',
              notes: `Draft expired after ${Math.round(ageDays)} days (limit: ${DRAFT_MAX_AGE_DAYS})`,
            },
          });
          report.evaluated++;
          report.rejected++;
          continue;
        }

        // Check LLM budget for types that need it
        const needsLlm = draft.policy_type === 'prompt' || draft.policy_type === 'rubric';
        if (needsLlm && llmCallsUsed >= LLM_BUDGET_PER_CYCLE) {
          report.skipped++;
          continue;
        }

        const outcome = await evaluateByType(draft, llmCallsUsed);
        if (outcome === null) {
          report.skipped++;
          continue;
        }

        if (outcome.details.method === 'verifier_model') {
          llmCallsUsed++;
        }

        await updatePolicyEval(draft.id, outcome);
        report.evaluated++;

        if (outcome.status === 'candidate') {
          report.promoted_to_candidate++;
        } else if (outcome.status === 'rejected') {
          report.rejected++;
        }
      } catch (err) {
        console.warn(`${LOG_PREFIX} Evaluation failed for ${draft.id}:`, (err as Error).message);
        report.skipped++;
      }
    }

    console.log(`${LOG_PREFIX} Complete:`, JSON.stringify(report));
  } finally {
    await cache.del(LOCK_KEY);
  }

  return report;
}

// ─── Type-Specific Evaluation Router ────────────────────────────

async function evaluateByType(draft: DraftPolicy, llmCallsUsed: number): Promise<EvalOutcome | null> {
  switch (draft.policy_type) {
    case 'prompt':
      return evaluatePromptPolicy(draft, llmCallsUsed);
    case 'constitution':
      return evaluateConstitutionPolicy(draft);
    case 'routing':
      return evaluateRoutingPolicy(draft);
    case 'model_selection':
      return evaluateModelSelectionPolicy(draft);
    case 'rubric':
      return evaluateRubricPolicy(draft, llmCallsUsed);
    default:
      console.warn(`${LOG_PREFIX} Unknown policy type: ${draft.policy_type}`);
      return null;
  }
}

// ─── Prompt Policy Evaluation ───────────────────────────────────

async function evaluatePromptPolicy(draft: DraftPolicy, llmCallsUsed: number): Promise<EvalOutcome | null> {
  if (llmCallsUsed >= LLM_BUDGET_PER_CYCLE) return null;

  const agentRole = draft.agent_role;
  if (!agentRole) {
    return {
      score: 0.4,
      status: 'draft',
      details: {
        method: 'skipped',
        sample_size: 0,
        comparison: 'no agent role specified',
        notes: 'Prompt policy without agent_role cannot be evaluated — retry next cycle',
      },
    };
  }

  // Fetch 5 recent task run outcomes for this agent
  const recentRuns = await systemQuery<{
    id: string;
    batch_quality_score: number;
    final_status: string;
    evaluation_notes: string;
  }>(
    `SELECT id, batch_quality_score, final_status, evaluation_notes
     FROM task_run_outcomes
     WHERE agent_role = $1
       AND batch_quality_score IS NOT NULL
     ORDER BY created_at DESC
     LIMIT 5`,
    [agentRole],
  );

  if (recentRuns.length < 3) {
    return {
      score: 0.5,
      status: 'draft',
      details: {
        method: 'insufficient_data',
        sample_size: recentRuns.length,
        comparison: 'need at least 3 scored runs',
        notes: 'Not enough historical data for evaluation — retry next cycle',
      },
    };
  }

  const avgScore = recentRuns.reduce((sum, r) => sum + Number(r.batch_quality_score), 0) / recentRuns.length;
  const content = draft.content as { suggestions?: string[]; theme?: string };
  const suggestions = content.suggestions ?? [];

  // Use verifier model to judge the prompt improvement proposal
  try {
    const modelClient = new ModelClient({
      geminiApiKey: process.env.GOOGLE_AI_API_KEY,
      openaiApiKey: process.env.OPENAI_API_KEY,
    });

    const prompt = [
      `You are evaluating a proposed prompt improvement for the "${agentRole}" agent.`,
      ``,
      `Current performance: average quality score ${avgScore.toFixed(2)}/5.0 over ${recentRuns.length} recent runs.`,
      `Recent outcome statuses: ${recentRuns.map(r => r.final_status).join(', ')}`,
      ``,
      `Proposed changes (${suggestions.length} suggestions):`,
      ...suggestions.map((s, i) => `${i + 1}. ${s}`),
      ``,
      `Theme: ${content.theme ?? 'general improvement'}`,
      ``,
      `Rate how likely this prompt change would improve agent quality on a scale of 0.0 to 1.0.`,
      `Consider: Is the current performance already good? Are the suggestions actionable and specific?`,
      `Would these changes address patterns visible in the recent outcomes?`,
      ``,
      `Respond with ONLY a JSON object: {"score": <number>, "reasoning": "<brief explanation>"}`,
    ].join('\n');

    const response = await modelClient.generate({
      model: VERIFIER_MODEL,
      systemInstruction: 'You are a policy evaluation verifier. Respond ONLY with the requested JSON — no markdown, no code fences.',
      contents: [{ role: 'user', content: prompt, timestamp: Date.now() }],
      temperature: 0.2,
    });

    const parsed = parseVerifierResponse(response.text ?? '');
    const score = Math.max(0, Math.min(1, parsed.score));

    return {
      score,
      status: score >= PASS_THRESHOLD ? 'candidate' : score < REJECT_THRESHOLD ? 'rejected' : 'draft',
      details: {
        method: 'verifier_model',
        sample_size: recentRuns.length,
        comparison: `avg_quality=${avgScore.toFixed(2)}, suggestions=${suggestions.length}`,
        notes: parsed.reasoning,
      },
    };
  } catch (err) {
    console.warn(`${LOG_PREFIX} Verifier model failed for prompt policy:`, (err as Error).message);
    return null;
  }
}

// ─── Constitution Policy Evaluation ─────────────────────────────

async function evaluateConstitutionPolicy(draft: DraftPolicy): Promise<EvalOutcome> {
  const content = draft.content as { amendment_id?: string; action?: string; rationale?: string };

  // Auto-promote to candidate if already approved via episodic replay process
  if (draft.source === 'constitutional_amendment' && content.amendment_id) {
    // Verify the amendment is still in approved status
    try {
      const amendments = await systemQuery<{ status: string }>(
        `SELECT status FROM proposed_constitutional_amendments WHERE id = $1`,
        [content.amendment_id],
      );

      if (amendments.length > 0 && amendments[0].status === 'approved') {
        return {
          score: 0.8,
          status: 'candidate',
          details: {
            method: 'auto_promote',
            sample_size: 1,
            comparison: 'amendment pre-approved via episodic replay',
            notes: `Amendment ${content.amendment_id} (${content.action ?? 'unknown action'}) approved — auto-promoted`,
          },
        };
      }
    } catch (err) {
      console.warn(`${LOG_PREFIX} Amendment lookup failed:`, (err as Error).message);
    }
  }

  return {
    score: 0.5,
    status: 'draft',
    details: {
      method: 'pending_approval',
      sample_size: 0,
      comparison: 'awaiting episodic replay approval',
      notes: 'Constitution policy without approved amendment — retry next cycle',
    },
  };
}

// ─── Routing Policy Evaluation ──────────────────────────────────

async function evaluateRoutingPolicy(draft: DraftPolicy): Promise<EvalOutcome> {
  const content = draft.content as {
    agent_role?: string;
    failure_rate?: number;
    total_runs?: number;
  };

  const failingRole = content.agent_role ?? draft.agent_role;
  if (!failingRole) {
    return {
      score: 0.4,
      status: 'draft',
      details: {
        method: 'insufficient_data',
        sample_size: 0,
        comparison: 'no agent role specified',
        notes: 'Cannot evaluate routing without a target agent role',
      },
    };
  }

  // Look up historical task outcomes for the failing agent and potential replacements
  try {
    const roleStats = await systemQuery<{
      agent_role: string;
      avg_quality: number;
      run_count: number;
    }>(
      `SELECT agent_role,
              ROUND(AVG(batch_quality_score)::numeric, 2)::float AS avg_quality,
              COUNT(*)::int AS run_count
       FROM task_run_outcomes
       WHERE batch_quality_score IS NOT NULL
         AND created_at > NOW() - INTERVAL '30 days'
       GROUP BY agent_role
       HAVING COUNT(*) >= 5
       ORDER BY avg_quality DESC`,
      [],
    );

    const currentRole = roleStats.find(r => r.agent_role === failingRole);
    if (!currentRole) {
      return {
        score: 0.5,
        status: 'draft',
        details: {
          method: 'insufficient_data',
          sample_size: 0,
          comparison: `no scored runs for ${failingRole}`,
          notes: 'Not enough scored data for the target agent — retry next cycle',
        },
      };
    }

    // Check if there are higher-performing agents that could handle similar tasks
    const betterAgents = roleStats.filter(
      r => r.agent_role !== failingRole && r.avg_quality > currentRole.avg_quality,
    );

    if (betterAgents.length > 0) {
      const bestAlt = betterAgents[0];
      const qualityDelta = bestAlt.avg_quality - currentRole.avg_quality;
      const score = Math.min(1.0, 0.5 + qualityDelta * 0.5);

      return {
        score,
        status: score >= PASS_THRESHOLD ? 'candidate' : score < REJECT_THRESHOLD ? 'rejected' : 'draft',
        details: {
          method: 'statistical_comparison',
          sample_size: currentRole.run_count + bestAlt.run_count,
          comparison: `${failingRole}=${currentRole.avg_quality} vs ${bestAlt.agent_role}=${bestAlt.avg_quality}`,
          notes: `Quality delta: +${qualityDelta.toFixed(2)} (${bestAlt.agent_role} outperforms)`,
        },
      };
    }

    // No better alternative found — high failure rate but no routing improvement available
    return {
      score: 0.4,
      status: 'draft',
      details: {
        method: 'statistical_comparison',
        sample_size: currentRole.run_count,
        comparison: `${failingRole}=${currentRole.avg_quality}, no better alternative`,
        notes: 'No higher-performing agent found for rerouting — retry next cycle',
      },
    };
  } catch (err) {
    console.warn(`${LOG_PREFIX} Routing stats query failed:`, (err as Error).message);
    return null as unknown as EvalOutcome;
  }
}

// ─── Model Selection Policy Evaluation ──────────────────────────

async function evaluateModelSelectionPolicy(draft: DraftPolicy): Promise<EvalOutcome> {
  const content = draft.content as {
    current_model?: string;
    suggested_model?: string;
    current_avg_score?: number;
    suggested_avg_score?: number;
    advantage?: number;
    run_count?: number;
  };

  const runCount = content.run_count ?? 0;
  const advantage = content.advantage ?? 0;

  // Auto-promote to candidate if evidence is strong
  if (runCount >= MODEL_SEL_MIN_RUNS && advantage >= MODEL_SEL_MIN_DELTA) {
    return {
      score: 0.8,
      status: 'candidate',
      details: {
        method: 'auto_promote',
        sample_size: runCount,
        comparison: `${content.current_model}=${content.current_avg_score} vs ${content.suggested_model}=${content.suggested_avg_score}`,
        notes: `Strong evidence: ${runCount} runs, +${advantage.toFixed(2)} advantage — auto-promoted`,
      },
    };
  }

  // Insufficient evidence — keep as draft
  const reasons: string[] = [];
  if (runCount < MODEL_SEL_MIN_RUNS) reasons.push(`runs=${runCount} (need ${MODEL_SEL_MIN_RUNS})`);
  if (advantage < MODEL_SEL_MIN_DELTA) reasons.push(`advantage=${advantage.toFixed(2)} (need ${MODEL_SEL_MIN_DELTA})`);

  return {
    score: 0.45,
    status: 'draft',
    details: {
      method: 'statistical_check',
      sample_size: runCount,
      comparison: `${content.current_model} vs ${content.suggested_model}`,
      notes: `Insufficient evidence: ${reasons.join(', ')} — retry next cycle`,
    },
  };
}

// ─── Rubric Policy Evaluation ───────────────────────────────────

async function evaluateRubricPolicy(draft: DraftPolicy, llmCallsUsed: number): Promise<EvalOutcome | null> {
  if (llmCallsUsed >= LLM_BUDGET_PER_CYCLE) return null;

  const content = draft.content as {
    name?: string;
    description?: string;
    steps?: unknown;
    domain?: string;
    success_rate?: number;
  };

  // Fetch 5 recent task outputs to test the rubric against
  const recentOutputs = await systemQuery<{
    id: string;
    agent_role: string;
    final_status: string;
    batch_quality_score: number;
    evaluation_notes: string;
  }>(
    `SELECT id, agent_role, final_status, batch_quality_score, evaluation_notes
     FROM task_run_outcomes
     WHERE batch_quality_score IS NOT NULL
     ORDER BY created_at DESC
     LIMIT 5`,
    [],
  );

  if (recentOutputs.length < 3) {
    return {
      score: 0.5,
      status: 'draft',
      details: {
        method: 'insufficient_data',
        sample_size: recentOutputs.length,
        comparison: 'need at least 3 scored outputs',
        notes: 'Not enough historical outputs for rubric evaluation — retry next cycle',
      },
    };
  }

  try {
    const modelClient = new ModelClient({
      geminiApiKey: process.env.GOOGLE_AI_API_KEY,
      openaiApiKey: process.env.OPENAI_API_KEY,
    });

    const outputSummaries = recentOutputs.map((o, i) =>
      `${i + 1}. [${o.agent_role}] status=${o.final_status}, quality=${o.batch_quality_score}/5.0, notes: ${o.evaluation_notes ?? 'none'}`,
    );

    const prompt = [
      `You are evaluating a proposed rubric for task quality assessment.`,
      ``,
      `Proposed Rubric: "${content.name ?? 'unnamed'}"`,
      `Domain: ${content.domain ?? 'general'}`,
      `Description: ${content.description ?? 'no description'}`,
      `Steps: ${JSON.stringify(content.steps ?? [])}`,
      `Historical success rate: ${((content.success_rate ?? 0) * 100).toFixed(0)}%`,
      ``,
      `Here are 5 recent task outcomes with their quality scores:`,
      ...outputSummaries,
      ``,
      `Does this rubric correctly distinguish good outcomes (score ≥ 3.5) from poor ones (score < 3.0)?`,
      `Would applying this rubric improve evaluation consistency?`,
      ``,
      `Rate this rubric's quality on a scale of 0.0 to 1.0.`,
      `Respond with ONLY a JSON object: {"score": <number>, "reasoning": "<brief explanation>"}`,
    ].join('\n');

    const response = await modelClient.generate({
      model: VERIFIER_MODEL,
      systemInstruction: 'You are a policy evaluation verifier. Respond ONLY with the requested JSON — no markdown, no code fences.',
      contents: [{ role: 'user', content: prompt, timestamp: Date.now() }],
      temperature: 0.2,
    });

    const parsed = parseVerifierResponse(response.text ?? '');
    const score = Math.max(0, Math.min(1, parsed.score));

    return {
      score,
      status: score >= PASS_THRESHOLD ? 'candidate' : score < REJECT_THRESHOLD ? 'rejected' : 'draft',
      details: {
        method: 'verifier_model',
        sample_size: recentOutputs.length,
        comparison: `rubric="${content.name}", domain=${content.domain}`,
        notes: parsed.reasoning,
      },
    };
  } catch (err) {
    console.warn(`${LOG_PREFIX} Verifier model failed for rubric policy:`, (err as Error).message);
    return null;
  }
}

// ─── Helpers ────────────────────────────────────────────────────

async function updatePolicyEval(id: string, outcome: EvalOutcome): Promise<void> {
  try {
    if (outcome.status === 'candidate') {
      await systemQuery(
        `UPDATE policy_versions
         SET eval_score = $1, eval_details = $2, status = 'candidate', promoted_at = NOW()
         WHERE id = $3`,
        [outcome.score, JSON.stringify(outcome.details), id],
      );
    } else if (outcome.status === 'rejected') {
      await systemQuery(
        `UPDATE policy_versions
         SET eval_score = $1, eval_details = $2, status = 'rejected'
         WHERE id = $3`,
        [outcome.score, JSON.stringify(outcome.details), id],
      );
    } else {
      await systemQuery(
        `UPDATE policy_versions
         SET eval_score = $1, eval_details = $2
         WHERE id = $3`,
        [outcome.score, JSON.stringify(outcome.details), id],
      );
    }
  } catch (err) {
    console.warn(`${LOG_PREFIX} Policy update failed for ${id}:`, (err as Error).message);
  }
}

function parseVerifierResponse(text: string): { score: number; reasoning: string } {
  try {
    // Strip markdown fences if present
    const cleaned = text.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return {
      score: typeof parsed.score === 'number' ? parsed.score : 0.5,
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : 'No reasoning provided',
    };
  } catch {
    console.warn(`${LOG_PREFIX} Failed to parse verifier response: ${text.slice(0, 200)}`);
    return { score: 0.5, reasoning: 'Failed to parse verifier response' };
  }
}
