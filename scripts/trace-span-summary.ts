import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

interface SpanEndEvent {
  event: string;
  name: string;
  status?: 'ok' | 'error';
  duration_ms?: number;
  attributes?: Record<string, unknown>;
}

interface GroupStats {
  count: number;
  ok: number;
  error: number;
  durations: number[];
}

function usage(): never {
  console.error(
    'Usage: tsx scripts/trace-span-summary.ts --file <log-file> [--limit 20]',
  );
  process.exit(1);
}

function parseArgs(argv: string[]): { file: string; limit: number } {
  const get = (flag: string): string | undefined => {
    const eq = argv.find((arg) => arg.startsWith(`${flag}=`));
    if (eq) return eq.slice(flag.length + 1);
    const idx = argv.indexOf(flag);
    if (idx >= 0 && idx + 1 < argv.length) return argv[idx + 1];
    return undefined;
  };

  const file = get('--file');
  if (!file) usage();

  const limitRaw = get('--limit') ?? '20';
  const limit = Number(limitRaw);
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error(`Invalid --limit value: ${limitRaw}`);
  }

  return { file, limit };
}

function extractTraceSpanPayload(line: string): SpanEndEvent | null {
  const marker = '[TraceSpan]';
  const markerIdx = line.indexOf(marker);
  if (markerIdx < 0) return null;
  const jsonPart = line.slice(markerIdx + marker.length).trim();
  if (!jsonPart.startsWith('{')) return null;

  try {
    const parsed = JSON.parse(jsonPart) as SpanEndEvent;
    if (parsed.event !== 'span_end') return null;
    if (typeof parsed.name !== 'string') return null;
    if (typeof parsed.duration_ms !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function groupKeyTool(event: SpanEndEvent): string | null {
  if (event.name !== 'tool.execute') return null;
  const toolName = typeof event.attributes?.tool_name === 'string'
    ? event.attributes.tool_name
    : null;
  return toolName;
}

function groupKeyModelCandidate(event: SpanEndEvent): string | null {
  if (event.name !== 'model.provider_attempt') return null;
  const candidate = typeof event.attributes?.candidate_model === 'string'
    ? event.attributes.candidate_model
    : null;
  return candidate;
}

function updateGroup(
  groups: Map<string, GroupStats>,
  key: string,
  event: SpanEndEvent,
): void {
  const group = groups.get(key) ?? { count: 0, ok: 0, error: 0, durations: [] };
  group.count += 1;
  if (event.status === 'error') group.error += 1;
  else group.ok += 1;
  group.durations.push(event.duration_ms ?? 0);
  groups.set(key, group);
}

function printTable(title: string, groups: Map<string, GroupStats>, limit: number): void {
  console.log(`\n${title}`);
  console.log('name,count,ok,error,p50_ms,p95_ms,avg_ms');

  const sorted = Array.from(groups.entries())
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, limit);

  for (const [name, stats] of sorted) {
    const p50 = percentile(stats.durations, 50);
    const p95 = percentile(stats.durations, 95);
    const avg = mean(stats.durations);
    console.log(
      `${name},${stats.count},${stats.ok},${stats.error},${p50.toFixed(1)},${p95.toFixed(1)},${avg.toFixed(1)}`,
    );
  }
}

export function summarizeTraceSpanText(raw: string, limit: number): void {
  const lines = raw.split(/\r?\n/);

  const toolGroups = new Map<string, GroupStats>();
  const modelCandidateGroups = new Map<string, GroupStats>();
  let parsedEvents = 0;

  for (const line of lines) {
    const event = extractTraceSpanPayload(line);
    if (!event) continue;
    parsedEvents += 1;

    const toolKey = groupKeyTool(event);
    if (toolKey) updateGroup(toolGroups, toolKey, event);

    const modelKey = groupKeyModelCandidate(event);
    if (modelKey) updateGroup(modelCandidateGroups, modelKey, event);
  }

  console.log(`Parsed span_end events: ${parsedEvents}`);
  printTable('Tool Latency Summary', toolGroups, limit);
  printTable('Model Candidate Latency Summary', modelCandidateGroups, limit);
}

function main(): void {
  const { file, limit } = parseArgs(process.argv.slice(2));
  const raw = readFileSync(file, 'utf8');
  summarizeTraceSpanText(raw, limit);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[trace-span-summary] ${msg}`);
    process.exitCode = 1;
  }
}
