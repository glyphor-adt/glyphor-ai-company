/**
 * Global Admin (Morgan Blake) — Tool Definitions
 *
 * Tools for: cross-project GCP IAM, Entra ID user/group/role management,
 * service account provisioning, secret management, access audits,
 * and standardized onboarding across GCP + Azure/Entra.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { systemQuery } from '@glyphor/shared/db';
import { getM365Token, type M365Operation } from '@glyphor/integrations';

/** GCP projects this admin manages. */
const MANAGED_PROJECTS = [
  process.env.GCP_PROJECT_ID || 'ai-glyphor-company',
  process.env.FUSE_PROJECT_ID || 'gen-lang-client-0834143721',
  process.env.PULSE_PROJECT_ID || 'glyphor-pulse',
];

/** Founders whose access cannot be modified. */
const PROTECTED_PRINCIPALS = new Set([
  'user:kristina@glyphor.ai',
  'user:andrew@glyphor.ai',
  'user:DevOps@glyphor.ai',
]);

function isProtectedPrincipal(member: string): boolean {
  return PROTECTED_PRINCIPALS.has(member);
}

/** Founder Entra emails — cannot be disabled/deleted/modified. */
const PROTECTED_ENTRA_EMAILS = new Set([
  'kristina@glyphor.ai',
  'andrew@glyphor.ai',
  'devops@glyphor.ai',
]);

function isProtectedEntraUser(email: string): boolean {
  return PROTECTED_ENTRA_EMAILS.has(email.toLowerCase());
}

/** Graph API token routed through M365 credential router. */
async function graphToken(operation: M365Operation = 'read_directory'): Promise<string> {
  return getM365Token(operation);
}

/** Graph API fetch helper — routes token via M365 credential router. */
async function graphFetch(path: string, method = 'GET', body?: unknown, operation: M365Operation = 'read_directory', extraHeaders?: Record<string, string>): Promise<Response> {
  const token = await graphToken(operation);
  const url = path.startsWith('https://') ? path : `https://graph.microsoft.com/v1.0${path}`;
  return fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** Generate a unique grant ID for audit trail. */
function grantId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `GRT-${ts}-${rand}`.toUpperCase();
}

/** Service account Morgan's tools impersonate for admin-level GCP access. */
const GCP_ADMIN_SA = process.env.GCP_ADMIN_SA || 'glyphor-global-admin@ai-glyphor-company.iam.gserviceaccount.com';

/** Safe fetch wrapper for GCP APIs — impersonates the global-admin SA. */
async function gcpFetch(url: string, method = 'GET', body?: unknown): Promise<Response> {
  const { GoogleAuth, Impersonated } = await import('google-auth-library');
  const sourceAuth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const sourceClient = await sourceAuth.getClient();

  // Impersonate the dedicated admin SA so Morgan has IAM/Secret Manager admin
  const impersonated = new Impersonated({
    sourceClient: sourceClient as InstanceType<typeof Impersonated>['sourceClient'],
    targetPrincipal: GCP_ADMIN_SA,
    lifetime: 3600,
    delegates: [],
    targetScopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const token = await impersonated.getAccessToken();

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token.token}`,
    'Content-Type': 'application/json',
  };

  return fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** Department → Teams channel environment variable mapping. */
const DEPT_CHANNELS: Record<string, string[]> = {
  engineering: ['TEAMS_CHANNEL_GENERAL_ID', 'TEAMS_CHANNEL_ENGINEERING_ID'],
  product: ['TEAMS_CHANNEL_GENERAL_ID'],
  finance: ['TEAMS_CHANNEL_GENERAL_ID', 'TEAMS_CHANNEL_FINANCIALS_ID'],
  marketing: ['TEAMS_CHANNEL_GENERAL_ID', 'TEAMS_CHANNEL_GROWTH_ID'],
  sales: ['TEAMS_CHANNEL_GENERAL_ID', 'TEAMS_CHANNEL_GROWTH_ID'],
  design: ['TEAMS_CHANNEL_GENERAL_ID', 'TEAMS_CHANNEL_GROWTH_ID'],
  research: ['TEAMS_CHANNEL_GENERAL_ID'],
  legal: ['TEAMS_CHANNEL_GENERAL_ID'],
  operations: ['TEAMS_CHANNEL_GENERAL_ID'],
};

/** Standard role templates by department. */
const ROLE_TEMPLATES: Record<string, string[]> = {
  engineering: ['roles/run.viewer', 'roles/monitoring.viewer', 'roles/logging.viewer'],
  product: ['roles/monitoring.viewer', 'roles/logging.viewer'],
  finance: ['roles/bigquery.dataViewer', 'roles/bigquery.jobUser'],
  marketing: ['roles/monitoring.viewer'],
  sales: ['roles/monitoring.viewer'],
  design: ['roles/monitoring.viewer'],
  research: ['roles/monitoring.viewer'],
  legal: ['roles/monitoring.viewer'],
  operations: ['roles/run.viewer', 'roles/monitoring.viewer', 'roles/logging.viewer', 'roles/secretmanager.secretAccessor'],
};

export function createGlobalAdminTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return [

    // ── IAM AUDIT & MANAGEMENT ──────────────────────────────────────

    {
      name: 'list_project_iam',
      description: 'List all IAM bindings for a GCP project. Returns role → members mapping.',
      parameters: {
        project_id: {
          type: 'string',
          description: `GCP project ID. One of: ${MANAGED_PROJECTS.join(', ')}`,
          required: true,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const projectId = params.project_id as string;
          if (!MANAGED_PROJECTS.includes(projectId)) {
            return { success: false, error: `Project ${projectId} is not in the managed set. Managed projects: ${MANAGED_PROJECTS.join(', ')}` };
          }
          const res = await gcpFetch(
            `https://cloudresourcemanager.googleapis.com/v1/projects/${projectId}:getIamPolicy`,
            'POST',
            { options: { requestedPolicyVersion: 3 } },
          );
          if (!res.ok) return { success: false, error: `API ${res.status}: ${await res.text()}` };
          const policy = await res.json() as { bindings: Array<{ role: string; members: string[] }> };
          return {
            success: true,
            data: {
              projectId,
              bindingCount: policy.bindings?.length || 0,
              bindings: policy.bindings?.map(b => ({
                role: b.role,
                members: b.members,
                memberCount: b.members.length,
              })) || [],
              auditedAt: new Date().toISOString(),
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'grant_project_role',
      description: 'Grant a GCP IAM role to a principal on a project. Cannot modify founder access.',
      parameters: {
        project_id: {
          type: 'string',
          description: 'GCP project ID',
          required: true,
        },
        member: {
          type: 'string',
          description: 'IAM member (e.g. serviceAccount:x@proj.iam.gserviceaccount.com or user:name@glyphor.ai)',
          required: true,
        },
        role: {
          type: 'string',
          description: 'IAM role to grant (e.g. roles/run.viewer)',
          required: true,
        },
        justification: {
          type: 'string',
          description: 'Why this access is needed',
          required: true,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const { project_id, member, role, justification } = params as Record<string, string>;
          if (isProtectedPrincipal(member)) {
            return { success: false, error: `BLOCKED: ${member} is a protected founder principal. Founder access is self-managed and cannot be modified by the Global Admin.` };
          }
          if (!MANAGED_PROJECTS.includes(project_id)) {
            return { success: false, error: `Project ${project_id} is not managed.` };
          }

          // Get current policy
          const getRes = await gcpFetch(
            `https://cloudresourcemanager.googleapis.com/v1/projects/${project_id}:getIamPolicy`,
            'POST',
            { options: { requestedPolicyVersion: 3 } },
          );
          if (!getRes.ok) return { success: false, error: `Get policy failed: ${getRes.status}` };
          const policy = await getRes.json() as { bindings: Array<{ role: string; members: string[] }>; etag: string; version: number };

          // Add binding
          const existing = policy.bindings.find(b => b.role === role);
          if (existing) {
            if (existing.members.includes(member)) {
              return { success: true, data: { message: `${member} already has ${role} on ${project_id}`, grantId: grantId() } };
            }
            existing.members.push(member);
          } else {
            policy.bindings.push({ role, members: [member] });
          }

          // Set updated policy
          const setRes = await gcpFetch(
            `https://cloudresourcemanager.googleapis.com/v1/projects/${project_id}:setIamPolicy`,
            'POST',
            { policy: { bindings: policy.bindings, etag: policy.etag, version: policy.version } },
          );
          if (!setRes.ok) return { success: false, error: `Set policy failed: ${setRes.status}: ${await setRes.text()}` };

          const id = grantId();
          return {
            success: true,
            data: {
              grantId: id,
              action: 'GRANT',
              project: project_id,
              member,
              role,
              justification,
              grantedAt: new Date().toISOString(),
              written: { member, role, project: project_id, action: 'grant_role' },
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'revoke_project_role',
      description: 'Revoke a GCP IAM role from a principal on a project. Cannot modify founder access.',
      parameters: {
        project_id: {
          type: 'string',
          description: 'GCP project ID',
          required: true,
        },
        member: {
          type: 'string',
          description: 'IAM member to revoke from',
          required: true,
        },
        role: {
          type: 'string',
          description: 'IAM role to revoke',
          required: true,
        },
        justification: {
          type: 'string',
          description: 'Why this access is being revoked',
          required: true,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const { project_id, member, role, justification } = params as Record<string, string>;
          if (isProtectedPrincipal(member)) {
            return { success: false, error: `BLOCKED: ${member} is a protected founder principal. Cannot modify.` };
          }

          const getRes = await gcpFetch(
            `https://cloudresourcemanager.googleapis.com/v1/projects/${project_id}:getIamPolicy`,
            'POST',
            { options: { requestedPolicyVersion: 3 } },
          );
          if (!getRes.ok) return { success: false, error: `Get policy failed: ${getRes.status}` };
          const policy = await getRes.json() as { bindings: Array<{ role: string; members: string[] }>; etag: string; version: number };

          const binding = policy.bindings.find(b => b.role === role);
          if (!binding || !binding.members.includes(member)) {
            return { success: true, data: { message: `${member} does not have ${role} on ${project_id} — no change needed.` } };
          }

          binding.members = binding.members.filter(m => m !== member);
          if (binding.members.length === 0) {
            policy.bindings = policy.bindings.filter(b => b.role !== role);
          }

          const setRes = await gcpFetch(
            `https://cloudresourcemanager.googleapis.com/v1/projects/${project_id}:setIamPolicy`,
            'POST',
            { policy: { bindings: policy.bindings, etag: policy.etag, version: policy.version } },
          );
          if (!setRes.ok) return { success: false, error: `Set policy failed: ${setRes.status}: ${await setRes.text()}` };

          return {
            success: true,
            data: {
              grantId: grantId(),
              action: 'REVOKE',
              project: project_id,
              member,
              role,
              justification,
              revokedAt: new Date().toISOString(),
              written: { member, role, project: project_id, action: 'revoke_role' },
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    // ── SERVICE ACCOUNTS ────────────────────────────────────────────

    {
      name: 'list_service_accounts',
      description: 'List all service accounts in a GCP project.',
      parameters: {
        project_id: {
          type: 'string',
          description: 'GCP project ID',
          required: true,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const projectId = params.project_id as string;
          const res = await gcpFetch(
            `https://iam.googleapis.com/v1/projects/${projectId}/serviceAccounts`,
          );
          if (!res.ok) return { success: false, error: `API ${res.status}: ${await res.text()}` };
          const data = await res.json() as { accounts: Array<{ email: string; displayName: string; disabled: boolean }> };
          return {
            success: true,
            data: {
              projectId,
              count: data.accounts?.length || 0,
              accounts: data.accounts?.map(a => ({
                email: a.email,
                displayName: a.displayName,
                disabled: a.disabled || false,
              })) || [],
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'create_service_account',
      description: 'Create a new GCP service account for an agent or service.',
      parameters: {
        project_id: {
          type: 'string',
          description: 'GCP project ID',
          required: true,
        },
        account_id: {
          type: 'string',
          description: 'Service account ID (e.g. glyphor-agent-name)',
          required: true,
        },
        display_name: {
          type: 'string',
          description: 'Human-readable name for the service account',
          required: true,
        },
        description: {
          type: 'string',
          description: 'Purpose of this service account',
          required: true,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const { project_id, account_id, display_name, description } = params as Record<string, string>;
          const res = await gcpFetch(
            `https://iam.googleapis.com/v1/projects/${project_id}/serviceAccounts`,
            'POST',
            {
              accountId: account_id,
              serviceAccount: { displayName: display_name, description },
            },
          );
          if (!res.ok) return { success: false, error: `API ${res.status}: ${await res.text()}` };
          const sa = await res.json() as { email: string; uniqueId: string };
          return {
            success: true,
            data: {
              grantId: grantId(),
              action: 'CREATE_SA',
              email: sa.email,
              uniqueId: sa.uniqueId,
              project: project_id,
              createdAt: new Date().toISOString(),
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    // ── SECRET MANAGEMENT ───────────────────────────────────────────

    {
      name: 'list_secrets',
      description: 'List all secrets in a GCP project\'s Secret Manager.',
      parameters: {
        project_id: {
          type: 'string',
          description: 'GCP project ID',
          required: true,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const projectId = params.project_id as string;
          const res = await gcpFetch(
            `https://secretmanager.googleapis.com/v1/projects/${projectId}/secrets`,
          );
          if (!res.ok) return { success: false, error: `API ${res.status}: ${await res.text()}` };
          const data = await res.json() as { secrets: Array<{ name: string; createTime: string }> };
          return {
            success: true,
            data: {
              projectId,
              count: data.secrets?.length || 0,
              secrets: data.secrets?.map(s => ({
                name: s.name.split('/').pop(),
                fullName: s.name,
                created: s.createTime,
              })) || [],
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'get_secret_iam',
      description: 'Show who has access to a specific secret.',
      parameters: {
        project_id: {
          type: 'string',
          description: 'GCP project ID',
          required: true,
        },
        secret_id: {
          type: 'string',
          description: 'Secret name (e.g. db-password)',
          required: true,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const { project_id, secret_id } = params as Record<string, string>;
          const res = await gcpFetch(
            `https://secretmanager.googleapis.com/v1/projects/${project_id}/secrets/${secret_id}:getIamPolicy`,
          );
          if (!res.ok) return { success: false, error: `API ${res.status}: ${await res.text()}` };
          const policy = await res.json() as { bindings: Array<{ role: string; members: string[] }> };
          return {
            success: true,
            data: {
              secret: secret_id,
              project: project_id,
              bindings: policy.bindings || [],
              auditedAt: new Date().toISOString(),
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'grant_secret_access',
      description: 'Grant a principal access to a GCP secret. Cannot modify founder access.',
      parameters: {
        project_id: {
          type: 'string',
          description: 'GCP project ID',
          required: true,
        },
        secret_id: {
          type: 'string',
          description: 'Secret name',
          required: true,
        },
        member: {
          type: 'string',
          description: 'IAM member to grant access to',
          required: true,
        },
        justification: {
          type: 'string',
          description: 'Why this secret access is needed',
          required: true,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const { project_id, secret_id, member, justification } = params as Record<string, string>;
          if (isProtectedPrincipal(member)) {
            return { success: false, error: `BLOCKED: ${member} is a protected founder principal.` };
          }

          // Get current policy
          const getRes = await gcpFetch(
            `https://secretmanager.googleapis.com/v1/projects/${project_id}/secrets/${secret_id}:getIamPolicy`,
          );
          if (!getRes.ok) return { success: false, error: `Get policy failed: ${getRes.status}` };
          const policy = await getRes.json() as { bindings: Array<{ role: string; members: string[] }>; etag: string };

          const role = 'roles/secretmanager.secretAccessor';
          const bindings = policy.bindings || [];
          const existing = bindings.find(b => b.role === role);
          if (existing) {
            if (existing.members.includes(member)) {
              return { success: true, data: { message: `${member} already has accessor on ${secret_id}` } };
            }
            existing.members.push(member);
          } else {
            bindings.push({ role, members: [member] });
          }

          const setRes = await gcpFetch(
            `https://secretmanager.googleapis.com/v1/projects/${project_id}/secrets/${secret_id}:setIamPolicy`,
            'POST',
            { policy: { bindings, etag: policy.etag } },
          );
          if (!setRes.ok) return { success: false, error: `Set policy failed: ${setRes.status}: ${await setRes.text()}` };

          return {
            success: true,
            data: {
              grantId: grantId(),
              action: 'GRANT_SECRET',
              secret: secret_id,
              project: project_id,
              member,
              justification,
              grantedAt: new Date().toISOString(),
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'revoke_secret_access',
      description: 'Revoke a principal\'s access to a GCP secret. Cannot modify founder access.',
      parameters: {
        project_id: {
          type: 'string',
          description: 'GCP project ID',
          required: true,
        },
        secret_id: {
          type: 'string',
          description: 'Secret name',
          required: true,
        },
        member: {
          type: 'string',
          description: 'IAM member to revoke',
          required: true,
        },
        justification: {
          type: 'string',
          description: 'Why this access is being revoked',
          required: true,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const { project_id, secret_id, member, justification } = params as Record<string, string>;
          if (isProtectedPrincipal(member)) {
            return { success: false, error: `BLOCKED: ${member} is a protected founder principal.` };
          }

          const getRes = await gcpFetch(
            `https://secretmanager.googleapis.com/v1/projects/${project_id}/secrets/${secret_id}:getIamPolicy`,
          );
          if (!getRes.ok) return { success: false, error: `Get policy failed: ${getRes.status}` };
          const policy = await getRes.json() as { bindings: Array<{ role: string; members: string[] }>; etag: string };

          const role = 'roles/secretmanager.secretAccessor';
          const binding = policy.bindings?.find(b => b.role === role);
          if (!binding || !binding.members.includes(member)) {
            return { success: true, data: { message: `${member} does not have accessor on ${secret_id} — no change.` } };
          }

          binding.members = binding.members.filter(m => m !== member);
          if (binding.members.length === 0) {
            policy.bindings = policy.bindings.filter(b => b.role !== role);
          }

          const setRes = await gcpFetch(
            `https://secretmanager.googleapis.com/v1/projects/${project_id}/secrets/${secret_id}:setIamPolicy`,
            'POST',
            { policy: { bindings: policy.bindings, etag: policy.etag } },
          );
          if (!setRes.ok) return { success: false, error: `Set policy failed: ${setRes.status}: ${await setRes.text()}` };

          return {
            success: true,
            data: {
              grantId: grantId(),
              action: 'REVOKE_SECRET',
              secret: secret_id,
              project: project_id,
              member,
              justification,
              revokedAt: new Date().toISOString(),
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    // ── SECRET VALUE MANAGEMENT ─────────────────────────────────────

    {
      name: 'update_secret_value',
      description: 'Add a new version to an existing GCP secret with a new value. Use for rotating credentials stored in Secret Manager.',
      parameters: {
        project_id: { type: 'string', description: 'GCP project ID', required: true },
        secret_id: { type: 'string', description: 'Secret name (e.g. azure-client-secret)', required: true },
        value: { type: 'string', description: 'New secret value to store', required: true },
        justification: { type: 'string', description: 'Why this secret is being updated', required: true },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const { project_id, secret_id, value, justification } = params as Record<string, string>;
          const payload = Buffer.from(value).toString('base64');
          const res = await gcpFetch(
            `https://secretmanager.googleapis.com/v1/projects/${project_id}/secrets/${secret_id}:addVersion`,
            'POST',
            { payload: { data: payload } },
          );
          if (!res.ok) return { success: false, error: `API ${res.status}: ${await res.text()}` };
          const version = await res.json() as { name: string; createTime: string; state: string };
          return {
            success: true,
            data: {
              grantId: grantId(),
              action: 'UPDATE_SECRET_VALUE',
              secret: secret_id,
              project: project_id,
              versionName: version.name,
              state: version.state,
              justification,
              updatedAt: new Date().toISOString(),
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'rotate_app_credential',
      description: 'Rotate an Entra ID app registration client secret: generates a new secret and stores it in GCP Secret Manager. Old secrets are NOT removed.',
      parameters: {
        app_id: { type: 'string', description: 'Entra app registration client ID (GUID)', required: true },
        gcp_project_id: { type: 'string', description: 'GCP project to store the new secret in', required: true },
        gcp_secret_id: { type: 'string', description: 'Secret Manager secret name to update (e.g. azure-mail-client-secret)', required: true },
        display_name: { type: 'string', description: 'Label for the new credential (e.g. rotated-2026-02)', required: true },
        justification: { type: 'string', description: 'Why this credential is being rotated', required: true },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const { app_id, gcp_project_id, gcp_secret_id, display_name, justification } = params as Record<string, string>;

          // Step 1: Generate a new client secret on the Entra app registration
          const addRes = await graphFetch(`/applications(appId='${encodeURIComponent(app_id)}')/addPassword`, 'POST', {
            passwordCredential: {
              displayName: display_name,
              endDateTime: new Date(Date.now() + 730 * 86400000).toISOString(), // 2 years
            },
          }, 'list_app_registrations');
          if (!addRes.ok) return { success: false, error: `Graph addPassword ${addRes.status}: ${await addRes.text()}` };
          const cred = await addRes.json() as { secretText: string; keyId: string; endDateTime: string };

          // Step 2: Store the new secret value in GCP Secret Manager
          const payload = Buffer.from(cred.secretText).toString('base64');
          const storeRes = await gcpFetch(
            `https://secretmanager.googleapis.com/v1/projects/${gcp_project_id}/secrets/${gcp_secret_id}:addVersion`,
            'POST',
            { payload: { data: payload } },
          );
          if (!storeRes.ok) {
            return {
              success: false,
              error: `Entra secret created (keyId: ${cred.keyId}) but FAILED to store in GCP: ${storeRes.status}: ${await storeRes.text()}. Manually store the secret or it will be lost.`,
            };
          }
          const version = await storeRes.json() as { name: string };

          return {
            success: true,
            data: {
              grantId: grantId(),
              action: 'ROTATE_APP_CREDENTIAL',
              appId: app_id,
              credentialKeyId: cred.keyId,
              credentialExpiry: cred.endDateTime,
              gcpSecret: gcp_secret_id,
              gcpVersion: version.name,
              justification,
              rotatedAt: new Date().toISOString(),
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    // ── ACCESS AUDIT ────────────────────────────────────────────────

    {
      name: 'run_access_audit',
      description: 'Run a full cross-project access audit. Checks IAM bindings and service accounts across all managed GCP projects.',
      parameters: {
        scope: {
          type: 'string',
          description: 'Audit scope: "all" for every project, or a specific project ID',
          required: false,
          enum: ['all', ...MANAGED_PROJECTS],
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const scope = (params.scope as string) || 'all';
          const projects = scope === 'all' ? MANAGED_PROJECTS : [scope];
          const results: Array<{
            project: string;
            serviceAccounts: number;
            iamBindings: number;
            issues: string[];
          }> = [];

          for (const projectId of projects) {
            const issues: string[] = [];

            // Check IAM
            const iamRes = await gcpFetch(
              `https://cloudresourcemanager.googleapis.com/v1/projects/${projectId}:getIamPolicy`,
              'POST',
              { options: { requestedPolicyVersion: 3 } },
            );
            let iamCount = 0;
            if (iamRes.ok) {
              const policy = await iamRes.json() as { bindings: Array<{ role: string; members: string[] }> };
              iamCount = policy.bindings?.length || 0;

              // Check for overly broad bindings
              for (const binding of policy.bindings || []) {
                if (binding.role === 'roles/owner' || binding.role === 'roles/editor') {
                  const nonDefaultMembers = binding.members.filter(
                    m => !m.includes('cloudservices.gserviceaccount.com') && !isProtectedPrincipal(m),
                  );
                  if (nonDefaultMembers.length > 0) {
                    issues.push(`DRIFT: ${binding.role} granted to non-founder/non-default: ${nonDefaultMembers.join(', ')}`);
                  }
                }
              }
            }

            // Check service accounts
            const saRes = await gcpFetch(
              `https://iam.googleapis.com/v1/projects/${projectId}/serviceAccounts`,
            );
            let saCount = 0;
            if (saRes.ok) {
              const saData = await saRes.json() as { accounts: Array<{ email: string; disabled: boolean }> };
              saCount = saData.accounts?.length || 0;
              const disabled = saData.accounts?.filter(a => a.disabled) || [];
              if (disabled.length > 0) {
                issues.push(`INFO: ${disabled.length} disabled service account(s): ${disabled.map(a => a.email).join(', ')}`);
              }
            }

            results.push({
              project: projectId,
              serviceAccounts: saCount,
              iamBindings: iamCount,
              issues,
            });
          }

          const totalIssues = results.reduce((sum, r) => sum + r.issues.length, 0);
          const hasDrift = results.some(r => r.issues.some(i => i.startsWith('DRIFT')));

          return {
            success: true,
            data: {
              scope,
              projectsAudited: results.length,
              severity: hasDrift ? 'DRIFT' : totalIssues > 0 ? 'INFO' : 'CLEAN',
              results,
              auditedAt: new Date().toISOString(),
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    // ── ONBOARDING ──────────────────────────────────────────────────

    {
      name: 'run_onboarding',
      description: 'Execute the standardized onboarding checklist for a new employee or agent. Provisions GCP roles based on department template, adds to Teams channels, and logs all actions.',
      parameters: {
        name: {
          type: 'string',
          description: 'Full name of the new employee/agent',
          required: true,
        },
        email: {
          type: 'string',
          description: 'Email address',
          required: true,
        },
        role_slug: {
          type: 'string',
          description: 'Agent role slug (e.g. platform-engineer) or job role for humans',
          required: true,
        },
        department: {
          type: 'string',
          description: 'Department',
          required: true,
          enum: ['engineering', 'product', 'finance', 'marketing', 'sales', 'design', 'research', 'legal', 'operations'],
        },
        reports_to: {
          type: 'string',
          description: 'Manager name or role slug',
          required: true,
        },
        is_agent: {
          type: 'boolean',
          description: 'Whether this is an AI agent (true) or human employee (false)',
          required: true,
        },
        gcp_projects: {
          type: 'string',
          description: 'Comma-separated GCP project IDs to grant access to (defaults to main project only)',
          required: false,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const { name, email, role_slug, department, reports_to, is_agent } = params as Record<string, string | boolean>;
        const dept = department as string;
        const checklist: Array<{ step: string; status: 'done' | 'skipped' | 'failed'; detail: string }> = [];

        // 1. GCP Access — grant department template roles
        const projectIds = (params.gcp_projects as string)?.split(',').map(s => s.trim()) || [MANAGED_PROJECTS[0]];
        const roles = ROLE_TEMPLATES[dept] || ['roles/monitoring.viewer'];

        for (const projectId of projectIds) {
          for (const role of roles) {
            const member = is_agent
              ? `serviceAccount:${email}`
              : `user:${email}`;
            try {
              const getRes = await gcpFetch(
                `https://cloudresourcemanager.googleapis.com/v1/projects/${projectId}:getIamPolicy`,
                'POST',
                { options: { requestedPolicyVersion: 3 } },
              );
              if (!getRes.ok) {
                checklist.push({ step: `GCP ${role} on ${projectId}`, status: 'failed', detail: `Get policy failed: ${getRes.status}` });
                continue;
              }
              const policy = await getRes.json() as { bindings: Array<{ role: string; members: string[] }>; etag: string; version: number };
              const existing = policy.bindings.find(b => b.role === role);
              if (existing && existing.members.includes(member)) {
                checklist.push({ step: `GCP ${role} on ${projectId}`, status: 'done', detail: 'Already granted' });
                continue;
              }
              if (existing) {
                existing.members.push(member);
              } else {
                policy.bindings.push({ role, members: [member] });
              }
              const setRes = await gcpFetch(
                `https://cloudresourcemanager.googleapis.com/v1/projects/${projectId}:setIamPolicy`,
                'POST',
                { policy: { bindings: policy.bindings, etag: policy.etag, version: policy.version } },
              );
              checklist.push({
                step: `GCP ${role} on ${projectId}`,
                status: setRes.ok ? 'done' : 'failed',
                detail: setRes.ok ? `Granted to ${member}` : `Set failed: ${setRes.status}`,
              });
            } catch (err) {
              checklist.push({ step: `GCP ${role} on ${projectId}`, status: 'failed', detail: (err as Error).message });
            }
          }
        }

        // 2. Entra ID — create user account (humans only, agents are service-principal-based)
        if (!is_agent) {
          try {
            const checkRes = await graphFetch(`/users/${encodeURIComponent(email as string)}?$select=id,accountEnabled`, 'GET', undefined, 'read_directory');
            if (checkRes.ok) {
              checklist.push({ step: 'Entra ID user', status: 'done', detail: 'User already exists in Entra' });
            } else {
              const nameParts = (name as string).split(' ');
              const tempPw = `Glyphor-${Date.now().toString(36).slice(-6)}!`;
              const createRes = await graphFetch('/users', 'POST', {
                accountEnabled: true,
                displayName: name,
                mailNickname: nameParts[0].toLowerCase(),
                userPrincipalName: email,
                jobTitle: role_slug,
                department: dept,
                passwordProfile: { forceChangePasswordNextSignIn: true, password: tempPw },
              }, 'write_directory');
              checklist.push({
                step: 'Entra ID user',
                status: createRes.ok ? 'done' : 'failed',
                detail: createRes.ok ? `Created ${email} (temp password issued)` : `Graph ${createRes.status}`,
              });
            }
          } catch (err) {
            checklist.push({ step: 'Entra ID user', status: 'failed', detail: (err as Error).message });
          }
        } else {
          checklist.push({ step: 'Entra ID user', status: 'skipped', detail: 'Agent — uses service account, not Entra user' });
        }

        // 3. Teams channels — log which channels should be assigned
        const channels = DEPT_CHANNELS[dept] || ['TEAMS_CHANNEL_GENERAL_ID'];
        for (const ch of channels) {
          const channelId = process.env[ch];
          checklist.push({
            step: `Teams channel: ${ch}`,
            status: channelId ? 'done' : 'skipped',
            detail: channelId
              ? `Channel ${channelId} — add ${name} via Riley (M365 Admin)`
              : 'Channel env var not set',
          });
        }

        // 4. Log onboarding completion
        try {
          await systemQuery(
            'INSERT INTO activity_log (agent_role, action, details) VALUES ($1, $2, $3)',
            ['global-admin', 'onboarding', JSON.stringify({
              employee: name,
              email,
              role: role_slug,
              department: dept,
              reports_to,
              is_agent,
              checklist,
            })],
          );
          checklist.push({ step: 'Log onboarding', status: 'done', detail: 'Recorded in activity_log' });
        } catch (err) {
          checklist.push({ step: 'Log onboarding', status: 'failed', detail: (err as Error).message });
        }

        const completed = checklist.filter(c => c.status === 'done').length;
        const failed = checklist.filter(c => c.status === 'failed').length;

        return {
          success: failed === 0,
          data: {
            grantId: grantId(),
            action: 'ONBOARDING',
            employee: name,
            email,
            role: role_slug,
            department: dept,
            reportsTo: reports_to,
            isAgent: is_agent,
            summary: `${completed}/${checklist.length} steps completed, ${failed} failed`,
            checklist,
            completedAt: new Date().toISOString(),
          },
        };
      },
    },

    // ── ADMIN LOG ───────────────────────────────────────────────────

    // ── ENTRA ID — USER MANAGEMENT ──────────────────────────────────

    {
      name: 'entra_list_users',
      description: 'List all users in the Entra ID / Microsoft 365 tenant with account status.',
      parameters: {
        filter: {
          type: 'string',
          description: 'Optional display name or email fragment to search for',
          required: false,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const filter = params.filter as string | undefined;
          const url = filter
            ? `/users?$search="displayName:${encodeURIComponent(filter)}"&$select=id,displayName,mail,userPrincipalName,jobTitle,accountEnabled,createdDateTime&$top=50`
            : `/users?$select=id,displayName,mail,userPrincipalName,jobTitle,accountEnabled,createdDateTime&$top=50&$orderby=displayName`;
          const res = await graphFetch(url, 'GET', undefined, 'read_directory', filter ? { ConsistencyLevel: 'eventual' } : undefined);
          if (!res.ok) return { success: false, error: `Graph ${res.status}: ${await res.text()}` };
          const data = await res.json() as { value: unknown[] };
          return { success: true, data: { count: data.value?.length || 0, users: data.value || [] } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'entra_create_user',
      description: 'Create a new Entra ID user with a temporary password. Cannot create founder accounts.',
      parameters: {
        display_name: { type: 'string', description: 'Full name', required: true },
        email: { type: 'string', description: 'user@glyphor.ai email', required: true },
        job_title: { type: 'string', description: 'Job title', required: true },
        department: { type: 'string', description: 'Department', required: true },
        temp_password: { type: 'string', description: 'Temporary password (user must change on first login)', required: true },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const email = params.email as string;
          if (isProtectedEntraUser(email)) {
            return { success: false, error: `BLOCKED: ${email} is a protected founder account.` };
          }
          const mailNickname = email.split('@')[0];
          const res = await graphFetch('/users', 'POST', {
            accountEnabled: true,
            displayName: params.display_name,
            mailNickname,
            userPrincipalName: email,
            jobTitle: params.job_title,
            department: params.department,
            passwordProfile: {
              forceChangePasswordNextSignIn: true,
              password: params.temp_password,
            },
          }, 'write_directory');
          if (!res.ok) return { success: false, error: `Graph ${res.status}: ${await res.text()}` };
          const user = await res.json() as { id: string; displayName: string; userPrincipalName: string };
          return {
            success: true,
            data: {
              grantId: grantId(),
              action: 'ENTRA_CREATE_USER',
              userId: user.id,
              displayName: user.displayName,
              upn: user.userPrincipalName,
              createdAt: new Date().toISOString(),
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'entra_disable_user',
      description: 'Disable an Entra ID user account (block sign-in). Cannot modify founder accounts.',
      parameters: {
        email: { type: 'string', description: 'User email to disable', required: true },
        justification: { type: 'string', description: 'Why this account is being disabled', required: true },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const email = params.email as string;
          if (isProtectedEntraUser(email)) {
            return { success: false, error: `BLOCKED: ${email} is a protected founder account.` };
          }
          const res = await graphFetch(`/users/${encodeURIComponent(email)}`, 'PATCH', {
            accountEnabled: false,
          }, 'write_directory');
          if (!res.ok) return { success: false, error: `Graph ${res.status}: ${await res.text()}` };
          return {
            success: true,
            data: {
              grantId: grantId(),
              action: 'ENTRA_DISABLE_USER',
              email,
              justification: params.justification,
              disabledAt: new Date().toISOString(),
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'entra_enable_user',
      description: 'Re-enable a disabled Entra ID user account (unblock sign-in). Cannot modify founder accounts.',
      parameters: {
        email: { type: 'string', description: 'User email to enable', required: true },
        justification: { type: 'string', description: 'Why this account is being re-enabled', required: true },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const email = params.email as string;
          if (isProtectedEntraUser(email)) {
            return { success: false, error: `BLOCKED: ${email} is a protected founder account.` };
          }
          const res = await graphFetch(`/users/${encodeURIComponent(email)}`, 'PATCH', {
            accountEnabled: true,
          }, 'write_directory');
          if (!res.ok) return { success: false, error: `Graph ${res.status}: ${await res.text()}` };
          return {
            success: true,
            data: {
              grantId: grantId(),
              action: 'ENTRA_ENABLE_USER',
              email,
              justification: params.justification,
              enabledAt: new Date().toISOString(),
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    // ── ENTRA ID — GROUP MANAGEMENT ─────────────────────────────────

    {
      name: 'entra_list_groups',
      description: 'List all Entra ID security and M365 groups.',
      parameters: {
        filter: {
          type: 'string',
          description: 'Optional group name filter',
          required: false,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const filter = params.filter as string | undefined;
          const url = filter
            ? `/groups?$search="displayName:${encodeURIComponent(filter)}"&$select=id,displayName,description,groupTypes,securityEnabled,mailEnabled,membershipRule&$top=50`
            : `/groups?$select=id,displayName,description,groupTypes,securityEnabled,mailEnabled&$top=50&$orderby=displayName`;
          const res = await graphFetch(url, 'GET', undefined, 'list_groups', filter ? { ConsistencyLevel: 'eventual' } : undefined);
          if (!res.ok) return { success: false, error: `Graph ${res.status}: ${await res.text()}` };
          const data = await res.json() as { value: unknown[] };
          return { success: true, data: { count: data.value?.length || 0, groups: data.value || [] } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'entra_list_group_members',
      description: 'List members of a specific Entra ID group.',
      parameters: {
        group_id: { type: 'string', description: 'Entra group ID (GUID)', required: true },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const res = await graphFetch(`/groups/${encodeURIComponent(params.group_id as string)}/members?$select=id,displayName,mail,userPrincipalName`, 'GET', undefined, 'list_groups');
          if (!res.ok) return { success: false, error: `Graph ${res.status}: ${await res.text()}` };
          const data = await res.json() as { value: unknown[] };
          return { success: true, data: { groupId: params.group_id, count: data.value?.length || 0, members: data.value || [] } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'entra_add_group_member',
      description: 'Add a user to an Entra ID group. Cannot modify founder group memberships.',
      parameters: {
        group_id: { type: 'string', description: 'Entra group ID', required: true },
        user_email: { type: 'string', description: 'User email to add', required: true },
        justification: { type: 'string', description: 'Why this membership is needed', required: true },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const email = params.user_email as string;
          if (isProtectedEntraUser(email)) {
            return { success: false, error: `BLOCKED: ${email} is a protected founder account.` };
          }
          // Resolve user ID
          const userRes = await graphFetch(`/users/${encodeURIComponent(email)}?$select=id`, 'GET', undefined, 'read_directory');
          if (!userRes.ok) return { success: false, error: `User not found: ${email}` };
          const user = await userRes.json() as { id: string };

          const res = await graphFetch(`/groups/${encodeURIComponent(params.group_id as string)}/members/$ref`, 'POST', {
            '@odata.id': `https://graph.microsoft.com/v1.0/directoryObjects/${user.id}`,
          }, 'manage_groups');
          if (!res.ok) {
            const errText = await res.text();
            if (errText.includes('already exist')) {
              return { success: true, data: { message: `${email} is already a member of this group` } };
            }
            return { success: false, error: `Graph ${res.status}: ${errText}` };
          }
          return {
            success: true,
            data: {
              grantId: grantId(),
              action: 'ENTRA_ADD_GROUP_MEMBER',
              groupId: params.group_id,
              email,
              justification: params.justification,
              addedAt: new Date().toISOString(),
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'entra_remove_group_member',
      description: 'Remove a user from an Entra ID group. Cannot modify founder group memberships.',
      parameters: {
        group_id: { type: 'string', description: 'Entra group ID', required: true },
        user_email: { type: 'string', description: 'User email to remove', required: true },
        justification: { type: 'string', description: 'Why this membership is being revoked', required: true },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const email = params.user_email as string;
          if (isProtectedEntraUser(email)) {
            return { success: false, error: `BLOCKED: ${email} is a protected founder account.` };
          }
          const userRes = await graphFetch(`/users/${encodeURIComponent(email)}?$select=id`, 'GET', undefined, 'read_directory');
          if (!userRes.ok) return { success: false, error: `User not found: ${email}` };
          const user = await userRes.json() as { id: string };

          const res = await graphFetch(`/groups/${encodeURIComponent(params.group_id as string)}/members/${user.id}/$ref`, 'DELETE', undefined, 'manage_groups');
          if (!res.ok && res.status !== 404) return { success: false, error: `Graph ${res.status}: ${await res.text()}` };
          return {
            success: true,
            data: {
              grantId: grantId(),
              action: 'ENTRA_REMOVE_GROUP_MEMBER',
              groupId: params.group_id,
              email,
              justification: params.justification,
              removedAt: new Date().toISOString(),
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    // ── ENTRA ID — DIRECTORY ROLES ──────────────────────────────────

    {
      name: 'entra_list_directory_roles',
      description: 'List all activated Entra ID directory roles and their members.',
      parameters: {},
      execute: async (_params, _ctx): Promise<ToolResult> => {
        try {
          const res = await graphFetch('/directoryRoles?$select=id,displayName,description', 'GET', undefined, 'list_directory_roles');
          if (!res.ok) return { success: false, error: `Graph ${res.status}: ${await res.text()}` };
          const data = await res.json() as { value: Array<{ id: string; displayName: string; description: string }> };

          const roles = [];
          for (const role of data.value || []) {
            const membersRes = await graphFetch(`/directoryRoles/${role.id}/members?$select=id,displayName,mail`, 'GET', undefined, 'list_directory_roles');
            const membersData = membersRes.ok ? (await membersRes.json() as { value: unknown[] }).value : [];
            roles.push({ ...role, memberCount: membersData.length, members: membersData });
          }
          return { success: true, data: { roleCount: roles.length, roles } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'entra_assign_directory_role',
      description: 'Assign an Entra directory role to a user. Cannot modify founder role assignments.',
      parameters: {
        role_id: { type: 'string', description: 'Directory role ID (GUID)', required: true },
        user_email: { type: 'string', description: 'User email', required: true },
        justification: { type: 'string', description: 'Why this role is needed', required: true },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const email = params.user_email as string;
          if (isProtectedEntraUser(email)) {
            return { success: false, error: `BLOCKED: ${email} is a protected founder account.` };
          }
          const userRes = await graphFetch(`/users/${encodeURIComponent(email)}?$select=id`, 'GET', undefined, 'read_directory');
          if (!userRes.ok) return { success: false, error: `User not found: ${email}` };
          const user = await userRes.json() as { id: string };

          const res = await graphFetch(`/directoryRoles/${encodeURIComponent(params.role_id as string)}/members/$ref`, 'POST', {
            '@odata.id': `https://graph.microsoft.com/v1.0/directoryObjects/${user.id}`,
          }, 'manage_directory_roles');
          if (!res.ok) return { success: false, error: `Graph ${res.status}: ${await res.text()}` };
          return {
            success: true,
            data: {
              grantId: grantId(),
              action: 'ENTRA_ASSIGN_ROLE',
              roleId: params.role_id,
              email,
              justification: params.justification,
              assignedAt: new Date().toISOString(),
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    // ── ENTRA ID — APP REGISTRATIONS ────────────────────────────────

    {
      name: 'entra_list_app_registrations',
      description: 'List all Entra ID app registrations with their client IDs and credential expiry.',
      parameters: {},
      execute: async (_params, _ctx): Promise<ToolResult> => {
        try {
          const res = await graphFetch('/applications?$select=id,appId,displayName,passwordCredentials,keyCredentials,createdDateTime&$top=50', 'GET', undefined, 'list_app_registrations');
          if (!res.ok) return { success: false, error: `Graph ${res.status}: ${await res.text()}` };
          const data = await res.json() as { value: Array<{ id: string; appId: string; displayName: string; passwordCredentials: Array<{ endDateTime: string; displayName: string }>; keyCredentials: Array<{ endDateTime: string }> }> };

          const now = new Date();
          const apps = (data.value || []).map(app => {
            const secrets = (app.passwordCredentials || []).map(c => ({
              name: c.displayName || '(unnamed)',
              expiresAt: c.endDateTime,
              isExpired: new Date(c.endDateTime) < now,
              daysUntilExpiry: Math.ceil((new Date(c.endDateTime).getTime() - now.getTime()) / 86400000),
            }));
            const certs = (app.keyCredentials || []).map(c => ({
              expiresAt: c.endDateTime,
              isExpired: new Date(c.endDateTime) < now,
              daysUntilExpiry: Math.ceil((new Date(c.endDateTime).getTime() - now.getTime()) / 86400000),
            }));
            return {
              displayName: app.displayName,
              appId: app.appId,
              objectId: app.id,
              secretCount: secrets.length,
              secrets,
              certCount: certs.length,
              certs,
              hasExpiringCredentials: [...secrets, ...certs].some(c => c.daysUntilExpiry < 30 && !c.isExpired),
              hasExpiredCredentials: [...secrets, ...certs].some(c => c.isExpired),
            };
          });

          const expiring = apps.filter(a => a.hasExpiringCredentials);
          const expired = apps.filter(a => a.hasExpiredCredentials);

          return {
            success: true,
            data: {
              totalApps: apps.length,
              expiringWithin30Days: expiring.length,
              expired: expired.length,
              apps,
              auditedAt: new Date().toISOString(),
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    // ── ENTRA ID — LICENSE MANAGEMENT ───────────────────────────────

    {
      name: 'entra_list_licenses',
      description: 'List all M365/Entra license subscriptions and usage counts.',
      parameters: {},
      execute: async (_params, _ctx): Promise<ToolResult> => {
        try {
          const res = await graphFetch('/subscribedSkus?$select=skuPartNumber,skuId,prepaidUnits,consumedUnits,appliesTo', 'GET', undefined, 'manage_licenses');
          if (!res.ok) return { success: false, error: `Graph ${res.status}: ${await res.text()}` };
          const data = await res.json() as { value: Array<{ skuPartNumber: string; skuId: string; prepaidUnits: { enabled: number }; consumedUnits: number }> };
          const licenses = (data.value || []).map(l => ({
            sku: l.skuPartNumber,
            skuId: l.skuId,
            total: l.prepaidUnits?.enabled || 0,
            consumed: l.consumedUnits || 0,
            available: (l.prepaidUnits?.enabled || 0) - (l.consumedUnits || 0),
          }));
          return { success: true, data: { licenseCount: licenses.length, licenses } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'entra_assign_license',
      description: 'Assign an M365 license to a user. Cannot modify founder licenses.',
      parameters: {
        user_email: { type: 'string', description: 'User email', required: true },
        sku_id: { type: 'string', description: 'License SKU ID (GUID from entra_list_licenses)', required: true },
        justification: { type: 'string', description: 'Why this license is needed', required: true },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const email = params.user_email as string;
          if (isProtectedEntraUser(email)) {
            return { success: false, error: `BLOCKED: ${email} is a protected founder account.` };
          }
          const res = await graphFetch(`/users/${encodeURIComponent(email)}/assignLicense`, 'POST', {
            addLicenses: [{ skuId: params.sku_id, disabledPlans: [] }],
            removeLicenses: [],
          }, 'manage_licenses');
          if (!res.ok) return { success: false, error: `Graph ${res.status}: ${await res.text()}` };
          return {
            success: true,
            data: {
              grantId: grantId(),
              action: 'ENTRA_ASSIGN_LICENSE',
              email,
              skuId: params.sku_id,
              justification: params.justification,
              assignedAt: new Date().toISOString(),
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'entra_revoke_license',
      description: 'Remove an M365 license from a user. Cannot modify founder licenses.',
      parameters: {
        user_email: { type: 'string', description: 'User email', required: true },
        sku_id: { type: 'string', description: 'License SKU ID to remove', required: true },
        justification: { type: 'string', description: 'Why this license is being revoked', required: true },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const email = params.user_email as string;
          if (isProtectedEntraUser(email)) {
            return { success: false, error: `BLOCKED: ${email} is a protected founder account.` };
          }
          const res = await graphFetch(`/users/${encodeURIComponent(email)}/assignLicense`, 'POST', {
            addLicenses: [],
            removeLicenses: [params.sku_id],
          }, 'manage_licenses');
          if (!res.ok) return { success: false, error: `Graph ${res.status}: ${await res.text()}` };
          return {
            success: true,
            data: {
              grantId: grantId(),
              action: 'ENTRA_REVOKE_LICENSE',
              email,
              skuId: params.sku_id,
              justification: params.justification,
              revokedAt: new Date().toISOString(),
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    // ── ENTRA ID — AUDIT LOGS ───────────────────────────────────────

    {
      name: 'entra_audit_sign_ins',
      description: 'Query recent Entra ID sign-in logs for failed or risky logins.',
      parameters: {
        hours: { type: 'number', description: 'Look back N hours (default 24)', required: false },
        status: { type: 'string', description: 'Filter: "failed", "success", or "all"', required: false, enum: ['failed', 'success', 'all'] },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          const hours = (params.hours as number) || 24;
          const since = new Date(Date.now() - hours * 3600_000).toISOString();
          const statusFilter = params.status as string || 'all';

          let filter = `createdDateTime ge ${since}`;
          if (statusFilter === 'failed') filter += ` and status/errorCode ne 0`;
          else if (statusFilter === 'success') filter += ` and status/errorCode eq 0`;

          const res = await graphFetch(`/auditLogs/signIns?$filter=${encodeURIComponent(filter)}&$top=50&$orderby=createdDateTime desc`, 'GET', undefined, 'audit_sign_ins');
          if (!res.ok) return { success: false, error: `Graph ${res.status}: ${await res.text()}` };
          const data = await res.json() as { value: Array<{ userDisplayName: string; userPrincipalName: string; createdDateTime: string; status: { errorCode: number; failureReason: string }; ipAddress: string; location: { city: string; countryOrRegion: string } }> };

          const signIns = (data.value || []).map(s => ({
            user: s.userDisplayName,
            upn: s.userPrincipalName,
            time: s.createdDateTime,
            success: s.status?.errorCode === 0,
            failureReason: s.status?.failureReason || null,
            ip: s.ipAddress,
            location: s.location ? `${s.location.city || '?'}, ${s.location.countryOrRegion || '?'}` : 'unknown',
          }));

          const failed = signIns.filter(s => !s.success);
          return {
            success: true,
            data: {
              totalSignIns: signIns.length,
              failedCount: failed.length,
              lookbackHours: hours,
              signIns,
              auditedAt: new Date().toISOString(),
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    // ── ADMIN LOG (existing) ────────────────────────────────────────

    {
      name: 'write_admin_log',
      description: 'Write an entry to the admin audit log with structured metadata.',
      parameters: {
        action: {
          type: 'string',
          description: 'Action type (e.g. grant, revoke, audit, onboarding, offboarding)',
          required: true,
        },
        details: {
          type: 'string',
          description: 'JSON string of structured details about the action',
          required: true,
        },
        severity: {
          type: 'string',
          description: 'Severity rating for the entry',
          required: false,
          enum: ['CLEAN', 'DRIFT', 'ALERT', 'INFO'],
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        try {
          let details: Record<string, unknown>;
          try {
            details = JSON.parse(params.details as string);
          } catch {
            details = { raw: params.details };
          }

          await systemQuery(
            'INSERT INTO activity_log (agent_role, action, details) VALUES ($1, $2, $3)',
            ['global-admin', params.action as string, JSON.stringify({
              ...details,
              severity: params.severity || 'INFO',
              loggedBy: 'Morgan Blake (Global Admin)',
              loggedAt: new Date().toISOString(),
            })],
          );

          return {
            success: true,
            data: {
              action: params.action,
              severity: params.severity || 'INFO',
              loggedAt: new Date().toISOString(),
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    // ── SELF-DIAGNOSTIC ─────────────────────────────────────────────

    {
      name: 'check_my_access',
      description: 'Verify what GCP and Entra ID permissions I actually have right now. Run this BEFORE reporting access issues.',
      parameters: {},
      execute: async (_params, _ctx): Promise<ToolResult> => {
        const results: Record<string, unknown> = {};

        // 1. Test GCP IAM — can I read IAM policies?
        try {
          const res = await gcpFetch(
            `https://cloudresourcemanager.googleapis.com/v1/projects/${MANAGED_PROJECTS[0]}:getIamPolicy`,
            'POST',
            { options: { requestedPolicyVersion: 3 } },
          );
          results.gcp_iam = res.ok
            ? { status: 'ok', detail: 'Can read IAM policies' }
            : { status: 'denied', detail: `${res.status}: ${await res.text()}` };
        } catch (err) {
          results.gcp_iam = { status: 'error', detail: (err as Error).message };
        }

        // 2. Test GCP Secret Manager — can I list secrets?
        try {
          const res = await gcpFetch(
            `https://secretmanager.googleapis.com/v1/projects/${MANAGED_PROJECTS[0]}/secrets?pageSize=1`,
          );
          results.gcp_secrets = res.ok
            ? { status: 'ok', detail: 'Can list secrets' }
            : { status: 'denied', detail: `${res.status}: ${await res.text()}` };
        } catch (err) {
          results.gcp_secrets = { status: 'error', detail: (err as Error).message };
        }

        // 3. Test Entra ID — can I read the directory?
        try {
          const res = await graphFetch('/users?$top=1&$select=id', 'GET', undefined, 'read_directory');
          results.entra_directory = res.ok
            ? { status: 'ok', detail: 'Can read directory' }
            : { status: 'denied', detail: `${res.status}: ${await res.text()}` };
        } catch (err) {
          results.entra_directory = { status: 'error', detail: (err as Error).message };
        }

        // 4. Test Entra ID — can I read directory roles?
        try {
          const res = await graphFetch('/directoryRoles?$top=1&$select=id', 'GET', undefined, 'list_directory_roles');
          results.entra_roles = res.ok
            ? { status: 'ok', detail: 'Can read directory roles' }
            : { status: 'denied', detail: `${res.status}: ${await res.text()}` };
        } catch (err) {
          results.entra_roles = { status: 'error', detail: (err as Error).message };
        }

        // 5. Test Entra ID — can I manage groups?
        try {
          const res = await graphFetch('/groups?$top=1&$select=id', 'GET', undefined, 'list_groups');
          results.entra_groups = res.ok
            ? { status: 'ok', detail: 'Can list groups' }
            : { status: 'denied', detail: `${res.status}: ${await res.text()}` };
        } catch (err) {
          results.entra_groups = { status: 'error', detail: (err as Error).message };
        }

        const allOk = Object.values(results).every((r) => (r as { status: string }).status === 'ok');

        return {
          success: true,
          data: {
            overallStatus: allOk ? 'ALL_ACCESS_OK' : 'PARTIAL_ACCESS',
            checks: results,
            checkedAt: new Date().toISOString(),
            note: allOk ? 'All access checks passed.' : 'Some checks failed — see details above.',
          },
        };
      },
    },
  ];
}
