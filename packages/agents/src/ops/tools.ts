/**
 * Atlas Vega (Ops Agent) — Tool Definitions & Implementations
 *
 * Tools for: querying agent health, data sync status, cost trends,
 * retrying failed runs, pausing/resuming agents, managing incidents,
 * and posting system status reports.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';

export function createOpsTools(memory: CompanyMemoryStore): ToolDefinition[] {
  const supabase = memory.getSupabaseClient();

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

        let query = supabase
          .from('agent_runs')
          .select('*')
          .gte('started_at', since)
          .order('started_at', { ascending: false })
          .limit(limit);

        if (params.agent_id) query = query.eq('agent_id', params.agent_id as string);
        if (params.status) query = query.eq('status', params.status as string);

        const { data, error } = await query;
        if (error) return { success: false, error: error.message };
        return { success: true, data };
      },
    },

    {
      name: 'query_agent_health',
      description: 'Get health summary for all agents: last run time, status, quality score trend, cost MTD.',
      parameters: {},
      execute: async (): Promise<ToolResult> => {
        const { data: agents, error: agErr } = await supabase
          .from('company_agents')
          .select('id, role, codename, status, last_run_at, total_runs, total_cost_usd, performance_score');

        if (agErr) return { success: false, error: agErr.message };

        const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data: recentRuns } = await supabase
          .from('agent_runs')
          .select('agent_id, status, cost, started_at')
          .gte('started_at', since24h)
          .order('started_at', { ascending: false });

        const runs = recentRuns ?? [];
        const health = (agents ?? []).map((agent) => {
          const agentRuns = runs.filter((r) => r.agent_id === agent.id || r.agent_id === agent.role);
          const failures = agentRuns.filter((r) => r.status === 'failed');
          return {
            id: agent.id,
            role: agent.role,
            codename: agent.codename,
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
        const { data, error } = await supabase
          .from('data_sync_status')
          .select('*');

        if (error) return { success: false, error: error.message };
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

        const { data, error } = await supabase
          .from('events')
          .select('id, type, source, priority, timestamp, processed_by')
          .gte('timestamp', since)
          .order('timestamp', { ascending: false });

        if (error) return { success: false, error: error.message };

        const unprocessed = (data ?? []).filter(
          (e) => !e.processed_by || (e.processed_by as string[]).length === 0,
        );

        return {
          success: true,
          data: {
            total_events: (data ?? []).length,
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

        let query = supabase
          .from('agent_runs')
          .select('agent_id, cost, started_at')
          .gte('started_at', since)
          .not('cost', 'is', null);

        if (params.agent_id) query = query.eq('agent_id', params.agent_id as string);

        const { data, error } = await query;
        if (error) return { success: false, error: error.message };

        // Group by agent
        const byAgent = new Map<string, number>();
        for (const run of data ?? []) {
          const cost = byAgent.get(run.agent_id) ?? 0;
          byAgent.set(run.agent_id, cost + (run.cost ?? 0));
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
        await supabase.from('activity_log').insert({
          agent_id: 'ops',
          action: 'agent.triggered',
          detail: `Atlas triggered ${params.agent_role}: ${params.reason}`,
          created_at: new Date().toISOString(),
        });

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
        const { data: run, error } = await supabase
          .from('agent_runs')
          .select('*')
          .eq('id', params.run_id)
          .single();

        if (error || !run) return { success: false, error: error?.message ?? 'Run not found' };
        if (run.status !== 'failed') return { success: false, error: `Run status is "${run.status}", not "failed"` };

        // Log retry attempt
        await supabase.from('activity_log').insert({
          agent_id: 'ops',
          action: 'run.retried',
          detail: `Atlas retrying run ${params.run_id} for agent ${run.agent_id}`,
          created_at: new Date().toISOString(),
        });

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

        await supabase.from('activity_log').insert({
          agent_id: 'ops',
          action: 'sync.retried',
          detail: `Atlas retrying ${syncType} data sync`,
          created_at: new Date().toISOString(),
        });

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
      description: 'Temporarily stop an agent from running. Use when agent is repeatedly failing.',
      parameters: {
        agent_id: { type: 'string', description: 'The agent ID to pause', required: true },
        reason: { type: 'string', description: 'Why this agent is being paused', required: true },
      },
      execute: async (params): Promise<ToolResult> => {
        const { error } = await supabase
          .from('company_agents')
          .update({ status: 'paused' })
          .eq('role', params.agent_id as string);

        if (error) return { success: false, error: error.message };

        await supabase.from('activity_log').insert({
          agent_id: 'ops',
          action: 'agent.paused',
          detail: `Atlas paused ${params.agent_id}: ${params.reason}`,
          created_at: new Date().toISOString(),
        });

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
        const { error } = await supabase
          .from('company_agents')
          .update({ status: 'active' })
          .eq('role', params.agent_id as string);

        if (error) return { success: false, error: error.message };

        await supabase.from('activity_log').insert({
          agent_id: 'ops',
          action: 'agent.resumed',
          detail: `Atlas resumed ${params.agent_id}`,
          created_at: new Date().toISOString(),
        });

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
        const { data, error } = await supabase
          .from('incidents')
          .insert({
            severity: params.severity as string,
            title: params.title as string,
            description: params.description as string,
            affected_agents: (params.affected_agents as string[]) ?? [],
            status: 'open',
            created_by: 'atlas',
            created_at: new Date().toISOString(),
          })
          .select('id')
          .single();

        if (error) return { success: false, error: error.message };

        await supabase.from('activity_log').insert({
          agent_id: 'ops',
          action: 'incident.created',
          detail: `[${params.severity}] ${params.title}`,
          created_at: new Date().toISOString(),
        });

        return { success: true, data: { incident_id: data.id, severity: params.severity, title: params.title } };
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
        const { error } = await supabase
          .from('incidents')
          .update({
            status: 'resolved',
            root_cause: params.root_cause as string,
            resolution: params.resolution as string,
            resolved_at: new Date().toISOString(),
          })
          .eq('id', params.incident_id as string);

        if (error) return { success: false, error: error.message };

        await supabase.from('activity_log').insert({
          agent_id: 'ops',
          action: 'incident.resolved',
          detail: `Resolved: ${params.resolution}`,
          created_at: new Date().toISOString(),
        });

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
        const { data: agents } = await supabase
          .from('company_agents')
          .select('id, role, status, last_run_at, performance_score');

        const { data: syncs } = await supabase
          .from('data_sync_status')
          .select('*');

        const { data: statusRow, error } = await supabase
          .from('system_status')
          .insert({
            status: params.status as string,
            summary: params.summary as string,
            details: (params.details as string) ?? null,
            agent_health: agents ?? [],
            data_freshness: syncs ?? [],
            cost_anomalies: [],
            created_at: new Date().toISOString(),
          })
          .select('id')
          .single();

        if (error) return { success: false, error: error.message };

        await supabase.from('activity_log').insert({
          agent_id: 'ops',
          action: 'system.status',
          detail: `[${(params.status as string).toUpperCase()}] ${params.summary}`,
          created_at: new Date().toISOString(),
        });

        return {
          success: true,
          data: { status_id: statusRow.id, status: params.status, summary: params.summary },
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
        const { data: agents } = await supabase
          .from('company_agents')
          .select('role')
          .eq('status', 'active');

        if (!agents?.length) return { success: true, data: { message: 'No active agents', date } };

        let rolledUp = 0;
        for (const agent of agents) {
          const { data: runs } = await supabase
            .from('agent_runs')
            .select('*')
            .eq('agent_id', agent.role)
            .gte('started_at', dayStart)
            .lte('started_at', dayEnd);

          if (!runs?.length) continue;

          const totalRuns = runs.length;
          const successful = runs.filter((r) => r.status === 'completed').length;
          const failed = runs.filter((r) => r.status === 'failed').length;
          const costs = runs.map((r) => Number(r.cost) || 0);
          const durations = runs.filter((r) => r.duration_ms != null).map((r) => r.duration_ms as number);
          const toolCalls = runs.reduce((s, r) => s + (r.tool_calls ?? 0), 0);

          // Get quality scores from reflections for this day
          const { data: reflections } = await supabase
            .from('agent_reflections')
            .select('quality_score')
            .eq('agent_role', agent.role)
            .gte('created_at', dayStart)
            .lte('created_at', dayEnd);

          const scores = (reflections ?? []).map((r) => r.quality_score).filter((s): s is number => s != null);

          // Get decisions and incidents
          const { count: decisionCount } = await supabase
            .from('decisions')
            .select('id', { count: 'exact', head: true })
            .eq('agent_role', agent.role)
            .gte('created_at', dayStart)
            .lte('created_at', dayEnd);

          const { count: incidentsCreated } = await supabase
            .from('incidents')
            .select('id', { count: 'exact', head: true })
            .eq('created_by', agent.role)
            .gte('created_at', dayStart)
            .lte('created_at', dayEnd);

          const { count: incidentsResolved } = await supabase
            .from('incidents')
            .select('id', { count: 'exact', head: true })
            .eq('created_by', agent.role)
            .not('resolved_at', 'is', null)
            .gte('resolved_at', dayStart)
            .lte('resolved_at', dayEnd);

          await supabase.from('agent_performance').upsert({
            agent_id: agent.role,
            date,
            total_runs: totalRuns,
            successful_runs: successful,
            failed_runs: failed,
            total_cost: costs.reduce((a, b) => a + b, 0),
            avg_duration_ms: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
            avg_quality_score: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
            max_quality_score: scores.length ? Math.max(...scores) : null,
            min_quality_score: scores.length ? Math.min(...scores) : null,
            total_tool_calls: toolCalls,
            decisions_filed: decisionCount ?? 0,
            incidents_created: incidentsCreated ?? 0,
            incidents_resolved: incidentsResolved ?? 0,
          }, { onConflict: 'agent_id,date' });

          rolledUp++;
        }

        return { success: true, data: { date, agents_rolled_up: rolledUp } };
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

        let query = supabase
          .from('agent_performance')
          .select('agent_id, date, total_runs, successful_runs, failed_runs, avg_quality_score, total_cost')
          .order('date', { ascending: false })
          .limit(60);

        if (filter) query = query.eq('agent_id', filter);

        const { data: perfRows } = await query;
        if (!perfRows?.length) return { success: true, data: { milestones: [] } };

        // Group by agent
        const byAgent = new Map<string, typeof perfRows>();
        for (const row of perfRows) {
          const arr = byAgent.get(row.agent_id) ?? [];
          arr.push(row);
          byAgent.set(row.agent_id, arr);
        }

        const milestones: { agent_id: string; type: string; title: string; description: string }[] = [];

        for (const [agentId, rows] of byAgent) {
          if (rows.length < 2) continue;
          const latest = rows[0];
          const totalRuns = rows.reduce((s, r) => s + r.total_runs, 0);

          // First: 100th run
          if (totalRuns >= 100) {
            const { data: existing } = await supabase
              .from('agent_milestones')
              .select('id')
              .eq('agent_id', agentId)
              .eq('title', '100 Runs Completed')
              .limit(1);
            if (!existing?.length) {
              milestones.push({
                agent_id: agentId,
                type: 'achievement',
                title: '100 Runs Completed',
                description: `Reached ${totalRuns} total runs`,
              });
            }
          }

          // Perfect day (5+ runs, 0 failures)
          if (latest.total_runs >= 5 && latest.failed_runs === 0) {
            milestones.push({
              agent_id: agentId,
              type: 'achievement',
              title: 'Perfect Day',
              description: `${latest.total_runs} runs with zero failures on ${latest.date}`,
            });
          }

          // Quality spike (latest quality >= 90)
          if (latest.avg_quality_score != null && latest.avg_quality_score >= 90) {
            milestones.push({
              agent_id: agentId,
              type: 'achievement',
              title: 'Quality Spike',
              description: `Quality score hit ${Math.round(latest.avg_quality_score)} on ${latest.date}`,
            });
          }

          // High failure rate (> 50% failures, 3+ runs)
          if (latest.total_runs >= 3 && latest.failed_runs > latest.total_runs * 0.5) {
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
          await supabase.from('agent_milestones').insert({
            agent_id: m.agent_id,
            type: m.type,
            title: m.title,
            description: m.description,
            created_at: new Date().toISOString(),
          });
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

        const { data: agents } = await supabase
          .from('company_agents')
          .select('role')
          .eq('status', 'active');

        if (!agents?.length) return { success: true, data: { message: 'No active agents' } };

        let updated = 0;

        for (const agent of agents) {
          // Current period
          const { data: currentRows } = await supabase
            .from('agent_performance')
            .select('avg_quality_score, total_runs, successful_runs, failed_runs, total_cost, avg_duration_ms')
            .eq('agent_id', agent.role)
            .gte('date', currentStart);

          // Previous period
          const { data: prevRows } = await supabase
            .from('agent_performance')
            .select('avg_quality_score, total_runs, successful_runs, failed_runs, total_cost, avg_duration_ms')
            .eq('agent_id', agent.role)
            .gte('date', previousStart)
            .lt('date', currentStart);

          if (!currentRows?.length || !prevRows?.length) continue;

          const avg = (rows: typeof currentRows, key: string) => {
            const vals = rows.map((r) => Number((r as Record<string, unknown>)[key]) || 0);
            return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
          };

          const dimensions = [
            { dimension: 'quality', current: avg(currentRows, 'avg_quality_score'), previous: avg(prevRows, 'avg_quality_score') },
            { dimension: 'reliability', current: currentRows.reduce((s, r) => s + r.successful_runs, 0) / Math.max(1, currentRows.reduce((s, r) => s + r.total_runs, 0)), previous: prevRows.reduce((s, r) => s + r.successful_runs, 0) / Math.max(1, prevRows.reduce((s, r) => s + r.total_runs, 0)) },
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

            await supabase.from('agent_growth').upsert({
              agent_id: agent.role,
              dimension: d.dimension,
              direction,
              current_value: parseFloat(d.current.toFixed(4)),
              previous_value: parseFloat(d.previous.toFixed(4)),
              period: `${periodDays}d`,
              evidence: `Current: ${d.current.toFixed(2)}, Previous: ${d.previous.toFixed(2)}`,
              updated_at: new Date().toISOString(),
            }, { onConflict: 'agent_id,dimension' });
          }

          updated++;
        }

        return { success: true, data: { agents_updated: updated } };
      },
    },
  ];
}
