/**
 * M365 Credential Router
 *
 * Routes M365 API calls to the correct Entra app registration
 * based on the operation type. Each app has scoped permissions
 * so that even if the runtime breaks, the credential can only
 * perform the operations its scopes allow.
 *
 * App registrations:
 *   1. glyphor-teams-channels  → ChannelMessage.Send
 *   2. glyphor-teams-bot       → Bot Framework
 *   3. glyphor-mail            → Mail.Send (shared mailbox)
 *   4. glyphor-files           → Sites.Selected
 *   5. glyphor-users           → User.Read.All
 */

import { ConfidentialClientApplication } from '@azure/msal-node';

export type M365Operation =
  | 'post_to_channel'
  | 'post_to_teams'
  | 'send_teams_dm'
  | 'send_email'
  | 'send_emergency_email'
  | 'read_inbox'
  | 'reply_to_email'
  | 'read_excel'
  | 'write_excel'
  | 'read_sharepoint'
  | 'get_user_profile'
  | 'list_users';

interface EntraAppConfig {
  clientId: string;
  clientSecret: string;
  tenantId: string;
}

const GRAPH_SCOPE = ['https://graph.microsoft.com/.default'];

// Maps operation → env var prefix for the corresponding Entra app
const OPERATION_TO_APP: Record<M365Operation, string> = {
  post_to_channel: 'AZURE_TEAMS_CHANNEL',
  post_to_teams: 'AZURE_TEAMS_CHANNEL',
  send_teams_dm: 'AZURE_TEAMS_BOT',
  send_email: 'AZURE_MAIL',
  send_emergency_email: 'AZURE_MAIL',
  read_inbox: 'AZURE_MAIL',
  reply_to_email: 'AZURE_MAIL',
  read_excel: 'AZURE_FILES',
  write_excel: 'AZURE_FILES',
  read_sharepoint: 'AZURE_FILES',
  get_user_profile: 'AZURE_USERS',
  list_users: 'AZURE_USERS',
};

// Cache MSAL clients to avoid recreating on every call
const clientCache = new Map<string, ConfidentialClientApplication>();

function getAppConfig(envPrefix: string): EntraAppConfig | null {
  const clientId = process.env[`${envPrefix}_CLIENT_ID`];
  const clientSecret = process.env[`${envPrefix}_CLIENT_SECRET`];
  const tenantId = process.env.AZURE_TENANT_ID;

  if (!clientId || !clientSecret || !tenantId) return null;
  return { clientId, clientSecret, tenantId };
}

function getMSALClient(config: EntraAppConfig): ConfidentialClientApplication {
  const cacheKey = config.clientId;
  let client = clientCache.get(cacheKey);
  if (!client) {
    client = new ConfidentialClientApplication({
      auth: {
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        authority: `https://login.microsoftonline.com/${config.tenantId}`,
      },
    });
    clientCache.set(cacheKey, client);
  }
  return client;
}

/**
 * Get the correct MSAL client for a given M365 operation.
 *
 * Falls back to the shared AZURE_CLIENT_ID/SECRET if the
 * per-scope app registration isn't configured yet.
 */
export function getM365Client(operation: M365Operation): ConfidentialClientApplication {
  const envPrefix = OPERATION_TO_APP[operation];

  // Try operation-specific app registration first
  const scopedConfig = getAppConfig(envPrefix);
  if (scopedConfig) return getMSALClient(scopedConfig);

  // Fall back to shared credentials (backward compatible)
  const fallbackConfig = getAppConfig('AZURE');
  if (fallbackConfig) return getMSALClient(fallbackConfig);

  throw new Error(`No M365 credentials configured for operation: ${operation}`);
}

/**
 * Get an access token for the specified M365 operation,
 * automatically selecting the correct app registration.
 */
export async function getM365Token(operation: M365Operation): Promise<string> {
  const client = getM365Client(operation);
  const result = await client.acquireTokenByClientCredential({ scopes: GRAPH_SCOPE });
  if (!result?.accessToken) {
    throw new Error(`Failed to acquire token for M365 operation: ${operation}`);
  }
  return result.accessToken;
}
