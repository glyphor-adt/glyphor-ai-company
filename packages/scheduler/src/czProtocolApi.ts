/**
 * Certification Protocol API — /api/cz/* endpoints.
 *
 * Schema: cz_runs is per-task (each row = one task execution in a batch).
 *   - batch_id groups a set of runs kicked off together
 *   - cz_scores has one row per cz_run
 *   - cz_latest_scores view: DISTINCT ON (task_id, mode) with passed, judge_score, judge_tier
 *
 * Provides:
 *   GET    /api/cz/tasks              – List active tasks (filter: pillar, p0, agent)
 *   GET    /api/cz/tasks/:id          – Task detail + last N scores
 *   POST   /api/cz/tasks              – Create ad-hoc task
 *   PATCH  /api/cz/tasks/:id          – Update / deactivate a task
 *   POST   /api/cz/runs               – Kick off a run batch (modes: single/pillar/critical/full/canary)
 *   GET    /api/cz/runs               – List run batches
 *   GET    /api/cz/runs/:batchId      – Batch status + per-task scores
 *   GET    /api/cz/runs/:batchId/stream – SSE stream for live console
 *   GET    /api/cz/scorecard          – Aggregated pillar pass rates + launch-gate status
 *   GET    /api/cz/drift              – Time-series for drift chart
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { systemQuery } from '@glyphor/shared/db';
import { writeJson } from './httpJson.js';
import { corsHeadersFor } from './corsHeaders.js';
import { getGoogleAiApiKey, getTierModel, isCanonicalKeepRole } from '@glyphor/shared';
import { ModelClient, type AgentExecutionResult } from '@glyphor/agent-runtime';
import {
  runChiefOfStaff, runCTO, runCFO, runCPO, runCMO,
  runVPDesign, runVPResearch, runOps,
  runCLO, runVPSales, runContentCreator, runSeoAnalyst,
  runDynamicAgent,
} from '@glyphor/agents';

/* ── Helpers ──────────────────────────────────────────────── */

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

const VALID_SURFACES = ['direct', 'teams', 'slack'] as const;

function isValidSurface(s: string): boolean {
  return (VALID_SURFACES as readonly string[]).includes(s);
}

/* ── SSE active streams (batch_id → Set<ServerResponse>) ── */

const sseClients = new Map<string, Set<ServerResponse>>();

/** Broadcast an SSE event to all listeners for a batch. */
export function broadcastCzRunEvent(batchId: string, event: string, data: unknown): void {
  const clients = sseClients.get(batchId);
  if (!clients?.size) return;
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try {
      res.write(msg);
    } catch {
      clients.delete(res);
    }
  }
}

/* ── Agent runners (eval-mode, dry-run) ──────────────────── */

/** Map agent first-names (as stored in cz_tasks.responsible_agent) to canonical role slugs. */
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

const STATIC_RUNNERS: Record<string, (prompt: string) => Promise<AgentExecutionResult>> = {
  'chief-of-staff': (p) => runChiefOfStaff({ task: 'on_demand', message: p, dryRun: true, evalMode: true }),
  cto: (p) => runCTO({ task: 'on_demand', message: p, dryRun: true, evalMode: true }),
  cfo: (p) => runCFO({ task: 'on_demand', message: p, dryRun: true, evalMode: true }),
  cpo: (p) => runCPO({ task: 'on_demand', message: p }),
  cmo: (p) => runCMO({ task: 'on_demand', message: p, dryRun: true, evalMode: true }),
  'vp-design': (p) => runVPDesign({ task: 'on_demand', message: p }),
  'vp-research': (p) => runVPResearch({ task: 'on_demand', message: p, maxToolCalls: 0 }),
  ops: (p) => runOps({ task: 'on_demand', message: p }),
  clo: (p) => runCLO({ task: 'on_demand', message: p }),
  'vp-sales': (p) => runVPSales({ task: 'on_demand', message: p }),
  'content-creator': (p) => runContentCreator({ task: 'on_demand', message: p, dryRun: true, evalMode: true }),
  'seo-analyst': (p) => runSeoAnalyst({ task: 'on_demand', message: p, dryRun: true, evalMode: true }),
};

function getAgentRunner(agentNameOrRole: string): ((prompt: string) => Promise<AgentExecutionResult>) | null {
  // Resolve name → role (e.g. 'sarah' → 'chief-of-staff')
  const role = AGENT_NAME_TO_ROLE[agentNameOrRole.toLowerCase()] ?? agentNameOrRole;
  if (STATIC_RUNNERS[role]) return STATIC_RUNNERS[role];
  if (!isCanonicalKeepRole(role)) return null;
  // Fall back to dynamic agent runner for DB-defined agents
  return (p) => runDynamicAgent({ role, task: 'on_demand', message: p });
}

function normalizeAgentOutput(result: AgentExecutionResult): string {
  if (result.output) return result.output;
  if (result.resultSummary) return result.resultSummary;
  return result.status === 'error'
    ? `Agent returned error: ${result.error ?? result.abortReason ?? 'unknown'}`
    : '(no output)';
}

const JUDGE_MODEL = getTierModel('fast');

interface JudgeVerdict {
  passed: boolean;
  score: number;
  reasoning: string;
  axis_scores: Record<string, number>;
}

async function judgeAgentOutput(
  judgeClient: ModelClient,
  task: Record<string, unknown>,
  agentOutput: string,
): Promise<JudgeVerdict> {
  const prompt = [
    'You are a strict certification judge evaluating whether an AI agent successfully performed a task.',
    '',
    `TASK: ${task.task}`,
    `AGENT ROLE: ${task.responsible_agent}`,
    `PILLAR: ${task.pillar}`,
    '',
    'ACCEPTANCE CRITERIA:',
    task.acceptance_criteria as string,
    '',
    'VERIFICATION METHOD:',
    (task.verification_method as string) || '(none specified)',
    '',
    'AGENT OUTPUT:',
    agentOutput.slice(0, 4000),
    '',
    'Score the agent output on a scale of 0-10 and determine pass/fail:',
    '- PASS (score >= 7): output meets acceptance criteria substantially',
    '- FAIL (score < 7): output is missing, wrong, or incomplete vs criteria',
    '',
    'Evaluate these axes (0.0-1.0 each):',
    '- criteria_met: Does the output satisfy the acceptance criteria?',
    '- specificity: Is the output specific and actionable (not generic)?',
    '- completeness: Does the output cover all aspects of the task?',
    '- quality: Is the output well-structured and professional?',
    '',
    'Respond with ONLY a JSON object:',
    '{"passed":true|false,"score":7.5,"reasoning":"...","axis_scores":{"criteria_met":0.9,"specificity":0.8,"completeness":0.7,"quality":0.9}}',
  ].join('\n');

  try {
    const response = await judgeClient.generate({
      model: JUDGE_MODEL,
      systemInstruction: 'You are a strict certification judge. Respond ONLY with the requested JSON object. No markdown fences, no prose.',
      contents: [{ role: 'user', content: prompt, timestamp: Date.now() }],
      temperature: 0.1,
      maxTokens: 500,
    });

    const text = (response.text ?? '').trim();
    // Extract JSON from potential markdown fences
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in judge response');
    const parsed = JSON.parse(jsonMatch[0]) as JudgeVerdict;
    return {
      passed: parsed.passed ?? parsed.score >= 7,
      score: Math.max(0, Math.min(10, parsed.score ?? 0)),
      reasoning: parsed.reasoning ?? '',
      axis_scores: parsed.axis_scores ?? {},
    };
  } catch (err) {
    return {
      passed: false,
      score: 0,
      reasoning: `Judge error: ${(err as Error).message}`,
      axis_scores: {},
    };
  }
}

/* ── Batch executor ───────────────────────────────────────── */

/**
 * Async batch executor.
 * For each run in the batch:
 *   1. Mark status → 'running', broadcast task_started
 *   2. Invoke the responsible agent with the task description
 *   3. Judge the agent output against acceptance_criteria
 *   4. Insert cz_scores row, update run status → 'scored'
 *   5. Broadcast task_scored with full output details
 * Then broadcast run_complete + close SSE streams.
 */
async function executeBatch(
  batchId: string,
  runRows: Array<{ id: string; task_id: string }>,
): Promise<void> {
  // Fetch task details for all tasks in this batch
  const taskIds = runRows.map((r) => r.task_id);
  const taskDetailsRows = await systemQuery(`
    SELECT id, task_number, pillar, task, acceptance_criteria, verification_method, responsible_agent, is_p0
    FROM cz_tasks WHERE id = ANY($1)
  `, [taskIds]);
  const taskMap = new Map(taskDetailsRows.map((t: Record<string, unknown>) => [t.id as string, t]));

  // Track per-pillar completion for pillar_complete events
  const pillarTasks = new Map<string, { total: number; done: number; passed: number }>();
  for (const t of taskDetailsRows) {
    const p = t.pillar as string;
    if (!pillarTasks.has(p)) pillarTasks.set(p, { total: 0, done: 0, passed: 0 });
    pillarTasks.get(p)!.total++;
  }

  // Initialize judge client once for the batch
  const judgeClient = new ModelClient({
    geminiApiKey: getGoogleAiApiKey(),
  });

  let batchPassed = 0;
  let batchFailed = 0;

  for (const run of runRows) {
    const task = taskMap.get(run.task_id) as Record<string, unknown> | undefined;
    if (!task) continue;

    const startTime = Date.now();
    const agentRole = (task.responsible_agent as string) || '';

    // 1. Mark running
    await systemQuery(
      "UPDATE cz_runs SET status = 'running', started_at = NOW() WHERE id = $1",
      [run.id],
    );
    broadcastCzRunEvent(batchId, 'task_started', {
      run_id: run.id,
      task_number: task.task_number,
      pillar: task.pillar,
      task: task.task,
      responsible_agent: agentRole,
    });

    let passed: boolean;
    let judgeScore: number;
    let reasoningTrace: string;
    let axisScores: Record<string, number>;
    let agentOutput: string;
    let judgeTier: string;
    let heuristicFailures: string[] = [];

    // 2. Invoke agent + judge
    const runner = getAgentRunner(agentRole);
    if (!runner) {
      // No runner available — fall back to heuristic checks
      judgeTier = 'heuristic';
      agentOutput = '';
      const criteria = (task.acceptance_criteria as string) || '';
      const method = (task.verification_method as string) || '';
      if (criteria.length < 10) heuristicFailures.push('acceptance_criteria too short');
      if (!method) heuristicFailures.push('no verification_method defined');
      if (!agentRole) heuristicFailures.push('no responsible_agent assigned');
      else heuristicFailures.push(`no runner available for agent "${agentRole}"`);

      passed = false;
      judgeScore = 2.0;
      reasoningTrace = `Task #${task.task_number}: no agent runner for "${agentRole}" — cannot execute`;
      axisScores = { criteria_met: 0, specificity: 0, completeness: 0, quality: 0 };
    } else {
      try {
        // Build the prompt for the agent
        const agentPrompt = [
          `Please complete the following task:`,
          ``,
          `TASK: ${task.task}`,
          ``,
          `ACCEPTANCE CRITERIA:`,
          task.acceptance_criteria as string,
          ``,
          `Provide your complete, production-quality output for this task.`,
        ].join('\n');

        broadcastCzRunEvent(batchId, 'agent_invoked', {
          run_id: run.id,
          task_number: task.task_number,
          agent: agentRole,
        });

        const agentResult = await runner(agentPrompt);
        agentOutput = normalizeAgentOutput(agentResult);

        broadcastCzRunEvent(batchId, 'agent_responded', {
          run_id: run.id,
          task_number: task.task_number,
          agent: agentRole,
          status: agentResult.status,
          output_length: agentOutput.length,
          elapsed_ms: agentResult.elapsedMs,
          model: agentResult.actualModel ?? 'unknown',
          cost: agentResult.cost ?? 0,
        });

        // 3. Judge the agent output against acceptance criteria
        const verdict = await judgeAgentOutput(judgeClient, task, agentOutput);
        passed = verdict.passed;
        judgeScore = verdict.score;
        reasoningTrace = verdict.reasoning;
        axisScores = verdict.axis_scores;
        judgeTier = 'llm-judge';
      } catch (err) {
        // Agent invocation failed
        agentOutput = `Agent execution error: ${(err as Error).message}`;
        passed = false;
        judgeScore = 0;
        reasoningTrace = `Task #${task.task_number}: agent "${agentRole}" threw: ${(err as Error).message}`;
        axisScores = { criteria_met: 0, specificity: 0, completeness: 0, quality: 0 };
        judgeTier = 'error';
        heuristicFailures = [`agent_error: ${(err as Error).message.slice(0, 200)}`];
      }
    }

    const latencyMs = Date.now() - startTime;

    // 4. Insert score + update run
    await systemQuery(`
      INSERT INTO cz_scores (run_id, passed, judge_score, judge_tier, heuristic_failures, reasoning_trace, axis_scores, agent_output)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      run.id,
      passed,
      judgeScore,
      judgeTier,
      heuristicFailures,
      reasoningTrace,
      JSON.stringify(axisScores),
      agentOutput.slice(0, 10000), // cap stored output
    ]);

    await systemQuery(
      "UPDATE cz_runs SET status = 'scored', completed_at = NOW(), latency_ms = $2 WHERE id = $1",
      [run.id, latencyMs],
    );

    if (passed) batchPassed++; else batchFailed++;

    // 5. Broadcast task_scored with full details
    broadcastCzRunEvent(batchId, 'task_scored', {
      run_id: run.id,
      task_number: task.task_number,
      pillar: task.pillar,
      task: task.task,
      responsible_agent: agentRole,
      pass: passed,
      judge_score: judgeScore,
      judge_tier: judgeTier,
      reasoning_trace: reasoningTrace,
      axis_scores: axisScores,
      agent_output_preview: agentOutput.slice(0, 500),
      heuristic_failures: heuristicFailures,
      latency_ms: latencyMs,
    });

    // Check if pillar complete
    const pillar = task.pillar as string;
    const ps = pillarTasks.get(pillar)!;
    ps.done++;
    if (passed) ps.passed++;
    if (ps.done === ps.total) {
      broadcastCzRunEvent(batchId, 'pillar_complete', {
        pillar,
        passed: ps.passed,
        total: ps.total,
        pass_rate: Math.round((ps.passed / ps.total) * 10000) / 10000,
      });
    }
  }

  // 5. Broadcast run_complete
  broadcastCzRunEvent(batchId, 'run_complete', {
    batch_id: batchId,
    status: 'completed',
    passed: batchPassed,
    failed: batchFailed,
    total: runRows.length,
  });

  // Close SSE connections for this batch
  const clients = sseClients.get(batchId);
  if (clients) {
    for (const res of clients) {
      try { res.end(); } catch { /* ignore */ }
    }
    sseClients.delete(batchId);
  }
}

/* ── Route handler ────────────────────────────────────────── */

export async function handleCzApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  _queryString: string,
  method: string,
): Promise<boolean> {
  if (!url.startsWith('/api/cz/')) return false;

  const path = url.slice('/api/cz/'.length); // e.g. "tasks", "runs/uuid", "scorecard"
  const segments = path.split('/');
  const params = new URLSearchParams(_queryString ?? '');
  const send = (status: number, data: unknown) => writeJson(res, status, data, req);

  try {
    // ═══════════════════════════════════════════════════════════
    //  TASKS
    // ═══════════════════════════════════════════════════════════

    // ── GET /api/cz/tasks ────────────────────────────────────
    if (segments[0] === 'tasks' && segments.length === 1 && method === 'GET') {
      const conditions: string[] = ['t.active = true'];
      const values: unknown[] = [];
      let idx = 1;

      if (params.has('pillar')) {
        conditions.push(`t.pillar = $${idx++}`);
        values.push(params.get('pillar'));
      }
      if (params.has('p0')) {
        conditions.push(`t.is_p0 = $${idx++}`);
        values.push(params.get('p0') === 'true');
      }
      if (params.has('agent')) {
        conditions.push(`t.responsible_agent = $${idx++}`);
        values.push(params.get('agent'));
      }

      const rows = await systemQuery(`
        SELECT
          t.id, t.task_number, t.pillar, t.sub_category, t.task,
          t.acceptance_criteria, t.verification_method,
          t.responsible_agent, t.is_p0, t.created_by, t.created_at,
          ls.passed       AS latest_pass,
          ls.judge_score  AS latest_score,
          ls.judge_tier   AS latest_judge_tier,
          ls.completed_at AS latest_run_at
        FROM cz_tasks t
        LEFT JOIN cz_latest_scores ls ON ls.task_id = t.id
        WHERE ${conditions.join(' AND ')}
        ORDER BY t.task_number
      `, values);
      send(200, { tasks: rows });
      return true;
    }

    // ── GET /api/cz/tasks/:id ────────────────────────────────
    if (segments[0] === 'tasks' && segments.length === 2 && method === 'GET') {
      const taskId = segments[1];
      if (!isUuid(taskId)) { send(400, { error: 'Invalid task ID' }); return true; }

      const limit = Math.min(Number(params.get('scores') ?? 10), 50);
      const [taskRows, scoreRows] = await Promise.all([
        systemQuery('SELECT * FROM cz_tasks WHERE id = $1', [taskId]),
        systemQuery(`
          SELECT s.*, r.mode, r.trigger_type, r.started_at, r.surface
          FROM cz_scores s
          JOIN cz_runs r ON r.id = s.run_id
          WHERE r.task_id = $1
          ORDER BY s.created_at DESC
          LIMIT $2
        `, [taskId, limit]),
      ]);

      if (!taskRows.length) { send(404, { error: 'Task not found' }); return true; }
      send(200, { task: taskRows[0], scores: scoreRows });
      return true;
    }

    // ── POST /api/cz/tasks ───────────────────────────────────
    if (segments[0] === 'tasks' && segments.length === 1 && method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const { pillar, sub_category, task, acceptance_criteria, verification_method, responsible_agent, is_p0 } = body;

      if (!pillar || !task || !acceptance_criteria) {
        send(400, { error: 'pillar, task, and acceptance_criteria are required' });
        return true;
      }

      // Determine next task_number
      const maxRow = await systemQuery('SELECT COALESCE(MAX(task_number), 0) + 1 AS next FROM cz_tasks');
      const nextNum = maxRow[0].next;

      const rows = await systemQuery(`
        INSERT INTO cz_tasks (task_number, pillar, sub_category, task, acceptance_criteria, verification_method, responsible_agent, is_p0, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'dashboard')
        RETURNING *
      `, [nextNum, pillar, sub_category ?? null, task, acceptance_criteria, verification_method ?? null, responsible_agent ?? null, is_p0 ?? false]);

      send(201, { task: rows[0] });
      return true;
    }

    // ── PATCH /api/cz/tasks/:id ──────────────────────────────
    if (segments[0] === 'tasks' && segments.length === 2 && method === 'PATCH') {
      const taskId = segments[1];
      if (!isUuid(taskId)) { send(400, { error: 'Invalid task ID' }); return true; }

      const body = JSON.parse(await readBody(req));
      const sets: string[] = [];
      const values: unknown[] = [];
      let idx = 1;

      for (const col of ['pillar', 'sub_category', 'task', 'acceptance_criteria', 'verification_method', 'responsible_agent', 'is_p0', 'active'] as const) {
        if (col in body) {
          sets.push(`${col} = $${idx++}`);
          values.push(body[col]);
        }
      }

      if (!sets.length) { send(400, { error: 'No fields to update' }); return true; }
      values.push(taskId);

      const rows = await systemQuery(`
        UPDATE cz_tasks SET ${sets.join(', ')}, updated_at = NOW()
        WHERE id = $${idx}
        RETURNING *
      `, values);

      if (!rows.length) { send(404, { error: 'Task not found' }); return true; }
      send(200, { task: rows[0] });
      return true;
    }

    // ═══════════════════════════════════════════════════════════
    //  RUNS (batch-oriented: each cz_runs row = one task execution)
    // ═══════════════════════════════════════════════════════════

    // ── POST /api/cz/runs ────────────────────────────────────
    if (segments[0] === 'runs' && segments.length === 1 && method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const triggerType: string = body.mode ?? 'full';
      const validTriggers = ['single', 'pillar', 'critical', 'full', 'canary'];
      if (!validTriggers.includes(triggerType)) {
        send(400, { error: `Invalid mode. Must be one of: ${validTriggers.join(', ')}` });
        return true;
      }

      const surface: string = body.surface ?? 'direct';
      if (!isValidSurface(surface)) {
        send(400, { error: `Invalid surface. Must be one of: ${VALID_SURFACES.join(', ')}` });
        return true;
      }

      // Build task filter based on mode
      let taskFilter = '';
      const filterValues: unknown[] = [];
      if (triggerType === 'single') {
        if (!body.task_id) { send(400, { error: 'task_id required for single mode' }); return true; }
        taskFilter = 'AND t.id = $1';
        filterValues.push(body.task_id);
      } else if (triggerType === 'pillar') {
        if (!body.pillar) { send(400, { error: 'pillar required for pillar mode' }); return true; }
        taskFilter = 'AND t.pillar = $1';
        filterValues.push(body.pillar);
      } else if (triggerType === 'critical') {
        taskFilter = 'AND t.is_p0 = true';
      } else if (triggerType === 'canary') {
        if (!body.agent) { send(400, { error: 'agent required for canary mode' }); return true; }
        taskFilter = 'AND t.responsible_agent = $1';
        filterValues.push(body.agent);
      }

      // Fetch matching tasks
      const taskRows = await systemQuery(`
        SELECT t.id FROM cz_tasks t WHERE t.active = true ${taskFilter}
      `, filterValues);
      if (!taskRows.length) {
        send(400, { error: 'No matching tasks for this mode/filter' });
        return true;
      }

      // Create a batch: one cz_runs row per task, sharing a batch_id
      const batchId = (await systemQuery("SELECT gen_random_uuid() AS id"))[0].id;
      const mode = body.orchestrated ? 'orchestrated' : 'solo';
      const insertValues: unknown[] = [];
      const placeholders: string[] = [];
      let pi = 1;
      for (const task of taskRows) {
        placeholders.push(`($${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++})`);
        insertValues.push(batchId, task.id, mode, triggerType, body.triggered_by ?? 'dashboard', surface);
      }

      const runRows = await systemQuery(`
        INSERT INTO cz_runs (batch_id, task_id, mode, trigger_type, triggered_by, surface)
        VALUES ${placeholders.join(', ')}
        RETURNING *
      `, insertValues);

      broadcastCzRunEvent(batchId, 'run_started', {
        batch_id: batchId,
        trigger_type: triggerType,
        surface,
        task_count: runRows.length,
      });

      // Fire-and-forget: execute the batch asynchronously
      executeBatch(batchId, runRows.map((r: { id: string; task_id: string }) => ({ id: r.id, task_id: r.task_id })))
        .catch((err) => console.error('[CZ executor]', err instanceof Error ? err.message : err));

      send(201, {
        batch_id: batchId,
        trigger_type: triggerType,
        surface,
        task_count: runRows.length,
        runs: runRows,
      });
      return true;
    }

    // ── GET /api/cz/runs ─────────────────────────────────────
    if (segments[0] === 'runs' && segments.length === 1 && method === 'GET') {
      const limit = Math.min(Number(params.get('limit') ?? 20), 100);
      const offset = Math.max(Number(params.get('offset') ?? 0), 0);

      const conditions: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      if (params.has('surface')) {
        conditions.push(`r.surface = $${idx++}`);
        values.push(params.get('surface'));
      }
      const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      values.push(limit, offset);

      const rows = await systemQuery(`
        SELECT
          r.batch_id,
          r.trigger_type,
          r.surface,
          r.triggered_by,
          MIN(r.started_at)   AS started_at,
          MAX(r.completed_at) AS completed_at,
          COUNT(*)::int AS task_count,
          COUNT(*) FILTER (WHERE r.status = 'scored')::int AS scored,
          COUNT(*) FILTER (WHERE r.status = 'failed')::int AS failed,
          COUNT(*) FILTER (WHERE r.status IN ('queued','running'))::int AS pending,
          COUNT(*) FILTER (WHERE s.passed = true)::int AS passed_count,
          COUNT(*) FILTER (WHERE s.passed = false)::int AS failed_count,
          ROUND(AVG(s.judge_score)::numeric, 2) AS avg_judge_score,
          CASE
            WHEN COUNT(*) FILTER (WHERE r.status IN ('queued','running')) > 0 THEN 'running'
            WHEN COUNT(*) FILTER (WHERE r.status = 'failed') > 0 THEN 'partial'
            ELSE 'completed'
          END AS batch_status
        FROM cz_runs r
        LEFT JOIN cz_scores s ON s.run_id = r.id
        ${whereClause}
        GROUP BY r.batch_id, r.trigger_type, r.surface, r.triggered_by
        ORDER BY MIN(r.started_at) DESC NULLS LAST
        LIMIT $${idx++} OFFSET $${idx++}
      `, values);

      send(200, { runs: rows });
      return true;
    }

    // ── GET /api/cz/runs/:batchId ────────────────────────────
    if (segments[0] === 'runs' && segments.length === 2 && !segments[1]?.includes('stream') && method === 'GET') {
      const batchId = segments[1];
      if (!isUuid(batchId)) { send(400, { error: 'Invalid batch ID' }); return true; }

      const runRows = await systemQuery(`
        SELECT
          r.*,
          t.task_number, t.pillar, t.task, t.is_p0, t.responsible_agent,
          s.passed, s.judge_score, s.judge_tier, s.axis_scores, s.reasoning_trace,
          s.heuristic_failures, s.agent_output
        FROM cz_runs r
        JOIN cz_tasks t ON t.id = r.task_id
        LEFT JOIN cz_scores s ON s.run_id = r.id
        WHERE r.batch_id = $1
        ORDER BY t.task_number
      `, [batchId]);

      if (!runRows.length) { send(404, { error: 'Batch not found' }); return true; }

      const passedCount = runRows.filter((r: { passed: boolean | null }) => r.passed === true).length;
      const failedCount = runRows.filter((r: { passed: boolean | null }) => r.passed === false).length;
      const pending = runRows.filter((r: { status: string }) => r.status === 'queued' || r.status === 'running').length;

      send(200, {
        batch_id: batchId,
        trigger_type: runRows[0].trigger_type,
        surface: runRows[0].surface,
        runs: runRows,
        summary: { passed: passedCount, failed: failedCount, pending, total: runRows.length },
      });
      return true;
    }

    // ── GET /api/cz/runs/:batchId/stream — SSE ──────────────
    if (segments[0] === 'runs' && segments.length === 3 && segments[2] === 'stream' && method === 'GET') {
      const batchId = segments[1];
      if (!isUuid(batchId)) { send(400, { error: 'Invalid batch ID' }); return true; }

      const runRows = await systemQuery(
        'SELECT batch_id, status FROM cz_runs WHERE batch_id = $1 LIMIT 1',
        [batchId],
      );
      if (!runRows.length) { send(404, { error: 'Batch not found' }); return true; }

      const headers: Record<string, string> = {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        ...corsHeadersFor(req),
      };
      res.writeHead(200, headers);

      // Check if all runs in batch are terminal
      const pendingRows = await systemQuery(
        "SELECT COUNT(*)::int AS n FROM cz_runs WHERE batch_id = $1 AND status IN ('queued','running')",
        [batchId],
      );
      const batchDone = pendingRows[0].n === 0;
      const batchStatus = batchDone ? 'completed' : 'running';

      res.write(`event: connected\ndata: ${JSON.stringify({ batch_id: batchId, status: batchStatus })}\n\n`);

      if (batchDone) {
        res.write(`event: run_complete\ndata: ${JSON.stringify({ batch_id: batchId, status: 'completed' })}\n\n`);
        res.end();
        return true;
      }

      if (!sseClients.has(batchId)) sseClients.set(batchId, new Set());
      sseClients.get(batchId)!.add(res);

      req.on('close', () => {
        sseClients.get(batchId)?.delete(res);
        if (sseClients.get(batchId)?.size === 0) sseClients.delete(batchId);
      });

      return true;
    }

    // ═══════════════════════════════════════════════════════════
    //  SCORECARD
    // ═══════════════════════════════════════════════════════════

    // ── GET /api/cz/scorecard ────────────────────────────────
    if (segments[0] === 'scorecard' && method === 'GET') {
      const surfaceFilter = params.get('surface');
      const surfaceCondition = surfaceFilter ? 'AND r.surface = $1' : '';
      const surfaceValues = surfaceFilter ? [surfaceFilter] : [];

      const pillarRows = await systemQuery(`
        WITH latest_batch AS (
          SELECT batch_id FROM cz_runs r
          WHERE r.status = 'scored' ${surfaceCondition}
          GROUP BY batch_id
          ORDER BY MAX(r.completed_at) DESC
          LIMIT 1
        )
        SELECT
          t.pillar,
          pc.display_order,
          pc.pass_rate_threshold,
          pc.avg_score_threshold,
          pc.is_p0 AS pillar_is_p0,
          r.surface,
          COUNT(*)::int AS total_tasks,
          COUNT(*) FILTER (WHERE s.passed = true)::int AS passed,
          ROUND(AVG(s.judge_score)::numeric, 2) AS avg_score,
          ROUND(
            (COUNT(*) FILTER (WHERE s.passed = true)::float / NULLIF(COUNT(*), 0))::numeric,
            4
          ) AS pass_rate
        FROM cz_runs r
        JOIN latest_batch lb ON r.batch_id = lb.batch_id
        JOIN cz_tasks t ON t.id = r.task_id
        JOIN cz_scores s ON s.run_id = r.id
        LEFT JOIN cz_pillar_config pc ON pc.pillar = t.pillar
        WHERE t.active = true
        GROUP BY t.pillar, pc.display_order, pc.pass_rate_threshold, pc.avg_score_threshold, pc.is_p0, r.surface
        ORDER BY pc.display_order, r.surface
      `, surfaceValues);

      // Launch gates
      const gateRows = await systemQuery('SELECT * FROM cz_launch_gates ORDER BY display_order');

      // Evaluate gates against pillar data
      const gates = gateRows.map((gate: {
        gate: string;
        display_order: number;
        p0_must_be_100: boolean;
        overall_pass_rate_min: number;
        avg_judge_score_min: number | null;
        max_neg_orch_delta: number | null;
        description: string;
      }) => {
        const p0Pillars = pillarRows.filter((p: { pillar_is_p0: boolean }) => p.pillar_is_p0);
        const p0AllPass = p0Pillars.length > 0 && p0Pillars.every((p: { pass_rate: number }) => Number(p.pass_rate) >= 1.0);
        const overallPassRate = pillarRows.length
          ? pillarRows.reduce((sum: number, p: { passed: number }) => sum + p.passed, 0) /
            Math.max(pillarRows.reduce((sum: number, p: { total_tasks: number }) => sum + p.total_tasks, 0), 1)
          : 0;
        const avgScore = pillarRows.length
          ? pillarRows.reduce((sum: number, p: { avg_score: number | null }) => sum + (Number(p.avg_score) || 0), 0) / pillarRows.length
          : 0;

        const met = (!gate.p0_must_be_100 || p0AllPass)
          && overallPassRate >= Number(gate.overall_pass_rate_min)
          && (!gate.avg_judge_score_min || avgScore >= Number(gate.avg_judge_score_min));

        return {
          ...gate,
          met,
          current_p0_pass: p0AllPass,
          current_overall_pass_rate: Math.round(overallPassRate * 10000) / 10000,
          current_avg_score: Math.round(avgScore * 100) / 100,
        };
      });

      send(200, { pillars: pillarRows, gates, last_run: pillarRows.length ? 'from_latest_completed' : null });
      return true;
    }

    // ═══════════════════════════════════════════════════════════
    //  DRIFT CHART
    // ═══════════════════════════════════════════════════════════

    // ── GET /api/cz/drift ────────────────────────────────────
    if (segments[0] === 'drift' && method === 'GET') {
      const pillar = params.get('pillar');
      const surfaceFilter = params.get('surface');
      const days = Math.min(Number(params.get('days') ?? 30), 90);

      const conditions: string[] = ["r.status = 'scored'", `r.completed_at > NOW() - INTERVAL '${days} days'`];
      const values: unknown[] = [];
      let idx = 1;

      if (pillar) {
        conditions.push(`t.pillar = $${idx++}`);
        values.push(pillar);
      }
      if (surfaceFilter) {
        conditions.push(`r.surface = $${idx++}`);
        values.push(surfaceFilter);
      }

      const rows = await systemQuery(`
        SELECT
          r.batch_id,
          MAX(r.completed_at) AS completed_at,
          r.surface,
          t.pillar,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE s.passed = true)::int AS passed,
          ROUND(AVG(s.judge_score)::numeric, 2) AS avg_score,
          ROUND(
            (COUNT(*) FILTER (WHERE s.passed = true)::float / NULLIF(COUNT(*), 0))::numeric,
            4
          ) AS pass_rate
        FROM cz_runs r
        JOIN cz_scores s ON s.run_id = r.id
        JOIN cz_tasks t ON t.id = r.task_id
        WHERE ${conditions.join(' AND ')}
        GROUP BY r.batch_id, r.surface, t.pillar
        ORDER BY MAX(r.completed_at), t.pillar
      `, values);

      send(200, { series: rows, days, pillar: pillar ?? 'all', surface: surfaceFilter ?? 'all' });
      return true;
    }

    // No matching route under /api/cz/
    send(404, { error: 'CZ endpoint not found' });
    return true;

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[CZ API]', message);
    send(500, { error: message });
    return true;
  }
}
