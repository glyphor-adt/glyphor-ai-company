import type {
  AgentRecord,
  AgentSdkClientOptions,
  CreateAgentRequest,
  RetireAgentRequest,
} from './types.js';

export class AgentSdkClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AgentSdkClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  listAgents(): Promise<AgentRecord[]> {
    return this.request<AgentRecord[]>('/sdk/agents');
  }

  getAgent(role: string): Promise<AgentRecord> {
    return this.request<AgentRecord>(`/sdk/agents/${encodeURIComponent(role)}`);
  }

  createAgent(input: CreateAgentRequest): Promise<AgentRecord> {
    return this.request<AgentRecord>('/sdk/agents', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  retireAgent(role: string, input: RetireAgentRequest): Promise<AgentRecord> {
    return this.request<AgentRecord>(`/sdk/agents/${encodeURIComponent(role)}/retire`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
        ...init?.headers,
      },
    });

    if (!response.ok) {
      let message = `Agent SDK request failed: ${response.status}`;
      try {
        const data = await response.json() as { error?: string };
        if (data?.error) message = data.error;
      } catch {
        // keep generic fallback
      }
      throw new Error(message);
    }

    return response.json() as Promise<T>;
  }
}
