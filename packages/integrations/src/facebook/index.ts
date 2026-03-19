/**
 * Facebook / Meta Graph API — REST client
 *
 * Wraps the Meta Graph API v21.0 for page posting, insights,
 * Instagram content publishing, and ad account management.
 *
 * Environment variables:
 *   FACEBOOK_APP_ID                     — Meta App ID
 *   FACEBOOK_APP_SECRET                 — Meta App Secret
 *   FACEBOOK_LONG_LIVED_PAGE_ACCESS_TOKEN — Page-scoped long-lived token
 *   FACEBOOK_PAGE_ID                    — Facebook Page ID
 *   FACEBOOK_BUSINESS_ACCOUNT_ID        — Meta Business Suite account ID
 */

const FB_API_BASE = 'https://graph.facebook.com/v21.0';

// ── Credentials ──────────────────────────────────────────────

function getPageToken(): string {
  const token = process.env.FACEBOOK_LONG_LIVED_PAGE_ACCESS_TOKEN;
  if (!token) throw new Error('FACEBOOK_LONG_LIVED_PAGE_ACCESS_TOKEN not configured');
  return token;
}

function getPageId(): string {
  const id = process.env.FACEBOOK_PAGE_ID;
  if (!id) throw new Error('FACEBOOK_PAGE_ID not configured');
  return id;
}

// ── Authenticated fetch ──────────────────────────────────────

async function fbFetch(
  path: string,
  options: RequestInit = {},
): Promise<Record<string, unknown>> {
  const token = getPageToken();
  const separator = path.includes('?') ? '&' : '?';
  const url = `${FB_API_BASE}${path}${separator}access_token=${encodeURIComponent(token)}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });

  const body = (await res.json()) as Record<string, unknown>;

  if (!res.ok) {
    const error = body.error as Record<string, unknown> | undefined;
    const msg = (error?.message as string) ?? `Facebook API error ${res.status}`;
    throw new Error(msg);
  }

  return body;
}

// ── Types ────────────────────────────────────────────────────

export interface FacebookPost {
  id: string;
  message?: string;
  created_time: string;
  permalink_url?: string;
}

export interface FacebookPostResult {
  id: string;
  postId: string;
}

export interface FacebookPageInsights {
  metric: string;
  period: string;
  values: Array<{ value: number | Record<string, number>; end_time: string }>;
}

export interface FacebookPostInsights {
  postId: string;
  impressions: number;
  reach: number;
  engagement: number;
  reactions: number;
  comments: number;
  shares: number;
}

// ── Page Operations ──────────────────────────────────────────

/** Publish a text post to the Facebook Page */
export async function createPagePost(
  message: string,
  link?: string,
): Promise<FacebookPostResult> {
  const pageId = getPageId();
  const payload: Record<string, string> = { message };
  if (link) payload.link = link;

  const data = await fbFetch(`/${pageId}/feed`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  return {
    id: data.id as string,
    postId: data.id as string,
  };
}

/** Schedule a post for a future time */
export async function schedulePagePost(
  message: string,
  scheduledTime: Date,
  link?: string,
): Promise<FacebookPostResult> {
  const pageId = getPageId();
  const unixTimestamp = Math.floor(scheduledTime.getTime() / 1000);

  const payload: Record<string, string | number | boolean> = {
    message,
    scheduled_publish_time: unixTimestamp,
    published: false,
  };
  if (link) payload.link = link;

  const data = await fbFetch(`/${pageId}/feed`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  return {
    id: data.id as string,
    postId: data.id as string,
  };
}

/** Get recent posts from the Page */
export async function getPagePosts(limit = 10): Promise<FacebookPost[]> {
  const pageId = getPageId();
  const data = await fbFetch(
    `/${pageId}/feed?fields=id,message,created_time,permalink_url&limit=${limit}`,
  );

  return (data.data as FacebookPost[]) ?? [];
}

/** Get a single post's details */
export async function getPost(postId: string): Promise<FacebookPost> {
  const data = await fbFetch(
    `/${postId}?fields=id,message,created_time,permalink_url`,
  );
  return data as unknown as FacebookPost;
}

/** Delete a post */
export async function deletePost(postId: string): Promise<boolean> {
  const data = await fbFetch(`/${postId}`, { method: 'DELETE' });
  return (data.success as boolean) ?? false;
}

// ── Page Insights ────────────────────────────────────────────

/** Get page-level insights (followers, reach, impressions, engagement) */
export async function getPageInsights(
  metrics: string[] = ['page_impressions', 'page_engaged_users', 'page_fans', 'page_views_total'],
  period: 'day' | 'week' | 'days_28' = 'day',
  limit = 7,
): Promise<FacebookPageInsights[]> {
  const pageId = getPageId();
  const metricStr = metrics.join(',');
  const data = await fbFetch(
    `/${pageId}/insights?metric=${metricStr}&period=${period}&limit=${limit}`,
  );

  return ((data.data as Array<Record<string, unknown>>) ?? []).map((item) => ({
    metric: item.name as string,
    period: item.period as string,
    values: (item.values as Array<{ value: number | Record<string, number>; end_time: string }>) ?? [],
  }));
}

/** Get insights for a specific post */
export async function getPostInsights(postId: string): Promise<FacebookPostInsights> {
  const metrics = 'post_impressions,post_engaged_users,post_reactions_by_type_total,post_clicks';
  const data = await fbFetch(`/${postId}/insights?metric=${metrics}`);

  const entries = (data.data as Array<Record<string, unknown>>) ?? [];
  const getValue = (name: string): number => {
    const entry = entries.find((e) => e.name === name);
    if (!entry?.values) return 0;
    const vals = entry.values as Array<{ value: number | Record<string, number> }>;
    const v = vals[0]?.value;
    return typeof v === 'number' ? v : 0;
  };

  return {
    postId,
    impressions: getValue('post_impressions'),
    reach: getValue('post_engaged_users'),
    engagement: getValue('post_clicks'),
    reactions: getValue('post_reactions_by_type_total'),
    comments: 0,
    shares: 0,
  };
}

// ── Audience / Demographics ──────────────────────────────────

/** Get audience demographics (age, gender, location) */
export async function getAudienceDemographics(): Promise<FacebookPageInsights[]> {
  const pageId = getPageId();
  const metrics = 'page_fans_gender_age,page_fans_city,page_fans_country';
  const data = await fbFetch(
    `/${pageId}/insights?metric=${metrics}&period=lifetime`,
  );

  return ((data.data as Array<Record<string, unknown>>) ?? []).map((item) => ({
    metric: item.name as string,
    period: item.period as string,
    values: (item.values as Array<{ value: number | Record<string, number>; end_time: string }>) ?? [],
  }));
}

// ── Health Check ─────────────────────────────────────────────

/** Verify Facebook credentials are configured and valid */
export async function checkFacebookHealth(): Promise<{
  configured: boolean;
  valid: boolean;
  pageName?: string;
  error?: string;
}> {
  try {
    getPageToken();
    getPageId();
  } catch {
    return { configured: false, valid: false, error: 'Facebook credentials not configured' };
  }

  try {
    const pageId = getPageId();
    const data = await fbFetch(`/${pageId}?fields=name,id`);
    return {
      configured: true,
      valid: true,
      pageName: data.name as string,
    };
  } catch (err) {
    return {
      configured: true,
      valid: false,
      error: (err as Error).message,
    };
  }
}
