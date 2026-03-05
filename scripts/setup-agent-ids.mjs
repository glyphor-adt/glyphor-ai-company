/**
 * Entra Agent ID Setup Script
 * 
 * Official docs:
 * - https://learn.microsoft.com/en-us/entra/agent-id/identity-platform/create-blueprint?tabs=microsoft-graph-api
 * - https://learn.microsoft.com/en-us/entra/agent-id/identity-platform/create-delete-agent-identities?tabs=microsoft-graph-api
 * 
 * Process:
 *   Phase 1 (delegated token - AgentIdentityBlueprint.* scopes):
 *     1. Verify blueprint exists
 *     2. Add credential (addPassword) if needed  
 *     3. Configure identifier URI + scope
 *     4. Create BlueprintPrincipal SP
 *   Phase 2 (blueprint client_credentials token):
 *     5. Get blueprint token via client_credentials
 *     6. Create Agent Identities for all agents
 */
import { PublicClientApplication, ConfidentialClientApplication } from '@azure/msal-node';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const TENANT_ID = '19ab7456-f160-416d-a503-57298ab192a2';
const GRAPH_PS_CLIENT_ID = '14d82eec-204b-4c2f-b7e8-296a70dab67e';
const BLUEPRINT_APP_ID = '5604df3b-a3a3-4c7e-a8c4-e6f9ed04ad6a';
const BLUEPRINT_OBJECT_ID = 'ef4709f1-5f28-4080-8287-cec2314dc5b5';
const SPONSOR_USER_ID = '88a731d1-3171-4279-aee1-34160898ab90'; // kristina@glyphor.ai
const GRAPH_BASE = 'https://graph.microsoft.com/beta';
const TOKEN_CACHE_FILE = resolve(import.meta.dirname, '../.agent-id-token-cache.json');
const SECRET_FILE = resolve(import.meta.dirname, '../.agent-id-blueprint-secret.json');

// Load agent identities
const agentIdentitiesPath = resolve(import.meta.dirname, '../packages/agent-runtime/src/config/agentIdentities.json');
const agentIdentities = JSON.parse(readFileSync(agentIdentitiesPath, 'utf8'));

const DELEGATED_SCOPES = [
  'https://graph.microsoft.com/AgentIdentityBlueprint.Create',
  'https://graph.microsoft.com/AgentIdentityBlueprint.AddRemoveCreds.All',
  'https://graph.microsoft.com/AgentIdentityBlueprint.ReadWrite.All',
  'https://graph.microsoft.com/AgentIdentityBlueprintPrincipal.Create',
  'https://graph.microsoft.com/User.Read',
];

// ──────────────────────────────────────────
// Auth helpers
// ──────────────────────────────────────────
async function getDelegatedToken() {
  const pca = new PublicClientApplication({
    auth: {
      clientId: GRAPH_PS_CLIENT_ID,
      authority: `https://login.microsoftonline.com/${TENANT_ID}`,
    },
    cache: {
      cachePlugin: {
        beforeCacheAccess: async (ctx) => {
          if (existsSync(TOKEN_CACHE_FILE)) {
            ctx.tokenCache.deserialize(readFileSync(TOKEN_CACHE_FILE, 'utf8'));
          }
        },
        afterCacheAccess: async (ctx) => {
          if (ctx.cacheHasChanged) {
            writeFileSync(TOKEN_CACHE_FILE, ctx.tokenCache.serialize());
          }
        },
      },
    },
  });

  // Try silent first (cached token)
  const accounts = await pca.getTokenCache().getAllAccounts();
  if (accounts.length > 0) {
    try {
      const result = await pca.acquireTokenSilent({ scopes: DELEGATED_SCOPES, account: accounts[0] });
      return result.accessToken;
    } catch { /* fall through to device code */ }
  }

  const result = await pca.acquireTokenByDeviceCode({
    scopes: DELEGATED_SCOPES,
    deviceCodeCallback: (response) => {
      console.log('\n╔══════════════════════════════════════════════════════════════════╗');
      console.log('║  SIGN IN REQUIRED                                              ║');
      console.log('║  Open: https://microsoft.com/devicelogin                        ║');
      console.log(`║  Code: ${response.userCode}                                          ║`);
      console.log('╚══════════════════════════════════════════════════════════════════╝\n');
    },
  });
  return result.accessToken;
}

async function getBlueprintToken(clientSecret) {
  const cca = new ConfidentialClientApplication({
    auth: {
      clientId: BLUEPRINT_APP_ID,
      authority: `https://login.microsoftonline.com/${TENANT_ID}`,
      clientSecret,
    },
  });
  const result = await cca.acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default'],
  });
  return result.accessToken;
}

// ──────────────────────────────────────────
// Graph helper
// ──────────────────────────────────────────
async function graph(token, method, path, body = null) {
  const url = path.startsWith('http') ? path : `${GRAPH_BASE}${path}`;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'OData-Version': '4.0',
  };
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const resp = await fetch(url, opts);
  const text = await resp.text();

  if (!resp.ok) {
    let errMsg = text.substring(0, 300);
    try { const e = JSON.parse(text); errMsg = `${e.error?.code}: ${e.error?.message}`; } catch {}
    return { ok: false, status: resp.status, error: errMsg };
  }
  if (!text) return { ok: true, status: resp.status, data: null };
  try { return { ok: true, status: resp.status, data: JSON.parse(text) }; }
  catch { return { ok: true, status: resp.status, data: text }; }
}

function log(msg) { console.log(msg); }
function err(msg) { console.error(msg); }

// ══════════════════════════════════════════
// PHASE 1: Blueprint setup (delegated token)
// ══════════════════════════════════════════

async function phase1_verifyBlueprint(token) {
  log('\n── Step 1: Verify Blueprint ──');
  const r = await graph(token, 'GET', `/applications/${BLUEPRINT_OBJECT_ID}?$select=displayName,appId,identifierUris,api,passwordCredentials`);
  if (!r.ok) { err(`  FAIL: ${r.error}`); return null; }
  log(`  ✓ ${r.data.displayName} (appId: ${r.data.appId})`);
  log(`  identifierUris: ${JSON.stringify(r.data.identifierUris)}`);
  log(`  scopes: ${JSON.stringify(r.data.api?.oauth2PermissionScopes?.map(s => s.value) || [])}`);
  log(`  passwordCredentials: ${r.data.passwordCredentials?.length || 0}`);
  return r.data;
}

async function phase1_addCredential(token, blueprint) {
  log('\n── Step 2: Add Credential ──');
  // Check for saved secret first
  if (existsSync(SECRET_FILE)) {
    const saved = JSON.parse(readFileSync(SECRET_FILE, 'utf8'));
    log(`  Using saved secret (keyId: ${saved.keyId})`);
    return saved.secretText;
  }
  
  if (blueprint.passwordCredentials?.length > 0) {
    log('  Blueprint already has password credentials.');
    log('  Adding a new one so we can capture the secret value...');
  }
  
  const r = await graph(token, 'POST', `/applications/${BLUEPRINT_OBJECT_ID}/addPassword`, {
    passwordCredential: {
      displayName: 'Agent ID Setup Secret',
      endDateTime: '2026-12-31T23:59:59Z',
    },
  });
  if (!r.ok) { err(`  FAIL: ${r.error}`); return null; }
  
  log(`  ✓ Created secret (keyId: ${r.data.keyId})`);
  // Save the secret - it can't be retrieved again
  writeFileSync(SECRET_FILE, JSON.stringify({ keyId: r.data.keyId, secretText: r.data.secretText }, null, 2));
  log(`  Secret saved to ${SECRET_FILE}`);
  return r.data.secretText;
}

async function phase1_configureUriAndScope(token, blueprint) {
  log('\n── Step 3: Configure Identifier URI and Scope ──');
  const hasUri = blueprint.identifierUris?.length > 0;
  const hasScope = blueprint.api?.oauth2PermissionScopes?.length > 0;
  if (hasUri && hasScope) { log('  Already configured, skipping.'); return true; }

  const scopeId = crypto.randomUUID();
  const r = await graph(token, 'PATCH', `/applications/${BLUEPRINT_OBJECT_ID}`, {
    identifierUris: [`api://${BLUEPRINT_APP_ID}`],
    api: {
      oauth2PermissionScopes: [{
        adminConsentDescription: 'Allow the application to access the agent on behalf of the signed-in user.',
        adminConsentDisplayName: 'Access agent',
        id: scopeId, isEnabled: true, type: 'User', value: 'access_agent',
      }],
    },
  });
  if (!r.ok) { err(`  FAIL: ${r.error}`); return false; }
  log(`  ✓ URI: api://${BLUEPRINT_APP_ID}`);
  log(`  ✓ Scope: access_agent (${scopeId})`);
  return true;
}

async function phase1_createBlueprintPrincipal(token) {
  log('\n── Step 4: Create Blueprint Principal ──');
  
  // Check existing
  const existing = await graph(token, 'GET', `/servicePrincipals?$filter=appId eq '${BLUEPRINT_APP_ID}'&$select=id,displayName,servicePrincipalType`);
  if (existing.ok && existing.data.value?.length > 0) {
    const sp = existing.data.value[0];
    log(`  Existing SP: ${sp.displayName} (type: ${sp.servicePrincipalType})`);
    if (sp.servicePrincipalType === 'AgentIdentityBlueprintPrincipal') {
      log('  ✓ Already a BlueprintPrincipal, skipping.');
      return sp.id;
    }
    log('  Deleting mistyped SP...');
    const del = await graph(token, 'DELETE', `/servicePrincipals/${sp.id}`);
    if (!del.ok) { err(`  FAIL delete: ${del.error}`); return null; }
    log('  Deleted. Waiting 5s for propagation...');
    await new Promise(r => setTimeout(r, 5000));
  }

  const r = await graph(token, 'POST', '/serviceprincipals/graph.agentIdentityBlueprintPrincipal', {
    appId: BLUEPRINT_APP_ID,
  });
  if (!r.ok) { err(`  FAIL: ${r.error}`); return null; }
  log(`  ✓ Created: ${r.data.id} (type: ${r.data.servicePrincipalType})`);
  return r.data.id;
}

// ══════════════════════════════════════════
// PHASE 2: Agent identities (blueprint token)
// ══════════════════════════════════════════

async function phase2_createAgentIdentities(blueprintToken) {
  log('\n── Step 6: Create Agent Identities ──');
  const agentKeys = Object.keys(agentIdentities);
  log(`  Total agents: ${agentKeys.length}`);

  let created = 0, skipped = 0, failed = 0;
  const results = {};

  for (const key of agentKeys) {
    const agent = agentIdentities[key];
    const displayName = agent.displayName.replace('Glyphor Agent - ', '');

    const r = await graph(blueprintToken, 'POST', '/serviceprincipals/Microsoft.Graph.AgentIdentity', {
      displayName,
      agentIdentityBlueprintId: BLUEPRINT_APP_ID,
      'sponsors@odata.bind': [`https://graph.microsoft.com/v1.0/users/${SPONSOR_USER_ID}`],
    });

    if (r.ok) {
      log(`  ✓ ${key}: ${displayName} → ${r.data.id}`);
      results[key] = { agentIdentityId: r.data.id, displayName };
      created++;
    } else if (r.status === 409) {
      log(`  ○ ${key}: ${displayName} (already exists)`);
      skipped++;
    } else {
      log(`  ✗ ${key}: ${displayName} — ${r.error}`);
      failed++;
      // If first one fails with permission error, stop early
      if (created === 0 && skipped === 0 && failed === 1 && r.status === 403) {
        err('\n  Permission denied on first agent. Blueprint token may lack required scopes.');
        break;
      }
    }
    await new Promise(r => setTimeout(r, 300)); // throttle
  }

  log(`\n  Results: ${created} created, ${skipped} existed, ${failed} failed`);
  if (Object.keys(results).length > 0) {
    writeFileSync(resolve(import.meta.dirname, '../.agent-identities-created.json'), JSON.stringify(results, null, 2));
    log('  Saved to .agent-identities-created.json');
  }
  return { created, skipped, failed };
}

// ══════════════════════════════════════════
// Main
// ══════════════════════════════════════════
async function main() {
  const mode = process.argv[2] || 'all';
  log('╔════════════════════════════════════════════════════╗');
  log('║  Entra Agent ID Setup                              ║');
  log('║  Blueprint: ' + BLUEPRINT_APP_ID + '    ║');
  log('║  Tenant:    ' + TENANT_ID + '    ║');
  log('╚════════════════════════════════════════════════════╝');

  // ── Phase 1: delegated token ──
  log('\n▶ Phase 1: Blueprint setup (delegated token)');
  log('Acquiring delegated token...');
  const delegatedToken = await getDelegatedToken();
  log('✓ Token acquired (no Directory.AccessAsUser.All).\n');

  if (mode === 'verify') {
    await phase1_verifyBlueprint(delegatedToken);
    return;
  }

  // Step 1: Verify
  const blueprint = await phase1_verifyBlueprint(delegatedToken);
  if (!blueprint) process.exit(1);

  // Step 2: Add credential (get client secret for Phase 2)
  const clientSecret = await phase1_addCredential(delegatedToken, blueprint);
  if (!clientSecret) { err('Cannot proceed without client secret.'); process.exit(1); }

  // Step 3: Configure URI + scope
  const uriOk = await phase1_configureUriAndScope(delegatedToken, blueprint);
  if (!uriOk) { err('Failed to configure URI/scope.'); process.exit(1); }

  // Step 4: Create BlueprintPrincipal
  const bpSpId = await phase1_createBlueprintPrincipal(delegatedToken);
  if (!bpSpId) { err('Failed to create BlueprintPrincipal.'); process.exit(1); }

  // ── Phase 2: blueprint token ──
  log('\n▶ Phase 2: Agent identity creation (blueprint token)');
  log('\n── Step 5: Get Blueprint Token (client_credentials) ──');
  let blueprintToken;
  try {
    blueprintToken = await getBlueprintToken(clientSecret);
    log('  ✓ Blueprint token acquired.');
  } catch (e) {
    err(`  FAIL: ${e.message}`);
    err('  The blueprint may need time for the credential to propagate.');
    err('  Try running again in 30 seconds with: node scripts/setup-agent-ids.mjs identities');
    process.exit(1);
  }

  // Step 6: Create Agent Identities
  if (mode === 'all' || mode === 'identities') {
    await phase2_createAgentIdentities(blueprintToken);
  }

  log('\n═══ Setup Complete ═══');
}

main().catch(e => {
  err(`Fatal: ${e.message}`);
  process.exit(1);
});
