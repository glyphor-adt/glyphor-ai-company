/**
 * Atlas Vega (Ops Agent) — Runner Entry Point
 *
 * Monitors system health, retries failures, manages incidents,
 * and produces status reports for Sarah's briefings.
 */

import {
  CompanyAgentRunner,
  ModelClient,
  AgentSupervisor,
  ToolExecutor,
  EventBus,
  GlyphorEventBus,
  type AgentConfig,
} from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { OPS_SYSTEM_PROMPT } from './systemPrompt.js';
import { createOpsTools } from './tools.js';
import { createMemoryTools } from '../shared/memoryTools.js';

export interface OpsRunParams {
  task?: 'health_check' | 'freshness_check' | 'cost_check' | 'morning_status' | 'evening_status' | 'on_demand' | 'event_response' | 'performance_rollup' | 'milestone_detection' | 'growth_update';
  message?: string;
  eventPayload?: Record<string, unknown>;
}

export async function runOps(params: OpsRunParams = {}) {
  const memory = new CompanyMemoryStore({
    supabaseUrl: process.env.SUPABASE_URL!,
    supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY!,
    gcsBucket: process.env.GCS_BUCKET || 'glyphor-company',
    gcpProjectId: process.env.GCP_PROJECT_ID,
  });

  const modelClient = new ModelClient({
    geminiApiKey: process.env.GOOGLE_AI_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  });
  const runner = new CompanyAgentRunner(modelClient);
  const eventBus = new EventBus();
  const glyphorEventBus = new GlyphorEventBus({ supabase: memory.getSupabaseClient() });
  const tools = [
    ...createOpsTools(memory),
    ...createMemoryTools(memory),
  ];
  const toolExecutor = new ToolExecutor(tools);

  eventBus.on('*', (event) => {
    console.log(`[Atlas] ${event.type}`, JSON.stringify(event));
  });

  const task = params.task || 'health_check';
  const today = new Date().toISOString().split('T')[0];

  let initialMessage: string;

  switch (task) {
    case 'health_check':
      initialMessage = `Perform a system health check for ${today}.

Steps:
1. Use query_agent_health to get the health summary for all agents
2. Check for any agents with failures in the last 24 hours
3. If any agent has 3+ failures, consider pausing it and creating an incident
4. If any agent has 1-2 failures, log a warning
5. Post a brief health status using post_system_status

Focus on actionable findings. Don't just list data — detect problems and take action.`;
      break;

    case 'freshness_check':
      initialMessage = `Check data freshness for ${today}.

Steps:
1. Use query_data_sync_status to check all sync sources
2. Flag any source that hasn't synced in over 6 hours as stale
3. If a source has consecutive failures >= 3, create an incident
4. If a source is stale but not failing, note the impact on downstream agents
5. Log your findings`;
      break;

    case 'cost_check':
      initialMessage = `Perform a cost anomaly scan for ${today}.

Steps:
1. Use query_cost_trends with period "24h" to get recent costs
2. Compare each agent's cost to their budget (check company_agents table)
3. Flag any agent spending more than 80% of their monthly budget
4. If any agent exceeds their budget, note this as a critical finding
5. Post findings via post_system_status if there are anomalies`;
      break;

    case 'morning_status':
      initialMessage = `Generate the morning system status report for ${today}.

This report will be included in Sarah's 7 AM briefing for the founders.

Steps:
1. Use query_agent_health for a full health summary
2. Use query_data_sync_status for data freshness
3. Use query_cost_trends with period "24h" for cost overview
4. Use query_events_backlog to check for unprocessed events
5. Synthesize into a comprehensive morning status report
6. Use post_system_status with the full report

Format: Lead with overall status (healthy/degraded/critical), then key findings.`;
      break;

    case 'evening_status':
      initialMessage = `Generate the evening system status report for ${today}.

This report closes out the day before Sarah's 6 PM EOD summary.

Steps:
1. Use query_agent_health for end-of-day health
2. Use query_agent_runs to see all runs today
3. Use query_cost_trends with period "24h" for daily cost total
4. Summarize the day: how many runs, any failures, total cost, overall health
5. Use post_system_status with the evening report`;
      break;

    case 'event_response':
      initialMessage = params.message || `An event was received that requires attention.

Event payload: ${JSON.stringify(params.eventPayload ?? {})}

Steps:
1. Analyze the event type and severity
2. Use query_agent_health to assess impact
3. Take appropriate action (retry, pause, create incident)
4. Log your response`;
      break;

    case 'on_demand':
      initialMessage = params.message || 'Provide a current system status summary.';
      break;

    case 'performance_rollup':
      initialMessage = `Run the daily performance rollup for yesterday.

Steps:
1. Use rollup_agent_performance to aggregate yesterday's agent_runs into agent_performance
2. Report how many agents were rolled up and any notable findings`;
      break;

    case 'milestone_detection':
      initialMessage = `Scan for new agent milestones.

Steps:
1. Use detect_milestones to scan all agents for notable achievements or incidents
2. Report any milestones found`;
      break;

    case 'growth_update':
      initialMessage = `Update weekly growth tracking for all agents.

Steps:
1. Use update_growth_areas with period_days 7 to compare this week vs last week
2. Report which agents are improving, stable, or declining in each dimension`;
      break;

    default:
      initialMessage = 'Provide a current system status summary.';
  }

  const config: AgentConfig = {
    id: `ops-${task}-${today}`,
    role: 'ops',
    systemPrompt: OPS_SYSTEM_PROMPT,
    model: 'gemini-3-flash-preview',
    tools,
    maxTurns: 10,
    maxStallTurns: 3,
    timeoutMs: 60_000,
    temperature: 0.2,
  };

  const supervisor = new AgentSupervisor({
    maxTurns: config.maxTurns,
    maxStallTurns: config.maxStallTurns,
    timeoutMs: config.timeoutMs,
    onEvent: (event) => eventBus.emit(event),
  });

  const startTime = Date.now();

  const result = await runner.run(
    config,
    initialMessage,
    supervisor,
    toolExecutor,
    (event) => eventBus.emit(event),
    memory,
    { glyphorEventBus, agentMemoryStore: memory },
  );

  const durationMs = Date.now() - startTime;
  const estimatedCost = result.conversationHistory.length * 0.0001;

  try {
    await memory.recordAgentRun('ops', durationMs, estimatedCost);
  } catch (e) {
    console.warn('[Atlas] Failed to record run:', (e as Error).message);
  }

  console.log(`[Atlas] ${result.status} in ${durationMs}ms (${result.totalTurns} turns)`);

  return result;
}

// CLI entry point
const args = process.argv.slice(2);
if (args.length > 0) {
  const task = args[0] as OpsRunParams['task'];
  runOps({ task })
    .then((result) => {
      console.log(`\n=== Atlas Vega: ${result.status} ===`);
      if (result.output) {
        console.log(result.output.substring(0, 500));
      }
      process.exit(result.status === 'completed' ? 0 : 1);
    })
    .catch((err) => {
      console.error('Fatal:', err);
      process.exit(1);
    });
}
