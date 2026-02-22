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
  ];
}
