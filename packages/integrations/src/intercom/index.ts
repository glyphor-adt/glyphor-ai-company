/**
 * Intercom Integration — Support tickets, conversations, knowledge base
 *
 * Used by: David (primary - teammate token), James (admin), Emma (read-only)
 * David: create/update tickets, respond to conversations, search KB
 * James: admin access for team management
 * Emma: read conversations for CSAT/sentiment analysis
 */

interface IntercomConfig {
  accessToken: string;
}

interface Conversation {
  id: string;
  type: string;
  title: string | null;
  state: 'open' | 'closed' | 'snoozed';
  priority: string;
  created_at: number;
  updated_at: number;
  waiting_since: number | null;
  tags: { tags: { id: string; name: string }[] };
  statistics: { time_to_first_response?: number; median_time_to_reply?: number };
}

interface Contact {
  id: string;
  email: string;
  name: string;
  created_at: number;
  last_seen_at: number | null;
}

interface Article {
  id: string;
  title: string;
  body: string;
  state: 'published' | 'draft';
  url: string;
  statistics: { views: number; conversions: number };
}

export class IntercomClient {
  private readonly token: string;
  private readonly baseUrl = 'https://api.intercom.io';

  constructor(config: IntercomConfig) {
    this.token = config.accessToken;
  }

  static fromEnv(tokenName = 'INTERCOM_ACCESS_TOKEN'): IntercomClient {
    const token = process.env[tokenName];
    if (!token) throw new Error(`${tokenName} not configured`);
    return new IntercomClient({ accessToken: token });
  }

  private async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Intercom API ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  /** List open conversations */
  async listConversations(opts?: { state?: string; page?: number }): Promise<{ conversations: Conversation[]; total: number }> {
    const params = new URLSearchParams();
    if (opts?.state) params.set('state', opts.state);
    if (opts?.page) params.set('page', String(opts.page));
    const qs = params.toString();
    return this.request(`/conversations${qs ? `?${qs}` : ''}`);
  }

  /** Get a single conversation */
  async getConversation(id: string): Promise<Conversation> {
    return this.request(`/conversations/${id}`);
  }

  /** Reply to a conversation */
  async replyToConversation(conversationId: string, body: string, adminId: string): Promise<void> {
    await this.request(`/conversations/${conversationId}/reply`, 'POST', {
      type: 'admin',
      admin_id: adminId,
      message_type: 'comment',
      body,
    });
  }

  /** Tag a conversation */
  async tagConversation(conversationId: string, tagId: string, adminId: string): Promise<void> {
    await this.request(`/conversations/${conversationId}/tags`, 'POST', {
      id: tagId,
      admin_id: adminId,
    });
  }

  /** Search contacts by email */
  async searchContacts(email: string): Promise<Contact[]> {
    const data = await this.request<{ data: Contact[] }>('/contacts/search', 'POST', {
      query: { field: 'email', operator: '=', value: email },
    });
    return data.data;
  }

  /** List help-center articles */
  async listArticles(page = 1): Promise<{ articles: Article[]; total: number }> {
    const data = await this.request<{ data: Article[]; total_count: number }>(`/articles?page=${page}`);
    return { articles: data.data, total: data.total_count };
  }

  /** Create a help-center article */
  async createArticle(title: string, body: string, state: 'published' | 'draft' = 'draft'): Promise<Article> {
    return this.request('/articles', 'POST', {
      title,
      body,
      state,
    });
  }

  /** Get conversation counts by state */
  async getConversationCounts(): Promise<{ open: number; closed: number; snoozed: number }> {
    const data = await this.request<{ conversation: { open: number; closed: number; snoozed: number } }>('/counts?type=conversation');
    return data.conversation;
  }
}
