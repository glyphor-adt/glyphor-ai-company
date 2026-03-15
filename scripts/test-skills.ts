import fs from 'node:fs';
import path from 'node:path';
import { systemQuery } from '@glyphor/shared/db';
import { ModelClient } from '@glyphor/agent-runtime';

interface SkillSuite {
  suiteName: string;
  schedulerUrl?: string;
  judgeModel?: string;
  tests: SkillTestCase[];
}

interface SkillTestCase {
  skillSlug: string;
  agentRole: string;
  skillFile: string;
  prompts: string[];
  assertions: SkillAssertion[];
  baselineMethodologyFile?: string;
}

type SkillAssertion =
  | {
      type: 'output_contains_any';
      values: string[];
      description?: string;
    }
  | {
      type: 'output_not_contains_any';
      values: string[];
      description?: string;
    }
  | {
      type: 'requires_any_tool';
      tools: string[];
      description?: string;
    }
  | {
      type: 'requires_first_tool_in';
      tools: string[];
      description?: string;
    }
  | {
      type: 'min_tool_calls';
      min: number;
      description?: string;
    }
  | {
      type: 'status_is';
      value: string;
      description?: string;
    };

interface ParsedSkill {
  slug: string;
  name: string;
  methodology: string;
}

interface RouteResult {
  routed: boolean;
  action: 'executed' | 'queued_for_approval' | 'rejected';
  agentRole: string;
  task: string;
  output?: string | null;
  status?: string;
  error?: string;
  reason?: string;
  actions?: Array<{ tool: string; params: Record<string, unknown>; result: 'success' | 'error'; output: string; timestamp: string }>;
}

interface RunMetrics {
  runId: string | null;
  runStatus: string | null;
  turns: number | null;
  toolCalls: number | null;
  costUsd: number | null;
  constitutionalAdherence: number | null;
}

interface VariantResult {
  variant: 'with_skill' | 'baseline';
  response: RouteResult;
  output: string;
  toolsUsed: string[];
  metrics: RunMetrics;
}

interface AssertionResult {
  description: string;
  passed: boolean;
  detail: string;
}

interface PairJudgeResult {
  winner: 'with_skill' | 'baseline' | 'tie';
  withSkillScore: number;
  baselineScore: number;
  rationale: string;
  usedModel: boolean;
}

interface PromptComparisonResult {
  prompt: string;
  withSkill: VariantResult;
  baseline: VariantResult;
  assertions: AssertionResult[];
  judge: PairJudgeResult;
  complianceDelta: number | null;
  costRatio: number | null;
  regression: boolean;
}

interface SkillSummary {
  skillSlug: string;
  agentRole: string;
  promptCount: number;
  wins: number;
  losses: number;
  ties: number;
  passRate: number;
  allAssertionsPassed: boolean;
  noRegression: boolean;
  avgComplianceDelta: number | null;
  avgCostRatio: number | null;
  passes: boolean;
}

interface SkillReport {
  generatedAt: string;
  suiteName: string;
  schedulerUrl: string;
  judgeModel: string;
  summaries: SkillSummary[];
  details: Array<{
    skillSlug: string;
    agentRole: string;
    promptResults: PromptComparisonResult[];
  }>;
}

interface CliArgs {
  configPath: string;
  schedulerUrl?: string;
  judgeModel?: string;
  outputPath?: string;
  dryRun: boolean;
  confirmLive: boolean;
  disableLlmJudge: boolean;
}

const DEFAULT_CONFIG = 'scripts/skill-tests/pilot-suite.json';
const DEFAULT_JUDGE_MODEL = 'gpt-5-mini-2025-08-07';
const SKILL_TEST_BLOCK_START = '<!-- SKILL_TEST_OVERRIDE_START -->';
const SKILL_TEST_BLOCK_END = '<!-- SKILL_TEST_OVERRIDE_END -->';

function readArg(args: string[], key: string): string | undefined {
  const idx = args.indexOf(key);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function parseArgs(argv: string[]): CliArgs {
  return {
    configPath: readArg(argv, '--config') ?? DEFAULT_CONFIG,
    schedulerUrl: readArg(argv, '--scheduler-url'),
    judgeModel: readArg(argv, '--judge-model'),
    outputPath: readArg(argv, '--output'),
    dryRun: argv.includes('--dry-run'),
    confirmLive: argv.includes('--confirm-live'),
    disableLlmJudge: argv.includes('--no-llm-judge'),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseSkillFile(repoRoot: string, filePath: string): ParsedSkill {
  const absPath = path.join(repoRoot, filePath);
  const raw = fs.readFileSync(absPath, 'utf8');
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    throw new Error(`Invalid frontmatter in skill file: ${filePath}`);
  }

  const frontmatter = match[1];
  const methodology = match[2].trim();

  const fields: Record<string, string> = {};
  for (const line of frontmatter.split(/\r?\n/)) {
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim();
    fields[key] = value;
  }

  if (!fields.slug || !fields.name) {
    throw new Error(`Skill file missing slug/name frontmatter: ${filePath}`);
  }

  return {
    slug: fields.slug,
    name: fields.name,
    methodology,
  };
}

function stripSkillTestBlocks(prompt: string): string {
  if (!prompt) return prompt;
  const start = prompt.indexOf(SKILL_TEST_BLOCK_START);
  const end = prompt.indexOf(SKILL_TEST_BLOCK_END);
  if (start === -1 || end === -1 || end < start) {
    return prompt;
  }
  return `${prompt.slice(0, start).trim()}\n${prompt.slice(end + SKILL_TEST_BLOCK_END.length).trim()}`.trim();
}

function composeWithMethodology(basePrompt: string | null, header: string, methodology: string): string {
  const cleanBase = stripSkillTestBlocks(basePrompt ?? '').trim();
  const parts: string[] = [];
  if (cleanBase) parts.push(cleanBase);
  parts.push(
    [
      SKILL_TEST_BLOCK_START,
      `## ${header}`,
      'This block is injected by scripts/test-skills.ts for A/B validation.',
      'Follow the methodology in this block for this run.',
      '',
      methodology,
      SKILL_TEST_BLOCK_END,
    ].join('\n'),
  );
  return parts.join('\n\n---\n\n');
}

async function getAgentBrief(agentRole: string): Promise<string | null> {
  const rows = await systemQuery<{ system_prompt: string }>(
    'SELECT system_prompt FROM agent_briefs WHERE agent_id = $1 LIMIT 1',
    [agentRole],
  );
  return rows[0]?.system_prompt ?? null;
}

async function setAgentBrief(agentRole: string, systemPrompt: string): Promise<void> {
  await systemQuery(
    `INSERT INTO agent_briefs (agent_id, system_prompt, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (agent_id)
     DO UPDATE SET system_prompt = EXCLUDED.system_prompt, updated_at = EXCLUDED.updated_at`,
    [agentRole, systemPrompt],
  );
}

async function restoreAgentBrief(agentRole: string, originalPrompt: string | null): Promise<void> {
  if (originalPrompt == null) {
    await systemQuery('DELETE FROM agent_briefs WHERE agent_id = $1', [agentRole]);
    return;
  }
  await setAgentBrief(agentRole, originalPrompt);
}

async function invokeSkillTestRun(
  schedulerUrl: string,
  agentRole: string,
  skillSlug: string,
  variant: 'with_skill' | 'baseline',
  prompt: string,
): Promise<RouteResult> {
  const response = await fetch(`${schedulerUrl.replace(/\/$/, '')}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentRole,
      task: 'skill_test',
      message: prompt,
      payload: {
        skill_test: true,
        skill_version: variant,
        skill_slug: skillSlug,
        metadata: {
          skill_test: true,
          skill_version: variant,
          skill_slug: skillSlug,
        },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`POST /run failed (${response.status}): ${body}`);
  }

  return (await response.json()) as RouteResult;
}

async function fetchRunMetrics(agentRole: string, startedAtIso: string): Promise<RunMetrics> {
  const runRows = await systemQuery<{
    id: string;
    status: string;
    turns: number | null;
    tool_calls: number | null;
    cost: number | null;
  }>(
    `SELECT id, status, turns, tool_calls, cost
     FROM agent_runs
     WHERE agent_id = $1
       AND task = 'skill_test'
       AND started_at >= $2::timestamptz
     ORDER BY started_at DESC
     LIMIT 1`,
    [agentRole, startedAtIso],
  );

  const run = runRows[0];
  if (!run) {
    return {
      runId: null,
      runStatus: null,
      turns: null,
      toolCalls: null,
      costUsd: null,
      constitutionalAdherence: null,
    };
  }

  const ceRows = await systemQuery<{ overall_adherence: number }>(
    `SELECT overall_adherence
     FROM constitutional_evaluations
     WHERE run_id = $1
     ORDER BY evaluated_at DESC
     LIMIT 1`,
    [run.id],
  );

  return {
    runId: run.id,
    runStatus: run.status,
    turns: run.turns,
    toolCalls: run.tool_calls,
    costUsd: run.cost,
    constitutionalAdherence: ceRows[0]?.overall_adherence ?? null,
  };
}

function normalizeText(input: string): string {
  return input.toLowerCase();
}

function evaluateAssertions(assertions: SkillAssertion[], result: VariantResult): AssertionResult[] {
  const output = result.output ?? '';
  const outputLc = normalizeText(output);
  const firstTool = result.toolsUsed[0] ?? null;

  return assertions.map((assertion) => {
    switch (assertion.type) {
      case 'status_is': {
        const actual = result.response.status ?? result.response.action;
        const passed = actual === assertion.value;
        return {
          description: assertion.description ?? `status is ${assertion.value}`,
          passed,
          detail: `expected=${assertion.value}, actual=${actual ?? 'unknown'}`,
        };
      }
      case 'min_tool_calls': {
        const count = result.toolsUsed.length;
        const passed = count >= assertion.min;
        return {
          description: assertion.description ?? `minimum tool calls ${assertion.min}`,
          passed,
          detail: `expected>=${assertion.min}, actual=${count}`,
        };
      }
      case 'requires_any_tool': {
        const allowed = new Set(assertion.tools.map((t) => t.toLowerCase()));
        const matched = result.toolsUsed.find((tool) => allowed.has(tool.toLowerCase()));
        return {
          description: assertion.description ?? `uses one of [${assertion.tools.join(', ')}]`,
          passed: Boolean(matched),
          detail: matched ? `matched=${matched}` : `used=[${result.toolsUsed.join(', ') || 'none'}]`,
        };
      }
      case 'requires_first_tool_in': {
        const allowed = new Set(assertion.tools.map((t) => t.toLowerCase()));
        const passed = firstTool ? allowed.has(firstTool.toLowerCase()) : false;
        return {
          description: assertion.description ?? `first tool in [${assertion.tools.join(', ')}]`,
          passed,
          detail: `first_tool=${firstTool ?? 'none'}`,
        };
      }
      case 'output_contains_any': {
        const matched = assertion.values.find((value) => outputLc.includes(value.toLowerCase()));
        return {
          description: assertion.description ?? `output contains one of [${assertion.values.join(', ')}]`,
          passed: Boolean(matched),
          detail: matched ? `matched=${matched}` : 'no expected keyword found',
        };
      }
      case 'output_not_contains_any': {
        const matched = assertion.values.find((value) => outputLc.includes(value.toLowerCase()));
        return {
          description: assertion.description ?? `output excludes [${assertion.values.join(', ')}]`,
          passed: !matched,
          detail: matched ? `forbidden match=${matched}` : 'no forbidden keywords',
        };
      }
      default:
        return {
          description: 'unknown assertion',
          passed: false,
          detail: 'unsupported assertion type',
        };
    }
  });
}

function heuristicJudge(withSkill: VariantResult, baseline: VariantResult): PairJudgeResult {
  const withTools = withSkill.toolsUsed.length;
  const baseTools = baseline.toolsUsed.length;
  const withLen = (withSkill.output ?? '').length;
  const baseLen = (baseline.output ?? '').length;

  const withScore = Math.max(0, Math.min(100, 40 + Math.min(20, withTools * 3) + Math.min(20, withLen / 120) + (withSkill.response.status === 'completed' ? 20 : 0)));
  const baseScore = Math.max(0, Math.min(100, 40 + Math.min(20, baseTools * 3) + Math.min(20, baseLen / 120) + (baseline.response.status === 'completed' ? 20 : 0)));

  if (Math.abs(withScore - baseScore) <= 2) {
    return {
      winner: 'tie',
      withSkillScore: Math.round(withScore),
      baselineScore: Math.round(baseScore),
      rationale: 'Heuristic tie: outputs are close in completion, tool usage, and response depth.',
      usedModel: false,
    };
  }

  return {
    winner: withScore > baseScore ? 'with_skill' : 'baseline',
    withSkillScore: Math.round(withScore),
    baselineScore: Math.round(baseScore),
    rationale: 'Heuristic comparison based on completion status, tool usage, and response depth.',
    usedModel: false,
  };
}

async function llmJudge(
  modelClient: ModelClient,
  judgeModel: string,
  prompt: string,
  withSkill: VariantResult,
  baseline: VariantResult,
): Promise<PairJudgeResult> {
  const systemInstruction = [
    'You evaluate two anonymous candidate outputs (A and B) for the same task.',
    'Score each 0-100 using weighted rubric:',
    '- methodology_adherence: 25%',
    '- tool_usage_quality: 20%',
    '- output_specificity: 20%',
    '- judgment_quality: 20%',
    '- completeness: 15%',
    'Respond with JSON only:',
    '{"winner":"A|B|tie","scoreA":0-100,"scoreB":0-100,"rationale":"..."}',
  ].join('\n');

  const judgePrompt = [
    `TASK PROMPT:\n${prompt}`,
    '',
    `CANDIDATE A (with-skill):\n${withSkill.output || '[empty output]'}`,
    '',
    `CANDIDATE B (baseline):\n${baseline.output || '[empty output]'}`,
  ].join('\n');

  const response = await modelClient.generate({
    model: judgeModel,
    systemInstruction,
    contents: [{ role: 'user', content: judgePrompt, timestamp: Date.now() }],
    temperature: 0.1,
    maxTokens: 500,
    fallbackScope: 'same-provider',
  });

  let parsed: { winner?: 'A' | 'B' | 'tie'; scoreA?: number; scoreB?: number; rationale?: string } = {};
  try {
    parsed = JSON.parse(response.text ?? '{}');
  } catch {
    return heuristicJudge(withSkill, baseline);
  }

  const scoreA = typeof parsed.scoreA === 'number' ? Math.max(0, Math.min(100, parsed.scoreA)) : 50;
  const scoreB = typeof parsed.scoreB === 'number' ? Math.max(0, Math.min(100, parsed.scoreB)) : 50;
  const winner = parsed.winner === 'A' ? 'with_skill' : parsed.winner === 'B' ? 'baseline' : 'tie';

  return {
    winner,
    withSkillScore: Math.round(scoreA),
    baselineScore: Math.round(scoreB),
    rationale: parsed.rationale ?? 'LLM judge did not provide rationale.',
    usedModel: true,
  };
}

async function comparePrompt(
  schedulerUrl: string,
  test: SkillTestCase,
  prompt: string,
  withSkillBrief: string,
  baselineBrief: string,
  judgeModel: string,
  modelClient: ModelClient | null,
): Promise<PromptComparisonResult> {
  const startedWith = new Date().toISOString();
  await setAgentBrief(test.agentRole, withSkillBrief);
  const withResponse = await invokeSkillTestRun(schedulerUrl, test.agentRole, test.skillSlug, 'with_skill', prompt);
  const withMetrics = await fetchRunMetrics(test.agentRole, startedWith);

  const startedBaseline = new Date().toISOString();
  await setAgentBrief(test.agentRole, baselineBrief);
  const baseResponse = await invokeSkillTestRun(schedulerUrl, test.agentRole, test.skillSlug, 'baseline', prompt);
  const baseMetrics = await fetchRunMetrics(test.agentRole, startedBaseline);

  const withResult: VariantResult = {
    variant: 'with_skill',
    response: withResponse,
    output: withResponse.output ?? '',
    toolsUsed: (withResponse.actions ?? []).map((a) => a.tool),
    metrics: withMetrics,
  };

  const baselineResult: VariantResult = {
    variant: 'baseline',
    response: baseResponse,
    output: baseResponse.output ?? '',
    toolsUsed: (baseResponse.actions ?? []).map((a) => a.tool),
    metrics: baseMetrics,
  };

  const assertionResults = evaluateAssertions(test.assertions, withResult);

  const judge = modelClient
    ? await llmJudge(modelClient, judgeModel, prompt, withResult, baselineResult)
    : heuristicJudge(withResult, baselineResult);

  const complianceDelta =
    withResult.metrics.constitutionalAdherence != null && baselineResult.metrics.constitutionalAdherence != null
      ? withResult.metrics.constitutionalAdherence - baselineResult.metrics.constitutionalAdherence
      : null;

  const costRatio =
    withResult.metrics.costUsd != null && baselineResult.metrics.costUsd != null && baselineResult.metrics.costUsd > 0
      ? withResult.metrics.costUsd / baselineResult.metrics.costUsd
      : null;

  const regression = judge.withSkillScore + 5 < judge.baselineScore;

  return {
    prompt,
    withSkill: withResult,
    baseline: baselineResult,
    assertions: assertionResults,
    judge,
    complianceDelta,
    costRatio,
    regression,
  };
}

function summarizeSkill(test: SkillTestCase, promptResults: PromptComparisonResult[]): SkillSummary {
  const wins = promptResults.filter((r) => r.judge.winner === 'with_skill').length;
  const losses = promptResults.filter((r) => r.judge.winner === 'baseline').length;
  const ties = promptResults.filter((r) => r.judge.winner === 'tie').length;
  const promptCount = promptResults.length;
  const passRate = promptCount === 0 ? 0 : wins / promptCount;

  const allAssertionsPassed = promptResults.every((r) => r.assertions.every((a) => a.passed));
  const noRegression = promptResults.every((r) => !r.regression);

  const complianceValues = promptResults
    .map((r) => r.complianceDelta)
    .filter((v): v is number => v != null);
  const avgComplianceDelta =
    complianceValues.length > 0
      ? complianceValues.reduce((sum, value) => sum + value, 0) / complianceValues.length
      : null;

  const costRatios = promptResults
    .map((r) => r.costRatio)
    .filter((v): v is number => v != null);
  const avgCostRatio =
    costRatios.length > 0
      ? costRatios.reduce((sum, value) => sum + value, 0) / costRatios.length
      : null;

  const complianceOk = avgComplianceDelta == null || avgComplianceDelta >= 0;
  const costOk = avgCostRatio == null || avgCostRatio < 2;

  const passes =
    passRate >= 0.8 &&
    allAssertionsPassed &&
    noRegression &&
    complianceOk &&
    costOk;

  return {
    skillSlug: test.skillSlug,
    agentRole: test.agentRole,
    promptCount,
    wins,
    losses,
    ties,
    passRate,
    allAssertionsPassed,
    noRegression,
    avgComplianceDelta,
    avgCostRatio,
    passes,
  };
}

function printDryRun(suite: SkillSuite, schedulerUrl: string): void {
  console.log(`[skill-test] dry-run for suite=${suite.suiteName}`);
  console.log(`[skill-test] scheduler=${schedulerUrl}`);
  for (const test of suite.tests) {
    console.log(`- ${test.skillSlug} (${test.agentRole}) prompts=${test.prompts.length}`);
  }
}

function printSummary(report: SkillReport): void {
  console.log(`\n[skill-test] suite=${report.suiteName} generated=${report.generatedAt}`);
  for (const summary of report.summaries) {
    const passPct = `${Math.round(summary.passRate * 100)}%`;
    const compliance = summary.avgComplianceDelta == null ? 'n/a' : summary.avgComplianceDelta.toFixed(3);
    const cost = summary.avgCostRatio == null ? 'n/a' : `${summary.avgCostRatio.toFixed(2)}x`;
    console.log(
      `- ${summary.skillSlug} (${summary.agentRole}) ` +
      `wins=${summary.wins}/${summary.promptCount} (${passPct}) ` +
      `assertions=${summary.allAssertionsPassed ? 'ok' : 'fail'} ` +
      `regression=${summary.noRegression ? 'none' : 'found'} ` +
      `compliance_delta=${compliance} cost_ratio=${cost} ` +
      `result=${summary.passes ? 'PASS' : 'FAIL'}`,
    );
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();

  if (!args.dryRun && !args.confirmLive) {
    throw new Error('Refusing to modify agent_briefs without --confirm-live. Use --dry-run to preview.');
  }

  const configPath = path.isAbsolute(args.configPath)
    ? args.configPath
    : path.join(repoRoot, args.configPath);

  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const suite = JSON.parse(fs.readFileSync(configPath, 'utf8')) as SkillSuite;
  const schedulerUrl = args.schedulerUrl ?? suite.schedulerUrl ?? 'http://localhost:8080';
  const judgeModel = args.judgeModel ?? suite.judgeModel ?? DEFAULT_JUDGE_MODEL;

  if (args.dryRun) {
    printDryRun(suite, schedulerUrl);
    return;
  }

  const modelClient = args.disableLlmJudge
    ? null
    : new ModelClient({
        geminiApiKey: process.env.GOOGLE_AI_API_KEY,
        openaiApiKey: process.env.OPENAI_API_KEY,
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      });

  const details: SkillReport['details'] = [];
  const summaries: SkillSummary[] = [];

  for (const test of suite.tests) {
    console.log(`\n[skill-test] running ${test.skillSlug} for ${test.agentRole}`);
    const newSkill = parseSkillFile(repoRoot, test.skillFile);
    if (newSkill.slug !== test.skillSlug) {
      throw new Error(`Skill slug mismatch in ${test.skillFile}: expected ${test.skillSlug}, found ${newSkill.slug}`);
    }

    const originalBrief = await getAgentBrief(test.agentRole);
    const baselineMethodology = test.baselineMethodologyFile
      ? parseSkillFile(repoRoot, test.baselineMethodologyFile).methodology
      : null;

    const withSkillBrief = composeWithMethodology(
      originalBrief,
      `SKILL TEST OVERRIDE: ${newSkill.name}`,
      newSkill.methodology,
    );

    const baselineBrief = baselineMethodology
      ? composeWithMethodology(originalBrief, `BASELINE OVERRIDE: ${test.skillSlug}`, baselineMethodology)
      : (stripSkillTestBlocks(originalBrief ?? '') || '');

    const promptResults: PromptComparisonResult[] = [];

    try {
      for (const prompt of test.prompts) {
        console.log(`[skill-test] prompt: ${prompt}`);
        const result = await comparePrompt(
          schedulerUrl,
          test,
          prompt,
          withSkillBrief,
          baselineBrief,
          judgeModel,
          modelClient,
        );

        const assertionPass = result.assertions.every((a) => a.passed);
        console.log(
          `[skill-test] winner=${result.judge.winner} ` +
          `score=${result.judge.withSkillScore}-${result.judge.baselineScore} ` +
          `assertions=${assertionPass ? 'ok' : 'fail'}`,
        );

        promptResults.push(result);
        await sleep(250);
      }
    } finally {
      await restoreAgentBrief(test.agentRole, originalBrief);
    }

    const summary = summarizeSkill(test, promptResults);
    details.push({
      skillSlug: test.skillSlug,
      agentRole: test.agentRole,
      promptResults,
    });
    summaries.push(summary);
  }

  const report: SkillReport = {
    generatedAt: new Date().toISOString(),
    suiteName: suite.suiteName,
    schedulerUrl,
    judgeModel,
    summaries,
    details,
  };

  const defaultOutput = path.join(
    repoRoot,
    'artifacts',
    'skill-tests',
    `skill-test-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  const outputPath = args.outputPath
    ? (path.isAbsolute(args.outputPath) ? args.outputPath : path.join(repoRoot, args.outputPath))
    : defaultOutput;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');

  printSummary(report);
  console.log(`\n[skill-test] report written: ${outputPath}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[skill-test] failed: ${message}`);
  process.exitCode = 1;
});
