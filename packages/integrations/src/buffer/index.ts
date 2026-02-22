/**
 * Buffer Integration — Social media scheduling and analytics
 *
 * Used by: Kai (post + read), Maya (post + read), Daniel (read only via Buffer)
 * Platforms: LinkedIn, Twitter/X
 */

interface BufferConfig {
  apiKey: string;
}

interface BufferPost {
  id: string;
  text: string;
  profile_ids: string[];
  scheduled_at?: string;
  status: 'draft' | 'pending' | 'sent' | 'error';
  created_at: string;
  statistics?: {
    impressions: number;
    engagements: number;
    clicks: number;
    shares: number;
  };
}

interface ScheduleParams {
  text: string;
  profileIds: string[];
  scheduledAt?: string;  // ISO datetime, or omit for "next available slot"
  media?: { link: string; description?: string }[];
}

interface SocialMetrics {
  impressions: number;
  engagements: number;
  clicks: number;
  followers: number;
  period: string;
}

export class BufferClient {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.bufferapp.com/1';

  constructor(config: BufferConfig) {
    this.apiKey = config.apiKey;
  }

  static fromEnv(): BufferClient {
    const apiKey = process.env.BUFFER_API_KEY;
    if (!apiKey) throw new Error('BUFFER_API_KEY not configured');
    return new BufferClient({ apiKey });
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const separator = path.includes('?') ? '&' : '?';
    const url = `${this.baseUrl}${path}${separator}access_token=${this.apiKey}`;
    const res = await fetch(url, options);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Buffer API ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  async getProfiles(): Promise<{ id: string; service: string; formatted_username: string }[]> {
    return this.request('/profiles.json');
  }

  async schedulePost(params: ScheduleParams): Promise<BufferPost> {
    const body: Record<string, unknown> = {
      text: params.text,
      profile_ids: params.profileIds,
    };
    if (params.scheduledAt) body.scheduled_at = params.scheduledAt;
    if (params.media?.length) body.media = params.media[0];

    return this.request('/updates/create.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(
        Object.entries(body).map(([k, v]): [string, string] => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)]),
      ),
    });
  }

  async getPendingPosts(profileId: string): Promise<BufferPost[]> {
    const data = await this.request<{ updates: BufferPost[] }>(`/profiles/${profileId}/updates/pending.json`);
    return data.updates ?? [];
  }

  async getSentPosts(profileId: string, count = 20): Promise<BufferPost[]> {
    const data = await this.request<{ updates: BufferPost[] }>(
      `/profiles/${profileId}/updates/sent.json?count=${count}`,
    );
    return data.updates ?? [];
  }

  async getAnalytics(profileId: string): Promise<SocialMetrics> {
    const sent = await this.getSentPosts(profileId, 50);
    const totals = sent.reduce(
      (acc, post) => ({
        impressions: acc.impressions + (post.statistics?.impressions ?? 0),
        engagements: acc.engagements + (post.statistics?.engagements ?? 0),
        clicks: acc.clicks + (post.statistics?.clicks ?? 0),
      }),
      { impressions: 0, engagements: 0, clicks: 0 },
    );
    return { ...totals, followers: 0, period: '50 recent posts' };
  }
}
