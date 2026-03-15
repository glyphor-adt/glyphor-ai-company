import { execFileSync } from 'node:child_process';

type HealthLevel = 'PASS' | 'WARN' | 'FAIL';

interface Config {
  project: string;
  service: string;
  minutes: number;
  maxUnknownAgent: number;
  maxInvalidUuid: number;
  minCompletionRatio: number;
  minStartsForRatio: number;
}

interface CheckResult {
  level: HealthLevel;
  message: string;
}

interface Metrics {
  agentStarted: number;
  agentCompleted: number;
  unknownAgent: number;
  invalidUuid: number;
  verificationUnavailable: number;
  toolResultsTotal: number;
  toolResultsFailed: number;
  failedByTool: Map<string, number>;
}

function resolveGcloudBinary(): string {
  const envOverride = process.env.GCLOUD_BIN?.trim();
  if (envOverride) return envOverride;

  const candidates = process.platform === 'win32'
    ? ['gcloud.cmd', 'gcloud.exe', 'gcloud']
    : ['gcloud'];

  for (const bin of candidates) {
    try {
      execFileSync(bin, ['--version'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return bin;
    } catch {
      // try next candidate
    }
  }

  throw new Error(
    'gcloud CLI not found in PATH. Install Google Cloud SDK or set GCLOUD_BIN to the full gcloud executable path.',
  );
}

function parseArgs(argv: string[]): Config {
  const get = (flag: string): string | undefined => {
    const eq = argv.find((arg) => arg.startsWith(`${flag}=`));
    if (eq) return eq.slice(flag.length + 1);
    const idx = argv.indexOf(flag);
    if (idx >= 0 && idx + 1 < argv.length) return argv[idx + 1];
    return undefined;
  };

  const minutes = Number(get('--minutes') ?? '20');
  const minCompletionRatio = Number(get('--min-completion-ratio') ?? '0.75');
  const minStartsForRatio = Number(get('--min-starts-for-ratio') ?? '5');
  const project = get('--project') ?? process.env.GCLOUD_PROJECT ?? 'ai-glyphor-company';
  const service = get('--service') ?? 'glyphor-scheduler';

  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new Error(`Invalid --minutes value: ${minutes}`);
  }

  const maxUnknownAgent = Math.max(0, Math.ceil((2 * minutes) / 60));

  return {
    project,
    service,
    minutes,
    maxUnknownAgent,
    maxInvalidUuid: 0,
    minCompletionRatio,
    minStartsForRatio,
  };
}

function runGcloudRead(project: string, query: string, freshness: string, limit: number, format: string): string {
  const args = [
    'logging',
    'read',
    query,
    '--project',
    project,
    '--freshness',
    freshness,
    '--limit',
    String(limit),
    '--format',
    format,
  ];

  try {
    const gcloudBin = resolveGcloudBinary();
    return execFileSync(gcloudBin, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    if (process.platform !== 'win32') {
      throw err;
    }

    const escapedQuery = query.replace(/'/g, "''");
    const escapedProject = project.replace(/'/g, "''");
    const escapedFreshness = freshness.replace(/'/g, "''");
    const escapedFormat = format.replace(/'/g, "''");
    const ps = [
      "$ErrorActionPreference='Stop'",
      `gcloud logging read '${escapedQuery}' --project '${escapedProject}' --freshness '${escapedFreshness}' --limit ${limit} --format '${escapedFormat}'`,
    ].join('; ');

    return execFileSync('pwsh', ['-NoProfile', '-Command', ps], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }
}

function countLines(text: string): number {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length;
}

function topFailedTools(failedByTool: Map<string, number>, max = 5): string {
  return Array.from(failedByTool.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([tool, count]) => `${tool}:${count}`)
    .join(', ');
}

function gatherMetrics(config: Config): Metrics {
  const freshness = `${config.minutes}m`;
  const baseFilter = `resource.type="cloud_run_revision" AND resource.labels.service_name="${config.service}"`;

  const agentStarted = countLines(
    runGcloudRead(config.project, `${baseFilter} AND textPayload:"agent_started"`, freshness, 500, 'value(timestamp)'),
  );
  const agentCompleted = countLines(
    runGcloudRead(config.project, `${baseFilter} AND textPayload:"agent_completed"`, freshness, 500, 'value(timestamp)'),
  );
  const unknownAgent = countLines(
    runGcloudRead(config.project, `${baseFilter} AND textPayload:"Unknown agent"`, freshness, 500, 'value(timestamp)'),
  );
  const invalidUuid = countLines(
    runGcloudRead(config.project, `${baseFilter} AND textPayload:"invalid input syntax for type uuid"`, freshness, 500, 'value(timestamp)'),
  );
  const verificationUnavailable = countLines(
    runGcloudRead(config.project, `${baseFilter} AND textPayload:"Verification unavailable"`, freshness, 500, 'value(timestamp)'),
  );

  const toolResultsTotal = countLines(
    runGcloudRead(config.project, `${baseFilter} AND textPayload:"tool_result"`, freshness, 1200, 'value(timestamp)'),
  );

  const failedPayload = runGcloudRead(
    config.project,
    `${baseFilter} AND textPayload:"tool_result" AND textPayload:"\\"success\\":false"`,
    freshness,
    1200,
    'value(textPayload)',
  );

  const failedByTool = new Map<string, number>();
  const toolNameRegex = /"toolName":"([^"]+)"/;
  for (const line of failedPayload.split(/\r?\n/)) {
    const match = line.match(toolNameRegex);
    if (!match?.[1]) continue;
    failedByTool.set(match[1], (failedByTool.get(match[1]) ?? 0) + 1);
  }

  let toolResultsFailed = 0;
  for (const value of failedByTool.values()) toolResultsFailed += value;

  return {
    agentStarted,
    agentCompleted,
    unknownAgent,
    invalidUuid,
    verificationUnavailable,
    toolResultsTotal,
    toolResultsFailed,
    failedByTool,
  };
}

function evaluate(config: Config, metrics: Metrics): CheckResult[] {
  const checks: CheckResult[] = [];

  if (metrics.unknownAgent <= config.maxUnknownAgent) {
    checks.push({ level: 'PASS', message: `Unknown agent errors ${metrics.unknownAgent}/${config.maxUnknownAgent} allowed.` });
  } else {
    checks.push({ level: 'FAIL', message: `Unknown agent errors too high: ${metrics.unknownAgent} > ${config.maxUnknownAgent}.` });
  }

  if (metrics.invalidUuid <= config.maxInvalidUuid) {
    checks.push({ level: 'PASS', message: `Invalid UUID errors ${metrics.invalidUuid}/${config.maxInvalidUuid} allowed.` });
  } else {
    checks.push({ level: 'FAIL', message: `Invalid UUID errors too high: ${metrics.invalidUuid} > ${config.maxInvalidUuid}.` });
  }

  if (metrics.agentStarted < config.minStartsForRatio) {
    checks.push({ level: 'WARN', message: `Only ${metrics.agentStarted} starts; completion ratio check skipped (needs >= ${config.minStartsForRatio}).` });
  } else {
    const ratio = metrics.agentStarted === 0 ? 0 : metrics.agentCompleted / metrics.agentStarted;
    if (ratio >= config.minCompletionRatio) {
      checks.push({ level: 'PASS', message: `Completion ratio ${(ratio * 100).toFixed(1)}% >= ${(config.minCompletionRatio * 100).toFixed(1)}%.` });
    } else {
      checks.push({ level: 'FAIL', message: `Completion ratio ${(ratio * 100).toFixed(1)}% < ${(config.minCompletionRatio * 100).toFixed(1)}%.` });
    }
  }

  if (metrics.toolResultsTotal === 0) {
    checks.push({ level: 'WARN', message: 'No tool_result logs observed in window.' });
  } else {
    const failRate = metrics.toolResultsFailed / metrics.toolResultsTotal;
    const top = topFailedTools(metrics.failedByTool);
    if (failRate <= 0.2) {
      checks.push({ level: 'PASS', message: `Tool failure rate ${(failRate * 100).toFixed(1)}% (top: ${top || 'none'}).` });
    } else if (failRate <= 0.35) {
      checks.push({ level: 'WARN', message: `Tool failure rate elevated at ${(failRate * 100).toFixed(1)}% (top: ${top || 'none'}).` });
    } else {
      checks.push({ level: 'FAIL', message: `Tool failure rate too high at ${(failRate * 100).toFixed(1)}% (top: ${top || 'none'}).` });
    }
  }

  if (metrics.verificationUnavailable > 0) {
    checks.push({ level: 'WARN', message: `Verification unavailable events: ${metrics.verificationUnavailable}.` });
  } else {
    checks.push({ level: 'PASS', message: 'No verification unavailable events.' });
  }

  return checks;
}

function printReport(config: Config, metrics: Metrics, checks: CheckResult[]): void {
  const totalFails = checks.filter((c) => c.level === 'FAIL').length;
  const totalWarns = checks.filter((c) => c.level === 'WARN').length;

  console.log(`Agent Autonomy SLO Monitor (${config.minutes}m)`);
  console.log(`project=${config.project} service=${config.service}`);
  console.log('');
  console.log('Metrics:');
  console.log(`- agent_started: ${metrics.agentStarted}`);
  console.log(`- agent_completed: ${metrics.agentCompleted}`);
  console.log(`- unknown_agent: ${metrics.unknownAgent}`);
  console.log(`- invalid_uuid: ${metrics.invalidUuid}`);
  console.log(`- verification_unavailable: ${metrics.verificationUnavailable}`);
  console.log(`- tool_results_total: ${metrics.toolResultsTotal}`);
  console.log(`- tool_results_failed: ${metrics.toolResultsFailed}`);
  if (metrics.failedByTool.size > 0) {
    console.log(`- tool_failures_by_tool: ${topFailedTools(metrics.failedByTool, 10)}`);
  }

  console.log('');
  console.log('Checks:');
  for (const check of checks) {
    console.log(`- [${check.level}] ${check.message}`);
  }

  console.log('');
  console.log(`Summary: FAIL=${totalFails} WARN=${totalWarns} PASS=${checks.length - totalFails - totalWarns}`);
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  const metrics = gatherMetrics(config);
  const checks = evaluate(config, metrics);
  printReport(config, metrics, checks);

  if (checks.some((c) => c.level === 'FAIL')) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`[check-agent-autonomy-slo] ${msg}`);
  process.exitCode = 1;
});
