/**
 * Provision Entra Agent Identities
 *
 * Creates an Entra app registration per agent and assigns Glyphor app roles
 * from the blueprint app (5604df3b-a3a3-4c7e-a8c4-e6f9ed04ad6a).
 *
 * Prerequisites:
 *   - Azure CLI logged in (`az login`) with admin permissions
 *   - Blueprint app roles already created (22 roles)
 *
 * Usage:
 *   node scripts/provision-agent-identities.cjs
 *
 * Output:
 *   - Creates/updates agent app registrations in Entra
 *   - Assigns app roles on the blueprint service principal
 *   - Writes agent identity map to packages/agent-runtime/src/config/agentIdentities.json
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BLUEPRINT_APP_ID = '5604df3b-a3a3-4c7e-a8c4-e6f9ed04ad6a';
const BLUEPRINT_SP_ID = '28079457-37d9-483c-b7bb-fe6920083b8e';
const TENANT_ID = '19ab7456-f160-416d-a503-57298ab192a2';

// Agent role → display name mapping
const AGENTS = {
  'chief-of-staff':       'Glyphor Agent - Sarah Chen (CoS)',
  'cto':                  'Glyphor Agent - Marcus Reeves (CTO)',
  'cfo':                  'Glyphor Agent - Nadia Okafor (CFO)',
  'cpo':                  'Glyphor Agent - Elena Vasquez (CPO)',
  'cmo':                  'Glyphor Agent - Maya Brooks (CMO)',
  'clo':                  'Glyphor Agent - Victoria Chase (CLO)',
  'vp-customer-success':  'Glyphor Agent - James Turner (VP CS)',
  'vp-sales':             'Glyphor Agent - Rachel Kim (VP Sales)',
  'vp-design':            'Glyphor Agent - Mia Tanaka (VP Design)',
  'platform-engineer':    'Glyphor Agent - Alex Park (Platform Eng)',
  'quality-engineer':     'Glyphor Agent - Sam DeLuca (Quality Eng)',
  'devops-engineer':      'Glyphor Agent - Jordan Hayes (DevOps)',
  'm365-admin':           'Glyphor Agent - Riley Morgan (M365)',
  'user-researcher':      'Glyphor Agent - Priya Sharma (User Research)',
  'competitive-intel':    'Glyphor Agent - Daniel Ortiz (Competitive Intel)',
  'revenue-analyst':      'Glyphor Agent - Anna Park (Revenue)',
  'cost-analyst':         'Glyphor Agent - Omar Hassan (Cost)',
  'content-creator':      'Glyphor Agent - Tyler Reed (Content)',
  'seo-analyst':          'Glyphor Agent - Lisa Chen (SEO)',
  'social-media-manager': 'Glyphor Agent - Kai Johnson (Social)',
  'onboarding-specialist':'Glyphor Agent - Emma Wright (Onboarding)',
  'support-triage':       'Glyphor Agent - David Santos (Support)',
  'account-research':     'Glyphor Agent - Nathan Cole (Account Research)',
  'ui-ux-designer':       'Glyphor Agent - Leo Vargas (UI/UX)',
  'frontend-engineer':    'Glyphor Agent - Ava Chen (Frontend)',
  'design-critic':        'Glyphor Agent - Sofia Marchetti (Design Critic)',
  'template-architect':   'Glyphor Agent - Ryan Park (Template Arch)',
  'ops':                  'Glyphor Agent - Atlas Vega (Ops)',
  'global-admin':         'Glyphor Agent - Morgan Blake (Global Admin)',
  'head-of-hr':           'Glyphor Agent - Jasmine Rivera (HR)',
  'vp-research':          'Glyphor Agent - Sophia Lin (VP Research)',
  'competitive-research-analyst': 'Glyphor Agent - Lena Park (Comp Research)',
  'market-research-analyst':      'Glyphor Agent - Daniel Okafor (Market Research)',
  'technical-research-analyst':   'Glyphor Agent - Kai Nakamura (Tech Research)',
  'industry-research-analyst':    'Glyphor Agent - Amara Diallo (Industry Research)',
  'ai-impact-analyst':            'Glyphor Agent - Riya Mehta (AI Impact)',
  'org-analyst':                  'Glyphor Agent - Marcus Chen (Org Analyst)',
  'enterprise-account-researcher':'Glyphor Agent - Ethan Morse (Enterprise)',
  'bob-the-tax-pro':              'Glyphor Agent - Bob Finley (Tax)',
  'data-integrity-auditor':       'Glyphor Agent - Grace Hwang (Data Audit)',
  'tax-strategy-specialist':      'Glyphor Agent - Mariana Solis (Tax Strategy)',
  'lead-gen-specialist':          'Glyphor Agent - Derek Owens (Lead Gen)',
  'marketing-intelligence-analyst':'Glyphor Agent - Zara Petrov (Marketing Intel)',
  'adi-rose':                     'Glyphor Agent - Adi Rose (Exec Assistant)',
};

// Role assignments from MCP.md Step 4
const ROLE_ASSIGNMENTS = {
  'chief-of-staff':       ['Glyphor.Admin.Read', 'Glyphor.Ops.Read'],
  'cto':                  ['Glyphor.Code.Read', 'Glyphor.Code.Write', 'Glyphor.Deploy.Production', 'Glyphor.Engineering.Read'],
  'cfo':                  ['Glyphor.Finance.Revenue.Read', 'Glyphor.Finance.Cost.Read', 'Glyphor.Finance.Banking.Read'],
  'cmo':                  ['Glyphor.Marketing.Read', 'Glyphor.Marketing.Content.Write', 'Glyphor.Marketing.Publish', 'Glyphor.Marketing.Social.Write'],
  'cpo':                  ['Glyphor.Product.Read', 'Glyphor.Research.Read'],
  'clo':                  ['Glyphor.Admin.Read'],
  'vp-customer-success':  ['Glyphor.Support.Read', 'Glyphor.Product.Read'],
  'vp-sales':             ['Glyphor.Research.Read'],
  'vp-design':            ['Glyphor.Design.Read', 'Glyphor.Design.Write', 'Glyphor.Figma.Read', 'Glyphor.Figma.Write', 'Glyphor.Code.Read'],
  'platform-engineer':    ['Glyphor.Code.Read', 'Glyphor.Code.Write', 'Glyphor.Engineering.Read'],
  'quality-engineer':     ['Glyphor.Code.Read', 'Glyphor.Engineering.Read'],
  'devops-engineer':      ['Glyphor.Code.Read', 'Glyphor.Deploy.Preview', 'Glyphor.Engineering.Read'],
  'm365-admin':           ['Glyphor.Admin.Read'],
  'user-researcher':      ['Glyphor.Product.Read', 'Glyphor.Support.Read'],
  'competitive-intel':    ['Glyphor.Product.Read', 'Glyphor.Research.Read'],
  'revenue-analyst':      ['Glyphor.Finance.Revenue.Read'],
  'cost-analyst':         ['Glyphor.Finance.Cost.Read'],
  'content-creator':      ['Glyphor.Marketing.Read', 'Glyphor.Marketing.Content.Write'],
  'seo-analyst':          ['Glyphor.Marketing.SEO.Read', 'Glyphor.Marketing.Read'],
  'social-media-manager': ['Glyphor.Marketing.Read', 'Glyphor.Marketing.Social.Write'],
  'onboarding-specialist':['Glyphor.Support.Read'],
  'support-triage':       ['Glyphor.Support.Read'],
  'account-research':     ['Glyphor.Research.Read'],
  'ui-ux-designer':       ['Glyphor.Design.Read', 'Glyphor.Figma.Read'],
  'frontend-engineer':    ['Glyphor.Design.Read', 'Glyphor.Code.Read', 'Glyphor.Code.Write'],
  'design-critic':        ['Glyphor.Design.Read', 'Glyphor.Figma.Read'],
  'template-architect':   ['Glyphor.Design.Read', 'Glyphor.Design.Write', 'Glyphor.Code.Read', 'Glyphor.Code.Write'],
  'ops':                  ['Glyphor.Ops.Read', 'Glyphor.Admin.Read'],
  'global-admin':         ['Glyphor.Admin.Read'],
  'head-of-hr':           ['Glyphor.Admin.Read'],
  'vp-research':          ['Glyphor.Research.Read', 'Glyphor.Product.Read'],
  'competitive-research-analyst': ['Glyphor.Research.Read'],
  'market-research-analyst':      ['Glyphor.Research.Read'],
  'technical-research-analyst':   ['Glyphor.Research.Read'],
  'industry-research-analyst':    ['Glyphor.Research.Read'],
  'ai-impact-analyst':            ['Glyphor.Research.Read'],
  'org-analyst':                  ['Glyphor.Research.Read'],
  'enterprise-account-researcher':['Glyphor.Research.Read'],
  'bob-the-tax-pro':              ['Glyphor.Finance.Revenue.Read'],
  'data-integrity-auditor':       ['Glyphor.Admin.Read'],
  'tax-strategy-specialist':      ['Glyphor.Finance.Revenue.Read'],
  'lead-gen-specialist':          ['Glyphor.Research.Read'],
  'marketing-intelligence-analyst':['Glyphor.Marketing.Read', 'Glyphor.Research.Read'],
  'adi-rose':                     ['Glyphor.Admin.Read', 'Glyphor.Ops.Read'],
};

function az(cmd) {
  try {
    const result = execSync(`az ${cmd}`, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
    return result.trim() ? JSON.parse(result) : null;
  } catch (err) {
    console.error(`  ✗ az ${cmd.substring(0, 80)}...`);
    console.error(`    ${err.stderr?.substring(0, 200) || err.message}`);
    return null;
  }
}

function azRaw(cmd) {
  try {
    return execSync(`az ${cmd}`, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }).trim();
  } catch (err) {
    console.error(`  ✗ az ${cmd.substring(0, 80)}...`);
    return '';
  }
}

async function main() {
  console.log('=== Glyphor Agent Identity Provisioner ===\n');

  // 1. Get blueprint app role definitions
  console.log('1. Fetching blueprint app roles...');
  const appRoles = az(`ad app show --id ${BLUEPRINT_APP_ID} --query "appRoles[].{id:id, value:value}" -o json`);
  if (!appRoles || appRoles.length === 0) {
    console.error('No app roles found on blueprint app. Run the role creation first.');
    process.exit(1);
  }
  const roleMap = {};
  for (const r of appRoles) {
    roleMap[r.value] = r.id;
  }
  console.log(`   Found ${Object.keys(roleMap).length} app roles\n`);

  // 2. Process each agent
  const identityMap = {};
  const agents = Object.entries(AGENTS);
  let created = 0, updated = 0, failed = 0;

  for (let i = 0; i < agents.length; i++) {
    const [role, displayName] = agents[i];
    const progress = `[${i + 1}/${agents.length}]`;
    process.stdout.write(`${progress} ${role}... `);

    // Check if app registration already exists
    const existing = az(`ad app list --display-name "${displayName}" --query "[0].{appId:appId, id:id}" -o json`);

    let appId, objectId;

    if (existing && existing.appId) {
      appId = existing.appId;
      objectId = existing.id;
      process.stdout.write('exists, ');
      updated++;
    } else {
      // Create new app registration
      const newApp = az(`ad app create --display-name "${displayName}" --sign-in-audience AzureADMyOrg --query "{appId:appId, id:id}" -o json`);
      if (!newApp) {
        console.log('FAILED (create)');
        failed++;
        continue;
      }
      appId = newApp.appId;
      objectId = newApp.id;
      process.stdout.write('created, ');
      created++;
    }

    // Ensure service principal exists
    let spId;
    const existingSp = az(`ad sp show --id ${appId} --query "id" -o json 2>nul`);
    if (existingSp) {
      spId = existingSp;
    } else {
      const newSp = az(`ad sp create --id ${appId} --query "id" -o json`);
      if (newSp) {
        spId = newSp;
        process.stdout.write('SP created, ');
      } else {
        console.log('FAILED (SP)');
        failed++;
        identityMap[role] = { appId, objectId, spId: null, roles: [] };
        continue;
      }
    }

    // Assign app roles
    const roleValues = ROLE_ASSIGNMENTS[role] || [];
    let assigned = 0;
    for (const roleValue of roleValues) {
      const roleId = roleMap[roleValue];
      if (!roleId) {
        console.error(`\n  ✗ Unknown role: ${roleValue}`);
        continue;
      }

      // Check if already assigned
      const body = JSON.stringify({
        principalId: spId,
        resourceId: BLUEPRINT_SP_ID,
        appRoleId: roleId
      }).replace(/"/g, '\\"');

      const assignResult = azRaw(
        `rest --method POST --url "https://graph.microsoft.com/v1.0/servicePrincipals/${spId}/appRoleAssignments" --body "${body}" --headers "Content-Type=application/json" -o json 2>&1`
      );

      if (assignResult.includes('Permission being assigned already exists') || assignResult.includes('"id"')) {
        assigned++;
      }
    }

    console.log(`${assigned}/${roleValues.length} roles`);

    identityMap[role] = {
      appId,
      objectId,
      spId,
      displayName,
      roles: roleValues,
    };
  }

  console.log(`\n=== Summary ===`);
  console.log(`Created: ${created}, Updated: ${updated}, Failed: ${failed}`);
  console.log(`Total: ${Object.keys(identityMap).length} agent identities\n`);

  // 3. Write identity map
  const outputPath = path.join(__dirname, '..', 'packages', 'agent-runtime', 'src', 'config', 'agentIdentities.json');
  fs.writeFileSync(outputPath, JSON.stringify(identityMap, null, 2));
  console.log(`Identity map written to: ${outputPath}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
