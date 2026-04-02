import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

type GateEventType =
  | 'planning_phase_started'
  | 'completion_gate_failed'
  | 'completion_gate_passed';

interface ParsedGateEvent {
  type: GateEventType;
  agentId: string;
  retryAttempt?: number;
  maxRetries?: number;
  missingCriteria?: string[];
}

interface RunStats {
  planningEvents: number;
  gatePassEvents: number;
  gateFailEvents: number;
  maxRetryAttemptSeen: number;
  maxRetriesConfigured: number;
  missingCriteriaMentions: number;
}

function usage(exitCode = 1): never {
  console.error(
    'Usage: tsx scripts/planning-gate-summary.ts --file <log-file> [--top 20] [--format text|csv]',
  );
  process.exit(exitCode);
}

type OutputFormat = 'text' | 'csv';

function parseArgs(argv: string[]): { file: string; top: number; format: OutputFormat } {
  if (argv.includes('--help') || argv.includes('-h')) usage(0);

  const get = (flag: string): string | undefined => {
    const eq = argv.find((arg) => arg.startsWith(`${flag}=`));
    if (eq) return eq.slice(flag.length + 1);
    const idx = argv.indexOf(flag);
    if (idx >= 0 && idx + 1 < argv.length) return argv[idx + 1];
    return undefined;
  };

  const file = get('--file');
  if (!file) usage();

  const topRaw = get('--top') ?? '20';
  const top = Number(topRaw);
  if (!Number.isFinite(top) || top <= 0) {
    throw new Error(`Invalid --top value: ${topRaw}`);
  }
  const formatRaw = (get('--format') ?? 'text').toLowerCase();
  if (formatRaw !== 'text' && formatRaw !== 'csv') {
    throw new Error(`Invalid --format value: ${formatRaw}`);
  }

  return { file, top, format: formatRaw };
}

function safeJsonParse(input: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(input) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractJsonObjectCandidate(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return safeJsonParse(trimmed);
  }

  const start = line.indexOf('{');
  const end = line.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return safeJsonParse(line.slice(start, end + 1));
}

function parseGateEventFromLine(line: string): ParsedGateEvent | null {
  const parsed = extractJsonObjectCandidate(line);
  if (!parsed) return null;
  const type = parsed.type;
  const agentId = parsed.agentId;
  if (
    type !== 'planning_phase_started'
    && type !== 'completion_gate_failed'
    && type !== 'completion_gate_passed'
  ) {
    return null;
  }
  if (typeof agentId !== 'string' || !agentId.trim()) return null;

  const retryAttempt = typeof parsed.retryAttempt === 'number' ? parsed.retryAttempt : undefined;
  const maxRetries = typeof parsed.maxRetries === 'number' ? parsed.maxRetries : undefined;
  const missingCriteria = Array.isArray(parsed.missingCriteria)
    ? parsed.missingCriteria.filter((item): item is string => typeof item === 'string')
    : undefined;

  return { type, agentId, retryAttempt, maxRetries, missingCriteria };
}

function roleFromAgentId(agentId: string): string {
  const firstToken = agentId.split('-').slice(0, 3).join('-');
  return firstToken || agentId;
}

function printRunTable(statsByRun: Map<string, RunStats>, top: number): void {
  console.log('\nTop Runs By Gate Failures');
  console.log('run_id,planning_events,gate_fail_events,gate_pass_events,max_retry_seen,max_retries_config,missing_criteria_mentions');
  const rows = Array.from(statsByRun.entries())
    .sort(([, a], [, b]) => b.gateFailEvents - a.gateFailEvents || b.planningEvents - a.planningEvents)
    .slice(0, top);
  for (const [runId, stats] of rows) {
    console.log(
      `${runId},${stats.planningEvents},${stats.gateFailEvents},${stats.gatePassEvents},${stats.maxRetryAttemptSeen},${stats.maxRetriesConfigured},${stats.missingCriteriaMentions}`,
    );
  }
}

function printRoleTable(statsByRole: Map<string, RunStats>, top: number): void {
  console.log('\nTop Roles By Gate Failures');
  console.log('role,planning_events,gate_fail_events,gate_pass_events,max_retry_seen,missing_criteria_mentions');
  const rows = Array.from(statsByRole.entries())
    .sort(([, a], [, b]) => b.gateFailEvents - a.gateFailEvents || b.planningEvents - a.planningEvents)
    .slice(0, top);
  for (const [role, stats] of rows) {
    console.log(
      `${role},${stats.planningEvents},${stats.gateFailEvents},${stats.gatePassEvents},${stats.maxRetryAttemptSeen},${stats.missingCriteriaMentions}`,
    );
  }
}

function summarizePlanningGateText(raw: string, top: number, format: OutputFormat = 'text'): void {
  const lines = raw.split(/\r?\n/);
  const statsByRun = new Map<string, RunStats>();
  const statsByRole = new Map<string, RunStats>();

  let parsedEvents = 0;
  let planningStarted = 0;
  let gatePassed = 0;
  let gateFailed = 0;

  const touch = (map: Map<string, RunStats>, key: string): RunStats => {
    const existing = map.get(key) ?? {
      planningEvents: 0,
      gatePassEvents: 0,
      gateFailEvents: 0,
      maxRetryAttemptSeen: 0,
      maxRetriesConfigured: 0,
      missingCriteriaMentions: 0,
    };
    map.set(key, existing);
    return existing;
  };

  for (const line of lines) {
    const event = parseGateEventFromLine(line);
    if (!event) continue;
    parsedEvents += 1;
    const runStats = touch(statsByRun, event.agentId);
    const roleStats = touch(statsByRole, roleFromAgentId(event.agentId));

    const update = (stats: RunStats): void => {
      if (event.type === 'planning_phase_started') {
        stats.planningEvents += 1;
      } else if (event.type === 'completion_gate_passed') {
        stats.gatePassEvents += 1;
      } else {
        stats.gateFailEvents += 1;
        stats.maxRetryAttemptSeen = Math.max(stats.maxRetryAttemptSeen, event.retryAttempt ?? 0);
        stats.maxRetriesConfigured = Math.max(stats.maxRetriesConfigured, event.maxRetries ?? 0);
        stats.missingCriteriaMentions += event.missingCriteria?.length ?? 0;
      }
    };

    update(runStats);
    update(roleStats);

    if (event.type === 'planning_phase_started') planningStarted += 1;
    if (event.type === 'completion_gate_passed') gatePassed += 1;
    if (event.type === 'completion_gate_failed') gateFailed += 1;
  }

  const runsWithPlanning = Array.from(statsByRun.values()).filter((stats) => stats.planningEvents > 0).length;
  const runsWithPass = Array.from(statsByRun.values()).filter((stats) => stats.gatePassEvents > 0).length;
  const runsWithFail = Array.from(statsByRun.values()).filter((stats) => stats.gateFailEvents > 0).length;

  if (format === 'csv') {
    console.log('table,key,planning_events,gate_fail_events,gate_pass_events,max_retry_seen,max_retries_config,missing_criteria_mentions');
    console.log(`totals,all,${planningStarted},${gateFailed},${gatePassed},0,0,0`);
    console.log(`totals,runs_with_planning,${runsWithPlanning},0,0,0,0,0`);
    console.log(`totals,runs_with_gate_fail,${runsWithFail},0,0,0,0,0`);
    console.log(`totals,runs_with_gate_pass,${runsWithPass},0,0,0,0,0`);
    const roleRows = Array.from(statsByRole.entries())
      .sort(([, a], [, b]) => b.gateFailEvents - a.gateFailEvents || b.planningEvents - a.planningEvents)
      .slice(0, top);
    for (const [role, stats] of roleRows) {
      console.log(`role,${role},${stats.planningEvents},${stats.gateFailEvents},${stats.gatePassEvents},${stats.maxRetryAttemptSeen},${stats.maxRetriesConfigured},${stats.missingCriteriaMentions}`);
    }
    const runRows = Array.from(statsByRun.entries())
      .sort(([, a], [, b]) => b.gateFailEvents - a.gateFailEvents || b.planningEvents - a.planningEvents)
      .slice(0, top);
    for (const [runId, stats] of runRows) {
      console.log(`run,${runId},${stats.planningEvents},${stats.gateFailEvents},${stats.gatePassEvents},${stats.maxRetryAttemptSeen},${stats.maxRetriesConfigured},${stats.missingCriteriaMentions}`);
    }
    return;
  }

  console.log(`Parsed planning/gate events: ${parsedEvents}`);
  console.log(`planning_phase_started: ${planningStarted}`);
  console.log(`completion_gate_passed: ${gatePassed}`);
  console.log(`completion_gate_failed: ${gateFailed}`);
  console.log(`runs_with_planning: ${runsWithPlanning}`);
  console.log(`runs_with_gate_pass: ${runsWithPass}`);
  console.log(`runs_with_gate_fail: ${runsWithFail}`);
  printRoleTable(statsByRole, top);
  printRunTable(statsByRun, top);
}

function main(): void {
  const { file, top, format } = parseArgs(process.argv.slice(2));
  const raw = readFileSync(file, 'utf8');
  summarizePlanningGateText(raw, top, format);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[planning-gate-summary] ${msg}`);
    process.exitCode = 1;
  }
}

export { summarizePlanningGateText };
