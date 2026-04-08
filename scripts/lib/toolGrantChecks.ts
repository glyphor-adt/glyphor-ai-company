import type { Pool } from 'pg';

export interface RoleGrantPolicy {
  description?: string;
  required: string[];
  recommended?: string[];
}

export interface GrantCheckRow {
  tool_name: string;
  is_active: boolean | null;
  is_blocked: boolean | null;
  expires_at: string | null;
}

export interface GrantCheckResult {
  role: string;
  ok: boolean;
  fatal: string[];
  warnings: string[];
  totalRows: number;
  effectiveGrants: number;
}

export async function checkRoleToolGrants(
  pool: Pool,
  role: string,
  policy: RoleGrantPolicy,
): Promise<GrantCheckResult> {
  const { rows } = await pool.query<GrantCheckRow>(
    `SELECT tool_name, is_active, is_blocked, expires_at
       FROM agent_tool_grants
      WHERE agent_role = $1`,
    [role],
  );

  const byName = new Map(rows.map((r) => [r.tool_name, r]));
  const fatal: string[] = [];

  for (const tool of policy.required) {
    const row = byName.get(tool);
    if (!row) {
      fatal.push(`missing grant: ${tool}`);
      continue;
    }
    if (row.is_active === false) fatal.push(`inactive: ${tool}`);
    if (row.is_blocked === true) fatal.push(`blocked: ${tool}`);
    if (row.expires_at && new Date(row.expires_at) <= new Date()) {
      fatal.push(`expired: ${tool}`);
    }
  }

  const warnings: string[] = [];
  for (const tool of policy.recommended ?? []) {
    const row = byName.get(tool);
    if (!row || row.is_active === false || row.is_blocked === true) {
      warnings.push(tool);
    } else if (row.expires_at && new Date(row.expires_at) <= new Date()) {
      warnings.push(`${tool} (expired)`);
    }
  }

  const effectiveGrants = rows.filter(
    (r) =>
      r.is_active !== false &&
      r.is_blocked !== true &&
      (!r.expires_at || new Date(r.expires_at) > new Date()),
  ).length;

  return {
    role,
    ok: fatal.length === 0,
    fatal,
    warnings,
    totalRows: rows.length,
    effectiveGrants,
  };
}
