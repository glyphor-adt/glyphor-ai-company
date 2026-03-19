/**
 * List all teams visible to the app and their channels.
 */
import { ConfidentialClientApplication } from '@azure/msal-node';

async function main() {
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
  const token = result!.accessToken;

  // List all groups of type "Team"
  const groupsRes = await fetch(
    'https://graph.microsoft.com/v1.0/groups?$filter=resourceProvisioningOptions/Any(x:x eq \'Team\')&$select=id,displayName,description',
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!groupsRes.ok) {
    console.error(`List groups failed: ${groupsRes.status} ${await groupsRes.text()}`);
    return;
  }

  const groups = (await groupsRes.json()) as { value: Array<{ id: string; displayName: string; description: string | null }> };
  
  console.log(`Found ${groups.value.length} team(s):\n`);

  const storedTeamId = process.env.TEAMS_TEAM_ID?.trim();
  console.log(`Stored TEAMS_TEAM_ID: ${storedTeamId}\n`);

  for (const group of groups.value) {
    const isStored = group.id === storedTeamId;
    console.log(`${isStored ? '>>> ' : '    '}Team: ${group.displayName}`);
    console.log(`     ID: ${group.id}${isStored ? ' (STORED IN SECRET)' : ''}`);
    if (group.description) console.log(`     Desc: ${group.description}`);

    // List channels
    const chRes = await fetch(
      `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(group.id)}/channels?$select=id,displayName,membershipType`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (chRes.ok) {
      const channels = (await chRes.json()) as { value: Array<{ id: string; displayName: string; membershipType: string }> };
      for (const ch of channels.value.sort((a, b) => a.displayName.localeCompare(b.displayName))) {
        console.log(`       - ${ch.displayName} (${ch.membershipType}) — ${ch.id.substring(0, 35)}...`);
      }
    } else {
      console.log(`       (failed to list channels: ${chRes.status})`);
    }
    console.log('');
  }
}
main();
