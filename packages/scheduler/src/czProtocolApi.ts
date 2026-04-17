/**
 * Customer Zero Protocol API — /api/cz/* endpoints.
 *
 * Provides:
 *   GET    /api/cz/tasks           – List active tasks (filter: pillar, p0, agent)
 *   GET    /api/cz/tasks/:id       – Task detail + last N scores
 *   POST   /api/cz/tasks           – Create ad-hoc task
 *   PATCH  /api/cz/tasks/:id       – Update / deactivate a task
 *   POST   /api/cz/runs            – Kick off a run (modes: single/pillar/critical/full/canary)
 *   GET    /api/cz/runs            – List runs
 *   GET    /api/cz/runs/:id        – Run status + score
 *   GET    /api/cz/runs/:id/stream – SSE stream for live console
 *   GET    /api/cz/scorecard       – Aggregated pillar pass rates + launch-gate status
 *   GET    /api/cz/drift           – Time-series for drift chart
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { systemQuery } from '@glyphor/shared/db';
import { writeJson } from './httpJson.js';
import { corsHeadersFor } from './corsHeaders.js';

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

/* ── SSE active streams (run_id → Set<ServerResponse>) ──── */

const sseClients = new Map<string, Set<ServerResponse>>();

/** Broadcast an SSE event to all listeners for a run. */
export function broadcastCzRunEvent(runId: string, event: string, data: unknown): void {
  const clients = sseClients.get(runId);
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
          ls.latest_pass, ls.latest_score, ls.latest_judge_tier, ls.latest_run_at
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
          SELECT s.*, r.mode, r.trigger_type, r.started_at
          FROM cz_scores s
          JOIN cz_runs r ON r.id = s.run_id
          WHERE s.task_id = $1
          ORDER BY s.scored_at DESC
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
    //  RUNS
    // ═══════════════════════════════════════════════════════════

    // ── POST /api/cz/runs ────────────────────────────────────
    if (segments[0] === 'runs' && segments.length === 1 && method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const mode: string = body.mode ?? 'full';
      const validModes = ['single', 'pillar', 'critical', 'full', 'canary'];
      if (!validModes.includes(mode)) {
        send(400, { error: `Invalid mode. Must be one of: ${validModes.join(', ')}` });
        return true;
      }

      // Build task filter based on mode
      let taskFilter = '';
      const filterValues: unknown[] = [];
      if (mode === 'single') {
        if (!body.task_id) { send(400, { error: 'task_id required for single mode' }); return true; }
        taskFilter = 'AND t.id = $1';
        filterValues.push(body.task_id);
      } else if (mode === 'pillar') {
        if (!body.pillar) { send(400, { error: 'pillar required for pillar mode' }); return true; }
        taskFilter = 'AND t.pillar = $1';
        filterValues.push(body.pillar);
      } else if (mode === 'critical') {
        taskFilter = 'AND t.is_p0 = true';
      } else if (mode === 'canary') {
        if (!body.agent) { send(400, { error: 'agent required for canary mode' }); return true; }
        taskFilter = 'AND t.responsible_agent = $1';
        filterValues.push(body.agent);
      }
      // 'full' = no extra filter

      // Count matching tasks
      const countRows = await systemQuery(`
        SELECT COUNT(*)::int AS n FROM cz_tasks t WHERE t.active = true ${taskFilter}
      `, filterValues);
      const taskCount = countRows[0].n;
      if (taskCount === 0) {
        send(400, { error: 'No matching tasks for this mode/filter' });
        return true;
      }

      // Create the run
      const runRows = await systemQuery(`
        INSERT INTO cz_runs (mode, trigger_type, triggered_by, task_count)
        VALUES ($1, 'manual', 'dashboard', $2)
        RETURNING *
      `, [mode, taskCount]);

      const run = runRows[0];

      // In the real implementation, this would dispatch to the judge pipeline.
      // For now, store the run and let the pipeline pick it up asynchronously.
      // Emit initial SSE event
      broadcastCzRunEvent(run.id, 'run_started', {
        run_id: run.id,
        mode,
        task_count: taskCount,
        started_at: run.started_at,
      });

      send(201, { run });
      return true;
    }

    // ── GET /api/cz/runs ─────────────────────────────────────
    if (segments[0] === 'runs' && segments.length === 1 && method === 'GET') {
      const limit = Math.min(Number(params.get('limit') ?? 20), 100);
      const offset = Math.max(Number(params.get('offset') ?? 0), 0);

      const rows = await systemQuery(`
        SELECT
          r.*,
          (SELECT COUNT(*)::int FROM cz_scores s WHERE s.run_id = r.id AND s.pass = true) AS passed,
          (SELECT COUNT(*)::int FROM cz_scores s WHERE s.run_id = r.id AND s.pass = false) AS failed
        FROM cz_runs r
        ORDER BY r.started_at DESC
        LIMIT $1 OFFSET $2
      `, [limit, offset]);

      send(200, { runs: rows });
      return true;
    }

    // ── GET /api/cz/runs/:id ─────────────────────────────────
    if (segments[0] === 'runs' && segments.length === 2 && !segments[1]?.includes('stream') && method === 'GET') {
      const runId = segments[1];
      if (!isUuid(runId)) { send(400, { error: 'Invalid run ID' }); return true; }

      const [runRows, scoreRows] = await Promise.all([
        systemQuery('SELECT * FROM cz_runs WHERE id = $1', [runId]),
        systemQuery(`
          SELECT s.*, t.task_number, t.pillar, t.task, t.is_p0
          FROM cz_scores s
          JOIN cz_tasks t ON t.id = s.task_id
          WHERE s.run_id = $1
          ORDER BY t.task_number
        `, [runId]),
      ]);

      if (!runRows.length) { send(404, { error: 'Run not found' }); return true; }

      const run = runRows[0];
      const passed = scoreRows.filter((s: { pass: boolean }) => s.pass).length;
      const failed = scoreRows.filter((s: { pass: boolean }) => !s.pass).length;

      send(200, { run, scores: scoreRows, summary: { passed, failed, total: scoreRows.length } });
      return true;
    }

    // ── GET /api/cz/runs/:id/stream — SSE ────────────────────
    if (segments[0] === 'runs' && segments.length === 3 && segments[2] === 'stream' && method === 'GET') {
      const runId = segments[1];
      if (!isUuid(runId)) { send(400, { error: 'Invalid run ID' }); return true; }

      // Verify run exists
      const runRows = await systemQuery('SELECT id, status FROM cz_runs WHERE id = $1', [runId]);
      if (!runRows.length) { send(404, { error: 'Run not found' }); return true; }

      // Set up SSE
      const headers: Record<string, string> = {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        ...corsHeadersFor(req),
      };
      res.writeHead(200, headers);
      res.write(`event: connected\ndata: ${JSON.stringify({ run_id: runId, status: runRows[0].status })}\n\n`);

      // Register client
      if (!sseClients.has(runId)) sseClients.set(runId, new Set());
      sseClients.get(runId)!.add(res);

      // If run is already complete, send final event and close
      if (runRows[0].status === 'completed' || runRows[0].status === 'failed') {
        res.write(`event: run_complete\ndata: ${JSON.stringify({ run_id: runId, status: runRows[0].status })}\n\n`);
        res.end();
        sseClients.get(runId)?.delete(res);
        return true;
      }

      // Clean up on close
      req.on('close', () => {
        sseClients.get(runId)?.delete(res);
        if (sseClients.get(runId)?.size === 0) sseClients.delete(runId);
      });

      return true;
    }

    // ═══════════════════════════════════════════════════════════
    //  SCORECARD
    // ═══════════════════════════════════════════════════════════

    // ── GET /api/cz/scorecard ────────────────────────────────
    if (segments[0] === 'scorecard' && method === 'GET') {
      // Pillar pass rates from most recent run
      const pillarRows = await systemQuery(`
        WITH latest_run AS (
          SELECT id FROM cz_runs
          WHERE status = 'completed'
          ORDER BY completed_at DESC
          LIMIT 1
        )
        SELECT
          t.pillar,
          pc.display_order,
          pc.pass_rate_threshold,
          pc.avg_score_threshold,
          pc.is_p0 AS pillar_is_p0,
          COUNT(*)::int AS total_tasks,
          COUNT(*) FILTER (WHERE s.pass = true)::int AS passed,
          ROUND(AVG(s.judge_score)::numeric, 2) AS avg_score,
          ROUND(
            (COUNT(*) FILTER (WHERE s.pass = true)::float / NULLIF(COUNT(*), 0))::numeric,
            4
          ) AS pass_rate
        FROM cz_tasks t
        JOIN cz_scores s ON s.task_id = t.id
        JOIN latest_run lr ON s.run_id = lr.id
        LEFT JOIN cz_pillar_config pc ON pc.pillar = t.pillar
        WHERE t.active = true
        GROUP BY t.pillar, pc.display_order, pc.pass_rate_threshold, pc.avg_score_threshold, pc.is_p0
        ORDER BY pc.display_order
      `);

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
        const p0AllPass = p0Pillars.every((p: { pass_rate: number }) => Number(p.pass_rate) >= 1.0);
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
      const days = Math.min(Number(params.get('days') ?? 30), 90);

      const conditions: string[] = ['r.status = \'completed\'', `r.completed_at > NOW() - INTERVAL '${days} days'`];
      const values: unknown[] = [];
      let idx = 1;

      if (pillar) {
        conditions.push(`t.pillar = $${idx++}`);
        values.push(pillar);
      }

      const rows = await systemQuery(`
        SELECT
          r.id AS run_id,
          r.completed_at,
          r.mode,
          t.pillar,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE s.pass = true)::int AS passed,
          ROUND(AVG(s.judge_score)::numeric, 2) AS avg_score,
          ROUND(
            (COUNT(*) FILTER (WHERE s.pass = true)::float / NULLIF(COUNT(*), 0))::numeric,
            4
          ) AS pass_rate
        FROM cz_runs r
        JOIN cz_scores s ON s.run_id = r.id
        JOIN cz_tasks t ON t.id = s.task_id
        WHERE ${conditions.join(' AND ')}
        GROUP BY r.id, r.completed_at, r.mode, t.pillar
        ORDER BY r.completed_at, t.pillar
      `, values);

      send(200, { series: rows, days, pillar: pillar ?? 'all' });
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
