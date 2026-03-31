import 'dotenv/config';
import { execSync } from 'node:child_process';
import { getWebsitePipelineEnvReport, WEBSITE_PIPELINE_ENV_REQUIREMENTS } from '../packages/integrations/src/websitePipelineEnv.js';

type CloudRunEnvEntry = {
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
        containers?: Array<{
          env?: CloudRunEnvEntry[];
        }>;
      };
    };
  };
};

function parseArgs(): { project: string; region: string; services: string[] } {
  const args = process.argv.slice(2);
  const services: string[] = [];
  let project = process.env.GCP_PROJECT_ID || 'ai-glyphor-company';
  let region = process.env.GCP_REGION || 'us-central1';

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--project' && args[index + 1]) {
      project = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--region' && args[index + 1]) {
      region = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--service' && args[index + 1]) {
      services.push(args[index + 1]);
      index += 1;
      continue;
    }
  }

  return {
    project,
    region,
    services: services.length > 0 ? services : ['glyphor-scheduler'],
  };
}

function describeService(service: string, region: string, project: string): CloudRunService {
  const command = [
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
  ].map((part) => (part.includes(' ') ? `"${part}"` : part)).join(' ');

  let stdout: string;
  try {
    stdout = execSync(command, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to execute gcloud for ${service}. Ensure Cloud SDK is installed and authenticated. ${message}`);
  }
  return JSON.parse(stdout) as CloudRunService;
}

function getEnvEntries(service: CloudRunService): CloudRunEnvEntry[] {
  return service.spec?.template?.spec?.containers?.[0]?.env ?? [];
}

function formatEnvSource(entry: CloudRunEnvEntry): string {
  if (entry.valueFrom?.secretKeyRef?.name) {
    return `secret:${entry.valueFrom.secretKeyRef.name}`;
  }
  if (typeof entry.value === 'string') {
    return 'literal';
  }
  return 'unknown';
}

function main(): void {
  const { project, region, services } = parseArgs();

  const failures: string[] = [];
  const summaries: Array<Record<string, string>> = [];

  for (const serviceName of services) {
    const service = describeService(serviceName, region, project);
    const envEntries = getEnvEntries(service);
    const envMap = new Map(envEntries.filter((entry) => entry.name).map((entry) => [String(entry.name), entry]));

    for (const requirement of WEBSITE_PIPELINE_ENV_REQUIREMENTS) {
      const matchedEnv = requirement.acceptedEnvNames.find((envName) => envMap.has(envName));
      if (!matchedEnv) {
        failures.push(
          `${serviceName}: missing ${requirement.preferredEnvName}. Accepted env vars: ${requirement.acceptedEnvNames.join(', ')}. Recommended secret(s): ${requirement.recommendedSecretNames.join(', ')}`,
        );
        continue;
      }

      const entry = envMap.get(matchedEnv)!;
      summaries.push({
        service: serviceName,
        requirement: requirement.id,
        env: matchedEnv,
        source: formatEnvSource(entry),
      });
    }
  }

  if (summaries.length > 0) {
    console.table(summaries);
  }

  if (failures.length > 0) {
    console.error('\nWebsite pipeline Cloud Run env verification failed:\n');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  const localReport = getWebsitePipelineEnvReport();
  console.log(`\nCloud Run env verification passed for ${services.join(', ')}.`);
  console.log(`Local shell currently satisfies ${localReport.satisfied.length}/${WEBSITE_PIPELINE_ENV_REQUIREMENTS.length} website pipeline env requirements.`);
}

main();