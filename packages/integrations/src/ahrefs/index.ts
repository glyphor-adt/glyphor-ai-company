/**
 * Ahrefs Integration — SEO analysis and keyword tracking
 *
 * Used by: Lisa (full API), Daniel (competitor domain analysis)
 * Read-only access for both.
 */

interface AhrefsConfig {
  apiKey: string;
}

interface KeywordData {
  keyword: string;
  volume: number;
  difficulty: number;
  cpc: number;
  position?: number;
  url?: string;
}

interface BacklinkData {
  referring_domains: number;
  backlinks: number;
  domain_rating: number;
}

interface CompetitorRanking {
  keyword: string;
  position: number;
  url: string;
  volume: number;
}

export class AhrefsClient {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.ahrefs.com/v3';

  constructor(config: AhrefsConfig) {
    this.apiKey = config.apiKey;
  }

  static fromEnv(): AhrefsClient {
    const apiKey = process.env.AHREFS_API_KEY;
    if (!apiKey) throw new Error('AHREFS_API_KEY not configured');
    return new AhrefsClient({ apiKey });
  }

  private async request<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    }
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${this.apiKey}`, Accept: 'application/json' },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Ahrefs API ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  async getKeywordData(keyword: string, country = 'us'): Promise<KeywordData> {
    const data = await this.request<{ keywords: KeywordData[] }>('/keywords-explorer/overview', {
      keyword, country,
    });
    return data.keywords?.[0] ?? { keyword, volume: 0, difficulty: 0, cpc: 0 };
  }

  async discoverKeywords(seed: string, country = 'us', limit = 20): Promise<KeywordData[]> {
    const data = await this.request<{ keywords: KeywordData[] }>('/keywords-explorer/related-terms', {
      keyword: seed, country, limit: String(limit),
    });
    return data.keywords ?? [];
  }

  async getBacklinks(domain: string): Promise<BacklinkData> {
    const data = await this.request<BacklinkData>('/site-explorer/overview', { target: domain });
    return data;
  }

  async getCompetitorRankings(domain: string, limit = 50): Promise<CompetitorRanking[]> {
    const data = await this.request<{ positions: CompetitorRanking[] }>('/site-explorer/organic-keywords', {
      target: domain, limit: String(limit),
    });
    return data.positions ?? [];
  }

  async getDomainRating(domain: string): Promise<number> {
    const data = await this.getBacklinks(domain);
    return data.domain_rating ?? 0;
  }
}
