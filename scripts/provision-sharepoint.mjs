#!/usr/bin/env node

/**
 * Provision SharePoint Site for Glyphor Company Knowledge
 *
 * Creates a SharePoint site via Microsoft Graph API, sets up the
 * document library folder structure, and seeds it with existing
 * company knowledge files.
 *
 * Prerequisites:
 *   - AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET env vars
 *     (or AZURE_FILES_CLIENT_ID / AZURE_FILES_CLIENT_SECRET)
 *   - App registration needs: Sites.ReadWrite.All, Files.ReadWrite.All
 *
 * Usage:
 *   node scripts/provision-sharepoint.mjs
 *
 * Output:
 *   Prints SHAREPOINT_SITE_ID and SHAREPOINT_DRIVE_ID for env config.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, basename } from 'node:path';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const TENANT_ID = process.env.AZURE_TENANT_ID;
const CLIENT_ID = process.env.AZURE_FILES_CLIENT_ID ?? process.env.AZURE_CLIENT_ID;
const CLIENT_SECRET = process.env.AZURE_FILES_CLIENT_SECRET ?? process.env.AZURE_CLIENT_SECRET;

const SITE_DISPLAY_NAME = 'Glyphor Company Knowledge';
const SITE_ALIAS = 'glyphor-knowledge';
const SITE_DESCRIPTION = 'Central knowledge base for Glyphor AI agents and team. Syncs to Supabase company_knowledge and the organizational knowledge graph.';

const FOLDER_STRUCTURE = [
  'Company-Agent-Knowledge',
  'Company-Agent-Knowledge/Strategy',
  'Company-Agent-Knowledge/Products',
  'Company-Agent-Knowledge/Products/Pulse',
  'Company-Agent-Knowledge/Products/Fuse',
  'Company-Agent-Knowledge/Engineering',
  'Company-Agent-Knowledge/Finance',
  'Company-Agent-Knowledge/Marketing',
  'Company-Agent-Knowledge/Sales',
  'Company-Agent-Knowledge/Design',
  'Company-Agent-Knowledge/Operations',
  'Company-Agent-Knowledge/Research',
  'Company-Agent-Knowledge/Policies',
  'Company-Agent-Knowledge/Briefs',
  'Company-Agent-Knowledge/Meeting-Notes',
  'Company-Agent-Knowledge/Templates',
];

if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing required environment variables:');
  console.error('  AZURE_TENANT_ID, AZURE_CLIENT_ID (or AZURE_FILES_CLIENT_ID), AZURE_CLIENT_SECRET (or AZURE_FILES_CLIENT_SECRET)');
  process.exit(1);
}

async function getToken() {
  const url = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const res = await fetch(url, { method: 'POST', body });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token acquisition failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  return data.access_token;
}

async function graphGet(token, path) {
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function graphPost(token, path, body) {
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
    throw new Error(`POST ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function graphPut(token, url, content, contentType = 'text/plain') {
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': contentType,
    },
    body: content,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PUT failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function findExistingSite(token) {
  try {
    const data = await graphGet(token, `/sites?search=${encodeURIComponent(SITE_ALIAS)}`);
    const match = data.value?.find(
      (s) => s.name === SITE_ALIAS || s.displayName === SITE_DISPLAY_NAME,
    );
    return match ?? null;
  } catch {
    return null;
  }
}

async function createSiteViaGroup(token) {
  console.log(`Creating Microsoft 365 Group "${SITE_DISPLAY_NAME}"...`);

  const group = await graphPost(token, '/groups', {
    displayName: SITE_DISPLAY_NAME,
    description: SITE_DESCRIPTION,
    mailNickname: SITE_ALIAS,
    groupTypes: ['Unified'],
    mailEnabled: true,
    securityEnabled: false,
    visibility: 'Private',
  });

  console.log(`  Group created: ${group.id}`);

  // Wait for SharePoint site provisioning (can take 10-30 seconds)
  console.log('  Waiting for SharePoint site provisioning...');
  let site = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    await new Promise((r) => setTimeout(r, 5000));
    try {
      site = await graphGet(token, `/groups/${group.id}/sites/root`);
      if (site?.id) break;
    } catch {
      // Site not ready yet
    }
  }

  if (!site?.id) {
    throw new Error('SharePoint site did not provision within 60 seconds. Check Azure portal.');
  }

  return { groupId: group.id, site };
}

async function getDriveId(token, siteId) {
  const drive = await graphGet(token, `/sites/${encodeURIComponent(siteId)}/drive`);
  return drive.id;
}

async function createFolder(token, siteId, driveId, folderPath) {
  const segments = folderPath.split('/');
  let parentPath = '';

  for (const segment of segments) {
    const currentPath = parentPath ? `${parentPath}/${segment}` : segment;
    const encodedPath = currentPath.split('/').map(encodeURIComponent).join('/');

    try {
      // Check if folder exists
      await graphGet(
        token,
        `/sites/${encodeURIComponent(siteId)}/drives/${encodeURIComponent(driveId)}/root:/${encodedPath}`,
      );
    } catch {
      // Create folder
      const parentUrl = parentPath
        ? `/sites/${encodeURIComponent(siteId)}/drives/${encodeURIComponent(driveId)}/root:/${parentPath.split('/').map(encodeURIComponent).join('/')}:/children`
        : `/sites/${encodeURIComponent(siteId)}/drives/${encodeURIComponent(driveId)}/root/children`;

      await graphPost(token, parentUrl, {
        name: segment,
        folder: {},
        '@microsoft.graph.conflictBehavior': 'fail',
      });
    }

    parentPath = currentPath;
  }
}

async function uploadFile(token, siteId, driveId, remotePath, localPath) {
  const content = readFileSync(localPath, 'utf-8');
  const encodedPath = remotePath.split('/').map(encodeURIComponent).join('/');
  const url = `${GRAPH_BASE}/sites/${encodeURIComponent(siteId)}/drives/${encodeURIComponent(driveId)}/root:/${encodedPath}:/content`;

  const ext = extname(localPath).toLowerCase();
  const mimeType = ext === '.md' ? 'text/markdown' : 'text/plain';

  await graphPut(token, url, content, mimeType);
}

function collectSeedFiles(baseDir) {
  const files = [];
  const entries = readdirSync(baseDir);

  for (const entry of entries) {
    const fullPath = join(baseDir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      // Recurse into subdirectories
      const sub = readdirSync(fullPath);
      for (const subEntry of sub) {
        const subPath = join(fullPath, subEntry);
        if (statSync(subPath).isFile() && ['.md', '.txt'].includes(extname(subEntry).toLowerCase())) {
          files.push({
            localPath: subPath,
            remotePath: `Company-Agent-Knowledge/${entry}/${subEntry}`,
          });
        }
      }
    } else if (['.md', '.txt'].includes(extname(entry).toLowerCase())) {
      // Top-level knowledge files → Strategy folder
      files.push({
        localPath: fullPath,
        remotePath: `Company-Agent-Knowledge/Strategy/${entry}`,
      });
    }
  }

  return files;
}

async function main() {
  console.log('=== Glyphor SharePoint Knowledge Site Provisioning ===\n');

  const token = await getToken();
  console.log('Authenticated with Microsoft Graph.\n');

  // Step 1: Check for existing site
  let site = await findExistingSite(token);
  let groupId = null;

  if (site) {
    console.log(`Found existing site: ${site.displayName} (${site.id})`);
  } else {
    // Create via M365 group (auto-provisions SharePoint team site)
    const result = await createSiteViaGroup(token);
    site = result.site;
    groupId = result.groupId;
    console.log(`Site provisioned: ${site.displayName} (${site.id})\n`);
  }

  const siteId = site.id;
  const driveId = await getDriveId(token, siteId);
  console.log(`Drive ID: ${driveId}\n`);

  // Step 2: Create folder structure
  console.log('Creating folder structure...');
  for (const folder of FOLDER_STRUCTURE) {
    try {
      await createFolder(token, siteId, driveId, folder);
      console.log(`  ✓ ${folder}`);
    } catch (err) {
      if (err.message?.includes('nameAlreadyExists') || err.message?.includes('409')) {
        console.log(`  · ${folder} (exists)`);
      } else {
        console.warn(`  ✗ ${folder}: ${err.message}`);
      }
    }
  }

  // Step 3: Seed with existing company knowledge files
  const knowledgeDir = join(import.meta.dirname, '..', 'packages', 'company-knowledge');
  console.log(`\nSeeding documents from ${knowledgeDir}...`);

  const seedFiles = collectSeedFiles(knowledgeDir);

  for (const file of seedFiles) {
    try {
      await uploadFile(token, siteId, driveId, file.remotePath, file.localPath);
      console.log(`  ✓ ${file.remotePath}`);
    } catch (err) {
      console.warn(`  ✗ ${file.remotePath}: ${err.message}`);
    }
  }

  // Step 4: Upload docs/ folder content
  const docsDir = join(import.meta.dirname, '..', 'docs');
  console.log(`\nSeeding reference docs from ${docsDir}...`);

  try {
    const docFiles = readdirSync(docsDir)
      .filter((f) => extname(f).toLowerCase() === '.md')
      .map((f) => ({
        localPath: join(docsDir, f),
        remotePath: `Company-Agent-Knowledge/Operations/${f}`,
      }));

    for (const file of docFiles) {
      try {
        await uploadFile(token, siteId, driveId, file.remotePath, file.localPath);
        console.log(`  ✓ ${file.remotePath}`);
      } catch (err) {
        console.warn(`  ✗ ${file.remotePath}: ${err.message}`);
      }
    }
  } catch {
    console.log('  (docs/ directory not found, skipping)');
  }

  // Output configuration
  console.log('\n' + '='.repeat(60));
  console.log('SharePoint site provisioned successfully!\n');
  console.log('Add these environment variables to your Cloud Run service:\n');
  console.log(`  SHAREPOINT_SITE_ID=${siteId}`);
  console.log(`  SHAREPOINT_DRIVE_ID=${driveId}`);
  console.log(`  SHAREPOINT_ROOT_FOLDER=Company-Agent-Knowledge`);
  if (groupId) {
    console.log(`  SHAREPOINT_GROUP_ID=${groupId}`);
  }
  console.log(`\nSite URL: ${site.webUrl}`);
  console.log('='.repeat(60));

  // Also print a summary JSON for scripting
  const summary = {
    siteId,
    driveId,
    groupId,
    webUrl: site.webUrl,
    rootFolder: 'Company-Agent-Knowledge',
    foldersCreated: FOLDER_STRUCTURE.length,
    documentsSeeded: seedFiles.length,
  };
  console.log('\n' + JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error('\nProvisioning failed:', err.message);
  process.exit(1);
});
