// Get a Microsoft Graph token with Agent ID scopes (no Directory.AccessAsUser.All)
// Uses MSAL device code flow with the Microsoft Graph PowerShell client ID
import { PublicClientApplication } from '@azure/msal-node';

const TENANT_ID = '19ab7456-f160-416d-a503-57298ab192a2';
// Microsoft Graph PowerShell SDK client ID (first-party Microsoft app)
const CLIENT_ID = '14d82eec-204b-4c2f-b7e8-296a70dab67e';

const scopes = [
  'https://graph.microsoft.com/AgentIdentityBlueprint.Create',
  'https://graph.microsoft.com/AgentIdentityBlueprint.AddRemoveCreds.All',
  'https://graph.microsoft.com/AgentIdentityBlueprint.ReadWrite.All',
  'https://graph.microsoft.com/AgentIdentityBlueprintPrincipal.Create',
  'https://graph.microsoft.com/User.Read',
];

const pca = new PublicClientApplication({
  auth: {
    clientId: CLIENT_ID,
    authority: `https://login.microsoftonline.com/${TENANT_ID}`,
  },
});

try {
  const result = await pca.acquireTokenByDeviceCode({
    scopes,
    deviceCodeCallback: (response) => {
      console.error('\n' + response.message + '\n');
    },
  });
  // Output only the token to stdout
  process.stdout.write(result.accessToken);
} catch (err) {
  console.error('Auth failed:', err.message);
  process.exit(1);
}
