/**
 * Crunchbase Integration — Funding data and revenue estimates
 *
 * Used by: Nathan (account research), Rachel (enterprise pipeline)
 * Read-only access.
 */

interface CrunchbaseConfig {
  apiKey: string;
}

interface FundingRound {
  id: string;
  funding_type: string;
  money_raised: number;
  currency: string;
  announced_on: string;
  lead_investors: string[];
}

interface CompanyProfile {
  name: string;
  domain: string;
  short_description: string;
  founded_on: string;
  num_employees_enum: string;
  total_funding: number;
  last_funding_type: string;
  ipo_status: string;
  categories: string[];
  funding_rounds: FundingRound[];
  investors: string[];
  revenue_range?: string;
}

export class CrunchbaseClient {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.crunchbase.com/api/v4';

  constructor(config: CrunchbaseConfig) {
    this.apiKey = config.apiKey;
  }

  static fromEnv(): CrunchbaseClient {
    const apiKey = process.env.CRUNCHBASE_API_KEY;
    if (!apiKey) throw new Error('CRUNCHBASE_API_KEY not configured');
    return new CrunchbaseClient({ apiKey });
  }

  private async request<T>(path: string): Promise<T> {
    const separator = path.includes('?') ? '&' : '?';
    const url = `${this.baseUrl}${path}${separator}user_key=${this.apiKey}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Crunchbase API ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  async getCompany(permalink: string): Promise<CompanyProfile | null> {
    try {
      const data = await this.request<{ properties: Record<string, unknown>; cards: Record<string, unknown> }>(
        `/entities/organizations/${permalink}?card_ids=funding_rounds,investors`,
      );

      const props = data.properties;
      const fundingCards = (data.cards as { funding_rounds?: { items: FundingRound[] } });
      const investorCards = (data.cards as { investors?: { items: { identifier: { value: string } }[] } });

      return {
        name: String(props.name ?? ''),
        domain: String(props.website_url ?? ''),
        short_description: String(props.short_description ?? ''),
        founded_on: String(props.founded_on ?? ''),
        num_employees_enum: String(props.num_employees_enum ?? ''),
        total_funding: Number(props.funding_total?.valueOf() ?? 0),
        last_funding_type: String(props.last_funding_type ?? ''),
        ipo_status: String(props.ipo_status ?? ''),
        categories: [],
        funding_rounds: fundingCards?.funding_rounds?.items ?? [],
        investors: investorCards?.investors?.items?.map((i) => i.identifier.value) ?? [],
        revenue_range: props.revenue_range as string | undefined,
      };
    } catch {
      return null;
    }
  }

  async searchCompanies(query: string, limit = 5): Promise<{ name: string; permalink: string; domain: string }[]> {
    const data = await this.request<{ entities: { identifier: { value: string; permalink: string }; properties: { website_url: string } }[] }>(
      `/autocompletes?query=${encodeURIComponent(query)}&collection_ids=organizations&limit=${limit}`,
    );
    return (data.entities ?? []).map((e) => ({
      name: e.identifier.value,
      permalink: e.identifier.permalink,
      domain: e.properties?.website_url ?? '',
    }));
  }
}
