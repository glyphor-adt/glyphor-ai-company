import { ConfidentialClientApplication } from '@azure/msal-node';

const GRAPH_SCOPE = ['https://graph.microsoft.com/.default'];

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function firstDefinedEnv(...names: string[]): string | null {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return null;
}

function getTenantUrl(): string {
  const explicitTenantUrl = firstDefinedEnv('SPO_TENANT_URL', 'SHAREPOINT_TENANT_URL');
  if (explicitTenantUrl) {
    return explicitTenantUrl.replace(/\/$/, '');
  }

  const siteId = process.env.SHAREPOINT_SITE_ID?.trim();
  if (siteId) {
    const host = siteId.split(',')[0]?.trim();
    if (host && host.includes('.')) {
      return `https://${host}`;
    }
  }

  throw new Error('Missing required environment variable: SPO_TENANT_URL (or SHAREPOINT_SITE_ID for hostname fallback)');
}

function createMsalClient(): ConfidentialClientApplication {
  const tenantId = firstDefinedEnv('AZURE_TENANT_ID', 'AGENT365_TENANT_ID') ?? requiredEnv('AZURE_TENANT_ID');
  const clientId = firstDefinedEnv('SPO_CLIENT_ID', 'AGENT365_CLIENT_ID') ?? requiredEnv('SPO_CLIENT_ID');
  const clientSecret = firstDefinedEnv('SPO_CLIENT_SECRET', 'AGENT365_CLIENT_SECRET') ?? requiredEnv('SPO_CLIENT_SECRET');

  return new ConfidentialClientApplication({
    auth: {
      clientId,
      clientSecret,
      authority: `https://login.microsoftonline.com/${tenantId}`,
    },
  });
}

const msalClient = createMsalClient();

export function tenantUrl(): string {
  return getTenantUrl();
}

export async function getSharePointToken(siteUrl: string): Promise<string> {
  const host = new URL(siteUrl).hostname;
  const result = await msalClient.acquireTokenByClientCredential({
    scopes: [`https://${host}/.default`],
  });

  if (!result?.accessToken) {
    throw new Error(`Failed to acquire SharePoint token for host ${host}`);
  }

  return result.accessToken;
}

export async function getGraphToken(): Promise<string> {
  const result = await msalClient.acquireTokenByClientCredential({ scopes: GRAPH_SCOPE });
  if (!result?.accessToken) {
    throw new Error('Failed to acquire Microsoft Graph token.');
  }
  return result.accessToken;
}

export function spoHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json;odata.metadata=none',
    'Content-Type': 'application/json;odata=verbose',
    'odata-version': '4.0',
  };
}

export function graphHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

export async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  let parsed: unknown = null;
  if (text.trim().length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!response.ok) {
    const errorMessage = typeof parsed === 'string'
      ? parsed
      : JSON.stringify(parsed);
    throw new Error(`SharePoint request failed (${response.status}): ${errorMessage.slice(0, 800)}`);
  }

  if (parsed && typeof parsed === 'object' && 'd' in (parsed as Record<string, unknown>)) {
    return (parsed as { d: unknown }).d;
  }

  return parsed;
}
