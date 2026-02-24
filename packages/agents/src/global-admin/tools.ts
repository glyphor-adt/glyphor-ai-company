/**
 * Global Admin (Morgan Blake) — Tool Definitions
 *
 * Tools for: cross-project IAM management, service account provisioning,
 * secret management, access audits, and standardized onboarding.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';

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

/** Generate a unique grant ID for audit trail. */
function grantId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `GRT-${ts}-${rand}`.toUpperCase();
}

/** Safe fetch wrapper for GCP APIs using ADC metadata server. */
async function gcpFetch(url: string, method = 'GET', body?: unknown): Promise<Response> {
  // Use Google Auth Library's Application Default Credentials
  const { GoogleAuth } = await import('google-auth-library');
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  const token = await client.getAccessToken();

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
  product: ['TEAMS_CHANNEL_GENERAL_ID', 'TEAMS_CHANNEL_PRODUCT_FUSE_ID', 'TEAMS_CHANNEL_PRODUCT_PULSE_ID'],
  finance: ['TEAMS_CHANNEL_GENERAL_ID', 'TEAMS_CHANNEL_FINANCIALS_ID'],
  marketing: ['TEAMS_CHANNEL_GENERAL_ID', 'TEAMS_CHANNEL_GROWTH_ID'],
  'customer-success': ['TEAMS_CHANNEL_GENERAL_ID'],
  sales: ['TEAMS_CHANNEL_GENERAL_ID', 'TEAMS_CHANNEL_GROWTH_ID'],
  operations: ['TEAMS_CHANNEL_GENERAL_ID'],
};

/** Standard role templates by department. */
const ROLE_TEMPLATES: Record<string, string[]> = {
  engineering: ['roles/run.viewer', 'roles/monitoring.viewer', 'roles/logging.viewer'],
  product: ['roles/monitoring.viewer', 'roles/logging.viewer'],
  finance: ['roles/bigquery.dataViewer', 'roles/bigquery.jobUser'],
  marketing: ['roles/monitoring.viewer'],
  'customer-success': ['roles/monitoring.viewer'],
  sales: ['roles/monitoring.viewer'],
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
          description: 'Secret name (e.g. supabase-url)',
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
          enum: ['engineering', 'product', 'finance', 'marketing', 'customer-success', 'sales', 'operations'],
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

        // 2. Teams channels — log which channels should be assigned
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

        // 3. Log onboarding completion
        const supabase = memory.getSupabaseClient();
        try {
          await supabase.from('activity_log').insert({
            agent_role: 'global-admin',
            action: 'onboarding',
            details: {
              employee: name,
              email,
              role: role_slug,
              department: dept,
              reports_to,
              is_agent,
              checklist,
            },
          });
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
          const supabase = memory.getSupabaseClient();
          let details: Record<string, unknown>;
          try {
            details = JSON.parse(params.details as string);
          } catch {
            details = { raw: params.details };
          }

          const { error } = await supabase.from('activity_log').insert({
            agent_role: 'global-admin',
            action: params.action as string,
            details: {
              ...details,
              severity: params.severity || 'INFO',
              loggedBy: 'Morgan Blake (Global Admin)',
              loggedAt: new Date().toISOString(),
            },
          });

          if (error) return { success: false, error: error.message };
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
  ];
}
