/**
 * Delete Product - Fuse and Product - Pulse channels.
 */
import { ConfidentialClientApplication } from '@azure/msal-node';

const TEAM_ID = 'edcb104d-a218-4a02-949e-31d03a4c5ef3';
const CHANNELS_TO_DELETE = [
  { name: 'Product - Fuse', id: '19:21c297ab533a49968ed07a056a6cd615@thread.tacv2' },
  { name: 'Product - Pulse', id: '19:8a98f5a14b1a4d2182168eb3266a2acd@thread.tacv2' },
];

async function main() {
  const msalApp = new ConfidentialClientApplication({
    auth: {
      clientId: process.env.AZURE_CLIENT_ID!.trim(),
      clientSecret: process.env.AZURE_CLIENT_SECRET!.trim(),
      authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID!.trim()}`,
    },
  });
  const result = await msalApp.acquireTokenByClientCredential({ scopes: ['https://graph.microsoft.com/.default'] });
  const token = result!.accessToken;

  for (const ch of CHANNELS_TO_DELETE) {
    console.log(`Deleting "${ch.name}" (${ch.id})...`);
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(TEAM_ID)}/channels/${encodeURIComponent(ch.id)}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
    );
    if (res.status === 204) {
      console.log('  Deleted.');
    } else {
      console.log(`  ${res.status}: ${await res.text()}`);
    }
  }
}
main();
