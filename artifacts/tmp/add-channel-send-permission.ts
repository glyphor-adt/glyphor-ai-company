/**
 * Add ChannelMessage.Send application permission to the Entra app
 * and grant admin consent via Graph API.
 */
import { ConfidentialClientApplication } from '@azure/msal-node';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
// Well-known: Microsoft Graph resource app ID
const GRAPH_RESOURCE_APP_ID = '00000003-0000-0000-c000-000000000000';

async function getToken(): Promise<string> {
  const tenantId = process.env.AZURE_TENANT_ID!.trim();
  const clientId = process.env.AZURE_CLIENT_ID!.trim();
  const clientSecret = process.env.AZURE_CLIENT_SECRET!.trim();

  const msalApp = new ConfidentialClientApplication({
    auth: {
      clientId,
      clientSecret,
      authority: `https://login.microsoftonline.com/${tenantId}`,
    },
  });

  const result = await msalApp.acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default'],
  });

  if (!result?.accessToken) throw new Error('Failed to acquire token');
  return result.accessToken;
}

async function graphGet(token: string, path: string) {
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GET ${path}: ${res.status} ${res.statusText}\n${body}`);
  }
  return res.json();
}

async function graphPatch(token: string, path: string, body: unknown) {
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PATCH ${path}: ${res.status} ${res.statusText}\n${text}`);
  }
  return res.status === 204 ? null : res.json();
}

async function graphPost(token: string, path: string, body: unknown) {
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${path}: ${res.status} ${res.statusText}\n${text}`);
  }
  return res.json();
}

async function main() {
  const clientId = process.env.AZURE_CLIENT_ID!.trim();
  const token = await getToken();
  console.log('Token acquired.\n');

  // Step 1: Find the ChannelMessage.Send role ID from the Microsoft Graph service principal
  console.log('Step 1: Finding ChannelMessage.Send role ID...');
  const graphSPs = await graphGet(
    token,
    `/servicePrincipals?$filter=appId eq '${GRAPH_RESOURCE_APP_ID}'&$select=id,appRoles`,
  ) as { value: Array<{ id: string; appRoles: Array<{ id: string; value: string; displayName: string }> }> };

  if (!graphSPs.value.length) throw new Error('Microsoft Graph service principal not found');
  const graphSP = graphSPs.value[0];
  console.log(`  Graph SP ID: ${graphSP.id}`);

  const channelSendRole = graphSP.appRoles.find(
    (r) => r.value === 'ChannelMessage.Send',
  );
  if (!channelSendRole) throw new Error('ChannelMessage.Send role not found in Graph appRoles');
  console.log(`  ChannelMessage.Send role ID: ${channelSendRole.id}`);
  console.log(`  Display name: ${channelSendRole.displayName}\n`);

  // Step 2: Get our app registration's current requiredResourceAccess
  console.log('Step 2: Reading current app registration permissions...');
  const apps = await graphGet(
    token,
    `/applications?$filter=appId eq '${clientId}'&$select=id,requiredResourceAccess`,
  ) as { value: Array<{ id: string; requiredResourceAccess: Array<{ resourceAppId: string; resourceAccess: Array<{ id: string; type: string }> }> }> };

  if (!apps.value.length) throw new Error('App registration not found');
  const app = apps.value[0];
  console.log(`  App object ID: ${app.id}`);

  // Check if ChannelMessage.Send is already declared
  const graphEntry = app.requiredResourceAccess.find(
    (r) => r.resourceAppId === GRAPH_RESOURCE_APP_ID,
  );

  const alreadyDeclared = graphEntry?.resourceAccess.some(
    (ra) => ra.id === channelSendRole.id,
  );

  if (alreadyDeclared) {
    console.log('  ChannelMessage.Send already declared in requiredResourceAccess.\n');
  } else {
    console.log('  Adding ChannelMessage.Send to requiredResourceAccess...');
    // Build updated requiredResourceAccess
    const updatedRRA = [...app.requiredResourceAccess];
    if (graphEntry) {
      // Add to existing Graph entry
      graphEntry.resourceAccess.push({
        id: channelSendRole.id,
        type: 'Role', // Application permission
      });
    } else {
      // Create new Graph entry
      updatedRRA.push({
        resourceAppId: GRAPH_RESOURCE_APP_ID,
        resourceAccess: [{ id: channelSendRole.id, type: 'Role' }],
      });
    }

    await graphPatch(token, `/applications/${encodeURIComponent(app.id)}`, {
      requiredResourceAccess: updatedRRA,
    });
    console.log('  Done — permission declared.\n');
  }

  // Step 3: Grant admin consent by creating an appRoleAssignment
  console.log('Step 3: Granting admin consent (appRoleAssignment)...');

  // Find our app's service principal
  const ourSPs = await graphGet(
    token,
    `/servicePrincipals?$filter=appId eq '${clientId}'&$select=id`,
  ) as { value: Array<{ id: string }> };

  if (!ourSPs.value.length) throw new Error('Our service principal not found');
  const ourSPId = ourSPs.value[0].id;
  console.log(`  Our SP ID: ${ourSPId}`);

  // Check if consent already exists
  const existingAssignments = await graphGet(
    token,
    `/servicePrincipals/${encodeURIComponent(ourSPId)}/appRoleAssignments?$filter=resourceId eq '${graphSP.id}'`,
  ) as { value: Array<{ appRoleId: string }> };

  const alreadyConsented = existingAssignments.value.some(
    (a) => a.appRoleId === channelSendRole.id,
  );

  if (alreadyConsented) {
    console.log('  Admin consent already granted for ChannelMessage.Send.\n');
  } else {
    try {
      const assignment = await graphPost(
        token,
        `/servicePrincipals/${encodeURIComponent(ourSPId)}/appRoleAssignments`,
        {
          principalId: ourSPId,
          resourceId: graphSP.id,
          appRoleId: channelSendRole.id,
        },
      );
      console.log('  Admin consent granted!');
      console.log(`  Assignment ID: ${(assignment as { id: string }).id}\n`);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('Permission being assigned already exists')) {
        console.log('  Admin consent already exists (race condition).\n');
      } else {
        throw err;
      }
    }
  }

  // Step 4: Verify by acquiring a fresh token and checking roles
  console.log('Step 4: Verifying — acquiring fresh token...');
  // Clear MSAL cache by creating a new instance
  const verifyApp = new ConfidentialClientApplication({
    auth: {
      clientId,
      clientSecret: process.env.AZURE_CLIENT_SECRET!.trim(),
      authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID!.trim()}`,
    },
  });
  const verifyResult = await verifyApp.acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default'],
  });
  if (verifyResult?.accessToken) {
    const payload = JSON.parse(
      Buffer.from(verifyResult.accessToken.split('.')[1], 'base64url').toString(),
    );
    const roles: string[] = payload.roles || [];
    if (roles.includes('ChannelMessage.Send')) {
      console.log('  SUCCESS: ChannelMessage.Send is now in token roles!\n');
    } else {
      console.log('  NOTE: ChannelMessage.Send not yet in token. This can take up to 60 seconds');
      console.log('  for Azure AD to propagate. The permission IS granted — next token will have it.\n');
    }
  }

  console.log('All done. Channel posting should work now (or within ~60 seconds).');
}

main().catch((err) => {
  console.error('FAILED:', (err as Error).message);
  process.exit(1);
});
