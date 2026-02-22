/**
 * PostHog Integration — Product analytics, events, funnels, sessions
 *
 * Used by: Priya (product analytics), Emma (usage patterns), Elena (product metrics),
 *          James (growth metrics), Anna (product research)
 * Read-only access.
 */

interface PostHogConfig {
  apiKey: string;
  projectId: string;
  host?: string;
}

interface PostHogEvent {
  id: string;
  event: string;
  distinct_id: string;
  timestamp: string;
  properties: Record<string, unknown>;
}

interface FunnelStep {
  order: number;
  name: string;
  count: number;
  conversion_rate: number;
}

interface TrendResult {
  label: string;
  data: number[];
  days: string[];
  count: number;
}

export class PostHogClient {
  private readonly apiKey: string;
  private readonly projectId: string;
  private readonly baseUrl: string;

  constructor(config: PostHogConfig) {
    this.apiKey = config.apiKey;
    this.projectId = config.projectId;
    this.baseUrl = config.host ?? 'https://app.posthog.com';
  }

  static fromEnv(): PostHogClient {
    const apiKey = process.env.POSTHOG_API_KEY;
    const projectId = process.env.POSTHOG_PROJECT_ID;
    if (!apiKey || !projectId) throw new Error('POSTHOG_API_KEY and POSTHOG_PROJECT_ID required');
    return new PostHogClient({ apiKey, projectId, host: process.env.POSTHOG_HOST });
  }

  private async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}/api/projects/${this.projectId}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`PostHog API ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  /** Get recent events, optionally filtered by event name */
  async getEvents(opts?: { event?: string; limit?: number; after?: string }): Promise<PostHogEvent[]> {
    const params = new URLSearchParams();
    if (opts?.event) params.set('event', opts.event);
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.after) params.set('after', opts.after);
    const qs = params.toString();
    const data = await this.request<{ results: PostHogEvent[] }>(`/events/${qs ? `?${qs}` : ''}`);
    return data.results;
  }

  /** Query trends (event counts over time) */
  async getTrends(opts: {
    events: { id: string; math?: string }[];
    date_from?: string;
    date_to?: string;
    interval?: 'day' | 'week' | 'month';
  }): Promise<TrendResult[]> {
    const data = await this.request<{ result: TrendResult[] }>('/insights/trend/', 'POST', {
      events: opts.events,
      date_from: opts.date_from ?? '-30d',
      date_to: opts.date_to ?? 'now',
      interval: opts.interval ?? 'day',
    });
    return data.result;
  }

  /** Query funnel conversion */
  async getFunnel(opts: {
    events: { id: string; order: number }[];
    date_from?: string;
    date_to?: string;
  }): Promise<FunnelStep[]> {
    const data = await this.request<{ result: FunnelStep[][] }>('/insights/funnel/', 'POST', {
      events: opts.events,
      date_from: opts.date_from ?? '-30d',
      date_to: opts.date_to ?? 'now',
      funnel_window_days: 14,
    });
    return data.result?.[0] ?? [];
  }

  /** Get active persons count */
  async getActiveUsers(period: 'day' | 'week' | 'month' = 'week'): Promise<number> {
    const trends = await this.getTrends({
      events: [{ id: '$pageview', math: 'dau' }],
      date_from: `-1${period.charAt(0)}`,
      interval: period,
    });
    return trends[0]?.count ?? 0;
  }

  /** Get session recordings list */
  async getRecordings(limit = 10): Promise<{ id: string; distinct_id: string; duration: number; start_time: string }[]> {
    const data = await this.request<{ results: { id: string; distinct_id: string; recording_duration: number; start_time: string }[] }>(
      `/session_recordings/?limit=${limit}`,
    );
    return data.results.map((r) => ({
      id: r.id,
      distinct_id: r.distinct_id,
      duration: r.recording_duration,
      start_time: r.start_time,
    }));
  }
}
