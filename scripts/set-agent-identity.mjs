// Script to set agentIdentityBlueprintId on user accounts via Graph API
// Uses MSAL device code flow to get a token with AgentIdUser.ReadWrite.All scope

import https from 'https';

const TENANT_ID = '19ab7456-f160-416d-a503-57298ab192a2';
const CLIENT_ID = '06c728b6-0111-4cb1-a708-d57c51128649';
const BLUEPRINT_ID = '5604df3b-a3a3-4c7e-a8c4-e6f9ed04ad6a';
const REDIRECT_URI = 'http://localhost:8400/';

// All agent user IDs (from previous enumeration)
const AGENT_USERS = [
  { email: 'adi@glyphor.ai', id: 'f86cb35c-8eff-4ae3-ad71-313ae8c4f2a2', name: 'Adi Rose' },
];

const SCOPE = 'https://graph.microsoft.com/AgentIdUser.ReadWrite.All https://graph.microsoft.com/User.ReadWrite.All openid';

async function graphRequest(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'graph.microsoft.com',
      path: path,
      method: method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function deviceCodeFlow() {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    scope: SCOPE,
    tenant: TENANT_ID,
  });

  const res = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/devicecode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await res.json();
  console.log('\n' + data.message + '\n');

  // Poll for token
  const interval = data.interval || 5;
  while (true) {
    await new Promise(r => setTimeout(r, interval * 1000));
    const tokenBody = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      client_id: CLIENT_ID,
      device_code: data.device_code,
    });
    const tokenRes = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody.toString(),
    });
    const tokenData = await tokenRes.json();
    if (tokenData.access_token) {
      return tokenData.access_token;
    }
    if (tokenData.error === 'authorization_pending') {
      process.stdout.write('.');
      continue;
    }
    throw new Error(`Token error: ${tokenData.error} - ${tokenData.error_description}`);
  }
}

async function main() {
  // Step 1: Get token via device code flow
  console.log('Starting device code authentication...');
  const token = await deviceCodeFlow();
  console.log('\nAuthenticated successfully!');

  // Step 2: Test with Adi Rose
  const testUser = AGENT_USERS[0];
  console.log(`\nTesting PATCH on ${testUser.name} (${testUser.email})...`);

  const patchBody = { agentIdentityBlueprintId: BLUEPRINT_ID };
  const patchRes = await graphRequest('PATCH', `/beta/users/${testUser.id}`, token, patchBody);
  console.log(`PATCH status: ${patchRes.status}`);
  if (patchRes.body) console.log(`PATCH response: ${patchRes.body}`);

  // Step 3: Verify
  const getRes = await graphRequest('GET', `/beta/users/${testUser.id}?$select=displayName,agentIdentityBlueprintId,identityParentId`, token);
  console.log(`\nVerification:`);
  const user = JSON.parse(getRes.body);
  console.log(`  displayName: ${user.displayName}`);
  console.log(`  agentIdentityBlueprintId: ${user.agentIdentityBlueprintId}`);
  console.log(`  identityParentId: ${user.identityParentId}`);
}

main().catch(console.error);
