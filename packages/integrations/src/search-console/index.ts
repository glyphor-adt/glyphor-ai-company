/**
 * Google Search Console Integration — Search performance data
 *
 * Used by: Lisa (SEO analyst) — impressions, clicks, CTR, positions
 * Read-only access via Google OAuth2 service account.
 */

interface SearchConsoleConfig {
  serviceAccountKey: string; // JSON string of the service account key
  siteUrl: string;           // e.g. 'sc-domain:glyphor.com' or 'https://glyphor.com/'
}

interface SearchRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface SearchAnalyticsResponse {
  rows: SearchRow[];
  responseAggregationType: string;
}

export class SearchConsoleClient {
  private readonly siteUrl: string;
  private readonly baseUrl = 'https://www.googleapis.com/webmasters/v3';
  private accessToken: string | null = null;
  private tokenExpiry = 0;
  private readonly serviceAccountKey: { client_email: string; private_key: string; token_uri: string };

  constructor(config: SearchConsoleConfig) {
    this.siteUrl = config.siteUrl;
    this.serviceAccountKey = JSON.parse(config.serviceAccountKey);
  }

  static fromEnv(): SearchConsoleClient {
    const key = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    const siteUrl = process.env.SEARCH_CONSOLE_SITE_URL;
    if (!key || !siteUrl) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY and SEARCH_CONSOLE_SITE_URL required');
    return new SearchConsoleClient({ serviceAccountKey: key, siteUrl });
  }

  /** Build a JWT and exchange for access token (Google OAuth2 service account flow) */
  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) return this.accessToken;

    const now = Math.floor(Date.now() / 1000);
    const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payload = btoa(
      JSON.stringify({
        iss: this.serviceAccountKey.client_email,
        scope: 'https://www.googleapis.com/auth/webmasters.readonly',
        aud: this.serviceAccountKey.token_uri,
        iat: now,
        exp: now + 3600,
      }),
    );

    const signingInput = `${header}.${payload}`;

    // Import the private key and sign
    const keyData = this.serviceAccountKey.private_key;
    const pemContents = keyData.replace(/-----BEGIN PRIVATE KEY-----/g, '').replace(/-----END PRIVATE KEY-----/g, '').replace(/\s/g, '');
    const binaryKey = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

    const cryptoKey = await crypto.subtle.importKey(
      'pkcs8',
      binaryKey,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    );

    const signatureBuffer = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signingInput));
    const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const jwt = `${header}.${payload}.${signature}`;

    const tokenRes = await fetch(this.serviceAccountKey.token_uri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
    });
    if (!tokenRes.ok) throw new Error(`Token exchange failed: ${tokenRes.status}`);
    const tokenData = (await tokenRes.json()) as { access_token: string; expires_in: number };

    this.accessToken = tokenData.access_token;
    this.tokenExpiry = Date.now() + (tokenData.expires_in - 60) * 1000;
    return this.accessToken;
  }

  private async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const token = await this.getAccessToken();
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Search Console API ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  /** Query search analytics — dimensions: query, page, country, device, date */
  async query(opts: {
    startDate: string;
    endDate: string;
    dimensions?: ('query' | 'page' | 'country' | 'device' | 'date')[];
    rowLimit?: number;
    startRow?: number;
    dimensionFilterGroups?: { filters: { dimension: string; operator: string; expression: string }[] }[];
  }): Promise<SearchRow[]> {
    const data = await this.request<SearchAnalyticsResponse>(
      `/sites/${encodeURIComponent(this.siteUrl)}/searchAnalytics/query`,
      'POST',
      {
        startDate: opts.startDate,
        endDate: opts.endDate,
        dimensions: opts.dimensions ?? ['query'],
        rowLimit: opts.rowLimit ?? 100,
        startRow: opts.startRow ?? 0,
        ...(opts.dimensionFilterGroups ? { dimensionFilterGroups: opts.dimensionFilterGroups } : {}),
      },
    );
    return data.rows ?? [];
  }

  /** Get top queries by clicks */
  async getTopQueries(days = 28, limit = 25): Promise<SearchRow[]> {
    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    return this.query({ startDate, endDate, dimensions: ['query'], rowLimit: limit });
  }

  /** Get top pages by clicks */
  async getTopPages(days = 28, limit = 25): Promise<SearchRow[]> {
    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    return this.query({ startDate, endDate, dimensions: ['page'], rowLimit: limit });
  }

  /** Get daily impression / click trends */
  async getDailyTrends(days = 28): Promise<SearchRow[]> {
    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    return this.query({ startDate, endDate, dimensions: ['date'], rowLimit: days });
  }
}
