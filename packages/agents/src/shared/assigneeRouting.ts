import { systemQuery } from '@glyphor/shared/db';

const ASSIGNEE_ROLE_ALIASES: Record<string, string> = {
  chief_of_staff: 'chief-of-staff',
  vp_design: 'vp-design',
  vp_sales: 'vp-sales',
  vp_cs: 'vp-cs',
  competitive_intel: 'competitive-research-analyst',
  'competitive-intel': 'competitive-research-analyst',
  // Common role aliases used by model outputs
  cos: 'chief-of-staff',
  ctos: 'cto',
  ops_lead: 'ops',
  // Human-name slug aliases used in prompts/briefs
  'sarah-chen': 'chief-of-staff',
  sarah: 'chief-of-staff',
  'marcus-reeves': 'cto',
  marcus: 'cto',
  'elena-vasquez': 'cpo',
  elena: 'cpo',
  'maya-brooks': 'cmo',
  maya: 'cmo',
  'nadia-okafor': 'cfo',
  nadia: 'cfo',
  'victoria-chase': 'clo',
  victoria: 'clo',
  'atlas-vega': 'ops',
  atlas: 'ops',
  'sophia-lin': 'vp-research',
  sophia: 'vp-research',
  'rachel-kim': 'vp-sales',
  rachel: 'vp-sales',
  'mia-tanaka': 'vp-design',
  mia: 'vp-design',
};

export function normalizeAssigneeRole(rawRole: string): string {
  const normalized = rawRole.trim().toLowerCase().replace(/[\s_]+/g, '-');
  return ASSIGNEE_ROLE_ALIASES[normalized] ?? normalized;
}

/** Resolves role slug, hyphenated display form, or spaced display name to company_agents.role. */
const RESOLVE_ASSIGNEE_FROM_AGENTS_SQL = `
SELECT role FROM company_agents
WHERE role = $1
   OR LOWER(REPLACE(COALESCE(display_name, name, ''), ' ', '-')) = LOWER(REPLACE(TRIM($1), ' ', '-'))
LIMIT 1`;

export async function resolveAssigneeRoleFromCompanyAgents(raw: string): Promise<string | null> {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  const [row] = await systemQuery<{ role: string }>(RESOLVE_ASSIGNEE_FROM_AGENTS_SQL, [trimmed]);
  return row?.role ?? null;
}

/**
 * Resolve assignee input to a canonical role slug: DB lookup on raw input, then on normalized alias form.
 */
export async function resolveAssigneeForWorkAssignment(raw: string): Promise<string | null> {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  let slug = await resolveAssigneeRoleFromCompanyAgents(trimmed);
  if (!slug) {
    slug = await resolveAssigneeRoleFromCompanyAgents(normalizeAssigneeRole(trimmed));
  }
  return slug ?? null;
}

function formatStatus(status: string | null | undefined): string {
  if (!status) return 'unknown';
  return status.toLowerCase();
}

export async function resolveActiveAssigneeRole(rawRole: string): Promise<{ ok: true; role: string } | { ok: false; error: string }> {
  const normalizedRole = normalizeAssigneeRole(rawRole ?? '');
  if (!normalizedRole) {
    return { ok: false, error: 'assigned_to role is required' };
  }

  const [row] = await systemQuery<{ role: string; status: string }>(
    'SELECT role, status FROM company_agents WHERE role = $1 LIMIT 1',
    [normalizedRole],
  );

  if (!row) {
    return {
      ok: false,
      error: `Unknown assignee role "${rawRole}" (normalized: "${normalizedRole}").`,
    };
  }

  if (formatStatus(row.status) !== 'active') {
    return {
      ok: false,
      error: `Assignee role "${row.role}" is ${formatStatus(row.status)}; assignments require active roles.`,
    };
  }

  return { ok: true, role: row.role };
}

export async function resolveActiveAssigneeBatch(rawRoles: string[]): Promise<{ canonicalByNormalized: Map<string, string>; errors: string[] }> {
  const normalizedRoles = rawRoles.map((role) => normalizeAssigneeRole(role ?? ''));
  const missing = normalizedRoles
    .map((role, index) => ({ role, index }))
    .filter((entry) => !entry.role)
    .map((entry) => `Assignment #${entry.index + 1}: assigned_to role is required`);

  const uniqueNormalized = Array.from(new Set(normalizedRoles.filter(Boolean)));
  const rows = uniqueNormalized.length > 0
    ? await systemQuery<{ role: string; status: string }>(
        'SELECT role, status FROM company_agents WHERE role = ANY($1)',
        [uniqueNormalized],
      )
    : [];

  const roleState = new Map(rows.map((row) => [row.role, formatStatus(row.status)]));
  const canonicalByNormalized = new Map<string, string>();
  const errors: string[] = [...missing];

  for (const normalizedRole of uniqueNormalized) {
    const status = roleState.get(normalizedRole);
    if (!status) {
      errors.push(`Unknown assignee role "${normalizedRole}".`);
      continue;
    }

    if (status !== 'active') {
      errors.push(`Assignee role "${normalizedRole}" is ${status}; assignments require active roles.`);
      continue;
    }

    canonicalByNormalized.set(normalizedRole, normalizedRole);
  }

  return { canonicalByNormalized, errors };
}
