/**
 * Try multiple approaches to post a channel message:
 * 1. Bot Framework with multi-tenant token
 * 2. Bot Framework with app-specific audience
 * 3. Graph beta endpoint
 */

const TEAMS_SERVICE_URL = 'https://smba.trafficmanager.net/amer';

async function getToken(tokenUrl: string, clientId: string, clientSecret: string, scope: string): Promise<string | null> {
  try {
    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope,
    });
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    if (!res.ok) {
      const text = await res.text();
      console.log(`    Token FAILED (${res.status}): ${text.substring(0, 200)}`);
      return null;
    }
    const data = (await res.json()) as { access_token: string };
    return data.access_token;
  } catch (err) {
    console.log(`    Token error: ${(err as Error).message}`);
    return null;
  }
}

async function tryPost(label: string, token: string, url: string, body: unknown): Promise<boolean> {
  console.log(`  ${label}: POST ${url.substring(0, 80)}...`);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (res.ok) {
      console.log(`    SUCCESS (${res.status})!`);
      return true;
    }
    console.log(`    ${res.status}: ${text.substring(0, 300)}`);
    return false;
  } catch (err) {
    console.log(`    Error: ${(err as Error).message}`);
    return false;
  }
}

async function main() {
  const botAppId = process.env.BOT_APP_ID!.trim();
  const botSecret = process.env.BOT_APP_SECRET!.trim();
  const tenantId = (process.env.BOT_TENANT_ID ?? process.env.AZURE_TENANT_ID)!.trim();
  const sharedClientId = process.env.AZURE_CLIENT_ID!.trim();
  const sharedSecret = process.env.AZURE_CLIENT_SECRET!.trim();
  const channelId = process.env.TEAMS_CHANNEL_DECISIONS_ID!.trim();
  const teamId = process.env.TEAMS_TEAM_ID!.trim();

  const simpleActivityBody = {
    isGroup: true,
    channelData: { channel: { id: channelId } },
    activity: {
      type: 'message',
      text: '[Diagnostic test — please ignore]',
    },
  };

  const graphPostBody = {
    body: { contentType: 'text', content: '[Diagnostic test — please ignore]' },
  };

  console.log('=== Approach 1: Bot Framework — multi-tenant token ===');
  console.log('  Getting token from botframework.com tenant...');
  const multiTenantToken = await getToken(
    'https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token',
    botAppId, botSecret,
    'https://api.botframework.com/.default',
  );
  if (multiTenantToken) {
    await tryPost('POST /v3/conversations', multiTenantToken,
      `${TEAMS_SERVICE_URL}/v3/conversations`, simpleActivityBody);
  }

  console.log('\n=== Approach 2: Bot Framework — single-tenant + app ID audience ===');
  console.log('  Getting token with app-specific scope...');
  const appScopeToken = await getToken(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    botAppId, botSecret,
    `api://${botAppId}/.default`,
  );
  if (appScopeToken) {
    await tryPost('POST /v3/conversations', appScopeToken,
      `${TEAMS_SERVICE_URL}/v3/conversations`, simpleActivityBody);
  }

  console.log('\n=== Approach 3: Graph beta endpoint ===');
  console.log('  Getting Graph token with shared credentials...');
  const graphToken = await getToken(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    sharedClientId, sharedSecret,
    'https://graph.microsoft.com/.default',
  );
  if (graphToken) {
    await tryPost('POST beta/teams/{id}/channels/{id}/messages', graphToken,
      `https://graph.microsoft.com/beta/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages`,
      graphPostBody);
  }

  console.log('\n=== Approach 4: Bot Framework — tenant token, botframework audience ===');
  console.log('  Getting token from tenant endpoint with botframework scope...');
  const tenantBfToken = await getToken(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    botAppId, botSecret,
    'https://api.botframework.com/.default',
  );
  if (tenantBfToken) {
    // Try posting directly to the channel as an activity
    await tryPost('POST /v3/conversations', tenantBfToken,
      `${TEAMS_SERVICE_URL}/v3/conversations`, simpleActivityBody);
    
    // Also try POSTing as an activity to an existing conversation
    await tryPost('POST /v3/conversations/{channelId}/activities', tenantBfToken,
      `${TEAMS_SERVICE_URL}/v3/conversations/${encodeURIComponent(channelId)}/activities`,
      { type: 'message', text: '[Diagnostic test — please ignore]' });
  }

  console.log('\n=== Approach 5: Graph v1.0 with bot credentials (Graph scope) ===');
  console.log('  Getting Graph token with BOT credentials...');
  const botGraphToken = await getToken(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    botAppId, botSecret,
    'https://graph.microsoft.com/.default',
  );
  if (botGraphToken) {
    // Check what Graph permissions the bot app has
    const payload = JSON.parse(Buffer.from(botGraphToken.split('.')[1], 'base64url').toString());
    const roles: string[] = payload.roles || [];
    console.log(`  Bot app Graph roles: ${roles.length} total`);
    const channelRoles = roles.filter(r => r.toLowerCase().includes('channel'));
    console.log(`  Channel-related: ${channelRoles.join(', ') || '(none)'}`);
    
    if (roles.includes('ChannelMessage.Send')) {
      console.log('  Bot app HAS ChannelMessage.Send! Trying Graph POST...');
      await tryPost('POST v1.0/teams/{id}/channels/{id}/messages', botGraphToken,
        `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages`,
        graphPostBody);
    } else {
      console.log('  Bot app also lacks ChannelMessage.Send.');
    }
  }

  console.log('\nDone. Check results above for SUCCESS/FAILED.');
}

main().catch(err => { console.error(err); process.exit(1); });
