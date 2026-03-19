/**
 * Eval Dashboard API — dedicated endpoints for the Fleet monitoring dashboard.
 *
 * Provides /api/eval/* routes:
 *   GET  /api/eval/fleet                     – Fleet health grid data
 *   GET  /api/eval/agent/:agentId/trend      – Performance trend + prompt versions
 *   GET  /api/eval/agent/:agentId/shadow     – Shadow run results
 *   GET  /api/eval/agent/:agentId/findings   – Findings for a single agent
 *   GET  /api/eval/agent/:agentId/tool-accuracy – Tool accuracy scores + problem tools
 *   GET  /api/eval/world-state               – World state freshness
 *   GET  /api/eval/cost-latency              – Cost & latency per agent
 *   PATCH /api/eval/findings/:id/resolve     – Mark a finding resolved
 *   PATCH /api/eval/shadow/:id/discard       – Discard a shadow challenger
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { systemQuery } from '@glyphor/shared/db';

/* ── Helpers ──────────────────────────────────────────────── */

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

/* ── Route handler ────────────────────────────────────────── */

export async function handleEvalApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  _queryString: string,
  method: string,
): Promise<boolean> {
  if (!url.startsWith('/api/eval/')) return false;

  const path = url.slice('/api/eval/'.length); // e.g. "fleet", "agent/cto/trend", "findings/uuid/resolve"
  const segments = path.split('/');
  const params = new URLSearchParams(_queryString ?? '');

  try {
    // ── GET /api/eval/fleet ──────────────────────────────────
    if (segments[0] === 'fleet' && method === 'GET') {
      const rows = await systemQuery(`
        WITH eval_scores AS (
          SELECT
            wa.assigned_to AS agent_id,
            AVG(ae.score_normalized) FILTER (WHERE ae.evaluator_type = 'executive' AND ae.evaluated_at > NOW() - INTERVAL '30 days') AS exec_quality,
            AVG(ae.score_normalized) FILTER (WHERE ae.evaluator_type = 'team'      AND ae.evaluated_at > NOW() - INTERVAL '30 days') AS team_quality,
            AVG(ae.score_normalized) FILTER (WHERE ae.evaluator_type = 'cos'       AND ae.evaluated_at > NOW() - INTERVAL '30 days') AS cos_quality,
            AVG(ae.score_normalized) FILTER (WHERE ae.evaluator_type = 'constitutional' AND ae.evaluated_at > NOW() - INTERVAL '30 days') AS constitutional_score
          FROM work_assignments wa
          JOIN assignment_evaluations ae ON ae.assignment_id = wa.id
          GROUP BY wa.assigned_to
        ),
        run_stats AS (
          SELECT
            agent_id,
            AVG(CASE WHEN status = 'completed' THEN 1.0 ELSE 0.0 END)
              FILTER (WHERE created_at > NOW() - INTERVAL '30 days') AS success_rate,
            MAX(created_at) AS last_run_at
          FROM agent_runs
          GROUP BY agent_id
        ),
        finding_counts AS (
          SELECT
            agent_id,
            COUNT(*) FILTER (WHERE severity = 'P0' AND resolved_at IS NULL) AS open_p0s,
            COUNT(*) FILTER (WHERE severity = 'P1' AND resolved_at IS NULL) AS open_p1s
          FROM fleet_findings
          GROUP BY agent_id
        ),
        prompt_info AS (
          SELECT DISTINCT ON (agent_id)
            agent_id, version AS prompt_version, source AS prompt_source
          FROM agent_prompt_versions
          WHERE deployed_at IS NOT NULL AND retired_at IS NULL
          ORDER BY agent_id, deployed_at DESC
        ),
        mutation_counts AS (
          SELECT
            agent_id,
            COUNT(*) FILTER (WHERE source = 'reflection')      AS reflection_mutations,
            COUNT(*) FILTER (WHERE source = 'shadow_promoted')  AS promoted_mutations
          FROM agent_prompt_versions
          GROUP BY agent_id
        )
        SELECT
          a.id,
          a.role,
          a.display_name AS name,
          a.department,
          a.performance_score,
          pi.prompt_version,
          pi.prompt_source,
          es.exec_quality,
          es.team_quality,
          es.cos_quality,
          es.constitutional_score,
          rs.success_rate,
          COALESCE(fc.open_p0s, 0)  AS open_p0s,
          COALESCE(fc.open_p1s, 0)  AS open_p1s,
          COALESCE(mc.reflection_mutations, 0) AS reflection_mutations,
          COALESCE(mc.promoted_mutations, 0)   AS promoted_mutations,
          rs.last_run_at
        FROM company_agents a
        LEFT JOIN eval_scores es     ON es.agent_id = a.role
        LEFT JOIN run_stats rs       ON rs.agent_id = a.role
        LEFT JOIN finding_counts fc  ON fc.agent_id = a.role
        LEFT JOIN prompt_info pi     ON pi.agent_id = a.role
        LEFT JOIN mutation_counts mc ON mc.agent_id = a.role
        ORDER BY a.performance_score ASC NULLS LAST
      `);
      json(res, 200, rows);
      return true;
    }

    // ── GET /api/eval/agent/:agentId/trend ───────────────────
    if (segments[0] === 'agent' && segments[2] === 'trend' && method === 'GET') {
      const agentId = decodeURIComponent(segments[1]);
      const days = Math.min(Math.max(parseInt(params.get('days') ?? '30', 10) || 30, 1), 365);

      const [trend, promptVersions] = await Promise.all([
        systemQuery(`
          SELECT
            DATE_TRUNC('day', tro.created_at) AS day,
            AVG(ae.score_normalized) AS avg_quality,
            AVG(CASE WHEN ar.status = 'completed' THEN 1.0 ELSE 0.0 END) AS success_rate,
            COUNT(tro.id) AS run_count
          FROM task_run_outcomes tro
          JOIN agent_runs ar ON ar.id = tro.run_id
          LEFT JOIN assignment_evaluations ae ON ae.run_id = tro.run_id
          WHERE ar.agent_id = $1
            AND tro.created_at > NOW() - MAKE_INTERVAL(days => $2)
          GROUP BY day
          ORDER BY day ASC
        `, [agentId, days]),
        systemQuery(`
          SELECT version, deployed_at, source, change_summary, performance_score_at_deploy
          FROM agent_prompt_versions
          WHERE agent_id = $1 AND deployed_at IS NOT NULL
          ORDER BY deployed_at ASC
        `, [agentId]),
      ]);

      json(res, 200, { trend, promptVersions });
      return true;
    }

    // ── GET /api/eval/agent/:agentId/shadow ──────────────────
    if (segments[0] === 'agent' && segments[2] === 'shadow' && method === 'GET') {
      const agentId = decodeURIComponent(segments[1]);
      const rows = await systemQuery(`
        SELECT
          challenger_prompt_version,
          baseline_prompt_version,
          COUNT(*)                                      AS run_count,
          AVG(challenger_score)                          AS avg_challenger,
          AVG(baseline_score)                            AS avg_baseline,
          AVG(challenger_score) - AVG(baseline_score)    AS delta,
          MIN(created_at)                                AS first_run,
          MAX(created_at)                                AS last_run
        FROM shadow_runs
        WHERE agent_id = $1
        GROUP BY challenger_prompt_version, baseline_prompt_version
        ORDER BY last_run DESC
      `, [agentId]);
      json(res, 200, rows);
      return true;
    }

    // ── GET /api/eval/agent/:agentId/findings ────────────────
    if (segments[0] === 'agent' && segments[2] === 'findings' && method === 'GET') {
      const agentId = decodeURIComponent(segments[1]);
      const rows = await systemQuery(`
        SELECT
          id, severity, finding_type, description, detected_at, resolved_at,
          EXTRACT(EPOCH FROM (NOW() - detected_at)) / 86400 AS days_open
        FROM fleet_findings
        WHERE agent_id = $1
        ORDER BY resolved_at IS NULL DESC, severity ASC, detected_at DESC
      `, [agentId]);
      json(res, 200, rows);
      return true;
    }

    // ── GET /api/eval/world-state ────────────────────────────
    if (segments[0] === 'world-state' && method === 'GET') {
      const rows = await systemQuery<{
        freshness: string;
        [k: string]: unknown;
      }>(`
        SELECT
          id, domain, key, entity_id, written_by_agent, confidence,
          updated_at, valid_until,
          EXTRACT(EPOCH FROM (NOW() - updated_at)) / 3600 AS age_hours,
          CASE
            WHEN valid_until IS NOT NULL AND valid_until < NOW() THEN 'expired'
            WHEN domain = 'customer'     AND updated_at < NOW() - INTERVAL '24 hours'  THEN 'stale'
            WHEN domain = 'campaign'     AND updated_at < NOW() - INTERVAL '6 hours'   THEN 'stale'
            WHEN domain = 'strategy'     AND updated_at < NOW() - INTERVAL '7 days'    THEN 'stale'
            WHEN domain = 'agent_output' AND updated_at < NOW() - INTERVAL '48 hours'  THEN 'stale'
            ELSE 'fresh'
          END AS freshness
        FROM world_state
        ORDER BY age_hours DESC
      `);

      const summary = {
        total: rows.length,
        fresh: rows.filter(r => r.freshness === 'fresh').length,
        stale: rows.filter(r => r.freshness === 'stale').length,
        expired: rows.filter(r => r.freshness === 'expired').length,
      };

      json(res, 200, { summary, entries: rows });
      return true;
    }

    // ── GET /api/eval/cost-latency ───────────────────────────
    if (segments[0] === 'cost-latency' && method === 'GET') {
      const rows = await systemQuery(`
        SELECT
          agent_id,
          AVG(input_tokens + output_tokens + COALESCE(thinking_tokens, 0)) AS avg_tokens,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_latency_ms,
          AVG(duration_ms)            AS avg_latency_ms,
          AVG(estimated_cost_usd)     AS avg_cost_usd,
          COUNT(*)                    AS run_count
        FROM agent_runs
        WHERE created_at > NOW() - INTERVAL '30 days'
          AND input_tokens IS NOT NULL
        GROUP BY agent_id
        ORDER BY avg_cost_usd DESC NULLS LAST
      `);
      json(res, 200, rows.length > 0 ? rows : null);
      return true;
    }

    // ── PATCH /api/eval/findings/:id/resolve ─────────────────
    if (segments[0] === 'findings' && segments[2] === 'resolve' && method === 'PATCH') {
      const findingId = segments[1];
      const updated = await systemQuery(
        `UPDATE fleet_findings SET resolved_at = NOW() WHERE id = $1 AND resolved_at IS NULL RETURNING id`,
        [findingId],
      );
      if (updated.length === 0) {
        json(res, 404, { error: 'Finding not found or already resolved' });
      } else {
        json(res, 200, { ok: true, id: updated[0] });
      }
      return true;
    }

    // ── PATCH /api/eval/shadow/:id/discard ───────────────────
    if (segments[0] === 'shadow' && segments[2] === 'discard' && method === 'PATCH') {
      const shadowId = segments[1];
      const updated = await systemQuery(
        `UPDATE shadow_runs SET status = 'discarded' WHERE id = $1 AND status = 'pending' RETURNING id`,
        [shadowId],
      );
      if (updated.length === 0) {
        json(res, 404, { error: 'Shadow run not found or not pending' });
      } else {
        json(res, 200, { ok: true, id: updated[0] });
      }
      return true;
    }

    // ── GET /api/eval/agent/:agentId/tool-accuracy ────────────
    if (segments[0] === 'agent' && segments[2] === 'tool-accuracy' && method === 'GET') {
      const agentId = decodeURIComponent(segments[1]);

      const [scoreData, problemTools, retrievalData, riskTools] = await Promise.all([
        // Average tool accuracy score (last 30 days)
        systemQuery<{ avg_score: number | null; eval_count: number }>(
          `SELECT AVG(ae.score_normalized) AS avg_score, COUNT(*)::int AS eval_count
           FROM assignment_evaluations ae
           JOIN work_assignments wa ON wa.id = ae.assignment_id
           WHERE wa.assigned_to = $1 AND ae.evaluator_type = 'tool_accuracy'
             AND ae.evaluated_at > NOW() - INTERVAL '30 days'`,
          [agentId],
        ),

        // Problem tools from feedback JSON
        systemQuery<{ tool_name: string; repeated_failures: number; redundant_calls: number }>(
          `SELECT
            tool_name,
            SUM(repeated_failures_count)::int AS repeated_failures,
            SUM(redundant_calls_count)::int   AS redundant_calls
           FROM (
             SELECT
               jsonb_array_elements_text(ae.feedback::jsonb->'repeated_failures') AS tool_name,
               1 AS repeated_failures_count, 0 AS redundant_calls_count
             FROM assignment_evaluations ae
             JOIN work_assignments wa ON wa.id = ae.assignment_id
             WHERE wa.assigned_to = $1 AND ae.evaluator_type = 'tool_accuracy'
               AND ae.evaluated_at > NOW() - INTERVAL '30 days'
             UNION ALL
             SELECT
               jsonb_array_elements_text(ae.feedback::jsonb->'redundant_calls'),
               0, 1
             FROM assignment_evaluations ae
             JOIN work_assignments wa ON wa.id = ae.assignment_id
             WHERE wa.assigned_to = $1 AND ae.evaluator_type = 'tool_accuracy'
               AND ae.evaluated_at > NOW() - INTERVAL '30 days'
           ) t
           GROUP BY tool_name
           ORDER BY (SUM(repeated_failures_count) + SUM(redundant_calls_count)) DESC
           LIMIT 5`,
          [agentId],
        ),

        // Retrieval method breakdown
        systemQuery<{ pinned_pct: number | null; semantic_pct: number | null }>(
          `SELECT
            ROUND(100.0 * COUNT(*) FILTER (WHERE retrieval_method IN ('role_pin','core_pin','dept_pin'))
              / NULLIF(COUNT(*), 0))::int AS pinned_pct,
            ROUND(100.0 * COUNT(*) FILTER (WHERE retrieval_method = 'semantic')
              / NULLIF(COUNT(*), 0))::int AS semantic_pct
           FROM tool_call_traces
           WHERE agent_id = $1
             AND called_at > NOW() - INTERVAL '30 days'`,
          [agentId],
        ),

        // Agent-specific tool risk from cross-signal view
        systemQuery<{ tool_name: string; fleet_risk: string; agent_underperforming_vs_fleet: boolean; call_count: number; agent_success_rate: number; fleet_success_rate: number | null }>(
          `SELECT tool_name, fleet_risk, agent_underperforming_vs_fleet, call_count,
                  ROUND(agent_success_rate::numeric, 2) AS agent_success_rate,
                  ROUND(fleet_success_rate::numeric, 2) AS fleet_success_rate
           FROM agent_tool_risk
           WHERE agent_id = $1
             AND (fleet_risk IN ('high', 'medium') OR agent_underperforming_vs_fleet = true)
           ORDER BY
             agent_underperforming_vs_fleet DESC,
             CASE fleet_risk WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
             call_count DESC
           LIMIT 5`,
          [agentId],
        ),
      ]);

      json(res, 200, {
        avg_score: scoreData[0]?.avg_score ?? null,
        eval_count: scoreData[0]?.eval_count ?? 0,
        problem_tools: problemTools,
        retrieval_breakdown: retrievalData[0] ?? null,
        risk_tools: riskTools,
      });
      return true;
    }

    // No match within /api/eval/*
    json(res, 404, { error: `Unknown eval endpoint: ${path}` });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[EvalDashboard] Error handling ${method} /api/eval/${path}:`, message);
    json(res, 500, { error: message });
    return true;
  }
}
