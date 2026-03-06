/**
 * Entra HR Tools — Entra ID user management for Head of HR (Jasmine Rivera)
 *
 * Tools for updating user profiles, uploading profile photos, setting managers
 * (org chart), and managing licenses in Microsoft Entra ID / M365.
 *
 * These tools use the M365 credential router (app-level Graph API permissions)
 * since agent users cannot hold Entra admin directory roles directly.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { getM365Token, type M365Operation } from '@glyphor/integrations';

/** Founder accounts that cannot be modified. */
const PROTECTED_EMAILS = new Set([
  'kristina@glyphor.ai',
  'andrew@glyphor.ai',
  'devops@glyphor.ai',
]);

function isProtected(email: string): boolean {
  return PROTECTED_EMAILS.has(email.toLowerCase());
}

/** Graph API fetch helper — routes token via M365 credential router. */
async function graphFetch(
  path: string,
  method = 'GET',
  body?: unknown,
  operation: M365Operation = 'read_directory',
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  const token = await getM365Token(operation);
  const url = path.startsWith('https://') ? path : `https://graph.microsoft.com/v1.0${path}`;
  return fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** Graph API fetch for binary bodies (e.g. photo upload). */
async function graphFetchBinary(
  path: string,
  method: string,
  body: Buffer | Uint8Array,
  contentType: string,
  operation: M365Operation = 'write_directory',
): Promise<Response> {
  const token = await getM365Token(operation);
  const url = path.startsWith('https://') ? path : `https://graph.microsoft.com/v1.0${path}`;
  return fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': contentType,
    },
    body,
  });
}

export function createEntraHRTools(): ToolDefinition[] {
  return [
    /* ── entra_get_user_profile ──────────── */
    {
      name: 'entra_get_user_profile',
      description:
        'Get a user\'s full Entra ID profile including display name, job title, department, ' +
        'manager, and account status. Use this to check what needs fixing.',
      parameters: {
        email: {
          type: 'string',
          description: 'User email (e.g. "marcus@glyphor.ai")',
          required: true,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const email = params.email as string;
          const res = await graphFetch(
            `/users/${encodeURIComponent(email)}?$select=id,displayName,givenName,surname,jobTitle,department,mail,userPrincipalName,accountEnabled,companyName,officeLocation`,
            'GET',
            undefined,
            'get_user_profile',
          );
          if (!res.ok) return { success: false, error: `Graph ${res.status}: ${await res.text()}` };
          const user = await res.json();

          // Also check for photo
          const photoRes = await graphFetch(
            `/users/${encodeURIComponent(email)}/photo`,
            'GET',
            undefined,
            'get_user_profile',
          );
          const hasPhoto = photoRes.ok;

          // Get manager
          const mgrRes = await graphFetch(
            `/users/${encodeURIComponent(email)}/manager?$select=displayName,userPrincipalName,jobTitle`,
            'GET',
            undefined,
            'get_user_profile',
          );
          const manager = mgrRes.ok ? await mgrRes.json() as Record<string, unknown> : null;

          return {
            success: true,
            data: {
              ...(user as Record<string, unknown>),
              hasProfilePhoto: hasPhoto,
              manager: manager ? { name: manager.displayName, email: manager.userPrincipalName, title: manager.jobTitle } : null,
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    /* ── entra_update_user_profile ────────── */
    {
      name: 'entra_update_user_profile',
      description:
        'Update an Entra ID user\'s profile properties: display name, job title, department, ' +
        'given name, surname, office location, company name. Cannot modify founder accounts.',
      parameters: {
        email: {
          type: 'string',
          description: 'User email (e.g. "marcus@glyphor.ai")',
          required: true,
        },
        display_name: { type: 'string', description: 'Full display name', required: false },
        given_name: { type: 'string', description: 'First name', required: false },
        surname: { type: 'string', description: 'Last name', required: false },
        job_title: { type: 'string', description: 'Job title', required: false },
        department: { type: 'string', description: 'Department', required: false },
        office_location: { type: 'string', description: 'Office location', required: false },
        company_name: { type: 'string', description: 'Company name', required: false },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const email = params.email as string;
          if (isProtected(email)) {
            return { success: false, error: `BLOCKED: ${email} is a protected founder account.` };
          }

          const updates: Record<string, unknown> = {};
          if (params.display_name) updates.displayName = params.display_name;
          if (params.given_name) updates.givenName = params.given_name;
          if (params.surname) updates.surname = params.surname;
          if (params.job_title) updates.jobTitle = params.job_title;
          if (params.department) updates.department = params.department;
          if (params.office_location) updates.officeLocation = params.office_location;
          if (params.company_name) updates.companyName = params.company_name;

          if (Object.keys(updates).length === 0) {
            return { success: false, error: 'No fields provided to update.' };
          }

          const res = await graphFetch(
            `/users/${encodeURIComponent(email)}`,
            'PATCH',
            updates,
            'write_directory',
          );
          if (!res.ok) return { success: false, error: `Graph ${res.status}: ${await res.text()}` };

          return {
            success: true,
            data: {
              action: 'ENTRA_UPDATE_PROFILE',
              email,
              updatedFields: Object.keys(updates),
              updatedAt: new Date().toISOString(),
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    /* ── entra_upload_user_photo ──────────── */
    {
      name: 'entra_upload_user_photo',
      description:
        'Upload a profile photo for a user in Entra ID. The photo will appear in Outlook, ' +
        'Teams, and the org chart. Reads the photo from the local avatars directory by role slug. ' +
        'Cannot modify founder accounts.',
      parameters: {
        email: {
          type: 'string',
          description: 'User email (e.g. "marcus@glyphor.ai")',
          required: true,
        },
        role: {
          type: 'string',
          description: 'Agent role slug matching the avatar filename (e.g. "cto" for cto.png)',
          required: true,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const email = params.email as string;
          const role = params.role as string;

          if (isProtected(email)) {
            return { success: false, error: `BLOCKED: ${email} is a protected founder account.` };
          }

          // Try GCS first, then local
          let photoBytes: Buffer;
          try {
            const { Storage } = await import('@google-cloud/storage');
            const storage = new Storage();
            const bucketName = process.env.GCS_BUCKET || 'glyphor-company';
            const [contents] = await storage.bucket(bucketName).file(`avatars/${role}.png`).download();
            photoBytes = contents;
          } catch {
            // Fall back to local avatar file
            const { readFile } = await import('node:fs/promises');
            const { join } = await import('node:path');
            const localPath = join(process.cwd(), 'packages', 'dashboard', 'public', 'avatars', `${role}.png`);
            photoBytes = await readFile(localPath);
          }

          const res = await graphFetchBinary(
            `/users/${encodeURIComponent(email)}/photo/$value`,
            'PUT',
            photoBytes,
            'image/png',
            'write_directory',
          );

          if (!res.ok) return { success: false, error: `Graph ${res.status}: ${await res.text()}` };

          return {
            success: true,
            data: {
              action: 'ENTRA_UPLOAD_PHOTO',
              email,
              role,
              uploadedAt: new Date().toISOString(),
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    /* ── entra_set_manager ────────────────── */
    {
      name: 'entra_set_manager',
      description:
        'Set the manager for a user in Entra ID. This controls the org chart hierarchy ' +
        'displayed in Outlook and Teams. Cannot modify founder accounts.',
      parameters: {
        email: {
          type: 'string',
          description: 'User email of the person whose manager to set',
          required: true,
        },
        manager_email: {
          type: 'string',
          description: 'Email of the manager',
          required: true,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const email = params.email as string;
          const managerEmail = params.manager_email as string;

          if (isProtected(email)) {
            return { success: false, error: `BLOCKED: ${email} is a protected founder account.` };
          }

          // Get manager's Entra ID
          const mgrRes = await graphFetch(
            `/users/${encodeURIComponent(managerEmail)}?$select=id`,
            'GET',
            undefined,
            'read_directory',
          );
          if (!mgrRes.ok) return { success: false, error: `Manager not found: ${managerEmail}` };
          const mgr = await mgrRes.json() as { id: string };

          const res = await graphFetch(
            `/users/${encodeURIComponent(email)}/manager/$ref`,
            'PUT',
            { '@odata.id': `https://graph.microsoft.com/v1.0/users/${mgr.id}` },
            'write_directory',
          );
          if (!res.ok) return { success: false, error: `Graph ${res.status}: ${await res.text()}` };

          return {
            success: true,
            data: {
              action: 'ENTRA_SET_MANAGER',
              email,
              managerEmail,
              setAt: new Date().toISOString(),
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    /* ── entra_assign_license ─────────────── */
    {
      name: 'entra_hr_assign_license',
      description:
        'Assign a Microsoft license to a user. Primarily used for assigning Agent 365 Tier 3 ' +
        'licenses to new agents. Cannot modify founder accounts.',
      parameters: {
        email: {
          type: 'string',
          description: 'User email',
          required: true,
        },
        sku_id: {
          type: 'string',
          description: 'License SKU ID. Agent365 Tier 3 = 304b93a3-b1f1-427f-aa02-da21e7c7d675',
          required: true,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const email = params.email as string;
          if (isProtected(email)) {
            return { success: false, error: `BLOCKED: ${email} is a protected founder account.` };
          }

          // Ensure usage location is set (required for licensing)
          await graphFetch(
            `/users/${encodeURIComponent(email)}`,
            'PATCH',
            { usageLocation: 'US' },
            'write_directory',
          );

          const res = await graphFetch(
            `/users/${encodeURIComponent(email)}/assignLicense`,
            'POST',
            {
              addLicenses: [{ skuId: params.sku_id, disabledPlans: [] }],
              removeLicenses: [],
            },
            'manage_licenses',
          );
          if (!res.ok) return { success: false, error: `Graph ${res.status}: ${await res.text()}` };

          return {
            success: true,
            data: {
              action: 'ENTRA_ASSIGN_LICENSE',
              email,
              skuId: params.sku_id,
              assignedAt: new Date().toISOString(),
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    /* ── entra_audit_profiles ─────────────── */
    {
      name: 'entra_audit_profiles',
      description:
        'Audit all glyphor.ai Entra users for missing profile data: display names, job titles, ' +
        'departments, profile photos, and manager assignments. Returns a list of issues to fix.',
      parameters: {},
      execute: async (): Promise<ToolResult> => {
        try {
          const res = await graphFetch(
            `/users?$filter=endsWith(userPrincipalName,'glyphor.ai')&$select=id,displayName,givenName,surname,jobTitle,department,userPrincipalName,accountEnabled&$top=100&$count=true`,
            'GET',
            undefined,
            'read_directory',
            { ConsistencyLevel: 'eventual' },
          );
          if (!res.ok) return { success: false, error: `Graph ${res.status}: ${await res.text()}` };
          const data = await res.json() as { value: Array<Record<string, unknown>> };
          const users = data.value || [];

          const issues: Array<{ email: string; problems: string[] }> = [];

          for (const user of users) {
            const problems: string[] = [];
            const upn = user.userPrincipalName as string;

            if (!user.displayName) problems.push('missing displayName');
            if (!user.givenName) problems.push('missing givenName');
            if (!user.surname) problems.push('missing surname');
            if (!user.jobTitle) problems.push('missing jobTitle');
            if (!user.department) problems.push('missing department');

            // Check photo
            const photoRes = await graphFetch(
              `/users/${encodeURIComponent(upn)}/photo`,
              'GET',
              undefined,
              'get_user_profile',
            );
            if (!photoRes.ok) problems.push('no profile photo');

            // Check manager
            const mgrRes = await graphFetch(
              `/users/${encodeURIComponent(upn)}/manager?$select=displayName`,
              'GET',
              undefined,
              'get_user_profile',
            );
            if (!mgrRes.ok) problems.push('no manager set (org chart)');

            if (problems.length > 0) {
              issues.push({ email: upn, problems });
            }
          }

          return {
            success: true,
            data: {
              totalUsers: users.length,
              usersWithIssues: issues.length,
              compliant: users.length - issues.length,
              complianceRate: users.length > 0
                ? `${Math.round(((users.length - issues.length) / users.length) * 100)}%`
                : 'N/A',
              issues,
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },
  ];
}
