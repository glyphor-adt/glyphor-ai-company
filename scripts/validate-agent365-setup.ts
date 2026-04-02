import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

type CheckLevel = 'PASS' | 'WARN' | 'FAIL';

interface CheckResult {
  level: CheckLevel;
  message: string;
}

interface IdentityRecord {
  blueprintSpId?: string;
  entraUserId?: string;
  upn?: string;
}

interface ManifestServer {
  mcpServerName?: string;
  url?: string;
}

interface ManifestFile {
  mcpServers?: ManifestServer[];
}

interface UserExportFile {
  value?: Array<{
    id?: string;
    displayName?: string;
    userPrincipalName?: string;
  }>;
}

const ROOT = process.cwd();
const IDENTITIES_PATH = path.join(ROOT, 'packages', 'agent-runtime', 'src', 'config', 'agentIdentities.json');
const EMAIL_MAP_PATH = path.join(ROOT, 'packages', 'agent-runtime', 'src', 'config', 'agentEmails.ts');
const MANIFEST_PATH = path.join(ROOT, 'ToolingManifest.json');
const ALL_USERS_EXPORT_PATH = path.join(ROOT, '_all_users.json');

const REQUIRED_ENV = [
  'AGENT365_ENABLED',
  'AGENT365_CLIENT_ID',
  'AGENT365_CLIENT_SECRET',
  'AGENT365_TENANT_ID',
  'AGENT365_BLUEPRINT_ID',
] as const;

function parseFlags(argv: string[]): { strictEnv: boolean } {
  return {
    strictEnv: argv.includes('--strict-env'),
  };
}

function loadIdentities(): Record<string, IdentityRecord> {
  return JSON.parse(readFileSync(IDENTITIES_PATH, 'utf8')) as Record<string, IdentityRecord>;
}

function loadAgentEmailMap(): Record<string, string> {
  const source = readFileSync(EMAIL_MAP_PATH, 'utf8');
  const roleToEmail: Record<string, string> = {};

  const entryPattern = /'([^']+)'\s*:\s*\{\s*email:\s*'([^']+)'/g;
  for (const match of source.matchAll(entryPattern)) {
    roleToEmail[match[1]] = match[2].toLowerCase();
  }

  return roleToEmail;
}

function loadManifest(): ManifestFile {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as ManifestFile;
}

function loadAllUsersExport(): UserExportFile | null {
  if (!existsSync(ALL_USERS_EXPORT_PATH)) {
    return null;
  }

  const raw = readFileSync(ALL_USERS_EXPORT_PATH, 'utf8');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    return null;
  }

  return JSON.parse(raw.slice(start, end + 1)) as UserExportFile;
}

function hasDuplicates(values: string[]): string[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([value]) => value);
}

function runChecks(strictEnv: boolean): CheckResult[] {
  const results: CheckResult[] = [];

  if (!existsSync(IDENTITIES_PATH)) {
    results.push({ level: 'FAIL', message: `Missing identity file: ${IDENTITIES_PATH}` });
    return results;
  }
  if (!existsSync(EMAIL_MAP_PATH)) {
    results.push({ level: 'FAIL', message: `Missing email map file: ${EMAIL_MAP_PATH}` });
    return results;
  }
  if (!existsSync(MANIFEST_PATH)) {
    results.push({ level: 'FAIL', message: `Missing ToolingManifest.json: ${MANIFEST_PATH}` });
    return results;
  }

  const identities = loadIdentities();
  const emailMap = loadAgentEmailMap();
  const manifest = loadManifest();
  const allUsersExport = loadAllUsersExport();

  const identityRoles = Object.keys(identities);
  const emailRoles = Object.keys(emailMap);

  const missingIdentityRoles = emailRoles.filter((role) => !identityRoles.includes(role));
  const missingEmailRoles = identityRoles.filter((role) => !emailRoles.includes(role));

  if (missingIdentityRoles.length === 0) {
    results.push({ level: 'PASS', message: `Identity coverage OK (${identityRoles.length} roles).` });
  } else {
    results.push({ level: 'FAIL', message: `Roles missing in agentIdentities.json: ${missingIdentityRoles.join(', ')}` });
  }

  if (missingEmailRoles.length === 0) {
    results.push({ level: 'PASS', message: `Email map coverage OK (${emailRoles.length} roles).` });
  } else {
    results.push({ level: 'FAIL', message: `Roles missing in AGENT_EMAIL_MAP: ${missingEmailRoles.join(', ')}` });
  }

  const missingBlueprint = identityRoles.filter((role) => !identities[role]?.blueprintSpId);
  const missingEntra = identityRoles.filter((role) => !identities[role]?.entraUserId);
  const missingUpn = identityRoles.filter((role) => !identities[role]?.upn);

  if (missingBlueprint.length === 0) {
    results.push({ level: 'PASS', message: 'All identities have blueprintSpId.' });
  } else {
    results.push({ level: 'FAIL', message: `Missing blueprintSpId for: ${missingBlueprint.join(', ')}` });
  }

  if (missingEntra.length === 0) {
    results.push({ level: 'PASS', message: 'All identities have entraUserId.' });
  } else {
    results.push({ level: 'FAIL', message: `Missing entraUserId for: ${missingEntra.join(', ')}` });
  }

  if (missingUpn.length === 0) {
    results.push({ level: 'PASS', message: 'All identities have UPN values.' });
  } else {
    results.push({ level: 'WARN', message: `Missing UPN for: ${missingUpn.join(', ')}` });
  }

  const upnMismatches = identityRoles.filter((role) => {
    const upn = identities[role]?.upn?.toLowerCase();
    const email = emailMap[role]?.toLowerCase();
    return !!upn && !!email && upn !== email;
  });
  if (upnMismatches.length === 0) {
    results.push({ level: 'PASS', message: 'Identity UPN and AGENT_EMAIL_MAP are aligned.' });
  } else {
    results.push({ level: 'WARN', message: `UPN/email mismatch for roles: ${upnMismatches.join(', ')}` });
  }

  const duplicateBlueprints = hasDuplicates(identityRoles.map((role) => identities[role]?.blueprintSpId ?? '').filter(Boolean));
  const duplicateEntraUsers = hasDuplicates(identityRoles.map((role) => identities[role]?.entraUserId ?? '').filter(Boolean));

  if (duplicateBlueprints.length === 0) {
    results.push({ level: 'PASS', message: 'No duplicate blueprintSpId values.' });
  } else {
    results.push({ level: 'FAIL', message: `Duplicate blueprintSpId values found: ${duplicateBlueprints.join(', ')}` });
  }

  if (duplicateEntraUsers.length === 0) {
    results.push({ level: 'PASS', message: 'No duplicate entraUserId values.' });
  } else {
    results.push({ level: 'FAIL', message: `Duplicate entraUserId values found: ${duplicateEntraUsers.join(', ')}` });
  }

  if (allUsersExport?.value?.length) {
    const exportedUpns = new Set(
      allUsersExport.value
        .map((entry) => entry.userPrincipalName?.toLowerCase())
        .filter((value): value is string => !!value),
    );
    const missingExportUsers = emailRoles.filter((role) => !exportedUpns.has(emailMap[role].toLowerCase()));

    if (missingExportUsers.length === 0) {
      results.push({ level: 'PASS', message: `All AGENT_EMAIL_MAP users exist in _all_users.json (${exportedUpns.size} exported users).` });
    } else {
      results.push({ level: 'WARN', message: `Roles missing from _all_users.json export: ${missingExportUsers.join(', ')}` });
    }
  } else {
    results.push({ level: 'WARN', message: '_all_users.json not found; skipped exported-user verification.' });
  }

  const mailToolsServer = (manifest.mcpServers ?? []).find((server) => server.mcpServerName === 'mcp_MailTools');
  if (!mailToolsServer?.url) {
    results.push({ level: 'FAIL', message: 'ToolingManifest is missing mcp_MailTools URL.' });
  } else if (!mailToolsServer.url.includes('agent365.svc.cloud.microsoft')) {
    results.push({ level: 'WARN', message: `mcp_MailTools URL is non-standard: ${mailToolsServer.url}` });
  } else {
    results.push({ level: 'PASS', message: `mcp_MailTools URL configured: ${mailToolsServer.url}` });
  }

  const missingEnv = REQUIRED_ENV.filter((name) => !process.env[name]);
  const enabled = process.env.AGENT365_ENABLED;

  if (strictEnv) {
    if (enabled !== 'true') {
      results.push({ level: 'FAIL', message: `AGENT365_ENABLED must be 'true' in strict mode (actual: ${enabled ?? 'unset'})` });
    }
    if (missingEnv.length > 0) {
      results.push({ level: 'FAIL', message: `Missing required AGENT365 env vars: ${missingEnv.join(', ')}` });
    } else {
      results.push({ level: 'PASS', message: 'Required AGENT365 env vars are present.' });
    }
  } else {
    if (enabled === 'true') {
      if (missingEnv.length > 0) {
        results.push({ level: 'FAIL', message: `AGENT365_ENABLED=true but env vars are missing: ${missingEnv.join(', ')}` });
      } else {
        results.push({ level: 'PASS', message: 'AGENT365 env vars present for enabled mode.' });
      }
    } else {
      results.push({ level: 'WARN', message: `AGENT365_ENABLED is ${enabled ?? 'unset'} in current shell; runtime env verification is partial.` });
    }
  }

  return results;
}

function printResults(results: CheckResult[]): void {
  const byLevel = {
    PASS: results.filter((r) => r.level === 'PASS'),
    WARN: results.filter((r) => r.level === 'WARN'),
    FAIL: results.filter((r) => r.level === 'FAIL'),
  };

  for (const result of results) {
    const prefix = result.level === 'PASS' ? '[PASS]' : result.level === 'WARN' ? '[WARN]' : '[FAIL]';
    console.log(`${prefix} ${result.message}`);
  }

  console.log('');
  console.log(`Summary: PASS ${byLevel.PASS.length} | WARN ${byLevel.WARN.length} | FAIL ${byLevel.FAIL.length}`);
}

async function main(): Promise<void> {
  const { strictEnv } = parseFlags(process.argv.slice(2));
  const results = runChecks(strictEnv);
  printResults(results);

  const failures = results.filter((r) => r.level === 'FAIL');
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[validate-agent365-setup] Failed: ${message}`);
  process.exitCode = 1;
});
