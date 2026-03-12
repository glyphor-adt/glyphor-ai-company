export type AgentAuthorityScope = 'green' | 'yellow' | 'red';

export interface AgentSdkToolConfig {
  name: string;
  description?: string;
  type?: 'api' | 'custom' | 'integration' | 'query';
  config?: Record<string, unknown>;
}

export interface CreateAgentRequest {
  name: string;
  role?: string;
  title?: string;
  department: string;
  reportsTo: string;
  brief: string;
  schedule?: string | null;
  authorityScope?: AgentAuthorityScope;
  ttlDays?: number | null;
  model?: string;
  tools?: AgentSdkToolConfig[];
  personality?: {
    tone?: string;
    expertise?: string[];
    communicationStyle?: string;
    workingStyle?: string;
  };
}

export interface RetireAgentRequest {
  reason: string;
}

export interface AgentRecord {
  role: string;
  displayName: string;
  title: string;
  department: string;
  reportsTo: string | null;
  status: string;
  tenantId: string;
  createdVia: string;
  authorityScope: string;
  model: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  brief: string | null;
  schedule: string | null;
  tools: AgentSdkToolConfig[];
}

export interface AgentSdkClientOptions {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
}
