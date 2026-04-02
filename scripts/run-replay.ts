import { pathToFileURL } from 'node:url';
import { replayRun } from '@glyphor/agent-runtime';

function usage(): never {
  console.error('Usage: tsx scripts/run-replay.ts --run-id <uuid> [--json]');
  process.exit(1);
}

function parseArgs(argv: string[]): { runId: string; asJson: boolean } {
  const get = (flag: string): string | undefined => {
    const eq = argv.find((arg) => arg.startsWith(`${flag}=`));
    if (eq) return eq.slice(flag.length + 1);
    const idx = argv.indexOf(flag);
    if (idx >= 0 && idx + 1 < argv.length) return argv[idx + 1];
    return undefined;
  };
  const runId = get('--run-id');
  if (!runId) usage();
  return { runId, asJson: argv.includes('--json') };
}

function printHumanReadableReplay(data: Awaited<ReturnType<typeof replayRun>>): void {
  console.log(`Run: ${data.runId}`);
  console.log(`Events: ${data.events.length}`);
  for (const event of data.events) {
    console.log(
      `#${event.eventSeq} ${event.eventType} [${event.component}] trigger=${event.trigger ?? 'n/a'} approval=${event.approvalState ?? 'n/a'} @ ${event.createdAt}`,
    );
  }
  if (data.claims.length > 0) {
    console.log('\nClaim-Evidence Links');
    for (const claim of data.claims) {
      console.log(`- ${claim.claimUid}: ${claim.verificationState} -> ${claim.evidenceUid}`);
      console.log(`  ${claim.claimText}`);
    }
  } else {
    console.log('\nNo claim-evidence links found.');
  }
}

async function main(): Promise<void> {
  const { runId, asJson } = parseArgs(process.argv.slice(2));
  const data = await replayRun(runId);
  if (asJson) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  printHumanReadableReplay(data);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[run-replay] ${msg}`);
    process.exitCode = 1;
  });
}
