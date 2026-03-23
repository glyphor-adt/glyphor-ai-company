/**
 * Smoke-test GTM + platform agents via the same path as dashboard chat: POST {SCHEDULER_URL}/run
 *
 *   npx tsx scripts/smoke-test-all-agents.ts
 *   SCHEDULER_URL=https://... npx tsx scripts/smoke-test-all-agents.ts
 *
 * Runs all agents in parallel (heavy — use against staging or expect rate limits).
 */
import 'dotenv/config';

interface ActionReceipt {
  tool: string;
  params: Record<string, unknown>;
  result: 'success' | 'error';
  output: string;
  timestamp: string;
}

interface RunResponse {
  routed?: boolean;
  action?: string;
  agentRole?: string;
  task?: string;
  reason?: string;
  output?: string | null;
  status?: string;
  error?: string;
  actions?: ActionReceipt[];
}

const SCHEDULER_URL = (process.env.SCHEDULER_URL ?? process.env.VITE_SCHEDULER_URL ?? '').replace(/\/$/, '');
const TIMEOUT_MS = Math.min(
  900_000,
  Math.max(60_000, parseInt(process.env.SMOKE_AGENT_TIMEOUT_MS ?? '600000', 10) || 600_000),
);

const ROLES_REQUIRING_GLYPHOR_IN_OUTPUT = new Set([
  'cmo',
  'content-creator',
  'social-media-manager',
  'chief-of-staff',
  'clo',
  'vp-design',
  'global-admin',
]);

const AGENTS: { role: string; displayName: string; task: string; expectWebSearch?: boolean }[] = [
  {
    role: 'cmo',
    displayName: 'Maya Brooks (CMO)',
    task: `What is Glyphor's brand voice and who is our target customer? Give me a 2-sentence summary and one example LinkedIn hook that demonstrates the voice.`,
  },
  {
    role: 'content-creator',
    displayName: 'Tyler Reed (Content Creator)',
    task: `Write a 3-sentence LinkedIn post announcing that Glyphor's AI Marketing Department is now in early access. Use our brand voice.`,
  },
  {
    role: 'seo-analyst',
    displayName: 'Lisa Chen (SEO Analyst)',
    task: `What are the top 3 keywords we should target for our product page? Use web search to find current search volume.`,
    expectWebSearch: true,
  },
  {
    role: 'social-media-manager',
    displayName: 'Kai Johnson (Social Media Manager)',
    task: `What should we post on LinkedIn tomorrow? Give me one post with a hook, body, and CTA.`,
  },
  {
    role: 'chief-of-staff',
    displayName: 'Sarah Chen (Chief of Staff)',
    task: `What is the current status of the Still You Campaign directive? What's been completed and what's blocking us?`,
  },
  {
    role: 'cto',
    displayName: 'Marcus Reeves (CTO)',
    task: `Run a platform health check. Return status of all Cloud Run services and flag anything degraded.`,
  },
  {
    role: 'ops',
    displayName: 'Atlas Vega (Ops)',
    task: `Run a system health check and return current status.`,
  },
  {
    role: 'platform-intel',
    displayName: 'Nexus (platform-intel)',
    task: `What is the current GTM readiness status and what are the top 3 blockers?`,
  },
  {
    role: 'clo',
    displayName: 'Victoria Chase (CLO)',
    task: `What are the top 3 legal risks Glyphor should address before onboarding our first customer?`,
  },
  {
    role: 'm365-admin',
    displayName: 'Riley Morgan (M365 Admin)',
    task: `Confirm Teams is operational and list any pending access requests.`,
  },
  {
    role: 'global-admin',
    displayName: 'Morgan Blake (Global Admin)',
    task: `Give me a summary of current platform access and any pending requests.`,
  },
  {
    role: 'vp-design',
    displayName: 'Mia Tanaka (VP Design)',
    task: `Review the AI Marketing Department brand for visual consistency. What are the top 2 things to address?`,
  },
];

function stripReasoning(text: string): string {
  return text.replace(/<reasoning>[\s\S]*?<\/reasoning>\s*/g, '').trim();
}

function extractOutput(data: RunResponse): string {
  if (typeof data.output === 'string' && data.output.trim()) return stripReasoning(data.output);
  if (data.action === 'queued_for_approval') return '[Queued for approval — no final output yet]';
  if (data.error) return `[Error] ${data.error}`;
  if (data.reason) return `[Reason] ${data.reason}`;
  return '';
}

function toolCallsFailed(actions: ActionReceipt[] | undefined): number {
  return (actions ?? []).filter((a) => a.result === 'error').length;
}

function usedWebSearch(actions: ActionReceipt[] | undefined): boolean {
  return (actions ?? []).some((a) => {
    const t = (a.tool ?? '').toLowerCase();
    return t.includes('web_search') || t.includes('search') || t === 'google_search';
  });
}

function evaluatePass(
  role: string,
  data: RunResponse | null,
  httpStatus: number,
  fetchError: string | null,
  expectWebSearch?: boolean,
): { pass: boolean; reason: string } {
  if (fetchError) return { pass: false, reason: fetchError };
  if (httpStatus < 200 || httpStatus >= 300) {
    return { pass: false, reason: `HTTP ${httpStatus}` };
  }
  if (!data) return { pass: false, reason: 'Empty JSON body' };

  if (data.action === 'queued_for_approval') {
    return { pass: true, reason: 'Queued for approval (authority tier)' };
  }
  if (data.routed === false || data.action === 'rejected') {
    return { pass: false, reason: data.reason || data.error || 'Route rejected' };
  }

  const status = (data.status ?? '').toLowerCase();
  if (status === 'aborted' || status === 'error') {
    return { pass: false, reason: data.error || 'Run aborted or errored' };
  }

  const text = extractOutput(data);
  if (!text || text.length < 25) {
    return { pass: false, reason: 'Output missing or too short' };
  }

  const failed = toolCallsFailed(data.actions);
  if (failed > 0) {
    return { pass: false, reason: `${failed} tool call(s) returned error` };
  }

  if (expectWebSearch && !usedWebSearch(data.actions)) {
    return { pass: false, reason: 'Prompt asked for web search but no web search tool was invoked' };
  }

  if (ROLES_REQUIRING_GLYPHOR_IN_OUTPUT.has(role) && !text.toLowerCase().includes('glyphor')) {
    return { pass: false, reason: 'Expected Glyphor in response for this role' };
  }

  return { pass: true, reason: 'Heuristic pass (review output for hallucinations)' };
}

async function runOne(entry: (typeof AGENTS)[0]): Promise<{
  role: string;
  displayName: string;
  toolCallCount: number;
  toolFailures: number;
  preview: string;
  pass: boolean;
  passReason: string;
  raw: RunResponse | null;
  httpStatus: number;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let httpStatus = 0;
  let fetchError: string | null = null;
  let data: RunResponse | null = null;

  try {
    const res = await fetch(`${SCHEDULER_URL}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentRole: entry.role,
        task: 'on_demand',
        message: entry.task,
        userName: 'Smoke Test',
        userEmail: 'smoke-test@glyphor.ai',
        history: [],
      }),
      signal: controller.signal,
    });
    httpStatus = res.status;
    if (!res.ok) {
      fetchError = `HTTP ${res.status} ${await res.text().catch(() => '')}`.slice(0, 500);
    } else {
      data = (await res.json()) as RunResponse;
    }
  } catch (e) {
    fetchError = e instanceof Error ? e.message : String(e);
  } finally {
    clearTimeout(timer);
  }

  const actions = data?.actions ?? [];
  const toolFailures = toolCallsFailed(actions);
  const text = extractOutput(data ?? {});
  const preview = text.slice(0, 500);
  const { pass, reason } = evaluatePass(entry.role, data, httpStatus, fetchError, entry.expectWebSearch);

  return {
    role: entry.role,
    displayName: entry.displayName,
    toolCallCount: actions.length,
    toolFailures,
    preview,
    pass,
    passReason: reason,
    raw: data,
    httpStatus,
  };
}

async function main(): Promise<void> {
  if (!SCHEDULER_URL) {
    console.error('Set SCHEDULER_URL or VITE_SCHEDULER_URL to your scheduler base (no trailing slash).');
    process.exit(1);
  }

  console.log(`Scheduler: ${SCHEDULER_URL}`);
  console.log(`Timeout per agent: ${TIMEOUT_MS}ms`);
  console.log(`Starting ${AGENTS.length} parallel /run calls…\n`);

  const results = await Promise.all(AGENTS.map((a) => runOne(a)));

  console.log('=== Summary ===\n');
  console.table(
    results.map((r) => ({
      role: r.role,
      displayName: r.displayName.slice(0, 28),
      tools: r.toolCallCount,
      toolErrs: r.toolFailures,
      http: r.httpStatus,
      result: r.pass ? 'PASS' : 'FAIL',
      note: r.passReason.slice(0, 60),
    })),
  );

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nTotal: ${passed}/${results.length} heuristic PASS`);

  console.log('\n=== Full output per agent ===\n');
  for (const r of results) {
    console.log('—'.repeat(72));
    console.log(`${r.displayName} (${r.role})`);
    console.log(`HTTP ${r.httpStatus} | tools: ${r.toolCallCount} | tool errors: ${r.toolFailures} | ${r.pass ? 'PASS' : 'FAIL'}: ${r.passReason}`);
    console.log('\nPreview (500 chars):\n', r.preview || '(none)');
    if (r.raw?.actions?.length) {
      console.log('\nTool calls:');
      for (const a of r.raw.actions) {
        console.log(`  - ${a.tool} [${a.result}] ${(a.output ?? '').slice(0, 120)}${(a.output?.length ?? 0) > 120 ? '…' : ''}`);
      }
    }
    console.log('\nRaw JSON:', JSON.stringify(r.raw, null, 2));
    console.log('');
  }

  process.exit(results.every((r) => r.pass) ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
