/**
 * Delete the two separate briefing channels and create one unified "Briefings" channel.
 */
import { ConfidentialClientApplication } from '@azure/msal-node';

const TEAM_ID = 'edcb104d-a218-4a02-949e-31d03a4c5ef3';

const DELETE = [
  { name: 'Briefing - Kristina', id: '19:0b0caf691f454e90a42d99b5ac3b0590@thread.tacv2' },
  { name: 'Briefing - Andrew', id: '19:8cae31f0c46f46f7985beee4d077a7b1@thread.tacv2' },
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
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // Delete the separate channels
  for (const ch of DELETE) {
    console.log(`Deleting "${ch.name}"...`);
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(TEAM_ID)}/channels/${encodeURIComponent(ch.id)}`,
      { method: 'DELETE', headers },
    );
    console.log(`  ${res.status === 204 ? 'Deleted' : `${res.status}: ${await res.text()}`}`);
  }

  // Create unified Briefings channel
  console.log('\nCreating "Briefings"...');
  const createRes = await fetch(
    `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(TEAM_ID)}/channels`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        displayName: 'Briefings',
        description: 'Daily briefings for founders',
        membershipType: 'standard',
      }),
    },
  );
  if (createRes.ok) {
    const data = (await createRes.json()) as { id: string };
    console.log(`  Created: ${data.id}`);
    console.log(`\nRun this to update the secret:`);
    console.log(`  gcloud secrets versions add teams-channel-briefings-id --data-file=- <<< "${data.id}"`);
  } else {
    const err = await createRes.text();
    console.log(`  ${createRes.status}: ${err}`);
  }

  // List final channels
  console.log('\n=== Final channel list ===');
  const listRes = await fetch(
    `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(TEAM_ID)}/channels?$select=id,displayName`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const channels = (await listRes.json()) as { value: Array<{ id: string; displayName: string }> };
  for (const ch of channels.value.sort((a, b) => a.displayName.localeCompare(b.displayName))) {
    console.log(`  ${ch.displayName}: ${ch.id}`);
  }
}
main();
