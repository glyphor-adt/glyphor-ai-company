/**
 * Apollo Integration — Company enrichment and people search
 *
 * Used by: Nathan (account research), Rachel (enterprise outreach)
 * Read-only access for both.
 */

interface ApolloConfig {
  apiKey: string;
}

interface CompanyInfo {
  id: string;
  name: string;
  domain: string;
  industry: string;
  employee_count: number;
  estimated_revenue: string;
  founded_year: number;
  linkedin_url?: string;
  description?: string;
  technologies?: string[];
}

interface PersonInfo {
  id: string;
  first_name: string;
  last_name: string;
  title: string;
  company_name: string;
  linkedin_url?: string;
  email?: string;
  seniority: string;
  departments: string[];
}

export class ApolloClient {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.apollo.io/v1';

  constructor(config: ApolloConfig) {
    this.apiKey = config.apiKey;
  }

  static fromEnv(): ApolloClient {
    const apiKey = process.env.APOLLO_API_KEY;
    if (!apiKey) throw new Error('APOLLO_API_KEY not configured');
    return new ApolloClient({ apiKey });
  }

  private async request<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': this.apiKey,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Apollo API ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  async searchCompany(domain: string): Promise<CompanyInfo | null> {
    const data = await this.request<{ organization: CompanyInfo }>('/organizations/enrich', {
      domain,
    });
    return data.organization ?? null;
  }

  async searchPeople(
    companyDomain: string,
    titles?: string[],
    limit = 10,
  ): Promise<PersonInfo[]> {
    const data = await this.request<{ people: PersonInfo[] }>('/mixed_people/search', {
      q_organization_domains: companyDomain,
      person_titles: titles,
      per_page: limit,
    });
    return data.people ?? [];
  }

  async enrichPerson(email: string): Promise<PersonInfo | null> {
    const data = await this.request<{ person: PersonInfo }>('/people/match', { email });
    return data.person ?? null;
  }
}
