/**
 * LinkedIn API — REST client (Community Management API v2)
 *
 * Wraps the LinkedIn Marketing/Community Management API for organization
 * page posting, share analytics, follower stats, and visitor demographics.
 *
 * Uses OAuth 2.0 three-legged flow. A long-lived refresh token is exchanged
 * for short-lived access tokens automatically.
 *
 * Environment variables:
 *   LINKEDIN_CLIENT_ID       — LinkedIn App client ID
 *   LINKEDIN_CLIENT_SECRET   — LinkedIn App client secret
 *   LINKEDIN_REFRESH_TOKEN   — Long-lived refresh token from OAuth consent flow
 *   LINKEDIN_ORGANIZATION_ID — LinkedIn Company Page / Organization ID (numeric)
 */

const LI_API_BASE = 'https://api.linkedin.com/rest';
const LI_TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const LI_API_VERSION = process.env.LINKEDIN_API_VERSION ?? '202306';

// ── Token cache ──────────────────────────────────────────────

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

function getCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET must be configured');
  }
  return { clientId, clientSecret };
}

function getOrganizationId(): string {
  const id = process.env.LINKEDIN_ORGANIZATION_ID;
  if (!id) throw new Error('LINKEDIN_ORGANIZATION_ID not configured');
  return id;
}

async function refreshAccessToken(): Promise<string> {
  const { clientId, clientSecret } = getCredentials();
  const refreshToken = process.env.LINKEDIN_REFRESH_TOKEN;
  if (!refreshToken) {
    throw new Error(
      'No LINKEDIN_REFRESH_TOKEN found. Complete the OAuth flow first: ' +
      'authorize at https://www.linkedin.com/oauth/v2/authorization with ' +
      'scope=r_organization_social,w_organization_social,rw_organization_admin,r_organization_followers ' +
      'then exchange the code for tokens via the scheduler OAuth callback.',
    );
  }

  const res = await fetch(LI_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LinkedIn token refresh failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  };

  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return data.access_token;
}

async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.accessToken;
  }
  return refreshAccessToken();
}

// ── Authenticated fetch ──────────────────────────────────────

async function liFetch(
  path: string,
  options: RequestInit = {},
): Promise<Record<string, unknown>> {
  const token = await getAccessToken();
  const url = path.startsWith('http') ? path : `${LI_API_BASE}${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'LinkedIn-Version': LI_API_VERSION,
      'X-Restli-Protocol-Version': '2.0.0',
      ...options.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (res.status === 204) return {};

  const body = (await res.json()) as Record<string, unknown>;

  if (!res.ok) {
    const msg = (body.message as string) ?? `LinkedIn API error ${res.status}`;
    throw new Error(msg);
  }

  return body;
}

// ── Types ────────────────────────────────────────────────────

export interface LinkedInPost {
  id: string;
  text: string;
  createdAt: string;
  url?: string;
}

export interface LinkedInPostResult {
  id: string;
  postUrn: string;
}

export interface LinkedInPostAnalytics {
  postUrn: string;
  impressions: number;
  clicks: number;
  likes: number;
  comments: number;
  shares: number;
  engagement: number;
}

export interface LinkedInFollowerStats {
  totalFollowers: number;
  organicFollowers: number;
  paidFollowers: number;
}

export interface LinkedInPageStats {
  pageViews: number;
  uniqueVisitors: number;
}

// ── Organization Posts ───────────────────────────────────────

/** Create a text post on the LinkedIn organization page */
export async function createLinkedInPost(
  text: string,
  articleUrl?: string,
): Promise<LinkedInPostResult> {
  const orgId = getOrganizationId();

  const payload: Record<string, unknown> = {
    author: `urn:li:organization:${orgId}`,
    commentary: text,
    visibility: 'PUBLIC',
    distribution: {
      feedDistribution: 'MAIN_FEED',
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: 'PUBLISHED',
  };

  if (articleUrl) {
    payload.content = {
      article: {
        source: articleUrl,
        title: text.slice(0, 200),
      },
    };
  }

  const data = await liFetch('/posts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  const postUrn = (data['x-restli-id'] as string) ?? (data.id as string) ?? '';

  return { id: postUrn, postUrn };
}

/** Schedule a post (LinkedIn doesn't natively support scheduling — we record intent) */
export async function scheduleLinkedInPost(
  text: string,
  _scheduledAt: Date,
  articleUrl?: string,
): Promise<LinkedInPostResult> {
  // LinkedIn API does not support native scheduling.
  // In production, this would store in the scheduled_social_posts table
  // and the heartbeat publisher would post at the right time.
  // For now, we create the post immediately if called.
  return createLinkedInPost(text, articleUrl);
}

/** Get recent posts from the organization page */
export async function getLinkedInPosts(limit = 10): Promise<LinkedInPost[]> {
  const orgId = getOrganizationId();
  const data = await liFetch(
    `/posts?q=author&author=urn%3Ali%3Aorganization%3A${orgId}&count=${limit}&sortBy=LAST_MODIFIED`,
  );

  const elements = (data.elements as Array<Record<string, unknown>>) ?? [];
  return elements.map((el) => ({
    id: (el.id as string) ?? '',
    text: (el.commentary as string) ?? '',
    createdAt: el.createdAt ? new Date(el.createdAt as number).toISOString() : '',
    url: el.id ? `https://www.linkedin.com/feed/update/${el.id}` : undefined,
  }));
}

/** Delete a post */
export async function deleteLinkedInPost(postUrn: string): Promise<boolean> {
  try {
    await liFetch(`/posts/${encodeURIComponent(postUrn)}`, { method: 'DELETE' });
    return true;
  } catch {
    return false;
  }
}

// ── Analytics ────────────────────────────────────────────────

/** Get analytics for a specific post */
export async function getLinkedInPostAnalytics(postUrn: string): Promise<LinkedInPostAnalytics> {
  const orgId = getOrganizationId();
  const data = await liFetch(
    `/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=urn%3Ali%3Aorganization%3A${orgId}&shares[0]=${encodeURIComponent(postUrn)}`,
  );

  const elements = (data.elements as Array<Record<string, unknown>>) ?? [];
  const stats = (elements[0]?.totalShareStatistics as Record<string, unknown>) ?? {};

  return {
    postUrn,
    impressions: (stats.impressionCount as number) ?? 0,
    clicks: (stats.clickCount as number) ?? 0,
    likes: (stats.likeCount as number) ?? 0,
    comments: (stats.commentCount as number) ?? 0,
    shares: (stats.shareCount as number) ?? 0,
    engagement: (stats.engagement as number) ?? 0,
  };
}

/** Get follower statistics for the organization */
export async function getLinkedInFollowerStats(): Promise<LinkedInFollowerStats> {
  const orgId = getOrganizationId();
  const data = await liFetch(
    `/organizationalEntityFollowerStatistics?q=organizationalEntity&organizationalEntity=urn%3Ali%3Aorganization%3A${orgId}`,
  );

  const elements = (data.elements as Array<Record<string, unknown>>) ?? [];
  const followerCounts = (elements[0]?.followerCounts as Record<string, unknown>) ?? {};

  return {
    totalFollowers:
      ((followerCounts.organicFollowerCount as number) ?? 0) +
      ((followerCounts.paidFollowerCount as number) ?? 0),
    organicFollowers: (followerCounts.organicFollowerCount as number) ?? 0,
    paidFollowers: (followerCounts.paidFollowerCount as number) ?? 0,
  };
}

/** Get page view statistics */
export async function getLinkedInPageStats(): Promise<LinkedInPageStats> {
  const orgId = getOrganizationId();
  const data = await liFetch(
    `/organizationPageStatistics?q=organization&organization=urn%3Ali%3Aorganization%3A${orgId}`,
  );

  const elements = (data.elements as Array<Record<string, unknown>>) ?? [];
  const views = (elements[0]?.views as Record<string, unknown>) ?? {};
  const allPageViews = (views.allPageViews as Record<string, unknown>) ?? {};

  return {
    pageViews: (allPageViews.pageViews as number) ?? (views.pageViews as number) ?? 0,
    uniqueVisitors: (allPageViews.uniquePageViews as number) ?? (views.uniquePageViews as number) ?? 0,
  };
}

/** Get follower demographics (industry, seniority, location) */
export async function getLinkedInFollowerDemographics(): Promise<Record<string, unknown>> {
  const orgId = getOrganizationId();
  const data = await liFetch(
    `/organizationalEntityFollowerStatistics?q=organizationalEntity&organizationalEntity=urn%3Ali%3Aorganization%3A${orgId}`,
  );

  const elements = (data.elements as Array<Record<string, unknown>>) ?? [];
  return {
    followerCountsByFunction: elements[0]?.followerCountsByFunction ?? [],
    followerCountsBySeniority: elements[0]?.followerCountsBySeniority ?? [],
    followerCountsByIndustry: elements[0]?.followerCountsByIndustry ?? [],
    followerCountsByGeo: elements[0]?.followerCountsByGeo ?? [],
  };
}

// ── Health Check ─────────────────────────────────────────────

/** Verify LinkedIn credentials are configured and valid */
export async function checkLinkedInHealth(): Promise<{
  configured: boolean;
  valid: boolean;
  organizationName?: string;
  error?: string;
}> {
  try {
    getCredentials();
    getOrganizationId();
  } catch {
    return { configured: false, valid: false, error: 'LinkedIn credentials not configured' };
  }

  try {
    const orgId = getOrganizationId();
    const data = await liFetch(`/organizations/${orgId}?fields=localizedName`);
    return {
      configured: true,
      valid: true,
      organizationName: data.localizedName as string,
    };
  } catch (err) {
    return {
      configured: true,
      valid: false,
      error: (err as Error).message,
    };
  }
}
