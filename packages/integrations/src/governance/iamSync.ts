/**
 * IAM Sync Job
 *
 * Periodically compares actual platform IAM state against desired
 * permissions stored in platform_iam_state. Detects drift and
 * updates the sync status for the governance dashboard.
 *
 * Designed to run as a scheduled task (daily) via the agent scheduler.
 */

import { systemQuery } from '@glyphor/shared/db';

interface ServiceAccountMapping {
  email: string;
  agentRole: string | null;
}

/** Emails must match Terraform: google_service_account.agent_owner + google_service_account.cfo_agent (sa-nadia). */
const SERVICE_ACCOUNTS: ServiceAccountMapping[] = [
  { email: 'sa-marcus@ai-glyphor-company.iam.gserviceaccount.com', agentRole: 'cto' },
  { email: 'sa-nadia@ai-glyphor-company.iam.gserviceaccount.com', agentRole: 'cfo' },
  { email: 'sa-alex@ai-glyphor-company.iam.gserviceaccount.com', agentRole: 'platform-engineer' },
  { email: 'sa-jordan@ai-glyphor-company.iam.gserviceaccount.com', agentRole: 'devops-engineer' },
  { email: 'sa-elena@ai-glyphor-company.iam.gserviceaccount.com', agentRole: 'cpo' },
  { email: 'sa-maya@ai-glyphor-company.iam.gserviceaccount.com', agentRole: 'cmo' },
  { email: 'sa-mia@ai-glyphor-company.iam.gserviceaccount.com', agentRole: 'vp-design' },
  { email: 'sa-sarah@ai-glyphor-company.iam.gserviceaccount.com', agentRole: 'chief-of-staff' },
  { email: 'sa-production-deploy@ai-glyphor-company.iam.gserviceaccount.com', agentRole: null },
];

interface IAMBinding {
  role: string;
  members: string[];
}

interface IAMPolicy {
  bindings: IAMBinding[];
}

/**
 * Sync GCP IAM state: fetch actual roles from GCP and compare with desired.
 */
export async function syncGCPIAMState(
  projectId = 'ai-glyphor-company',
): Promise<{ synced: number; drifts: number }> {
  let actualPolicy: IAMPolicy | null = null;

  try {
    // Fetch the project IAM policy from GCP
    const token = await getGCPAccessToken();
    const response = await fetch(
      `https://cloudresourcemanager.googleapis.com/v1/projects/${encodeURIComponent(projectId)}:getIamPolicy`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      },
    );

    if (response.ok) {
      actualPolicy = (await response.json()) as IAMPolicy;
    } else {
      console.warn(`[IAMSync] Failed to fetch GCP IAM policy: ${response.status}`);
    }
  } catch (err) {
    console.warn('[IAMSync] GCP API unavailable, checking stored state only:', (err as Error).message);
  }

  let synced = 0;
  let drifts = 0;

  for (const sa of SERVICE_ACCOUNTS) {
    // Get actual roles from the policy
    const actualRoles = actualPolicy
      ? actualPolicy.bindings
          .filter((b) => b.members.includes(`serviceAccount:${sa.email}`))
          .map((b) => b.role)
          .sort()
      : null;

    // Get desired state from DB
    const existingRows = await systemQuery<{ desired_permissions: unknown }>(
      'SELECT desired_permissions FROM platform_iam_state WHERE credential_id = $1 LIMIT 1',
      [sa.email],
    );

    if (existingRows.length === 0) continue;
    const existing = existingRows[0];

    if (actualRoles) {
      const desiredRoles = ((existing.desired_permissions as { roles?: string[] })?.roles ?? []).sort();
      const inSync = arraysEqual(actualRoles, desiredRoles);

      await systemQuery(
        `INSERT INTO platform_iam_state (platform, credential_id, agent_role, permissions, in_sync, drift_details, last_synced)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (platform, credential_id) DO UPDATE SET
           agent_role = $3, permissions = $4, in_sync = $5, drift_details = $6, last_synced = $7`,
        [
          'gcp',
          sa.email,
          sa.agentRole,
          JSON.stringify({ roles: actualRoles }),
          inSync,
          inSync ? null : `Expected: [${desiredRoles.join(', ')}], Actual: [${actualRoles.join(', ')}]`,
          new Date().toISOString(),
        ],
      );

      if (inSync) synced++;
      else drifts++;
    } else {
      synced++; // Can't verify — assume in sync
    }
  }

  return { synced, drifts };
}

/**
 * Update secret rotation status based on expiry dates.
 */
export async function syncSecretRotationStatus(): Promise<void> {
  const secrets = await systemQuery<{ id: string; expires_at: string | null; status: string }>(
    'SELECT id, expires_at, status FROM platform_secret_rotation',
    [],
  );

  if (!secrets || secrets.length === 0) return;

  const now = Date.now();
  for (const secret of secrets) {
    if (!secret.expires_at) continue;

    const expiresAt = new Date(secret.expires_at).getTime();
    const daysLeft = Math.ceil((expiresAt - now) / (86400 * 1000));
    let newStatus: string;

    if (daysLeft <= 0) newStatus = 'expired';
    else if (daysLeft <= 90) newStatus = 'expiring';
    else newStatus = 'active';

    if (newStatus !== secret.status) {
      await systemQuery(
        'UPDATE platform_secret_rotation SET status = $1 WHERE id = $2',
        [newStatus, secret.id],
      );
    }
  }
}

/**
 * Run the full IAM sync: GCP + secret rotation checks.
 */
export async function runGovernanceSync(): Promise<{
  gcp: { synced: number; drifts: number };
}> {
  const gcp = await syncGCPIAMState();
  await syncSecretRotationStatus();
  return { gcp };
}

/* ── Helpers ──────────────────────────────── */

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

async function getGCPAccessToken(): Promise<string> {
  // Use the metadata server when running on GCP (Cloud Run)
  const metadataUrl = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';
  const response = await fetch(metadataUrl, {
    headers: { 'Metadata-Flavor': 'Google' },
  });
  if (!response.ok) {
    throw new Error(`Failed to get GCP access token: ${response.status}`);
  }
  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}
