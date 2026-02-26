/**
 * Generic Dynamic Agent Runner
 *
 * Runs any agent created dynamically via create_specialist_agent.
 * Loads the system prompt from agent_briefs, assembles standard shared tools,
 * and executes using CompanyAgentRunner.
 */
import {
  ModelClient, AgentSupervisor,
  ToolExecutor, EventBus, GlyphorEventBus, type AgentConfig,
  type AgentExecutionResult,
  type ConversationTurn,
} from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { createMemoryTools } from './memoryTools.js';
import { createRunDeps, loadAgentConfig } from './createRunDeps.js';
import { createRunner } from './createRunner.js';
import { createEventTools } from './eventTools.js';
import { createGraphTools } from './graphTools.js';
import { createAssignmentTools } from './assignmentTools.js';
import { createCommunicationTools } from './communicationTools.js';
import { createResearchTools } from './researchTools.js';
import { createCollectiveIntelligenceTools } from './collectiveIntelligenceTools.js';

export interface DynamicAgentRunParams {
  role: string;
  task?: string;
  message?: string;
  conversationHistory?: ConversationTurn[];
}

export async function runDynamicAgent(params: DynamicAgentRunParams): Promise<AgentExecutionResult> {
  const { role, task = 'on_demand', message, conversationHistory } = params;

  const memory = new CompanyMemoryStore({
    supabaseUrl: process.env.SUPABASE_URL!,
    supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY!,
    gcsBucket: process.env.GCS_BUCKET || 'glyphor-company',
    gcpProjectId: process.env.GCP_PROJECT_ID,
  });

  const supabase = memory.getSupabaseClient();

  // Load agent record from DB
  const { data: agentRow } = await supabase
    .from('company_agents')
    .select('role, display_name, name, title, department, model, temperature, max_turns, status, is_temporary, expires_at, reports_to')
    .eq('role', role)
    .single();

  if (!agentRow) {
    return {
      output: `Agent "${role}" not found in company_agents.`,
      status: 'error',
      totalTurns: 0,
    } as AgentExecutionResult;
  }

  if (agentRow.status !== 'active') {
    return {
      output: `Agent "${role}" is ${agentRow.status} and cannot run.`,
      status: 'error',
      totalTurns: 0,
    } as AgentExecutionResult;
  }

  // Check TTL expiration
  if (agentRow.is_temporary && agentRow.expires_at && new Date(agentRow.expires_at) < new Date()) {
    // Auto-retire
    await supabase.from('company_agents').update({ status: 'retired', updated_at: new Date().toISOString() }).eq('role', role);
    return {
      output: `Agent "${role}" has expired (TTL reached ${agentRow.expires_at}) and has been retired.`,
      status: 'error',
      totalTurns: 0,
    } as AgentExecutionResult;
  }

  // Load system prompt from agent_briefs
  const { data: brief } = await supabase
    .from('agent_briefs')
    .select('system_prompt, skills, tools')
    .eq('agent_id', role)
    .single();

  const systemPrompt = brief?.system_prompt || `You are ${agentRow.display_name || agentRow.name}, ${agentRow.title}. Department: ${agentRow.department}. Reports to: ${agentRow.reports_to}. Complete tasks thoroughly and report your findings.`;

  const modelClient = new ModelClient({
    geminiApiKey: process.env.GOOGLE_AI_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  });

  const runner = createRunner(modelClient, role as any, task);
  const eventBus = new EventBus();
  const glyphorEventBus = new GlyphorEventBus({ supabase });
  const graphReader = memory.getGraphReader();
  const graphWriter = memory.getGraphWriter();

  // Assemble standard shared tools — dynamic agents get a solid base toolkit
  const tools = [
    ...createMemoryTools(memory),
    ...createEventTools(glyphorEventBus),
    ...(graphReader && graphWriter ? createGraphTools(graphReader, graphWriter) : []),
    ...createAssignmentTools(supabase, glyphorEventBus),
    ...createCommunicationTools(supabase, glyphorEventBus, process.env.SCHEDULER_URL),
    ...createResearchTools(supabase),
    ...createCollectiveIntelligenceTools(memory),
  ];

  const toolExecutor = new ToolExecutor(tools);

  const agentCfg = await loadAgentConfig(supabase, role, {
    model: agentRow.model || 'gemini-3-flash-preview',
    temperature: agentRow.temperature ?? 0.3,
    maxTurns: agentRow.max_turns ?? 10,
  });

  const today = new Date().toISOString().split('T')[0];
  const initialMessage = message || `You have been activated for task: ${task}. Review your pending assignments and messages, then proceed.`;

  const config: AgentConfig = {
    id: `${role}-${task}-${today}`,
    role: role as any,
    systemPrompt,
    model: agentCfg.model,
    tools,
    maxTurns: agentCfg.maxTurns,
    maxStallTurns: 3,
    timeoutMs: 300_000,
    temperature: agentCfg.temperature,
    thinkingEnabled: agentCfg.thinkingEnabled,
    conversationHistory,
  };

  const supervisor = new AgentSupervisor({
    maxTurns: config.maxTurns,
    maxStallTurns: config.maxStallTurns,
    timeoutMs: config.timeoutMs,
    onEvent: (event) => eventBus.emit(event),
  });

  const result = await runner.run(
    config, initialMessage, supervisor, toolExecutor,
    (event) => eventBus.emit(event),
    memory,
    createRunDeps(supabase, glyphorEventBus, memory),
  );

  try { await memory.recordAgentRun(role, 0, 0.02); } catch {}
  console.log(`[DynamicAgent:${role}] ${result.status} (${result.totalTurns} turns)`);
  return result;
}
