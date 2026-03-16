import { execFileSync, spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

function requiredProjectId(): string {
  const explicitSecretProject = process.env.DB_PASSWORD_SECRET_PROJECT?.trim();
  if (explicitSecretProject) {
    return explicitSecretProject;
  }

  const envProjectId =
    process.env.GCP_PROJECT_ID ??
    process.env.GOOGLE_CLOUD_PROJECT ??
    process.env.GCLOUD_PROJECT;

  if (envProjectId && envProjectId.trim().length > 0) {
    return envProjectId.trim();
  }

  try {
    const activeProject = execFileSync('gcloud', ['config', 'get-value', 'project'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    if (activeProject && activeProject !== '(unset)') {
      return activeProject;
    }
  } catch {
    // Fallback to explicit error below.
  }

  // Repository default project for local operator scripts.
  return 'ai-glyphor-company';
}

function readSecret(projectId: string, secretName: string): string {
  const gcloudBin = resolveGcloudBinary();
  let output = '';
  try {
    output = runGcloud(gcloudBin, [
      'secrets',
      'versions',
      'access',
      'latest',
      `--secret=${secretName}`,
      `--project=${projectId}`,
    ]);
  } catch (error) {
    const details = (error as Error).message || 'Unknown gcloud error.';
    throw new Error(
      `Failed to read Secret Manager secret ${secretName} in project ${projectId}. Ensure gcloud is installed and authenticated. ${details}`,
    );
  }

  const value = output.trim();
  if (!value) {
    throw new Error(`Secret ${secretName} in project ${projectId} is empty.`);
  }
  return value;
}

function canRun(command: string): boolean {
  try {
    runGcloud(command, ['--version'], false);
    return true;
  } catch {
    return false;
  }
}

function runGcloud(command: string, args: string[], captureOutput = true): string {
  const stdio: ['ignore', 'pipe', 'pipe'] | ['ignore', 'ignore', 'ignore'] = captureOutput
    ? ['ignore', 'pipe', 'pipe']
    : ['ignore', 'ignore', 'ignore'];

  if (command.toLowerCase().endsWith('.ps1')) {
    const pwsh = process.platform === 'win32' ? (canRunDirect('pwsh') ? 'pwsh' : 'powershell') : 'pwsh';
    return execFileSync(
      pwsh,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', command, ...args],
      { encoding: 'utf8', stdio },
    );
  }

  return execFileSync(command, args, { encoding: 'utf8', stdio });
}

function canRunDirect(command: string): boolean {
  try {
    execFileSync(command, ['-Version'], { stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

function resolveGcloudBinary(): string {
  const explicit = process.env.GCLOUD_BIN?.trim();
  if (explicit && canRun(explicit)) {
    return explicit;
  }

  const candidates = ['gcloud', 'gcloud.cmd', 'gcloud.exe', 'gcloud.ps1'];
  for (const candidate of candidates) {
    if (canRun(candidate)) {
      return candidate;
    }
  }

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? '';
    const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
    const windowsCandidates = [
      `${localAppData}\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd`,
      `${localAppData}\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.ps1`,
      `${programFiles}\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd`,
      `${programFiles}\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.ps1`,
    ];
    for (const candidate of windowsCandidates) {
      if (candidate && existsSync(candidate) && canRun(candidate)) {
        return candidate;
      }
    }
  }

  throw new Error(
    'gcloud CLI not found. Install Google Cloud SDK or set GCLOUD_BIN to the gcloud executable path.',
  );
}

function main(): void {
  const [targetScript, ...forwardedArgs] = process.argv.slice(2);
  if (!targetScript) {
    throw new Error('Usage: tsx scripts/run-with-gcp-db-secret.ts <script-path> [...args]');
  }

  const projectId = requiredProjectId();
  const secretName = process.env.DB_PASSWORD_SECRET_NAME?.trim() || 'db-system-password';
  const dbPassword = readSecret(projectId, secretName);
  const dbHost = resolveDbHost(projectId);
  const dbPort = process.env.DB_PORT?.trim() || '5432';
  const dbName = process.env.DB_NAME?.trim() || 'glyphor';
  const dbUser = process.env.DB_USER?.trim() || 'glyphor_system_user';
  const encodedUser = encodeURIComponent(dbUser);
  const encodedPassword = encodeURIComponent(dbPassword);
  const encodedHost = dbHost.includes(':') && !dbHost.startsWith('[') ? `[${dbHost}]` : dbHost;
  const databaseUrl = `postgresql://${encodedUser}:${encodedPassword}@${encodedHost}:${dbPort}/${dbName}`;

  const child = spawn(
    process.execPath,
    ['--import', 'tsx', resolve(targetScript), ...forwardedArgs],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        DB_HOST: dbHost,
        DB_PORT: dbPort,
        DB_NAME: dbName,
        DB_USER: dbUser,
        DB_PASSWORD: dbPassword,
        PGPASSWORD: dbPassword,
      },
    },
  );

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}

function resolveDbHost(projectId: string): string {
  const explicitHost = process.env.DB_HOST?.trim();
  if (explicitHost) {
    return explicitHost;
  }

  const instanceName = process.env.DB_INSTANCE_NAME?.trim() || 'glyphor-db';
  const output = runGcloud(
    resolveGcloudBinary(),
    [
      'sql',
      'instances',
      'describe',
      instanceName,
      `--project=${projectId}`,
      '--format=value(ipAddresses[0].ipAddress)',
    ],
  ).trim();

  if (!output) {
    throw new Error(
      `Unable to resolve DB host from Cloud SQL instance ${instanceName}. Set DB_HOST explicitly or check Cloud SQL access.`,
    );
  }

  return output;
}

main();
