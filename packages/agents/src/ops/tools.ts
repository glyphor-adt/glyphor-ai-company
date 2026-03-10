/**
 * Atlas Vega (Ops Agent) — Tool Definitions & Implementations
 *
 * Tools for: querying agent health, data sync status, cost trends,
 * retrying failed runs, pausing/resuming agents, managing incidents,
 * and posting system status reports.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { systemQuery } from '@glyphor/shared/db';
import {
  GraphTeamsClient,
  BotDmSender,
} from '@glyphor/integrations';

export function createOpsTools(memory: CompanyMemoryStore): ToolDefinition[] {
  // Initialize DM sender (Bot Framework proactive messaging —
  // Graph API app-only tokens cannot post chat messages)
  let dmClient: BotDmSender | null = null;
  try {
    const graphClient = GraphTeamsClient.fromEnv();
    dmClient = BotDmSender.fromEnv(graphClient);
  } catch {
    // Bot Framework not configured — DM tool will return error
  }

  return [
    // ─── QUERY TOOLS ────────────────────────────────────────────

    {
      name: 'query_agent_runs',
      description: 'Query agent run history. Returns recent runs with status, duration, cost, errors.',
      parameters: {
        agent_id: { type: 'string', description: 'Filter by agent ID (optional)', required: false },
        status: { type: 'string', description: 'Filter by status', required: false, enum: ['completed', 'failed', 'timeout', 'budget_exceeded'] },
        hours: { type: 'number', description: 'Look back N hours (default 24)', required: false },
        limit: { type: 'number', description: 'Max results (default 50)', required: false },
      },
      execute: async (params): Promise<ToolResult> => {
        const hours = (params.hours as number) || 24;
        const limit = (params.limit as number) || 50;
        const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

        const conditions: string[] = ['started_at >= $1'];
        const queryParams: unknown[] = [since];
        let paramIdx = 2;

        if (params.agent_id) {
          conditions.push(`agent_id = $${paramIdx++}`);
          queryParams.push(params.agent_id as string);
        }
        if (params.status) {
          conditions.push(`status = $${paramIdx++}`);
          queryParams.push(params.status as string);
        }

        queryParams.push(limit);
        const where = conditions.join(' AND ');
        const data = await systemQuery(
          `SELECT * FROM agent_runs WHERE ${where} ORDER BY started_at DESC LIMIT $${paramIdx}`,
          queryParams,
        );
        return { success: true, data };
      },
    },

    {
      name: 'query_agent_health',
      description: 'Get health summary for all agents: last run time, status, quality score trend, cost MTD.',
      parameters: {},
      execute: async (): Promise<ToolResult> => {
        const agents = await systemQuery(
          'SELECT id, role, display_name, status, last_run_at, total_runs, total_cost_usd, performance_score FROM company_agents',
        );

        const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const runs = await systemQuery(
          'SELECT agent_id, status, cost, started_at FROM agent_runs WHERE started_at >= $1 ORDER BY started_at DESC',
          [since24h],
        );

        const health = agents.map((agent: Record<string, unknown>) => {
          const agentRuns = runs.filter((r: Record<string, unknown>) => r.agent_id === agent.id || r.agent_id === agent.role);
          const failures = runs.filter((r: Record<string, unknown>) => {
            if (r.status !== 'failed') return false;
            // Exclude reaped/stalled runs — these are infrastructure timeouts, not real failures
            const err = (r.error as string) || '';
            if (err.includes('reaped') || err.includes('stalled')) return false;
            return true;
          });
          return {
            id: agent.id,
            role: agent.role,
            display_name: agent.display_name,
            status: agent.status,
            last_run_at: agent.last_run_at,
            total_runs: agent.total_runs,
            cost_mtd: agent.total_cost_usd,
            performance_score: agent.performance_score,
            runs_24h: agentRuns.length,
            failures_24h: failures.length,
            health: failures.length === 0 ? 'OK' : failures.length <= 2 ? 'WARN' : 'FAIL',
          };
        });

        return { success: true, data: health };
      },
    },

    {
      name: 'query_data_sync_status',
      description: 'Check when each data sync (Stripe, Mercury, GCP billing) last succeeded.',
      parameters: {},
      execute: async (): Promise<ToolResult> => {
        const data = await systemQuery('SELECT * FROM data_sync_status');
        return { success: true, data };
      },
    },

    {
      name: 'query_events_backlog',
      description: 'Check for unconsumed events that may indicate an agent is not processing its queue.',
      parameters: {
        hours: { type: 'number', description: 'Look back N hours (default 6)', required: false },
      },
      execute: async (params): Promise<ToolResult> => {
        const hours = (params.hours as number) || 6;
        const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

        const data = await systemQuery(
          'SELECT id, type, source, priority, timestamp, processed_by FROM events WHERE timestamp >= $1 ORDER BY timestamp DESC',
          [since],
        );

        const unprocessed = data.filter(
          (e: Record<string, unknown>) => !e.processed_by || (e.processed_by as string[]).length === 0,
        );

        return {
          success: true,
          data: {
            total_events: data.length,
            unprocessed_count: unprocessed.length,
            unprocessed: unprocessed.slice(0, 20),
          },
        };
      },
    },

    {
      name: 'query_cost_trends',
      description: 'Get agent cost trends to detect anomalies. Compares current period to rolling average.',
      parameters: {
        period: { type: 'string', description: 'Time period to analyze', required: false, enum: ['1h', '24h', '7d'] },
        agent_id: { type: 'string', description: 'Filter by agent (optional)', required: false },
      },
      execute: async (params): Promise<ToolResult> => {
        const period = (params.period as string) || '24h';
        const periodMs = period === '1h' ? 3600000 : period === '24h' ? 86400000 : 604800000;
        const since = new Date(Date.now() - periodMs).toISOString();

        const conditions: string[] = ['started_at >= $1', 'cost IS NOT NULL'];
        const queryParams: unknown[] = [since];
        let paramIdx = 2;

        if (params.agent_id) {
          conditions.push(`agent_id = $${paramIdx++}`);
          queryParams.push(params.agent_id as string);
        }

        const where = conditions.join(' AND ');
        const data = await systemQuery(
          `SELECT agent_id, cost, started_at FROM agent_runs WHERE ${where}`,
          queryParams,
        );

        // Group by agent
        const byAgent = new Map<string, number>();
        for (const run of data) {
          const cost = byAgent.get(run.agent_id as string) ?? 0;
          byAgent.set(run.agent_id as string, cost + (Number(run.cost) ?? 0));
        }

        const trends = Array.from(byAgent.entries()).map(([id, cost]) => ({
          agent_id: id,
          cost_in_period: parseFloat(cost.toFixed(4)),
          period,
        }));

        return { success: true, data: trends };
      },
    },

    // ─── ACTION TOOLS ───────────────────────────────────────────

    {
      name: 'trigger_agent_run',
      description: 'Manually wake an agent for an urgent reason. Use sparingly — only for high-priority events.',
      parameters: {
        agent_role: { type: 'string', description: 'The agent role ID (e.g., cpo, cmo)', required: true },
        reason: { type: 'string', description: 'Why this agent needs to wake now', required: true },
        task: { type: 'string', description: 'Specific task to assign', required: false },
      },
      execute: async (params): Promise<ToolResult> => {
        // Log the trigger request — the scheduler server will
        // handle the actual execution via the /run endpoint
        await systemQuery(
          'INSERT INTO activity_log (agent_role, agent_id, action, detail, created_at) VALUES ($1, $2, $3, $4, $5)',
          ['ops', 'ops', 'agent.triggered', `Atlas triggered ${params.agent_role}: ${params.reason}`, new Date().toISOString()],
        );

        return {
          success: true,
          data: {
            triggered: params.agent_role,
            task: params.task ?? 'on_demand',
            reason: params.reason,
            note: 'Agent trigger request logged. The scheduler will execute this.',
          },
        };
      },
    },

    {
      name: 'retry_failed_run',
      description: 'Re-execute a failed agent run. Will use same agent and task.',
      parameters: {
        run_id: { type: 'string', description: 'The failed run ID to retry', required: true },
      },
      execute: async (params): Promise<ToolResult> => {
        const rows = await systemQuery(
          'SELECT * FROM agent_runs WHERE id = $1',
          [params.run_id],
        );

        const run = rows[0];
        if (!run) return { success: false, error: 'Run not found' };
        if (run.status !== 'failed') return { success: false, error: `Run status is "${run.status}", not "failed"` };

        // Log retry attempt
        await systemQuery(
          'INSERT INTO activity_log (agent_role, agent_id, action, detail, created_at) VALUES ($1, $2, $3, $4, $5)',
          ['ops', 'ops', 'run.retried', `Atlas retrying run ${params.run_id} for agent ${run.agent_id}`, new Date().toISOString()],
        );

        return {
          success: true,
          data: {
            run_id: params.run_id,
            agent_id: run.agent_id,
            retried: true,
            note: 'Retry request logged. The scheduler will re-execute this agent.',
          },
        };
      },
    },

    {
      name: 'retry_data_sync',
      description: 'Re-trigger a data sync job (Stripe, Mercury, or GCP billing).',
      parameters: {
        sync_type: { type: 'string', description: 'Which sync to retry', required: true, enum: ['stripe', 'mercury', 'gcp-billing'] },
      },
      execute: async (params): Promise<ToolResult> => {
        const syncType = params.sync_type as string;

        await systemQuery(
          'INSERT INTO activity_log (agent_role, agent_id, action, detail, created_at) VALUES ($1, $2, $3, $4, $5)',
          ['ops', 'ops', 'sync.retried', `Atlas retrying ${syncType} data sync`, new Date().toISOString()],
        );

        return {
          success: true,
          data: {
            sync_type: syncType,
            retried: true,
            note: `${syncType} sync retry requested. The scheduler will re-execute.`,
          },
        };
      },
    },

    {
      name: 'pause_agent',
      description: 'Temporarily stop an agent from running. Only use after verifying 5+ failures in the last 24 hours AND no successful runs in between. Never pause chief-of-staff or ops agents.',
      parameters: {
        agent_id: { type: 'string', description: 'The agent ID to pause', required: true },
        reason: { type: 'string', description: 'Why this agent is being paused — must reference specific failure count and timeframe', required: true },
        failure_count: { type: 'number', description: 'Number of consecutive failures observed (must be >= 5)', required: true },
      },
      execute: async (params): Promise<ToolResult> => {
        const agentId = params.agent_id as string;
        const failureCount = (params.failure_count as number) || 0;

        // Guard: never pause critical infrastructure agents
        const PROTECTED_AGENTS = ['chief-of-staff', 'ops'];
        if (PROTECTED_AGENTS.includes(agentId)) {
          return { success: false, error: `Cannot pause protected agent "${agentId}". Escalate to founders instead.` };
        }

        // Guard: require minimum failure threshold
        if (failureCount < 5) {
          return { success: false, error: `Failure count ${failureCount} is below the minimum threshold of 5. Monitor and retry instead.` };
        }

        // Guard: cooldown — don't re-pause an agent that was resumed in the last 2 hours
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
        const recentResume = await systemQuery(
          'SELECT created_at FROM activity_log WHERE action = $1 AND created_at >= $2 LIMIT 1',
          ['agent.resumed', twoHoursAgo],
        );
        if (recentResume.length > 0) {
          return { success: false, error: `Agent "${agentId}" was resumed within the last 2 hours. Allow more time before re-pausing.` };
        }

        await systemQuery(
          'UPDATE company_agents SET status = $1 WHERE role = $2',
          ['paused', agentId],
        );

        await systemQuery(
          'INSERT INTO activity_log (agent_role, action, summary, tier, created_at) VALUES ($1, $2, $3, $4, $5)',
          ['ops', 'agent.paused', `Atlas paused ${params.agent_id}: ${params.reason}`, 'yellow', new Date().toISOString()],
        );

        return { success: true, data: { agent_id: params.agent_id, paused: true, reason: params.reason } };
      },
    },

    {
      name: 'resume_agent',
      description: 'Re-enable a paused agent.',
      parameters: {
        agent_id: { type: 'string', description: 'The agent ID to resume', required: true },
      },
      execute: async (params): Promise<ToolResult> => {
        await systemQuery(
          'UPDATE company_agents SET status = $1 WHERE role = $2',
          ['active', params.agent_id as string],
        );

        await systemQuery(
          'INSERT INTO activity_log (agent_role, action, summary, tier, created_at) VALUES ($1, $2, $3, $4, $5)',
          ['ops', 'agent.resumed', `Atlas resumed ${params.agent_id}`, 'green', new Date().toISOString()],
        );

        return { success: true, data: { agent_id: params.agent_id, resumed: true } };
      },
    },

    // ─── INCIDENT MANAGEMENT ────────────────────────────────────

    {
      name: 'create_incident',
      description: 'Log a system incident with severity and description.',
      parameters: {
        severity: { type: 'string', description: 'Incident severity', required: true, enum: ['low', 'medium', 'high', 'critical'] },
        title: { type: 'string', description: 'Short incident title', required: true },
        description: { type: 'string', description: 'Detailed description', required: true },
        affected_agents: { type: 'array', description: 'Agent IDs affected', required: false, items: { type: 'string', description: 'Agent ID' } },
      },
      execute: async (params): Promise<ToolResult> => {
        const rows = await systemQuery(
          'INSERT INTO incidents (severity, title, description, affected_agents, status, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
          [
            params.severity as string,
            params.title as string,
            params.description as string,
            (params.affected_agents as string[]) ?? [],
            'open',
            'atlas',
            new Date().toISOString(),
          ],
        );

        await systemQuery(
          'INSERT INTO activity_log (agent_id, action, detail, created_at) VALUES ($1, $2, $3, $4)',
          ['ops', 'incident.created', `[${params.severity}] ${params.title}`, new Date().toISOString()],
        );

        return { success: true, data: { incident_id: rows[0].id, severity: params.severity, title: params.title } };
      },
    },

    {
      name: 'resolve_incident',
      description: 'Close an incident with root cause and resolution.',
      parameters: {
        incident_id: { type: 'string', description: 'The incident ID to resolve', required: true },
        root_cause: { type: 'string', description: 'What caused the incident', required: true },
        resolution: { type: 'string', description: 'How it was resolved', required: true },
      },
      execute: async (params): Promise<ToolResult> => {
        await systemQuery(
          'UPDATE incidents SET status = $1, root_cause = $2, resolution = $3, resolved_at = $4 WHERE id = $5',
          ['resolved', params.root_cause as string, params.resolution as string, new Date().toISOString(), params.incident_id as string],
        );

        await systemQuery(
          'INSERT INTO activity_log (agent_id, action, detail, created_at) VALUES ($1, $2, $3, $4)',
          ['ops', 'incident.resolved', `Resolved: ${params.resolution}`, new Date().toISOString()],
        );

        return { success: true, data: { incident_id: params.incident_id, resolved: true } };
      },
    },

    // ─── SYSTEM STATUS ──────────────────────────────────────────

    {
      name: 'post_system_status',
      description: 'Write system status report. Sarah will include this in briefings.',
      parameters: {
        status: { type: 'string', description: 'Overall status', required: true, enum: ['healthy', 'degraded', 'critical'] },
        summary: { type: 'string', description: 'Brief status summary', required: true },
        details: { type: 'string', description: 'Detailed status information', required: false },
      },
      execute: async (params): Promise<ToolResult> => {
        // Gather current health data for the snapshot
        const agents = await systemQuery(
          'SELECT id, role, status, last_run_at, performance_score FROM company_agents',
        );

        const syncs = await systemQuery('SELECT * FROM data_sync_status');

        const statusRows = await systemQuery(
          'INSERT INTO system_status (status, summary, details, agent_health, data_freshness, cost_anomalies, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
          [
            params.status as string,
            params.summary as string,
            (params.details as string) ?? null,
            JSON.stringify(agents),
            JSON.stringify(syncs),
            JSON.stringify([]),
            new Date().toISOString(),
          ],
        );

        await systemQuery(
          'INSERT INTO activity_log (agent_id, action, detail, created_at) VALUES ($1, $2, $3, $4)',
          ['ops', 'system.status', `[${(params.status as string).toUpperCase()}] ${params.summary}`, new Date().toISOString()],
        );

        return {
          success: true,
          data: { status_id: statusRows[0].id, status: params.status, summary: params.summary },
          memoryKeysWritten: 1,
        };
      },
    },

    // ─── PERFORMANCE ROLLUP & GROWTH ────────────────────────────

    {
      name: 'rollup_agent_performance',
      description: 'Aggregate agent_runs into agent_performance daily rollups. Run once daily at 1 AM.',
      parameters: {
        date: { type: 'string', description: 'Date to roll up (YYYY-MM-DD). Defaults to yesterday.', required: false },
      },
      execute: async (params): Promise<ToolResult> => {
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
        const date = (params.date as string) || yesterday;
        const dayStart = `${date}T00:00:00.000Z`;
        const dayEnd = `${date}T23:59:59.999Z`;

        // Get all active agents
        const agents = await systemQuery(
          "SELECT role FROM company_agents WHERE status = 'active'",
        );

        if (!agents.length) return { success: true, data: { message: 'No active agents', date } };

        let rolledUp = 0;
        for (const agent of agents) {
          const runs = await systemQuery(
            'SELECT * FROM agent_runs WHERE agent_id = $1 AND started_at >= $2 AND started_at <= $3',
            [agent.role, dayStart, dayEnd],
          );

          if (!runs.length) continue;

          const totalRuns = runs.length;
          const successful = runs.filter((r: Record<string, unknown>) => r.status === 'completed').length;
          const failed = runs.filter((r: Record<string, unknown>) => r.status === 'failed').length;
          const costs = runs.map((r: Record<string, unknown>) => Number(r.cost) || 0);
          const durations = runs.filter((r: Record<string, unknown>) => r.duration_ms != null).map((r: Record<string, unknown>) => r.duration_ms as number);
          const toolCalls = runs.reduce((s: number, r: Record<string, unknown>) => s + ((r.tool_calls as number) ?? 0), 0);

          // Get quality scores from reflections for this day
          const reflections = await systemQuery(
            'SELECT quality_score FROM agent_reflections WHERE agent_role = $1 AND created_at >= $2 AND created_at <= $3',
            [agent.role, dayStart, dayEnd],
          );

          const scores = reflections.map((r: Record<string, unknown>) => r.quality_score).filter((s: unknown): s is number => s != null);

          // Get decisions and incidents
          const [{ count: decisionCount }] = await systemQuery<{ count: number }>(
            'SELECT COUNT(*)::int as count FROM decisions WHERE agent_role = $1 AND created_at >= $2 AND created_at <= $3',
            [agent.role, dayStart, dayEnd],
          );

          const [{ count: incidentsCreated }] = await systemQuery<{ count: number }>(
            'SELECT COUNT(*)::int as count FROM incidents WHERE created_by = $1 AND created_at >= $2 AND created_at <= $3',
            [agent.role, dayStart, dayEnd],
          );

          const [{ count: incidentsResolved }] = await systemQuery<{ count: number }>(
            'SELECT COUNT(*)::int as count FROM incidents WHERE created_by = $1 AND resolved_at IS NOT NULL AND resolved_at >= $2 AND resolved_at <= $3',
            [agent.role, dayStart, dayEnd],
          );

          await systemQuery(
            `INSERT INTO agent_performance (agent_id, date, total_runs, successful_runs, failed_runs, total_cost, avg_duration_ms, avg_quality_score, max_quality_score, min_quality_score, total_tool_calls, decisions_filed, incidents_created, incidents_resolved)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
             ON CONFLICT (agent_id, date) DO UPDATE SET
               total_runs = EXCLUDED.total_runs,
               successful_runs = EXCLUDED.successful_runs,
               failed_runs = EXCLUDED.failed_runs,
               total_cost = EXCLUDED.total_cost,
               avg_duration_ms = EXCLUDED.avg_duration_ms,
               avg_quality_score = EXCLUDED.avg_quality_score,
               max_quality_score = EXCLUDED.max_quality_score,
               min_quality_score = EXCLUDED.min_quality_score,
               total_tool_calls = EXCLUDED.total_tool_calls,
               decisions_filed = EXCLUDED.decisions_filed,
               incidents_created = EXCLUDED.incidents_created,
               incidents_resolved = EXCLUDED.incidents_resolved`,
            [
              agent.role,
              date,
              totalRuns,
              successful,
              failed,
              costs.reduce((a, b) => a + b, 0),
              durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
              scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
              scores.length ? Math.max(...scores) : null,
              scores.length ? Math.min(...scores) : null,
              toolCalls,
              decisionCount ?? 0,
              incidentsCreated ?? 0,
              incidentsResolved ?? 0,
            ],
          );

          rolledUp++;
        }

        return { success: true, data: { date, agents_rolled_up: rolledUp } };
      },
    },

    {
      name: 'refresh_performance_scores',
      description: 'Recompute the composite performance_score on company_agents from trailing 30-day data (success rate, reflection quality, assignment quality). Run after daily rollup.',
      parameters: {},
      execute: async (): Promise<ToolResult> => {
        const results = await systemQuery<{ agent_role: string; new_score: number | null }>(
          'SELECT * FROM compute_performance_scores()',
        );
        const updated = results.filter((r) => r.new_score != null);
        return {
          success: true,
          data: {
            agents_scored: updated.length,
            scores: Object.fromEntries(updated.map((r) => [r.agent_role, r.new_score])),
          },
        };
      },
    },

    {
      name: 'detect_milestones',
      description: 'Scan for notable achievements or incidents. Run after daily rollup.',
      parameters: {
        agent_id: { type: 'string', description: 'Check a specific agent (optional — checks all if omitted)', required: false },
      },
      execute: async (params): Promise<ToolResult> => {
        const filter = params.agent_id as string | undefined;

        const conditions: string[] = [];
        const queryParams: unknown[] = [];
        let paramIdx = 1;

        if (filter) {
          conditions.push(`agent_id = $${paramIdx++}`);
          queryParams.push(filter);
        }

        queryParams.push(60);
        const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
        const perfRows = await systemQuery(
          `SELECT agent_id, date, total_runs, successful_runs, failed_runs, avg_quality_score, total_cost FROM agent_performance ${where} ORDER BY date DESC LIMIT $${paramIdx}`,
          queryParams,
        );
        if (!perfRows.length) return { success: true, data: { milestones: [] } };

        // Group by agent
        const byAgent = new Map<string, typeof perfRows>();
        for (const row of perfRows) {
          const arr = byAgent.get(row.agent_id as string) ?? [];
          arr.push(row);
          byAgent.set(row.agent_id as string, arr);
        }

        const milestones: { agent_id: string; type: string; title: string; description: string }[] = [];

        for (const [agentId, rows] of byAgent) {
          if (rows.length < 2) continue;
          const latest = rows[0];
          const totalRuns = rows.reduce((s, r) => s + (r.total_runs as number), 0);

          // First: 100th run
          if (totalRuns >= 100) {
            const existing = await systemQuery(
              "SELECT id FROM agent_milestones WHERE agent_id = $1 AND title = '100 Runs Completed' LIMIT 1",
              [agentId],
            );
            if (!existing.length) {
              milestones.push({
                agent_id: agentId,
                type: 'achievement',
                title: '100 Runs Completed',
                description: `Reached ${totalRuns} total runs`,
              });
            }
          }

          // Perfect day (5+ runs, 0 failures)
          if ((latest.total_runs as number) >= 5 && latest.failed_runs === 0) {
            milestones.push({
              agent_id: agentId,
              type: 'achievement',
              title: 'Perfect Day',
              description: `${latest.total_runs} runs with zero failures on ${latest.date}`,
            });
          }

          // Quality spike (latest quality >= 90)
          if (latest.avg_quality_score != null && (latest.avg_quality_score as number) >= 90) {
            milestones.push({
              agent_id: agentId,
              type: 'achievement',
              title: 'Quality Spike',
              description: `Quality score hit ${Math.round(latest.avg_quality_score as number)} on ${latest.date}`,
            });
          }

          // High failure rate (> 50% failures, 3+ runs)
          if ((latest.total_runs as number) >= 3 && (latest.failed_runs as number) > (latest.total_runs as number) * 0.5) {
            milestones.push({
              agent_id: agentId,
              type: 'incident',
              title: 'High Failure Rate',
              description: `${latest.failed_runs}/${latest.total_runs} runs failed on ${latest.date}`,
            });
          }
        }

        // Write milestones
        for (const m of milestones) {
          await systemQuery(
            'INSERT INTO agent_milestones (agent_id, type, title, description, created_at) VALUES ($1, $2, $3, $4, $5)',
            [m.agent_id, m.type, m.title, m.description, new Date().toISOString()],
          );
        }

        return { success: true, data: { milestones_created: milestones.length, milestones } };
      },
    },

    {
      name: 'update_growth_areas',
      description: 'Compare current vs previous period performance to track growth dimensions. Run weekly.',
      parameters: {
        period_days: { type: 'number', description: 'Days per period to compare (default 7)', required: false },
      },
      execute: async (params): Promise<ToolResult> => {
        const periodDays = (params.period_days as number) || 7;
        const now = new Date();
        const currentStart = new Date(now.getTime() - periodDays * 86400000).toISOString().split('T')[0];
        const previousStart = new Date(now.getTime() - periodDays * 2 * 86400000).toISOString().split('T')[0];

        const agents = await systemQuery(
          "SELECT role FROM company_agents WHERE status = 'active'",
        );

        if (!agents.length) return { success: true, data: { message: 'No active agents' } };

        let updated = 0;

        for (const agent of agents) {
          // Current period
          const currentRows = await systemQuery(
            'SELECT avg_quality_score, total_runs, successful_runs, failed_runs, total_cost, avg_duration_ms FROM agent_performance WHERE agent_id = $1 AND date >= $2',
            [agent.role, currentStart],
          );

          // Previous period
          const prevRows = await systemQuery(
            'SELECT avg_quality_score, total_runs, successful_runs, failed_runs, total_cost, avg_duration_ms FROM agent_performance WHERE agent_id = $1 AND date >= $2 AND date < $3',
            [agent.role, previousStart, currentStart],
          );

          if (!currentRows.length || !prevRows.length) continue;

          const avg = (rows: typeof currentRows, key: string) => {
            const vals = rows.map((r) => Number((r as Record<string, unknown>)[key]) || 0);
            return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
          };

          const dimensions = [
            { dimension: 'quality', current: avg(currentRows, 'avg_quality_score'), previous: avg(prevRows, 'avg_quality_score') },
            { dimension: 'reliability', current: currentRows.reduce((s, r) => s + (r.successful_runs as number), 0) / Math.max(1, currentRows.reduce((s, r) => s + (r.total_runs as number), 0)), previous: prevRows.reduce((s, r) => s + (r.successful_runs as number), 0) / Math.max(1, prevRows.reduce((s, r) => s + (r.total_runs as number), 0)) },
            { dimension: 'efficiency', current: avg(currentRows, 'avg_duration_ms'), previous: avg(prevRows, 'avg_duration_ms') },
            { dimension: 'cost-efficiency', current: avg(currentRows, 'total_cost'), previous: avg(prevRows, 'total_cost') },
          ];

          for (const d of dimensions) {
            const threshold = 0.05; // 5% change needed to be "improving" or "declining"
            let direction: string;
            if (d.dimension === 'efficiency' || d.dimension === 'cost-efficiency') {
              // Lower is better for these
              direction = d.current < d.previous * (1 - threshold) ? 'improving'
                : d.current > d.previous * (1 + threshold) ? 'declining' : 'stable';
            } else {
              direction = d.current > d.previous * (1 + threshold) ? 'improving'
                : d.current < d.previous * (1 - threshold) ? 'declining' : 'stable';
            }

            await systemQuery(
              `INSERT INTO agent_growth (agent_id, dimension, direction, current_value, previous_value, period, evidence, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               ON CONFLICT (agent_id, dimension) DO UPDATE SET
                 direction = EXCLUDED.direction,
                 current_value = EXCLUDED.current_value,
                 previous_value = EXCLUDED.previous_value,
                 period = EXCLUDED.period,
                 evidence = EXCLUDED.evidence,
                 updated_at = EXCLUDED.updated_at`,
              [
                agent.role,
                d.dimension,
                direction,
                parseFloat(d.current.toFixed(4)),
                parseFloat(d.previous.toFixed(4)),
                `${periodDays}d`,
                `Current: ${d.current.toFixed(2)}, Previous: ${d.previous.toFixed(2)}`,
                new Date().toISOString(),
              ],
            );
          }

          updated++;
        }

        return { success: true, data: { agents_updated: updated } };
      },
    },

    // ─── DIRECT MESSAGES ────────────────────────────────────────

    {
      name: 'send_dm',
      description: 'Send a direct message to a founder via Teams 1:1 chat. GREEN for Atlas — use for critical system alerts, outage notifications, or urgent ops issues. Include image_url to show an image inline.',
      parameters: {
        recipient: {
          type: 'string',
          description: 'Founder to DM',
          required: true,
          enum: ['kristina', 'andrew'],
        },
        message: {
          type: 'string',
          description: 'Message content (supports markdown bold/italic)',
          required: true,
        },
        image_url: {
          type: 'string',
          description: 'Optional image URL to display inline in the message (e.g. from Pulse image generation)',
        },
      },
      execute: async (params): Promise<ToolResult> => {
        if (!dmClient) {
          return {
            success: false,
            error: 'DM client not configured. Set TEAMS_USER_KRISTINA_ID and/or TEAMS_USER_ANDREW_ID.',
          };
        }

        const recipient = params.recipient as 'kristina' | 'andrew';
        const imageUrl = params.image_url as string | undefined;

        if (imageUrl) {
          // Send as Adaptive Card with inline image
          await dmClient.sendCard(recipient, {
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            type: 'AdaptiveCard',
            version: '1.5',
            body: [
              { type: 'TextBlock', text: params.message as string, wrap: true },
              { type: 'Image', url: imageUrl, size: 'large', altText: 'Shared image' },
            ],
            actions: [
              { type: 'Action.OpenUrl', title: 'View Full Size', url: imageUrl },
            ],
          }, 'Atlas Vega');
        } else {
          await dmClient.sendText(recipient, params.message as string, 'Atlas Vega');
        }

        await systemQuery(
          'INSERT INTO activity_log (agent_id, action, detail, created_at) VALUES ($1, $2, $3, $4)',
          ['ops', 'dm.sent', `Atlas DM to ${recipient}: ${(params.message as string).slice(0, 100)}`, new Date().toISOString()],
        );

        return { success: true, data: { sent: true, recipient } };
      },
    },
  ];
}