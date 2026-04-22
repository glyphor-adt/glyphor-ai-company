/**
 * Changes to packages/scheduler/src/czProtocolApi.ts to support shadow-eval.
 *
 * Three surgical changes:
 *
 *   1. executeBatch() accepts an optional prompt_version_id per run and
 *      threads it through to the agent runner. When set, the runner MUST
 *      use that prompt version's text instead of the agent's current live
 *      deployed version. Fallback behavior (no override) is unchanged.
 *
 *   2. POST /api/cz/runs accepts an optional prompt_version_id so the
 *      shadow-eval module can queue canaries through the normal API. When
 *      set, all runs in the batch share that version; the batch's mode
 *      must be 'single' or 'canary' (it's a category error to override
 *      prompts for a full run).
 *
 *   3. New endpoints under /api/cz/shadow/* for the dashboard + Sarah's
 *      loop to read shadow-eval state. The existing /fixes/:id/promote
 *      still works for manual override.
 *
 * ============================================================
 *  PATCH 1: executeBatch signature + agent runner override
 * ============================================================
 *
 * Replace the current signature:
 *
 *     async function executeBatch(
 *       batchId: string,
 *       runRows: Array<{ id: string; task_id: string }>,
 *     ): Promise<void>
 *
 * With:
 *
 *     async function executeBatch(
 *       batchId: string,
 *       runRows: Array<{ id: string; task_id: string; prompt_version_id?: string | null }>,
 *     ): Promise<void>
 *
 * Inside the for loop, BEFORE `const runner = getAgentRunner(agentRole);`,
 * resolve the prompt override:
 *
 *     let promptOverride: { text: string; version: number } | null = null;
 *     if (run.prompt_version_id) {
 *       const pv = await systemQuery<{ prompt_text: string | null; version: number }>(
 *         'SELECT prompt_text, version FROM agent_prompt_versions WHERE id = $1',
 *         [run.prompt_version_id],
 *       );
 *       if (pv[0]?.prompt_text) {
 *         promptOverride = { text: pv[0].prompt_text, version: pv[0].version };
 *       }
 *     }
 *
 * Then update the runner invocation to pass the override. You'll need to
 * extend the STATIC_RUNNERS signature and the corresponding runChiefOfStaff /
 * runCTO / etc. functions in @glyphor/agents to accept an optional
 * { systemPromptOverride?: string } parameter. Where the agent currently
 * loads its system prompt from agent_prompt_versions WHERE deployed_at IS NOT NULL,
 * it should prefer systemPromptOverride when supplied.
 *
 * I can't patch @glyphor/agents from here, so the STATIC_RUNNERS block
 * becomes (e.g. for chief-of-staff):
 *
 *     'chief-of-staff': (p, opts) => runChiefOfStaff({
 *       task: 'on_demand', message: p, dryRun: true, evalMode: true,
 *       systemPromptOverride: opts?.systemPromptOverride,
 *     }),
 *
 * And getAgentRunner returns a (prompt, opts?) signature.
 *
 * At call site:
 *
 *     const agentResult = await runner(agentPrompt, {
 *       systemPromptOverride: promptOverride?.text,
 *     });
 *
 * Also broadcast the override in agent_invoked events so the console
 * shows which version was tested:
 *
 *     broadcastCzRunEvent(batchId, 'agent_invoked', {
 *       run_id: run.id, task_number: task.task_number, agent: agentRole,
 *       prompt_version: promptOverride ? `v${promptOverride.version} (shadow)` : 'deployed',
 *     });
 *
 *
 * ============================================================
 *  PATCH 2: POST /api/cz/runs accepts prompt_version_id
 * ============================================================
 *
 * Inside the POST /api/cz/runs handler, after reading body:
 *
 *     const promptVersionId: string | undefined = body.prompt_version_id;
 *     if (promptVersionId) {
 *       if (!isUuid(promptVersionId)) {
 *         send(400, { error: 'Invalid prompt_version_id' });
 *         return true;
 *       }
 *       if (!['single','canary'].includes(triggerType)) {
 *         send(400, { error: 'prompt_version_id only valid with mode=single|canary' });
 *         return true;
 *       }
 *       // Confirm the version exists and is for the right agent context.
 *       // (We don't strictly check agent alignment here because canary is by
 *       // agent; we trust the caller.)
 *     }
 *
 * And when inserting cz_runs rows, include prompt_version_id in the
 * placeholder set (add one more $ per row) and INSERT column list:
 *
 *     INSERT INTO cz_runs (batch_id, task_id, mode, trigger_type, triggered_by, surface, prompt_version_id)
 *     VALUES ...
 *
 * For the fire-and-forget dispatch:
 *
 *     executeBatch(batchId, runRows.map((r) => ({
 *       id: r.id,
 *       task_id: r.task_id,
 *       prompt_version_id: r.prompt_version_id ?? null,
 *     }))).catch(...);
 *
 *
 * ============================================================
 *  PATCH 3: New /api/cz/shadow/* endpoints
 * ============================================================
 *
 * Add these BEFORE the "No matching route" fallback at the bottom of
 * handleCzApi:
 */

// ---- BEGIN PATCH 3 (paste these blocks into handleCzApi) ----

/*
    // ── GET /api/cz/shadow ────────────────────────────────────
    // Dashboard view: all shadow evals grouped by state, with attempts.
    if (segments[0] === 'shadow' && segments.length === 1 && method === 'GET') {
      const rows = await systemQuery(`
        SELECT e.*,
               apv.version AS challenger_version,
               apv.change_summary,
               (
                 SELECT json_agg(row_to_json(a.*) ORDER BY a.attempt_number)
                 FROM cz_shadow_attempts a WHERE a.shadow_eval_id = e.id
               ) AS attempts
        FROM cz_shadow_evals e
        JOIN agent_prompt_versions apv ON apv.id = e.prompt_version_id
        ORDER BY
          CASE e.state
            WHEN 'human_review'   THEN 1
            WHEN 'shadow_running' THEN 2
            WHEN 'shadow_pending' THEN 3
            WHEN 'auto_promoted'  THEN 4
            WHEN 'shadow_passed'  THEN 5
            WHEN 'shadow_failed'  THEN 6
          END,
          e.created_at DESC
        LIMIT 50
      `);
      send(200, { shadow_evals: rows });
      return true;
    }

    // ── POST /api/cz/shadow/tick ─────────────────────────────
    // Called by Sarah's orchestrator on a schedule. Finds ready shadow-evals
    // and advances each by one step (queue canary, or evaluate completed
    // batch). Returns what it did.
    if (segments[0] === 'shadow' && segments[1] === 'tick' && method === 'POST') {
      const { findReadyShadowEvals, runShadowCanary } = await import('./czShadowEval.js');
      const ready = await findReadyShadowEvals();
      const results: Array<{ id: string; state: string }> = [];
      for (const se of ready) {
        try {
          const newState = await runShadowCanary(se.id, async ({ task_ids, prompt_version_id, triggered_by }) => {
            // Queue a canary batch via the same internal path as POST /runs.
            const batchId = (await systemQuery("SELECT gen_random_uuid() AS id"))[0].id;
            const placeholders: string[] = [];
            const values: unknown[] = [];
            let pi = 1;
            for (const tid of task_ids) {
              placeholders.push(`($${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++})`);
              values.push(batchId, tid, 'solo', 'canary', triggered_by, 'direct', prompt_version_id);
            }
            const runRows = await systemQuery(`
              INSERT INTO cz_runs (batch_id, task_id, mode, trigger_type, triggered_by, surface, prompt_version_id)
              VALUES ${placeholders.join(', ')}
              RETURNING id, task_id, prompt_version_id
            `, values);
            broadcastCzRunEvent(batchId, 'run_started', {
              batch_id: batchId, trigger_type: 'canary',
              surface: 'direct', task_count: runRows.length,
              shadow_eval: true,
            });
            executeBatch(batchId, runRows.map((r) => ({
              id: r.id, task_id: r.task_id, prompt_version_id: r.prompt_version_id,
            }))).catch((e) => console.error('[shadow canary]', e));
            return batchId;
          });
          results.push({ id: se.id, state: newState });
        } catch (err) {
          console.error(`[shadow tick] ${se.id} failed:`, err);
          results.push({ id: se.id, state: 'error' });
        }
      }
      send(200, { ticked: results.length, results });
      return true;
    }

    // ── POST /api/cz/shadow/auto-reassign ────────────────────
    // Runs the heuristic-driven task reassignment pass. Idempotent — safe
    // to call as often as the orchestrator wants.
    if (segments[0] === 'shadow' && segments[1] === 'auto-reassign' && method === 'POST') {
      const { autoReassignMisroutedTasks } = await import('./czShadowEval.js');
      const reassignments = await autoReassignMisroutedTasks();
      send(200, { reassignments });
      return true;
    }

    // ── GET /api/cz/shadow/convergence ───────────────────────
    // Cheap stop-condition check for the orchestrator.
    if (segments[0] === 'shadow' && segments[1] === 'convergence' && method === 'GET') {
      const { evaluateConvergence } = await import('./czShadowEval.js');
      const status = await evaluateConvergence();
      send(200, status);
      return true;
    }
*/

// ---- END PATCH 3 ----

/**
 * ============================================================
 *  PATCH 4: Hook into czReflectionBridge.ts
 * ============================================================
 *
 * In packages/scheduler/src/czReflectionBridge.ts, at the point where
 * processCzBatchFailures inserts a new row into agent_prompt_versions
 * (search for `INSERT INTO agent_prompt_versions`), immediately after
 * the successful insert, call createShadowEval:
 *
 *     import { createShadowEval } from './czShadowEval.js';
 *     // ...after inserting the challenger prompt version:
 *     await createShadowEval({
 *       prompt_version_id: inserted.id,
 *       agent_id: agentId,
 *       tenant_id: tenantId,
 *     }).catch((e) => console.error('[CzReflection] createShadowEval failed:', e));
 *
 * Do NOT block the rest of processCzBatchFailures on shadow-eval creation;
 * the shadow-eval table is a derived convenience and should never prevent
 * a challenger from being staged.
 */
