import agentIdentities from './agentIdentities.json';

interface AgentIdentityRecord {
  appId?: string;
}

const AGENT_IDENTITY_MAP = agentIdentities as Record<string, AgentIdentityRecord>;

export function getAgentIdentityAppId(role: string): string | null {
  const record = AGENT_IDENTITY_MAP[role];
  return typeof record?.appId === 'string' && record.appId ? record.appId : null;
}
