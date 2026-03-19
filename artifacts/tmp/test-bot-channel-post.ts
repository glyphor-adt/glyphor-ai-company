/**
 * Test Bot Framework proactive messaging to a Teams channel.
 * 
 * Bot Framework uses a separate auth model from Graph API.
 * Bots can send channel messages if installed in the team,
 * without needing Graph ChannelMessage.Send permission.
 */

const TEAMS_SERVICE_URL = 'https://smba.trafficmanager.net/amer';

async function getBotToken(
  tenantId: string,
  botAppId: string,
  botAppSecret: string,
): Promise<string> {
  // Single-tenant: use tenant-specific endpoint
  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
  
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: botAppId,
    client_secret: botAppSecret,
    scope: 'https://api.botframework.com/.default',
  });

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Bot token acquisition failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  return data.access_token;
}

async function main() {
  const botAppId = process.env.BOT_APP_ID?.trim();
  const botAppSecret = process.env.BOT_APP_SECRET?.trim();
  const tenantId = (process.env.BOT_TENANT_ID ?? process.env.AZURE_TENANT_ID)?.trim();
  const channelId = process.env.TEAMS_CHANNEL_DECISIONS_ID?.trim();

  if (!botAppId || !botAppSecret || !tenantId) {
    console.error('Missing BOT_APP_ID, BOT_APP_SECRET, or tenant ID');
    process.exit(1);
  }

  console.log(`Bot App ID: ${botAppId}`);
  console.log(`Tenant ID:  ${tenantId}`);
  console.log(`Channel:    ${channelId?.substring(0, 30)}...`);

  // Step 1: Get Bot Framework token
  console.log('\nStep 1: Acquiring Bot Framework token...');
  const token = await getBotToken(tenantId, botAppId, botAppSecret);
  console.log('  Token acquired!');

  // Decode to see scopes
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  console.log(`  Audience: ${payload.aud}`);
  console.log(`  Issuer:   ${payload.iss?.substring(0, 60)}...`);

  if (!channelId) {
    console.log('\nNo TEAMS_CHANNEL_DECISIONS_ID set — skipping channel test.');
    return;
  }

  // Step 2: Create a conversation (post to channel)
  console.log('\nStep 2: Posting message to channel via Bot Connector API...');
  const conversationUrl = `${TEAMS_SERVICE_URL}/v3/conversations`;

  const card = {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.5',
    body: [
      {
        type: 'TextBlock',
        text: '🔧 Bot Channel Posting Test',
        weight: 'bolder',
        size: 'medium',
      },
      {
        type: 'TextBlock',
        text: 'If you see this message, Bot Framework proactive messaging is working. This is a diagnostic test — please ignore.',
        wrap: true,
      },
    ],
  };

  const conversationPayload = {
    isGroup: true,
    channelData: {
      channel: { id: channelId },
    },
    activity: {
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: card,
        },
      ],
    },
  };

  const postRes = await fetch(conversationUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(conversationPayload),
  });

  console.log(`  Response: ${postRes.status} ${postRes.statusText}`);

  const responseBody = await postRes.text();
  if (postRes.ok) {
    console.log('  SUCCESS — Bot Framework channel posting works!');
    try {
      const parsed = JSON.parse(responseBody);
      console.log(`  Activity ID: ${parsed.activityId || parsed.id || 'N/A'}`);
    } catch {
      console.log(`  Response: ${responseBody.substring(0, 200)}`);
    }
  } else {
    console.log(`  FAILED: ${responseBody.substring(0, 500)}`);

    // Try alternative: maybe the bot needs to be installed
    if (postRes.status === 403 || postRes.status === 404) {
      console.log('\n  The bot may not be installed in this team.');
      console.log('  To install: Teams Admin Center → Manage apps → upload the bot manifest.');
    }
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
