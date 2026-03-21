/**
 * Lists tool_registry rows with bearer_env auth, compares auth_env_var to
 * secret env keys mounted on glyphor-scheduler OR glyphor-worker (Cloud Run).
 * Deletes rows whose auth_env_var is missing or not mounted as a secret on either service.
 *
 * Usage: npx tsx scripts/run-with-gcp-db-secret.ts --db-user glyphor_app --db-password-secret db-password scripts/audit-delete-bearer-env-tool-registry.ts [--dry-run]
 */
import { closePool, systemQuery } from '@glyphor/shared/db';

if (!process.env.GCP_PROJECT_ID?.trim()) {
  process.env.GCP_PROJECT_ID =
    process.env.GOOGLE_CLOUD_PROJECT?.trim() || 'ai-glyphor-company';
}

async function getGCPAccessToken(): Promise<string> {
  try {
    const metadataRes = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      { headers: { 'Metadata-Flavor': 'Google' } },
    );
    if (metadataRes.ok) {
      const tokenData = (await metadataRes.json()) as { access_token: string };
      return tokenData.access_token;
    }
  } catch {
    /* not on GCP */
  }
  const { GoogleAuth } = await import('google-auth-library');
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  const tokenRes = await client.getAccessToken();
  if (!tokenRes.token) throw new Error('Failed to get GCP access token via ADC');
  return tokenRes.token;
}

async function fetchSecretEnvKeys(serviceSuffix: string): Promise<Set<string>> {
  const projectId = process.env.GCP_PROJECT_ID!;
  const region = 'us-central1';
  const serviceName = `glyphor-${serviceSuffix}`;
  const token = await getGCPAccessToken();
  const url = `https://run.googleapis.com/v2/projects/${projectId}/locations/${region}/services/${serviceName}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`Cloud Run GET ${serviceName}: ${res.status} ${await res.text()}`);
  }
  const svc = (await res.json()) as Record<string, unknown>;
  const template = (svc as { template?: { containers?: Array<{ env?: unknown[] }> } }).template;
  const container = template?.containers?.[0];
  const keys = new Set<string>();
  for (const e of (container?.env ?? []) as Array<{
    name?: string;
    valueSource?: { secretKeyRef?: { secret?: string; version?: string } };
  }>) {
    if (e.valueSource?.secretKeyRef && e.name) {
      keys.add(e.name);
    }
  }
  return keys;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const rows = await systemQuery<{
    name: string;
    auth_env_var: string | null;
    url_template: string | null;
  }>(`
    SELECT tr.name,
           tr.api_config->>'auth_env_var' AS auth_env_var,
           tr.api_config->>'url_template' AS url_template
    FROM tool_registry tr
    WHERE tr.api_config->>'auth_type' = 'bearer_env'
    ORDER BY tr.name
  `);

  console.log('=== SELECT bearer_env rows ===');
  console.log(JSON.stringify(rows, null, 2));

  const sched = await fetchSecretEnvKeys('scheduler');
  const worker = await fetchSecretEnvKeys('worker');
  const mounted = new Set([...sched, ...worker]);

  const broken = rows.filter((r) => {
    const v = r.auth_env_var?.trim();
    if (!v) return true;
    return !mounted.has(v);
  });

  console.log('\n=== Mounted secret env keys (scheduler ∪ worker), count:', mounted.size, '===');
  console.log([...mounted].sort().join(', '));

  console.log('\n=== Broken (auth_env_var not mounted as secret on scheduler or worker) ===');
  console.log(JSON.stringify(broken, null, 2));

  if (broken.length === 0) {
    console.log('\nNothing to delete.');
  } else if (dryRun) {
    console.log('\n--dry-run: no DELETE executed.');
  } else {
    const names = broken.map((b) => b.name);
    const del = await systemQuery<{ name: string }>(
      `DELETE FROM tool_registry WHERE name = ANY($1::text[]) RETURNING name`,
      [names],
    );
    console.log('\n=== DELETED ===');
    console.log(JSON.stringify(del, null, 2));
  }

  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
