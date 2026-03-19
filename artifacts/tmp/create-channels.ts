/**
 * Create missing channels in the Glyphor Company Knowledge team
 * and update all secrets (team ID + channel IDs).
 */
import { ConfidentialClientApplication } from '@azure/msal-node';

const CORRECT_TEAM_ID = 'edcb104d-a218-4a02-949e-31d03a4c5ef3';

// Channels that already exist (from list-teams output)
const EXISTING = new Map([
  ['General', '19:oPkixzZmwFDiR3qll0C07-wFUx4j2FVl'],       // partial — we'll re-fetch
  ['engineering', '19:373d4d2fa4b04f6c969c6d4f26e5df3a'],
  ['financials', '19:4ae220ee20c64944871d551c7c2bb6d8'],
  ['growth', '19:0f61752c46df445ab8aa0884effff353'],
]);

// Channels to create
const TO_CREATE = [
  { displayName: 'Decisions', description: 'Founder approval decisions from agents' },
  { displayName: 'Briefing - Kristina', description: 'Daily briefings for Kristina' },
  { displayName: 'Briefing - Andrew', description: 'Daily briefings for Andrew' },
  { displayName: 'Alerts', description: 'System alerts and incidents' },
  { displayName: 'Deliverables', description: 'Completed deliverables and reports' },
  { displayName: 'Product - Fuse', description: 'Fuse product updates' },
  { displayName: 'Product - Pulse', description: 'Pulse product updates' },
];

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

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  // Step 1: Create missing channels
  console.log('=== Creating missing channels ===\n');

  const created: Array<{ name: string; id: string }> = [];

  for (const ch of TO_CREATE) {
    console.log(`Creating "${ch.displayName}"...`);
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(CORRECT_TEAM_ID)}/channels`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          displayName: ch.displayName,
          description: ch.description,
          membershipType: 'standard',
        }),
      },
    );

    if (res.ok) {
      const data = (await res.json()) as { id: string; displayName: string };
      console.log(`  Created: ${data.id}`);
      created.push({ name: ch.displayName, id: data.id });
    } else {
      const err = await res.text();
      if (err.includes('NameAlreadyExists')) {
        console.log(`  Already exists — skipping`);
      } else {
        console.error(`  FAILED (${res.status}): ${err.substring(0, 200)}`);
      }
    }
  }

  // Step 2: List ALL channels to get exact IDs
  console.log('\n=== Fetching all channel IDs ===\n');

  const chRes = await fetch(
    `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(CORRECT_TEAM_ID)}/channels?$select=id,displayName`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!chRes.ok) {
    console.error(`List channels failed: ${chRes.status} ${await chRes.text()}`);
    return;
  }

  const channels = (await chRes.json()) as { value: Array<{ id: string; displayName: string }> };
  
  // Build name → ID map
  const channelMap = new Map<string, string>();
  for (const ch of channels.value) {
    channelMap.set(ch.displayName.toLowerCase(), ch.id);
    console.log(`  ${ch.displayName}: ${ch.id}`);
  }

  // Step 3: Map to secret names
  console.log('\n=== Secret mapping ===\n');

  const secretUpdates: Array<{ secretName: string; value: string; label: string }> = [
    { secretName: 'teams-team-id', value: CORRECT_TEAM_ID, label: 'Team ID' },
  ];

  const channelSecretMap: Record<string, string[]> = {
    'teams-channel-general-id': ['general'],
    'teams-channel-engineering-id': ['engineering'],
    'teams-channel-financials-id': ['financials'],
    'teams-channel-growth-id': ['growth'],
    'teams-channel-decisions-id': ['decisions'],
    'teams-channel-briefing-kristina-id': ['briefing - kristina'],
    'teams-channel-briefing-andrew-id': ['briefing - andrew'],
    // 'teams-channel-alerts-id': ['alerts'],   // These secrets may not exist yet
    // 'teams-channel-deliverables-id': ['deliverables'],
    // 'teams-channel-product-fuse-id': ['product - fuse'],
    // 'teams-channel-product-pulse-id': ['product - pulse'],
  };

  // Also add the new channel secrets
  const newChannelSecrets: Record<string, string[]> = {
    'teams-channel-alerts-id': ['alerts'],
    'teams-channel-deliverables-id': ['deliverables'],
    'teams-channel-product-fuse-id': ['product - fuse'],
    'teams-channel-product-pulse-id': ['product - pulse'],
  };

  for (const [secretName, nameVariants] of Object.entries({ ...channelSecretMap, ...newChannelSecrets })) {
    const channelId = nameVariants
      .map(n => channelMap.get(n))
      .find(id => id);
    
    if (channelId) {
      secretUpdates.push({ secretName, value: channelId, label: nameVariants[0] });
      console.log(`  ${secretName} → ${channelId.substring(0, 40)}...`);
    } else {
      console.warn(`  ${secretName} → ⚠️ NO CHANNEL FOUND (looked for: ${nameVariants.join(', ')})`);
    }
  }

  // Step 4: Output gcloud commands
  console.log('\n=== gcloud commands to update secrets ===\n');

  for (const { secretName, value, label } of secretUpdates) {
    // Use printf-style to avoid newlines
    console.log(`echo -n "${value}" | gcloud secrets versions add ${secretName} --data-file=-`);
  }

  // Also output JSON for easy scripting
  console.log('\n=== JSON output ===');
  console.log(JSON.stringify(
    Object.fromEntries(secretUpdates.map(s => [s.secretName, s.value])),
    null,
    2,
  ));
}

main().catch(err => { console.error(err); process.exit(1); });
