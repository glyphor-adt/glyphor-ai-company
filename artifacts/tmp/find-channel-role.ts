/**
 * Find the ChannelMessage.Send role ID from the Microsoft Graph service principal.
 */
import { ConfidentialClientApplication } from '@azure/msal-node';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const GRAPH_RESOURCE_APP_ID = '00000003-0000-0000-c000-000000000000';

async function main() {
  const token = await getToken();

  // Get Graph SP with appRoles
  const res = await fetch(
    `${GRAPH_BASE}/servicePrincipals?$filter=appId eq '${GRAPH_RESOURCE_APP_ID}'&$select=id,appRoles`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const data = await res.json() as { value: Array<{ id: string; appRoles: Array<{ id: string; value: string; displayName: string; isEnabled: boolean }> }> };
  const sp = data.value[0];
  console.log(`Graph SP ID: ${sp.id}`);
  console.log(`Total appRoles returned: ${sp.appRoles.length}`);

  // Find all Channel-related roles
  const channelRoles = sp.appRoles.filter((r) => r.value.toLowerCase().includes('channel'));
  console.log(`\nChannel-related roles (${channelRoles.length}):`);
  for (const r of channelRoles) {
    console.log(`  ${r.value} -> ${r.id} (enabled: ${r.isEnabled})`);
  }

  // Also search for "Message"
  const messageRoles = sp.appRoles.filter(
    (r) => r.value.toLowerCase().includes('message') && !r.value.toLowerCase().includes('channel'),
  );
  console.log(`\nMessage-related roles (${messageRoles.length}):`);
  for (const r of messageRoles) {
    console.log(`  ${r.value} -> ${r.id} (enabled: ${r.isEnabled})`);
  }

  // Try exact match variations
  for (const name of ['ChannelMessage.Send', 'ChannelMessage.Send.All', 'Teamwork.Send.All']) {
    const found = sp.appRoles.find((r) => r.value === name);
    console.log(`\n"${name}": ${found ? `FOUND -> ${found.id}` : 'NOT FOUND'}`);
  }
}

async function getToken(): Promise<string> {
  const msalApp = new ConfidentialClientApplication({
    auth: {
      clientId: process.env.AZURE_CLIENT_ID!.trim(),
      clientSecret: process.env.AZURE_CLIENT_SECRET!.trim(),
      authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID!.trim()}`,
    },
  });
  const result = await msalApp.acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default'],
  });
  return result!.accessToken;
}
main();
