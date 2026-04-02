import { execFileSync } from 'node:child_process';
import { summarizeTraceSpanText } from './trace-span-summary.ts';

interface Config {
  project: string;
  service: string;
  minutes: number;
  limit: number;
  top: number;
}

function usage(exitCode = 1): never {
  console.error(
    'Usage: tsx scripts/trace-span-cloudrun-summary.ts --project <gcp-project> --service <cloud-run-service> [--minutes 30] [--limit 3000] [--top 20]',
  );
  process.exit(exitCode);
}

function parseArgs(argv: string[]): Config {
  if (argv.includes('--help') || argv.includes('-h')) usage(0);

  const get = (flag: string): string | undefined => {
    const eq = argv.find((arg) => arg.startsWith(`${flag}=`));
    if (eq) return eq.slice(flag.length + 1);
    const idx = argv.indexOf(flag);
    if (idx >= 0 && idx + 1 < argv.length) return argv[idx + 1];
    return undefined;
  };

  const minutesRaw = get('--minutes') ?? '30';
  const limitRaw = get('--limit') ?? '3000';
  const topRaw = get('--top') ?? '20';
  const project = get('--project') ?? process.env.GCLOUD_PROJECT ?? 'ai-glyphor-company';
  const service = get('--service') ?? 'glyphor-scheduler';

  const minutes = Number(minutesRaw);
  const limit = Number(limitRaw);
  const top = Number(topRaw);

  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new Error(`Invalid --minutes value: ${minutesRaw}`);
  }
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error(`Invalid --limit value: ${limitRaw}`);
  }
  if (!Number.isFinite(top) || top <= 0) {
    throw new Error(`Invalid --top value: ${topRaw}`);
  }

  return { project, service, minutes, limit, top };
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

  throw new Error('gcloud CLI not found in PATH. Install Google Cloud SDK or set GCLOUD_BIN.');
}

function fetchTraceSpanLogs(config: Config): string {
  const query = [
    'resource.type="cloud_run_revision"',
    `resource.labels.service_name="${config.service}"`,
    'textPayload:"[TraceSpan]"',
  ].join(' AND ');

  const args = [
    'logging',
    'read',
    query,
    '--project',
    config.project,
    '--freshness',
    `${config.minutes}m`,
    '--limit',
    String(config.limit),
    '--format',
    'value(textPayload)',
  ];

  const gcloudBin = resolveGcloudBinary();
  return execFileSync(gcloudBin, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function main(): void {
  const config = parseArgs(process.argv.slice(2));
  const raw = fetchTraceSpanLogs(config);
  console.log(`Fetched trace log lines from service=${config.service} project=${config.project} window=${config.minutes}m`);
  summarizeTraceSpanText(raw, config.top);
}

try {
  main();
} catch (error) {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`[trace-span-cloudrun-summary] ${msg}`);
  process.exitCode = 1;
}
