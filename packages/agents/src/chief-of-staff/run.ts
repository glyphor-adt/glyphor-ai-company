/**
 * Chief of Staff — Runner Entry Point
 *
 * Executes the Chief of Staff agent for briefings or on-demand tasks.
 * Can be invoked via Cloud Scheduler cron or direct HTTP request.
 */

import {
  CompanyAgentRunner,
  ModelClient,
  AgentSupervisor,
  ToolExecutor,
  EventBus,
  type AgentConfig,
} from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { CHIEF_OF_STAFF_SYSTEM_PROMPT } from './systemPrompt.js';
import { createChiefOfStaffTools } from './tools.js';

export interface CoSRunParams {
  task?: 'generate_briefing' | 'check_escalations' | 'on_demand';
  recipient?: 'kristina' | 'andrew';
  message?: string;
}

export async function runChiefOfStaff(params: CoSRunParams = {}) {
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
  const tools = createChiefOfStaffTools(memory);
  const toolExecutor = new ToolExecutor(tools);

  // Log all events to console
  eventBus.on('*', (event) => {
    console.log(`[CoS] ${event.type}`, JSON.stringify(event));
  });

  const task = params.task || 'generate_briefing';
  const today = new Date().toISOString().split('T')[0];

  let initialMessage: string;

  switch (task) {
    case 'generate_briefing': {
      const recipient = params.recipient || 'kristina';
      initialMessage = `Generate the morning briefing for ${recipient} for ${today}.

Steps:
1. Use get_recent_activity to see what happened in the last 24 hours
2. Use get_pending_decisions to check for items needing approval
3. Use get_product_metrics for both Fuse and Pulse
4. Use get_financials for the last 7 days
5. Synthesize everything into a concise morning briefing
6. Use send_briefing to deliver it to ${recipient} via Teams

Remember:
- Kristina cares about: product/market, growth, competitive landscape, enterprise opportunities
- Andrew cares about: financials, costs, margins, infrastructure, risk
- Lead with the most important item
- Include action items if any decisions need their attention`;
      break;
    }

    case 'check_escalations':
      initialMessage = `Check for any decisions that need escalation.

Use check_escalations to find yellow decisions older than 72 hours.
If any exist, create a red-tier decision to flag both founders.
Log your findings as an activity.`;
      break;

    case 'on_demand':
      initialMessage = params.message || 'Provide a status summary of the company.';
      break;

    default:
      initialMessage = 'Provide a status summary of the company.';
  }

  const config: AgentConfig = {
    id: `cos-${task}-${today}`,
    role: 'chief-of-staff',
    systemPrompt: CHIEF_OF_STAFF_SYSTEM_PROMPT,
    model: 'gemini-3-flash-preview',
    tools,
    maxTurns: 10,
    maxStallTurns: 3,
    timeoutMs: 60_000,
    temperature: 0.3,
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
  );

  const durationMs = Date.now() - startTime;

  // Estimate cost (Flash: ~$0.15/1M input, ~$0.60/1M output)
  const lastEvent = result.conversationHistory.length;
  const estimatedCost = (lastEvent * 0.0001); // Very rough estimate

  // Record run in agent tracking
  try {
    await memory.recordAgentRun('chief-of-staff', durationMs, estimatedCost);
  } catch (e) {
    console.warn('[CoS] Failed to record run:', (e as Error).message);
  }

  console.log(`[CoS] ${result.status} in ${durationMs}ms (${result.totalTurns} turns)`);

  return result;
}

// CLI entry point
const args = process.argv.slice(2);
if (args.length > 0) {
  const task = args[0] as CoSRunParams['task'];
  const recipient = args[1] as CoSRunParams['recipient'];
  runChiefOfStaff({ task, recipient })
    .then((result) => {
      console.log(`\n=== Chief of Staff: ${result.status} ===`);
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
