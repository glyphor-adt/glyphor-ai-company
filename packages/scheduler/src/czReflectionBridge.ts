/**
 * CZ Reflection Bridge — Connects certification test failures to the
 * prompt self-improvement pipeline (reflect → mutate → shadow → promote).
 *
 * After a CZ batch completes, this module:
 *   1. Collects all failed scores (judge_score < 7, passed = false)
 *   2. Groups by agent role (max 1 reflection per agent per batch)
 *   3. Asks the reflection LLM to analyze the worst failure per agent
 *   4. Stages a prompt mutation via applyMutation()
 *   5. Queues shadow evaluation so the cron picks it up
 *
 * Rate-limited: max 1 mutation per agent per 24h (inherited from promptMutator).
 */

import { systemQuery } from '@glyphor/shared/db';
import { getGoogleAiApiKey, getSpecialized } from '@glyphor/shared';
import { ModelClient, applyMutation, queueShadowEvaluation, getActivePrompt } from '@glyphor/agent-runtime';
import type { ReflectionResult } from '@glyphor/agent-runtime';

// ─── Types ──────────────────────────────────────────────────

interface CzFailure {
  run_id: string;
  task_number: number;
  pillar: string;
  task: string;
  acceptance_criteria: string;
  responsible_agent: string;
  judge_score: number;
  judge_tier: string;
  reasoning_trace: string | null;
  axis_scores: Record<string, number> | null;
  agent_output: string | null;
  heuristic_failures: string[] | null;
}

// ─── System Prompt ──────────────────────────────────────────

const CZ_REFLECTION_SYSTEM = `You are a prompt engineering expert analyzing why an AI agent failed a certification test.

You will be given:
- The agent's current system prompt
- The certification task that was assigned
- The acceptance criteria the output was judged against
- The agent's actual output
- The judge's score, reasoning, and axis breakdown

Your job is to identify ONE specific, surgical change to the agent's system prompt that would most likely have improved the output to pass the certification test.

Rules:
- Propose exactly ONE change. Not a rewrite. One targeted addition, clarification, or example.
- The change must address the SPECIFIC failure observed, not a general improvement.
- If the agent had no output (heuristic-only run), set confidence to 0.0.
- If the failure was due to infrastructure issues (timeout, API error), set confidence to 0.0.
- Be concrete — quote what you would add or modify in the prompt.

Output format: JSON only.
{
  "failure_mode": "brief description of what went wrong",
  "proposed_change": "exact text to add/modify",
  "change_type": "add_instruction | clarify_constraint | add_example | remove_ambiguity",
  "expected_impact": "what this change should fix in future runs",
  "confidence": 0.0-1.0
}`;

// ─── Rate Limiting ──────────────────────────────────────────

const RATE_LIMIT_HOURS = 24;

async function isRateLimited(agentId: string): Promise<boolean> {
  // Match both source tags: `applyMutation` writes 'reflection', then this
  // bridge used to UPDATE to 'cz_reflection' — but that UPDATE has been
  // silently no-op'ing in practice (likely RLS on tenant_id in a different
  // connection context), so historical CZ-triggered versions are stored as
  // plain 'reflection'. Counting both prevents the bridge from re-firing on
  // the same agent every batch.
  const rows = await systemQuery<{ count: string }>(
    `SELECT COUNT(*) AS count FROM agent_prompt_versions
     WHERE agent_id = $1 AND source IN ('cz_reflection', 'reflection')
       AND created_at > NOW() - INTERVAL '${RATE_LIMIT_HOURS} hours'`,
    [agentId],
  );
  return Number(rows[0]?.count ?? 0) > 0;
}

// ─── Core ───────────────────────────────────────────────────

/** Map agent first-names to canonical role slugs (same as czProtocolApi). */
const AGENT_NAME_TO_ROLE: Record<string, string> = {
  sarah: 'chief-of-staff',
  marcus: 'cto',
  nadia: 'cfo',
  elena: 'cpo',
  maya: 'cmo',
  mia: 'vp-design',
  rachel: 'vp-sales',
  atlas: 'ops',
  victoria: 'clo',
  tyler: 'content-creator',
  lisa: 'seo-analyst',
  kai: 'social-media-manager',
};

function resolveAgentId(nameOrRole: string): string {
  return AGENT_NAME_TO_ROLE[nameOrRole.toLowerCase()] ?? nameOrRole;
}

/**
 * Process CZ batch failures and trigger the self-improvement pipeline.
 * Call this after a batch completes.
 */
export async function processCzBatchFailures(batchId: string): Promise<{
  analyzed: number;
  mutations_staged: number;
  skipped_rate_limited: number;
  skipped_low_confidence: number;
  skipped_no_prompt: number;
  errors: number;
}> {
  const stats = {
    analyzed: 0,
    mutations_staged: 0,
    skipped_rate_limited: 0,
    skipped_low_confidence: 0,
    skipped_no_prompt: 0,
    errors: 0,
  };

  // 1. Collect failed scores from this batch
  const failures = await systemQuery<CzFailure>(`
    SELECT r.id AS run_id, t.task_number, t.pillar, t.task, t.acceptance_criteria,
           t.responsible_agent, s.judge_score, s.judge_tier,
           s.reasoning_trace, s.axis_scores, s.agent_output, s.heuristic_failures
    FROM cz_scores s
    JOIN cz_runs r ON r.id = s.run_id
    JOIN cz_tasks t ON t.id = r.task_id
    WHERE r.batch_id = $1
      AND s.passed = false
      AND s.judge_tier != 'heuristic'
      AND s.agent_output IS NOT NULL
      AND s.agent_output != ''
    ORDER BY s.judge_score ASC
  `, [batchId]);

  if (failures.length === 0) {
    console.log(`[CzReflection] No actionable failures in batch ${batchId}`);
    return stats;
  }

  // 2. Group by agent, keep only the worst failure per agent
  const worstByAgent = new Map<string, CzFailure>();
  for (const f of failures) {
    if (!f.responsible_agent) continue;
    const agentId = resolveAgentId(f.responsible_agent);
    const existing = worstByAgent.get(agentId);
    if (!existing || f.judge_score < existing.judge_score) {
      worstByAgent.set(agentId, f);
    }
  }

  console.log(`[CzReflection] Batch ${batchId}: ${failures.length} failures across ${worstByAgent.size} agents`);

  // 3. For each agent, reflect → mutate → queue shadow
  const modelClient = new ModelClient({ geminiApiKey: getGoogleAiApiKey() });

  for (const [agentId, failure] of worstByAgent) {
    stats.analyzed++;

    // Rate limit check
    if (await isRateLimited(agentId)) {
      console.log(`[CzReflection] Rate limited: ${agentId}`);
      stats.skipped_rate_limited++;
      continue;
    }

    // Get current prompt
    const currentPrompt = await getActivePrompt(agentId);
    if (!currentPrompt) {
      console.log(`[CzReflection] No active prompt for ${agentId} — skipping`);
      stats.skipped_no_prompt++;
      continue;
    }

    try {
      // Build context for the reflection LLM
      const context = buildCzReflectionContext(currentPrompt, failure);

      const response = await modelClient.generate({
        model: getSpecialized('reflection'),
        systemInstruction: CZ_REFLECTION_SYSTEM,
        contents: [{ role: 'user', content: context, timestamp: Date.now() }],
        source: 'scheduled',
      });

      const result = parseReflectionJSON(response.text ?? '');
      if (!result) {
        console.warn(`[CzReflection] Failed to parse reflection for ${agentId}`);
        stats.errors++;
        continue;
      }

      if (result.confidence < 0.6) {
        console.log(`[CzReflection] Low confidence (${result.confidence}) for ${agentId} — skipping`);
        stats.skipped_low_confidence++;
        continue;
      }

      // Stage mutation
      const newVersion = await applyMutation(agentId, result);
      if (newVersion === null) {
        console.warn(`[CzReflection] Mutation had no effect for ${agentId}`);
        stats.errors++;
        continue;
      }

      // Tag the version source as cz_reflection (for rate limiting + dashboard
      // filtering) and fetch id/tenant_id so we can wire shadow-eval.
      // Historically this UPDATE silently affected 0 rows (tenant/RLS quirk);
      // we now do a SELECT fallback so shadow-eval creation never depends on
      // the UPDATE succeeding.
      const updateResult = await systemQuery<{ id: string; tenant_id: string }>(
        `UPDATE agent_prompt_versions
            SET source = 'cz_reflection'
          WHERE agent_id = $1 AND version = $2
      RETURNING id, tenant_id`,
        [agentId, newVersion],
      );
      let versionRow: { id: string; tenant_id: string } | undefined = updateResult[0];
      if (!versionRow) {
        console.warn(
          `[CzReflection] Source-tag UPDATE affected 0 rows for ${agentId} v${newVersion} — falling back to SELECT so shadow-eval still fires.`,
        );
        const selectResult = await systemQuery<{ id: string; tenant_id: string }>(
          `SELECT id, tenant_id FROM agent_prompt_versions
             WHERE agent_id = $1 AND version = $2
             ORDER BY created_at DESC LIMIT 1`,
          [agentId, newVersion],
        );
        versionRow = selectResult[0];
      }

      // Queue shadow evaluation
      await queueShadowEvaluation(agentId, newVersion);

      // Hand the challenger to the CZ shadow-eval auto-promotion gate.
      // Awaited so we actually see errors in logs (previously fire-and-forget
      // + gated on a 0-row UPDATE meant this never ran in production).
      if (versionRow?.id) {
        try {
          const { createShadowEval } = await import('./czShadowEval.js');
          const shadowId = await createShadowEval({
            prompt_version_id: versionRow.id,
            agent_id: agentId,
            tenant_id: versionRow.tenant_id,
          });
          if (shadowId) {
            console.log(`[CzReflection] shadow eval ${shadowId.slice(0, 8)} created for ${agentId} v${newVersion}`);
          }
        } catch (e) {
          console.error(
            `[CzReflection] createShadowEval failed for ${agentId} v${newVersion}:`,
            e instanceof Error ? e.message : e,
          );
        }
      } else {
        console.error(
          `[CzReflection] could not resolve version row for ${agentId} v${newVersion} — shadow eval NOT created.`,
        );
      }

      console.log(
        `[CzReflection] ${agentId}: staged v${newVersion} ` +
        `(${result.change_type}: ${result.failure_mode.slice(0, 80)}) — shadow queued`,
      );
      stats.mutations_staged++;

    } catch (err) {
      console.error(`[CzReflection] Error processing ${agentId}:`, (err as Error).message);
      stats.errors++;
    }
  }

  console.log(`[CzReflection] Batch ${batchId} complete:`, stats);
  return stats;
}

// ─── Context Builder ────────────────────────────────────────

function buildCzReflectionContext(prompt: string, failure: CzFailure): string {
  const parts: string[] = [];

  parts.push('## Current System Prompt');
  parts.push(prompt.slice(0, 4000));

  parts.push('\n## Certification Task');
  parts.push(`Task #${failure.task_number}: ${failure.task}`);
  parts.push(`Pillar: ${failure.pillar}`);

  parts.push('\n## Acceptance Criteria');
  parts.push(failure.acceptance_criteria);

  parts.push('\n## Agent Output');
  parts.push((failure.agent_output ?? '(no output)').slice(0, 3000));

  parts.push('\n## Judge Evaluation');
  parts.push(`Score: ${failure.judge_score}/10 (FAIL — needs ≥7 to pass)`);
  if (failure.reasoning_trace) {
    parts.push(`Reasoning: ${failure.reasoning_trace}`);
  }
  if (failure.axis_scores && Object.keys(failure.axis_scores).length > 0) {
    parts.push('Axis scores: ' + Object.entries(failure.axis_scores)
      .map(([k, v]) => `${k}=${(v * 10).toFixed(1)}`)
      .join(', '));
  }
  if (failure.heuristic_failures && failure.heuristic_failures.length > 0) {
    parts.push('Heuristic failures: ' + failure.heuristic_failures.join('; '));
  }

  return parts.join('\n');
}

// ─── JSON Parser ────────────────────────────────────────────

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
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence ?? 0))),
    };
  } catch {
    return null;
  }
}
