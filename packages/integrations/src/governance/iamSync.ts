/**
 * IAM Sync Job
 *
 * Periodically compares actual platform IAM state against desired
 * permissions stored in platform_iam_state. Detects drift and
 * updates the sync status for the governance dashboard.
 *
 * Designed to run as a scheduled task (daily) via the agent scheduler.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

interface ServiceAccountMapping {
  email: string;
  agentRole: string | null;
}

const SERVICE_ACCOUNTS: ServiceAccountMapping[] = [
  { email: 'sa-marcus@ai-glyphor-company.iam.gserviceaccount.com', agentRole: 'cto' },
  { email: 'sa-nadia@ai-glyphor-company.iam.gserviceaccount.com', agentRole: 'cfo' },
  { email: 'sa-alex@ai-glyphor-company.iam.gserviceaccount.com', agentRole: 'platform-engineer' },
  { email: 'sa-jordan@ai-glyphor-company.iam.gserviceaccount.com', agentRole: 'devops-engineer' },
  { email: 'sa-omar@ai-glyphor-company.iam.gserviceaccount.com', agentRole: 'cost-analyst' },
  { email: 'sa-elena@ai-glyphor-company.iam.gserviceaccount.com', agentRole: 'cpo' },
  { email: 'sa-maya@ai-glyphor-company.iam.gserviceaccount.com', agentRole: 'cmo' },
  { email: 'sa-rachel@ai-glyphor-company.iam.gserviceaccount.com', agentRole: 'vp-sales' },
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
  supabase: SupabaseClient,
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
    const { data: existing } = await supabase
      .from('platform_iam_state')
      .select('desired_permissions')
      .eq('credential_id', sa.email)
      .single();

    if (!existing) continue;

    if (actualRoles) {
      const desiredRoles = ((existing.desired_permissions as { roles?: string[] })?.roles ?? []).sort();
      const inSync = arraysEqual(actualRoles, desiredRoles);

      await supabase.from('platform_iam_state').upsert(
        {
          platform: 'gcp',
          credential_id: sa.email,
          agent_role: sa.agentRole,
          permissions: { roles: actualRoles },
          in_sync: inSync,
          drift_details: inSync ? null : `Expected: [${desiredRoles.join(', ')}], Actual: [${actualRoles.join(', ')}]`,
          last_synced: new Date().toISOString(),
        },
        { onConflict: 'platform,credential_id' },
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
export async function syncSecretRotationStatus(supabase: SupabaseClient): Promise<void> {
  const { data: secrets } = await supabase
    .from('platform_secret_rotation')
    .select('*');

  if (!secrets) return;

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
      await supabase
        .from('platform_secret_rotation')
        .update({ status: newStatus })
        .eq('id', secret.id);
    }
  }
}

/**
 * Run the full IAM sync: GCP + secret rotation checks.
 */
export async function runGovernanceSync(supabase: SupabaseClient): Promise<{
  gcp: { synced: number; drifts: number };
}> {
  const gcp = await syncGCPIAMState(supabase);
  await syncSecretRotationStatus(supabase);
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
