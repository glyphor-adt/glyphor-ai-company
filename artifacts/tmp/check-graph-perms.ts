/**
 * Diagnostic: Acquire a Graph token using the shared AZURE_CLIENT_ID
 * and inspect its roles claim to check for ChannelMessage.Send.
 */
import { ConfidentialClientApplication } from '@azure/msal-node';

async function main() {
  const tenantId = process.env.AZURE_TENANT_ID?.trim();
  const clientId = process.env.AZURE_CLIENT_ID?.trim();
  const clientSecret = process.env.AZURE_CLIENT_SECRET?.trim();

  if (!tenantId || !clientId || !clientSecret) {
    console.error('Missing AZURE_TENANT_ID, AZURE_CLIENT_ID, or AZURE_CLIENT_SECRET');
    process.exit(1);
  }

  console.log(`Tenant ID: ${tenantId}`);
  console.log(`Client ID: ${clientId}`);
  console.log(`Secret:    ${clientSecret.substring(0, 4)}...${clientSecret.substring(clientSecret.length - 4)}`);

  const msalApp = new ConfidentialClientApplication({
    auth: {
      clientId,
      clientSecret,
      authority: `https://login.microsoftonline.com/${tenantId}`,
    },
  });

  try {
    const result = await msalApp.acquireTokenByClientCredential({
      scopes: ['https://graph.microsoft.com/.default'],
    });

    if (!result?.accessToken) {
      console.error('No access token returned');
      process.exit(1);
    }

    console.log('\nToken acquired successfully!');
    console.log(`Expires: ${result.expiresOn}`);

    // Decode JWT payload (base64url -> JSON)
    const parts = result.accessToken.split('.');
    if (parts.length !== 3) {
      console.error('Token is not a valid JWT');
      process.exit(1);
    }

    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());

    console.log(`\nAudience: ${payload.aud}`);
    console.log(`App ID:   ${payload.appid || payload.azp}`);
    console.log(`Tenant:   ${payload.tid}`);
    console.log(`\nRoles (permissions):`);

    const roles = payload.roles || [];
    if (roles.length === 0) {
      console.log('  (NONE — no application permissions granted!)');
    } else {
      for (const role of roles.sort()) {
        const isChannelSend = role === 'ChannelMessage.Send';
        console.log(`  ${isChannelSend ? '>>> ' : '    '}${role}${isChannelSend ? ' <<<' : ''}`);
      }
    }

    // Check specifically for ChannelMessage.Send
    if (!roles.includes('ChannelMessage.Send')) {
      console.log('\n*** MISSING: ChannelMessage.Send is NOT in the token roles! ***');
      console.log('This is why sendCard() returns 401. The app registration needs');
      console.log('ChannelMessage.Send (Application) permission with admin consent.');
    } else {
      console.log('\nChannelMessage.Send is present — channel posting should work.');
    }

    // Quick test: try listing channels
    console.log('\n--- Quick test: List channels ---');
    const teamId = process.env.TEAMS_TEAM_ID;
    if (teamId) {
      const res = await fetch(
        `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(teamId)}/channels?$select=id,displayName&$top=3`,
        { headers: { Authorization: `Bearer ${result.accessToken}` } },
      );
      console.log(`List channels: ${res.status} ${res.statusText}`);
      if (res.ok) {
        const data = await res.json() as { value: Array<{ id: string; displayName: string }> };
        console.log(`Found ${data.value.length} channels:`, data.value.map(c => c.displayName));
      } else {
        console.log('Response:', await res.text());
      }

      // Try posting to decisions channel
      const decisionsId = process.env.TEAMS_CHANNEL_DECISIONS_ID;
      if (decisionsId) {
        console.log('\n--- Quick test: POST to decisions channel ---');
        const postRes = await fetch(
          `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(decisionsId)}/messages`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${result.accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              body: { contentType: 'text', content: '[Diagnostic] Channel send permission test — please ignore.' },
            }),
          },
        );
        console.log(`POST message: ${postRes.status} ${postRes.statusText}`);
        if (!postRes.ok) {
          console.log('Response:', await postRes.text());
        } else {
          console.log('SUCCESS — channel posting works!');
        }
      }
    }
  } catch (err) {
    console.error('Token acquisition failed:', (err as Error).message);
  }
}
main();
