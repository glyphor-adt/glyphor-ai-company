/**
 * Wappalyzer Integration — Technology stack detection
 *
 * Used by: Nathan (account research - tech stack discovery), Rachel (prospect qualification)
 * Read-only access.
 */

interface WappalyzerConfig {
  apiKey: string;
}

interface Technology {
  name: string;
  slug: string;
  categories: { id: number; slug: string; name: string }[];
  confidence: number;
  version: string | null;
  website: string;
}

interface LookupResult {
  url: string;
  technologies: Technology[];
  meta: { language: string; title: string };
}

export class WappalyzerClient {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.wappalyzer.com/v2';

  constructor(config: WappalyzerConfig) {
    this.apiKey = config.apiKey;
  }

  static fromEnv(): WappalyzerClient {
    const apiKey = process.env.WAPPALYZER_API_KEY;
    if (!apiKey) throw new Error('WAPPALYZER_API_KEY not configured');
    return new WappalyzerClient({ apiKey });
  }

  private async request<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: {
        'x-api-key': this.apiKey,
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Wappalyzer API ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  /** Lookup technologies used by a website */
  async lookup(url: string): Promise<LookupResult> {
    return this.request<LookupResult>(`/lookup/?urls=${encodeURIComponent(url)}`);
  }

  /** Get technologies grouped by category for a domain */
  async getTechStack(domain: string): Promise<Record<string, Technology[]>> {
    const result = await this.lookup(`https://${domain}`);
    const grouped: Record<string, Technology[]> = {};
    for (const tech of result.technologies) {
      for (const cat of tech.categories) {
        if (!grouped[cat.name]) grouped[cat.name] = [];
        grouped[cat.name].push(tech);
      }
    }
    return grouped;
  }
}
