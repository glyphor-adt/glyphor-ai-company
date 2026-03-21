/**
 * Deletes tool_registry rows whose api_config matches broken-override patterns:
 * - url_template contains example.com, placeholder, localhost, TODO (case-insensitive)
 * - bearer_env/header_env auth_env_var not mounted on glyphor-scheduler ∪ glyphor-worker
 * - auth_type none with a static https URL (no `{` placeholders) — external API without credentials
 *
 * Usage:
 *   npx tsx scripts/run-with-gcp-db-secret.ts --db-user glyphor_app --db-password-secret db-password scripts/prune-broken-tool-registry-overrides.ts [--dry-run]
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

function badUrlTemplate(t: string | null | undefined): boolean {
  if (!t) return false;
  const s = t.toLowerCase();
  return (
    s.includes('example.com')
    || s.includes('placeholder')
    || s.includes('localhost')
    || s.includes('todo')
  );
}

/** auth_type none but URL is a fixed https origin with no {…} placeholders — implies missing auth */
function badAuthNoneStaticHttps(authType: string | null | undefined, urlTemplate: string | null | undefined): boolean {
  if ((authType ?? '').toLowerCase() !== 'none') return false;
  const u = urlTemplate?.trim() ?? '';
  if (!u.startsWith('https://')) return false;
  if (u.includes('{')) return false;
  return true;
}

/** auth_type none but template is a relative /api (or /v1) path — not a public anonymous endpoint */
function badAuthNoneRelativeApi(authType: string | null | undefined, urlTemplate: string | null | undefined): boolean {
  if ((authType ?? '').toLowerCase() !== 'none') return false;
  const u = urlTemplate?.trim() ?? '';
  return u.startsWith('/api/') || u.startsWith('/v1/') || u.startsWith('/v2/');
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const rows = await systemQuery<{
    name: string;
    url: string | null;
    auth_env_var: string | null;
    auth_type: string | null;
  }>(`
    SELECT name,
           api_config->>'url_template' AS url,
           api_config->>'auth_env_var' AS auth_env_var,
           api_config->>'auth_type' AS auth_type
    FROM tool_registry
    WHERE api_config IS NOT NULL
    ORDER BY name
  `);

  console.log('=== Full listing (api_config NOT NULL) ===');
  console.log(JSON.stringify(rows, null, 2));

  const sched = await fetchSecretEnvKeys('scheduler');
  const worker = await fetchSecretEnvKeys('worker');
  const mounted = new Set([...sched, ...worker]);

  const toDelete: string[] = [];
  const reasons: Record<string, string[]> = {};

  for (const r of rows) {
    const rs: string[] = [];

    if (badUrlTemplate(r.url ?? undefined)) {
      rs.push('bad_url_template');
    }

    const at = (r.auth_type ?? '').toLowerCase();
    if (at === 'bearer_env' || at === 'header_env') {
      const v = r.auth_env_var?.trim();
      if (!v) {
        rs.push('missing_auth_env_var');
      } else if (!mounted.has(v)) {
        rs.push(`auth_env_var_not_mounted:${v}`);
      }
    }

    if (badAuthNoneStaticHttps(r.auth_type, r.url)) {
      rs.push('auth_none_static_https');
    }

    if (badAuthNoneRelativeApi(r.auth_type, r.url)) {
      rs.push('auth_none_relative_api');
    }

    if (rs.length > 0) {
      toDelete.push(r.name);
      reasons[r.name] = rs;
    }
  }

  console.log('\n=== Mounted secret env keys (scheduler ∪ worker), count:', mounted.size, '===');

  console.log('\n=== Rows to DELETE ===');
  console.log(JSON.stringify({ names: toDelete, reasons }, null, 2));

  if (toDelete.length === 0) {
    console.log('\nNothing to delete.');
    await closePool();
    return;
  }

  if (dryRun) {
    console.log('\n--dry-run: no DELETE executed.');
    await closePool();
    return;
  }

  const del = await systemQuery<{ name: string }>(
    `DELETE FROM tool_registry WHERE name = ANY($1::text[]) RETURNING name`,
    [toDelete],
  );
  console.log('\n=== DELETED ===');
  console.log(JSON.stringify(del, null, 2));

  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
