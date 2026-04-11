import { systemQuery } from '@glyphor/shared/db';
import { getModel } from '@glyphor/shared/models';
import { getGoogleAiApiKey, getTierModel, isCanonicalKeepRole } from '@glyphor/shared';
import { runCFO, runCMO, runCTO, runChiefOfStaff, runVPResearch } from '@glyphor/agents';
import { getRedisCache, ModelClient, type AgentExecutionResult } from '@glyphor/agent-runtime';

export interface AgentKnowledgeEvalReport {
  runDate: string;
  evaluated: number;
  pass: number;
  softFail: number;
  hardFail: number;
  agents: Array<{
    agentRole: string;
    scenarios: number;
    pass: number;
    softFail: number;
    hardFail: number;
  }>;
}

interface EvalScenarioRow {
  id: string;
  agent_role: string;
  scenario_name: string;
  input_prompt: string;
  pass_criteria: string;
  fail_indicators: string;
  knowledge_tags: string[] | null;
  tenant_id: string;
}

interface JudgeResult {
  score: 'PASS' | 'SOFT_FAIL' | 'HARD_FAIL';
  reasoning: string;
  missing_knowledge: string[];
  knowledge_tags_failed: string[];
}

interface EvalOptions {
  /** Single role filter (legacy). */
  agentRole?: string;
  /** One or more agent role slugs (e.g. from POST body `agentIds`). */
  agentRoles?: string[];
  /** Restrict scenarios to golden-task suite entries (scenario_name prefixed with "golden:"). */
  goldenOnly?: boolean;
}

const LOCK_KEY = 'agent-knowledge-eval-lock';
const LOCK_TTL_SECONDS = 60 * 60;
const JUDGE_MODEL = getTierModel('fast');
const LOG_PREFIX = '[AgentKnowledgeEvaluator]';
const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000000';
const GOLDEN_SCENARIO_PREFIX = 'golden:%';

const RUNNERS: Record<string, (prompt: string) => Promise<AgentExecutionResult>> = {
  cmo: (prompt) => runCMO({ task: 'on_demand', message: prompt, dryRun: true, evalMode: true }),
  cto: (prompt) => runCTO({ task: 'on_demand', message: prompt, dryRun: true, evalMode: true }),
  cfo: (prompt) => runCFO({ task: 'on_demand', message: prompt, dryRun: true, evalMode: true }),
  // Chief of Staff — orchestration quality
  'chief-of-staff': (prompt) => runChiefOfStaff({ task: 'on_demand', message: prompt, dryRun: true, evalMode: true }),
  'vp-research': (prompt) => runVPResearch({ task: 'on_demand', message: prompt, maxToolCalls: 0 }),
};

export async function evaluateAgentKnowledgeGaps(options: EvalOptions = {}): Promise<AgentKnowledgeEvalReport> {
  const report: AgentKnowledgeEvalReport = {
    runDate: new Date().toISOString(),
    evaluated: 0,
    pass: 0,
    softFail: 0,
    hardFail: 0,
    agents: [],
  };

  const cache = getRedisCache();
  const existingLock = await cache.get<string>(LOCK_KEY);
  if (existingLock) {
    console.log(`${LOG_PREFIX} Skipping — another evaluation is in progress`);
    return report;
  }
  await cache.set(LOCK_KEY, report.runDate, LOCK_TTL_SECONDS);

  try {
    const params: unknown[] = [];
    const whereClauses: string[] = [];
    let sql = `
      SELECT id, agent_role, scenario_name, input_prompt, pass_criteria, fail_indicators, knowledge_tags, tenant_id
      FROM agent_eval_scenarios
    `;
    const roleFilter: string[] = [];
    if (options.agentRoles && options.agentRoles.length > 0) {
      roleFilter.push(...options.agentRoles);
    } else if (options.agentRole) {
      roleFilter.push(options.agentRole);
    }
    const uniqueRoles = [...new Set(roleFilter.map((r) => r.trim()).filter(Boolean))];
    if (uniqueRoles.length > 0) {
      whereClauses.push(`agent_role = ANY($${params.length + 1}::text[])`);
      params.push(uniqueRoles);
    }
    if (options.goldenOnly) {
      whereClauses.push(`scenario_name ILIKE $${params.length + 1}`);
      params.push(GOLDEN_SCENARIO_PREFIX);
    }
    if (whereClauses.length > 0) {
      sql += ` WHERE ${whereClauses.join(' AND ')}`;
    }
    sql += ' ORDER BY agent_role, scenario_name';

    const scenarios = await systemQuery<EvalScenarioRow>(sql, params);
    if (scenarios.length === 0) {
      console.log(`${LOG_PREFIX} No ${options.goldenOnly ? 'golden ' : ''}scenarios found`);
      return report;
    }

    const judgeClient = new ModelClient({      geminiApiKey: getGoogleAiApiKey(),
    });

    const agentSummaries = new Map<string, AgentKnowledgeEvalReport['agents'][number]>();

    for (const scenario of scenarios) {
      try {
        if (!isCanonicalKeepRole(scenario.agent_role)) {
          console.log(`${LOG_PREFIX} Skipping retired role scenario ${scenario.agent_role}/${scenario.scenario_name}`);
          continue;
        }
        const runner = RUNNERS[scenario.agent_role];
        if (!runner) {
          console.warn(`${LOG_PREFIX} No eval runner registered for ${scenario.agent_role}`);
          continue;
        }

        const agentResult = await runner(scenario.input_prompt);
        const agentOutput = normalizeAgentOutput(agentResult);
        const judged = await judgeScenario(judgeClient, scenario, agentOutput);
        const evalCost = roundEvalCost((agentResult.cost ?? 0) + estimateModelCallCost(judged.model, judged.usage));

        await systemQuery(
          `INSERT INTO agent_eval_results
            (scenario_id, agent_role, run_date, agent_output, score, reasoning, missing_knowledge, knowledge_tags_failed, model_used, eval_cost, tenant_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            scenario.id,
            scenario.agent_role,
            report.runDate,
            agentOutput,
            judged.result.score,
            judged.result.reasoning,
            judged.result.missing_knowledge,
            judged.result.knowledge_tags_failed,
            `${agentResult.actualModel ?? 'unknown-agent-model'} | judge:${judged.model}`,
            evalCost,
            scenario.tenant_id ?? DEFAULT_TENANT_ID,
          ],
        );

        report.evaluated++;
        if (judged.result.score === 'PASS') report.pass++;
        if (judged.result.score === 'SOFT_FAIL') report.softFail++;
        if (judged.result.score === 'HARD_FAIL') report.hardFail++;

        const summary = agentSummaries.get(scenario.agent_role) ?? {
          agentRole: scenario.agent_role,
          scenarios: 0,
          pass: 0,
          softFail: 0,
          hardFail: 0,
        };
        summary.scenarios++;
        if (judged.result.score === 'PASS') summary.pass++;
        if (judged.result.score === 'SOFT_FAIL') summary.softFail++;
        if (judged.result.score === 'HARD_FAIL') summary.hardFail++;
        agentSummaries.set(scenario.agent_role, summary);
      } catch (err) {
        console.warn(
          `${LOG_PREFIX} Scenario failed for ${scenario.agent_role}/${scenario.scenario_name}:`,
          (err as Error).message,
        );
      }
    }

    report.agents = Array.from(agentSummaries.values());
    await logActivity(
      `Knowledge eval complete${options.goldenOnly ? ' (golden)' : ''}: ${report.evaluated} scenarios — PASS ${report.pass}, SOFT_FAIL ${report.softFail}, HARD_FAIL ${report.hardFail}`,
    );
    console.log(`${LOG_PREFIX} Complete: ${JSON.stringify(report)}`);
    return report;
  } finally {
    await cache.del(LOCK_KEY);
  }
}

async function judgeScenario(
  judgeClient: ModelClient,
  scenario: EvalScenarioRow,
  agentOutput: string,
): Promise<{
  result: JudgeResult;
  model: string;
  usage: { inputTokens: number; outputTokens: number; thinkingTokens?: number; cachedInputTokens?: number };
}> {
  const prompt = [
    'You are evaluating an AI agent response to a work scenario.',
    '',
    `AGENT ROLE: ${scenario.agent_role}`,
    `SCENARIO: ${scenario.input_prompt}`,
    `AGENT RESPONSE: ${agentOutput}`,
    '',
    'PASS CRITERIA:',
    scenario.pass_criteria,
    '',
    'FAIL INDICATORS:',
    scenario.fail_indicators,
    '',
    'Score this response:',
    '- PASS: meets all pass criteria, no fail indicators present',
    '- SOFT_FAIL: directionally correct but missing company specifics, hedging, or generic. Identify exactly what is missing.',
    '- HARD_FAIL: wrong, contradicts company data, or cannot perform the task. Identify exactly what knowledge gap caused the failure.',
    '',
    'Respond with ONLY a JSON object:',
    '{"score":"PASS|SOFT_FAIL|HARD_FAIL","reasoning":"...","missing_knowledge":["specific gap"],"knowledge_tags_failed":["brand_voice"]}',
  ].join('\n');

  const response = await judgeClient.generate({
    model: JUDGE_MODEL,
    systemInstruction: 'You are a strict evaluation judge. Respond ONLY with the requested JSON. No markdown, no prose outside JSON.',
    contents: [{ role: 'user', content: prompt, timestamp: Date.now() }],
    temperature: 0.1,
    maxTokens: 500,
    fallbackScope: 'same-provider',
  });

  return {
    result: parseJudgeResponse(response.text ?? ''),
    model: response.actualModel ?? JUDGE_MODEL,
    usage: response.usageMetadata,
  };
}

function parseJudgeResponse(text: string): JudgeResult {
  try {
    const cleaned = text.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned) as Partial<JudgeResult>;
    const score = parsed.score === 'PASS' || parsed.score === 'SOFT_FAIL' || parsed.score === 'HARD_FAIL'
      ? parsed.score
      : 'SOFT_FAIL';
    return {
      score,
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : 'Judge response missing reasoning.',
      missing_knowledge: Array.isArray(parsed.missing_knowledge)
        ? parsed.missing_knowledge.filter((item): item is string => typeof item === 'string')
        : [],
      knowledge_tags_failed: Array.isArray(parsed.knowledge_tags_failed)
        ? parsed.knowledge_tags_failed.filter((item): item is string => typeof item === 'string')
        : [],
    };
  } catch {
    return {
      score: 'SOFT_FAIL',
      reasoning: `Judge response could not be parsed: ${text.slice(0, 200)}`,
      missing_knowledge: ['judge_response_parse_failure'],
      knowledge_tags_failed: [],
    };
  }
}

function normalizeAgentOutput(result: AgentExecutionResult): string {
  const text = (result.output ?? result.resultSummary ?? result.error ?? result.abortReason ?? '').trim();
  if (text.length > 0) return text;
  return 'No response produced.';
}

function estimateModelCallCost(
  modelId: string,
  usage: { inputTokens: number; outputTokens: number; thinkingTokens?: number; cachedInputTokens?: number },
): number {
  const model = getModel(modelId) ?? getModel(JUDGE_MODEL);
  if (!model) return 0;

  const cachedInputDiscount = model.cachedInputDiscount ?? 1;
  const cachedInputTokens = usage.cachedInputTokens ?? 0;
  const billableInputTokens = Math.max(0, usage.inputTokens - cachedInputTokens);
  const thinkingRate = model.thinkingPer1M ?? model.outputPer1M;

  return (
    (billableInputTokens / 1_000_000) * model.inputPer1M +
    (cachedInputTokens / 1_000_000) * model.inputPer1M * cachedInputDiscount +
    (usage.outputTokens / 1_000_000) * model.outputPer1M +
    ((usage.thinkingTokens ?? 0) / 1_000_000) * thinkingRate
  );
}

function roundEvalCost(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

async function logActivity(detail: string): Promise<void> {
  try {
    await systemQuery(
      'INSERT INTO activity_log (agent_role, action, summary) VALUES ($1,$2,$3)',
      ['system', 'agent_eval.completed', detail],
    );
  } catch (err) {
    console.warn(`${LOG_PREFIX} Failed to log activity:`, (err as Error).message);
  }
}
