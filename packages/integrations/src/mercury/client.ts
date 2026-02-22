/**
 * Mercury Banking API Client
 *
 * Mercury API docs: https://docs.mercury.com/reference
 * Uses Bearer token authentication.
 */

const MERCURY_BASE_URL = 'https://api.mercury.com/api/v1';

function getApiToken(): string {
  const token = process.env.MERCURY_API_TOKEN;
  if (!token) throw new Error('MERCURY_API_TOKEN environment variable is required');
  return token;
}

export interface MercuryAccount {
  id: string;
  name: string;
  status: string;
  type: string;
  currentBalance: number;
  availableBalance: number;
  accountNumber: string;
  routingNumber: string;
}

export interface MercuryTransaction {
  id: string;
  amount: number;
  status: string;
  kind: string;
  createdAt: string;
  postedAt: string | null;
  counterpartyName: string;
  note: string | null;
  dashboardLink: string;
}

interface MercuryAccountsResponse {
  accounts: MercuryAccount[];
}

interface MercuryTransactionsResponse {
  total: number;
  transactions: MercuryTransaction[];
}

async function mercuryFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${MERCURY_BASE_URL}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${getApiToken()}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Mercury API error ${response.status}: ${text}`);
  }

  return response.json() as Promise<T>;
}

/** List all Mercury accounts */
export async function listAccounts(): Promise<MercuryAccount[]> {
  const data = await mercuryFetch<MercuryAccountsResponse>('/accounts');
  return data.accounts;
}

/** Get a single account with current balance */
export async function getAccount(accountId: string): Promise<MercuryAccount> {
  return mercuryFetch<MercuryAccount>(`/account/${encodeURIComponent(accountId)}`);
}

/** List transactions for an account within a date range */
export async function listTransactions(
  accountId: string,
  start: string,
  end: string,
  limit = 500,
): Promise<MercuryTransaction[]> {
  const data = await mercuryFetch<MercuryTransactionsResponse>(
    `/account/${encodeURIComponent(accountId)}/transactions`,
    { start, end, limit: String(limit) },
  );
  return data.transactions;
}
