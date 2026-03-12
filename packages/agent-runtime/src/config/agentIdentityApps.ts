import { readFileSync } from 'node:fs';

interface AgentIdentityRecord {
  appId?: string;
  spId?: string;
  blueprintSpId?: string;
  entraUserId?: string;
  upn?: string;
}

const AGENT_IDENTITY_MAP = JSON.parse(
  readFileSync(new URL('./agentIdentities.json', import.meta.url), 'utf8'),
) as Record<string, AgentIdentityRecord>;

export function getAgentIdentityAppId(role: string): string | null {
  const record = AGENT_IDENTITY_MAP[role];
  return typeof record?.appId === 'string' && record.appId ? record.appId : null;
}

export function getAgentSpId(role: string): string | null {
  const record = AGENT_IDENTITY_MAP[role];
  return typeof record?.spId === 'string' && record.spId ? record.spId : null;
}

export function getAgentBlueprintSpId(role: string): string | null {
  const record = AGENT_IDENTITY_MAP[role];
  return typeof record?.blueprintSpId === 'string' && record.blueprintSpId ? record.blueprintSpId : null;
}

export function getAgentEntraUserId(role: string): string | null {
  const record = AGENT_IDENTITY_MAP[role];
  return typeof record?.entraUserId === 'string' && record.entraUserId ? record.entraUserId : null;
}

export function getAgentUpn(role: string): string | null {
  const record = AGENT_IDENTITY_MAP[role];
  return typeof record?.upn === 'string' && record.upn ? record.upn : null;
}
