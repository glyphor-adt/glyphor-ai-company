/**
 * Graph API Token Acquisition for MCP Email Server
 *
 * Uses MSAL client credentials flow to obtain a Graph API token
 * for sending/reading email on behalf of agent shared mailboxes.
 *
 * Required env vars:
 *   AZURE_TENANT_ID          — Entra tenant ID
 *   AZURE_MAIL_CLIENT_ID     — App registration with Mail.Send + Mail.ReadWrite
 *   AZURE_MAIL_CLIENT_SECRET — Client secret for the mail app registration
 *
 * Falls back to AZURE_CLIENT_ID / AZURE_CLIENT_SECRET if AZURE_MAIL_ vars aren't set.
 */

let tokenCache: { token: string; expiresAt: number } | null = null;

export async function getGraphToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now()) {
    return tokenCache.token;
  }

  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_MAIL_CLIENT_ID ?? process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_MAIL_CLIENT_SECRET ?? process.env.AZURE_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error(
      'Missing Graph API credentials. Set AZURE_TENANT_ID, AZURE_MAIL_CLIENT_ID, AZURE_MAIL_CLIENT_SECRET.',
    );
  }

  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to acquire Graph token (${response.status}): ${text}`);
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };
  // Cache with 5-minute safety margin
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 300) * 1000,
  };

  return tokenCache.token;
}
