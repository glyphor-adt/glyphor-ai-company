import 'dotenv/config';
import { execSync } from 'node:child_process';

type EnvEntry = {
  name?: string;
  value?: string;
  valueFrom?: {
    secretKeyRef?: {
      name?: string;
      key?: string;
    };
  };
};

type CloudRunService = {
  spec?: {
    template?: {
      spec?: {
        serviceAccountName?: string;
        containers?: Array<{
          env?: EnvEntry[];
        }>;
      };
    };
  };
  status?: {
    url?: string;
    latestReadyRevisionName?: string;
  };
};

type ServicePolicy = {
  requiredEnv: string[];
  requiredSecrets?: string[];
  requireRunInvokerForServiceAccount?: string;
};

type Args = {
  project: string;
  region: string;
  schedulerService: string;
  workerService: string;
};

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let project = process.env.GCP_PROJECT_ID || 'ai-glyphor-company';
  let region = process.env.GCP_REGION || 'us-central1';
  let schedulerService = 'glyphor-scheduler';
  let workerService = 'glyphor-worker';

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--project' && args[i + 1]) {
      project = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--region' && args[i + 1]) {
      region = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--scheduler' && args[i + 1]) {
      schedulerService = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--worker' && args[i + 1]) {
      workerService = args[i + 1];
      i += 1;
      continue;
    }
  }

  return { project, region, schedulerService, workerService };
}

function runJson(command: string[]): unknown {
  const cmd = command.map((part) => (/\s/.test(part) ? `"${part}"` : part)).join(' ');
  const stdout = execSync(cmd, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });
  return JSON.parse(stdout);
}

function describeService(service: string, region: string, project: string): CloudRunService {
  return runJson([
    'gcloud',
    'run',
    'services',
    'describe',
    service,
    '--region',
    region,
    '--project',
    project,
    '--format=json',
  ]) as CloudRunService;
}

function listRunInvokerMembers(service: string, region: string, project: string): string[] {
  const policy = runJson([
    'gcloud',
    'run',
    'services',
    'get-iam-policy',
    service,
    '--region',
    region,
    '--project',
    project,
    '--format=json',
  ]) as {
    bindings?: Array<{ role?: string; members?: string[] }>;
  };

  const invokerBinding = (policy.bindings ?? []).find((binding) => binding.role === 'roles/run.invoker');
  return invokerBinding?.members ?? [];
}

function envMap(service: CloudRunService): Map<string, EnvEntry> {
  const entries = service.spec?.template?.spec?.containers?.[0]?.env ?? [];
  return new Map(entries.filter((entry) => entry.name).map((entry) => [String(entry.name), entry]));
}

function secretName(entry?: EnvEntry): string | null {
  return entry?.valueFrom?.secretKeyRef?.name ?? null;
}

function literalValue(entry?: EnvEntry): string | null {
  return typeof entry?.value === 'string' ? entry.value : null;
}

function assertRequiredEnv(
  serviceName: string,
  policy: ServicePolicy,
  env: Map<string, EnvEntry>,
  failures: string[],
): void {
  for (const key of policy.requiredEnv) {
    if (!env.has(key)) {
      failures.push(`${serviceName}: missing required env ${key}`);
    }
  }
}

function assertRequiredSecrets(
  serviceName: string,
  policy: ServicePolicy,
  env: Map<string, EnvEntry>,
  failures: string[],
): void {
  for (const key of policy.requiredSecrets ?? []) {
    const entry = env.get(key);
    if (!entry) {
      failures.push(`${serviceName}: missing required secret env ${key}`);
      continue;
    }
    if (!secretName(entry)) {
      failures.push(`${serviceName}: ${key} must be secret-backed`);
    }
  }
}

function main(): void {
  const { project, region, schedulerService, workerService } = parseArgs();
  const failures: string[] = [];

  const scheduler = describeService(schedulerService, region, project);
  const worker = describeService(workerService, region, project);
  const schedulerEnv = envMap(scheduler);
  const workerEnv = envMap(worker);

  const schedulerPolicy: ServicePolicy = {
    requiredEnv: ['WORKER_URL'],
    requiredSecrets: ['WORKER_SHARED_SECRET'],
    requireRunInvokerForServiceAccount: scheduler.spec?.template?.spec?.serviceAccountName,
  };

  const workerPolicy: ServicePolicy = {
    requiredEnv: ['WORKER_OIDC_SERVICE_ACCOUNT_EMAIL'],
    requiredSecrets: ['VERCEL_API_TOKEN', 'VERCEL_TEAM_ID', 'WORKER_SHARED_SECRET'],
  };

  assertRequiredEnv(schedulerService, schedulerPolicy, schedulerEnv, failures);
  assertRequiredSecrets(schedulerService, schedulerPolicy, schedulerEnv, failures);
  assertRequiredEnv(workerService, workerPolicy, workerEnv, failures);
  assertRequiredSecrets(workerService, workerPolicy, workerEnv, failures);

  const schedulerWorkerUrl = literalValue(schedulerEnv.get('WORKER_URL'));
  const workerUrl = worker.status?.url ?? null;
  if (!schedulerWorkerUrl) {
    failures.push(`${schedulerService}: WORKER_URL is not set`);
  } else if (workerUrl && schedulerWorkerUrl !== workerUrl) {
    failures.push(
      `${schedulerService}: WORKER_URL mismatch. configured=${schedulerWorkerUrl}, worker.status.url=${workerUrl}`,
    );
  }

  const expectedSchedulerSa = schedulerPolicy.requireRunInvokerForServiceAccount;
  if (expectedSchedulerSa) {
    const invokers = listRunInvokerMembers(workerService, region, project);
    const expectedMember = `serviceAccount:${expectedSchedulerSa}`;
    if (!invokers.includes(expectedMember)) {
      failures.push(`${workerService}: missing run.invoker IAM for ${expectedMember}`);
    }
  }

  const workerSharedSecret = secretName(workerEnv.get('WORKER_SHARED_SECRET'));
  const schedulerSharedSecret = secretName(schedulerEnv.get('WORKER_SHARED_SECRET'));
  if (!workerSharedSecret || !schedulerSharedSecret || workerSharedSecret !== schedulerSharedSecret) {
    failures.push(
      `${schedulerService}/${workerService}: WORKER_SHARED_SECRET must be set to the same secret on both services`,
    );
  }

  const schedulerRow = {
    service: schedulerService,
    revision: scheduler.status?.latestReadyRevisionName ?? 'unknown',
    workerUrl: schedulerWorkerUrl ?? 'missing',
    workerSharedSecret: schedulerSharedSecret ?? 'missing',
  };
  const workerRow = {
    service: workerService,
    revision: worker.status?.latestReadyRevisionName ?? 'unknown',
    workerUrl: workerUrl ?? 'unknown',
    workerOidcServiceAccount: literalValue(workerEnv.get('WORKER_OIDC_SERVICE_ACCOUNT_EMAIL')) ?? 'missing',
    vercelTokenSecret: secretName(workerEnv.get('VERCEL_API_TOKEN')) ?? 'missing',
    vercelTeamSecret: secretName(workerEnv.get('VERCEL_TEAM_ID')) ?? 'missing',
    workerSharedSecret: workerSharedSecret ?? 'missing',
  };
  console.table([schedulerRow, workerRow]);

  if (failures.length > 0) {
    console.error('\nRuntime Cloud Run verification failed:\n');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('\nRuntime Cloud Run verification passed.');
}

main();
