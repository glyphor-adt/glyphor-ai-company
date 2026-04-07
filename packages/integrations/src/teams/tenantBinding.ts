import { systemQuery } from '@glyphor/shared/db';

export const DEFAULT_SYSTEM_TENANT_ID = (
  process.env.DEFAULT_TENANT_ID?.trim()
  || process.env.GLYPHOR_TENANT_ID?.trim()
  || '00000000-0000-0000-0000-000000000000'
);

export interface TeamsInstallProofInput {
  teamsTenantId: string;
  teamsTeamId?: string | null;
  installerAadId?: string | null;
  serviceUrl?: string | null;
  conversationId?: string | null;
  source: 'conversation_update' | 'manual_binding';
}

export interface TeamsTenantBindingResolution {
  tenantId: string;
  workspaceKey: string;
  matchedBy: 'tenant_workspaces';
}

function normalizeValue(value: string): string {
  return value.trim().toLowerCase();
}

export function isSystemTenantId(tenantId: string | null | undefined): boolean {
  return !tenantId || tenantId === DEFAULT_SYSTEM_TENANT_ID;
}

export function canonicalTeamsWorkspaceKey(teamsTenantId: string, teamsTeamId?: string | null): string {
  const tenantKey = normalizeValue(teamsTenantId);
  const teamKey = teamsTeamId?.trim() ? normalizeValue(teamsTeamId) : 'personal';
  return `teams:${tenantKey}:${teamKey}`;
}

export function buildTeamsWorkspaceKeys(teamsTenantId: string, teamsTeamId?: string | null): string[] {
  const tenantKey = normalizeValue(teamsTenantId);
  const keys = [
    canonicalTeamsWorkspaceKey(teamsTenantId, teamsTeamId),
    `teams:${tenantKey}`,
    tenantKey,
  ];
  return [...new Set(keys)];
}

export function buildTeamsInstallProof(input: TeamsInstallProofInput): Record<string, unknown> {
  return {
    source: input.source,
    observed_at: new Date().toISOString(),
    teams_tenant_id: input.teamsTenantId,
    teams_team_id: input.teamsTeamId ?? null,
    installer_aad_id: input.installerAadId ?? null,
    service_url: input.serviceUrl ?? null,
    conversation_id: input.conversationId ?? null,
  };
}

export async function resolveVerifiedTeamsTenantBinding(
  teamsTenantId: string,
  teamsTeamId?: string | null,
): Promise<TeamsTenantBindingResolution | null> {
  const keys = buildTeamsWorkspaceKeys(teamsTenantId, teamsTeamId);
  const rows = await systemQuery<{ tenant_id: string; workspace_external_id: string }>(
    `SELECT tenant_id, LOWER(workspace_external_id) AS workspace_external_id
       FROM tenant_workspaces
      WHERE platform = 'teams'
        AND is_active = true
        AND workspace_external_id IS NOT NULL
        AND LOWER(workspace_external_id) = ANY($1::text[])`,
    [keys],
  );

  if (rows.length === 0) {
    return null;
  }

  const tenantIds = [...new Set(rows.map((row) => row.tenant_id))];
  if (tenantIds.length !== 1) {
    return null;
  }

  const workspaceKey = keys.find((key) => rows.some((row) => row.workspace_external_id === key))
    ?? rows[0]!.workspace_external_id;

  return {
    tenantId: tenantIds[0]!,
    workspaceKey,
    matchedBy: 'tenant_workspaces',
  };
}
