import { systemQuery } from '@glyphor/shared/db';
import { createHash } from 'node:crypto';
import { getM365Token } from '../credentials/m365Router.js';

interface GraphDriveItem {
  id: string;
  name: string;
  webUrl?: string;
  eTag?: string;
  file?: { mimeType?: string };
  folder?: { childCount?: number };
  parentReference?: { path?: string };
  lastModifiedDateTime?: string;
}

interface GraphListResponse {
  value: GraphDriveItem[];
  '@odata.nextLink'?: string;
}

interface ExistingIndexRow {
  drive_item_id: string;
  etag: string | null;
  knowledge_id: string | null;
}

export interface SharePointSyncOptions {
  siteId?: string;
  driveId?: string;
  rootFolder?: string;
  maxFiles?: number;
}

export interface SharePointSyncResult {
  scanned: number;
  updated: number;
  skipped: number;
  unsupported: number;
  deleted: number;
  errors: number;
}

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const SUPPORTED_EXTENSIONS = new Set(['.md', '.txt']);

/** Encode a Graph API site ID preserving commas (hostname,siteId,webId format). */
function encodeSiteId(siteId: string): string {
  return siteId.split(',').map(encodeURIComponent).join(',');
}

export async function syncSharePointKnowledge(
  options?: SharePointSyncOptions,
): Promise<SharePointSyncResult> {
  const siteId = options?.siteId ?? process.env.SHAREPOINT_SITE_ID;
  if (!siteId) {
    throw new Error('Missing SHAREPOINT_SITE_ID for SharePoint knowledge sync.');
  }

  const rootFolder = options?.rootFolder ?? process.env.SHAREPOINT_ROOT_FOLDER ?? 'Company-Agent-Knowledge';
  const maxFiles = options?.maxFiles ?? parseInt(process.env.SHAREPOINT_MAX_FILES ?? '300', 10);

  const token = await getM365Token('read_sharepoint');
  const driveId = options?.driveId ?? process.env.SHAREPOINT_DRIVE_ID ?? await getDefaultDriveId(token, siteId);

  const result: SharePointSyncResult = {
    scanned: 0,
    updated: 0,
    skipped: 0,
    unsupported: 0,
    deleted: 0,
    errors: 0,
  };

  const existingByItem = await loadExistingRows(siteId, driveId);
  const seen = new Set<string>();

  const queue: Array<{ itemId: string | null; path: string | null }> = [{ itemId: null, path: rootFolder }];

  while (queue.length > 0 && result.scanned < maxFiles) {
    const current = queue.shift()!;
    const children = await listChildren(token, siteId, driveId, current.itemId, current.path);

    for (const item of children) {
      if (result.scanned >= maxFiles) break;

      if (item.folder) {
        queue.push({ itemId: item.id, path: null });
        continue;
      }

      result.scanned += 1;
      seen.add(item.id);

      const extension = getExtension(item.name);
      const folderPath = normalizeParentPath(item.parentReference?.path);
      const itemPath = folderPath ? `${folderPath}/${item.name}` : item.name;

      if (!SUPPORTED_EXTENSIONS.has(extension)) {
        await upsertIndexRow({
          site_id: siteId,
          drive_id: driveId,
          drive_item_id: item.id,
          name: item.name,
          path: itemPath,
          web_url: item.webUrl ?? null,
          etag: item.eTag ?? null,
          mime_type: item.file?.mimeType ?? null,
          last_modified_at: item.lastModifiedDateTime ?? null,
          status: 'unsupported',
          last_synced_at: new Date().toISOString(),
          error_text: null,
          knowledge_id: existingByItem.get(item.id)?.knowledge_id ?? null,
          metadata: { extension },
        });
        result.unsupported += 1;
        continue;
      }

      const existing = existingByItem.get(item.id);
      if (existing?.etag && item.eTag && existing.etag === item.eTag) {
        await touchIndexRow(item.id);
        result.skipped += 1;
        continue;
      }

      try {
        const text = await downloadTextContent(token, siteId, driveId, item.id);
        if (text.trim().length < 40) {
          await upsertIndexRow({
            site_id: siteId,
            drive_id: driveId,
            drive_item_id: item.id,
            name: item.name,
            path: itemPath,
            web_url: item.webUrl ?? null,
            etag: item.eTag ?? null,
            mime_type: item.file?.mimeType ?? null,
            last_modified_at: item.lastModifiedDateTime ?? null,
            status: 'unsupported',
            last_synced_at: new Date().toISOString(),
            error_text: 'File content too short for ingestion.',
            knowledge_id: existing?.knowledge_id ?? null,
            metadata: { extension },
          });
          result.unsupported += 1;
          continue;
        }

        const knowledgeId = await saveKnowledgeEntry({
          content: buildKnowledgeText(item.name, itemPath, item.webUrl ?? null, text),
          evidence: item.webUrl ?? null,
          tags: ['sharepoint', 'document', extension.replace('.', '')],
        });

        if (existing?.knowledge_id && existing.knowledge_id !== knowledgeId) {
          await markKnowledgeSuperseded(existing.knowledge_id, knowledgeId);
        }

        await upsertIndexRow({
          site_id: siteId,
          drive_id: driveId,
          drive_item_id: item.id,
          name: item.name,
          path: itemPath,
          web_url: item.webUrl ?? null,
          etag: item.eTag ?? null,
          mime_type: item.file?.mimeType ?? null,
          content_hash: hashText(text),
          last_modified_at: item.lastModifiedDateTime ?? null,
          status: 'active',
          last_synced_at: new Date().toISOString(),
          error_text: null,
          knowledge_id: knowledgeId,
          metadata: { extension },
        });

        result.updated += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await upsertIndexRow({
          site_id: siteId,
          drive_id: driveId,
          drive_item_id: item.id,
          name: item.name,
          path: itemPath,
          web_url: item.webUrl ?? null,
          etag: item.eTag ?? null,
          mime_type: item.file?.mimeType ?? null,
          last_modified_at: item.lastModifiedDateTime ?? null,
          status: 'error',
          last_synced_at: new Date().toISOString(),
          error_text: message,
          knowledge_id: existing?.knowledge_id ?? null,
          metadata: { extension },
        });
        result.errors += 1;
      }
    }
  }

  result.deleted = await markMissingAsDeleted(siteId, driveId, seen);
  return result;
}

async function getDefaultDriveId(token: string, siteId: string): Promise<string> {
  // Try the standard comma-separated format first (hostname,siteGuid,webGuid)
  const primaryUrl = `${GRAPH_BASE}/sites/${encodeSiteId(siteId)}/drive`;
  const response = await fetch(primaryUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.ok) {
    const data = (await response.json()) as { id: string };
    if (data.id) return data.id;
  }

  // Fallback: try as hostname:/sites/path format (e.g. "glyphorai.sharepoint.com/sites/glyphor-knowledge")
  const cleaned = siteId.replace(/^https?:\/\//, '');
  if (cleaned.includes('/sites/')) {
    const [hostname, ...rest] = cleaned.split('/sites/');
    const sitePath = rest.join('/sites/');
    const fallbackUrl = `${GRAPH_BASE}/sites/${encodeURIComponent(hostname)}:/sites/${encodeURIComponent(sitePath)}:/drive`;
    const fallbackRes = await fetch(fallbackUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (fallbackRes.ok) {
      const data = (await fallbackRes.json()) as { id: string };
      if (data.id) return data.id;
    }
  }

  // Fallback: try as just a site hostname (resolve root site drive)
  if (!siteId.includes(',') && !siteId.includes('/')) {
    const rootUrl = `${GRAPH_BASE}/sites/${encodeURIComponent(siteId)}/drive`;
    const rootRes = await fetch(rootUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (rootRes.ok) {
      const data = (await rootRes.json()) as { id: string };
      if (data.id) return data.id;
    }
  }

  throw new Error(
    `Failed to resolve SharePoint drive. SHAREPOINT_SITE_ID="${siteId}" did not resolve. ` +
    `Expected format: "hostname,siteCollectionGuid,webGuid" (e.g. "contoso.sharepoint.com,guid1,guid2"). ` +
    `Set SHAREPOINT_DRIVE_ID directly to bypass this lookup.`,
  );
}

async function listChildren(
  token: string,
  siteId: string,
  driveId: string,
  itemId: string | null,
  rootPath: string | null,
): Promise<GraphDriveItem[]> {
  const encodedSite = encodeSiteId(siteId);
  const encodedDrive = encodeURIComponent(driveId);

  const select = '$select=id,name,webUrl,eTag,file,folder,parentReference,lastModifiedDateTime';
  const baseUrl = itemId
    ? `${GRAPH_BASE}/sites/${encodedSite}/drives/${encodedDrive}/items/${encodeURIComponent(itemId)}/children?${select}`
    : buildRootChildrenUrl(encodedSite, encodedDrive, rootPath, select);

  const items: GraphDriveItem[] = [];
  let nextUrl: string | null = baseUrl;

  while (nextUrl) {
    const response = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Failed to list SharePoint children (${response.status}): ${body}`);
    }

    const data = (await response.json()) as GraphListResponse;
    items.push(...(data.value ?? []));
    nextUrl = data['@odata.nextLink'] ?? null;
  }

  return items;
}

async function downloadTextContent(
  token: string,
  siteId: string,
  driveId: string,
  itemId: string,
): Promise<string> {
  const url = `${GRAPH_BASE}/sites/${encodeSiteId(siteId)}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/content`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to download SharePoint content (${response.status}): ${body}`);
  }

  return response.text();
}

async function saveKnowledgeEntry(
  input: { content: string; evidence: string | null; tags: string[] },
): Promise<string> {
  const rows = await systemQuery<{ id: string }>(
    `INSERT INTO company_knowledge (knowledge_type, content, evidence, discovered_by, contributing_agents, discovery_context, departments_affected, agents_who_need_this, confidence, tags, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      'policy',
      input.content,
      input.evidence,
      'sharepoint-sync',
      JSON.stringify(['m365-admin']),
      'sharepoint_import',
      JSON.stringify([]),
      JSON.stringify([]),
      0.85,
      JSON.stringify(input.tags),
      'active',
    ],
  );

  if (!rows[0]?.id) {
    throw new Error('Failed to insert company knowledge row: no id returned');
  }

  return rows[0].id;
}

async function markKnowledgeSuperseded(
  previousKnowledgeId: string,
  replacementKnowledgeId: string,
): Promise<void> {
  await systemQuery(
    "UPDATE company_knowledge SET status = $1, superseded_by = $2, last_validated_at = $3 WHERE id = $4 AND status = 'active'",
    ['superseded', replacementKnowledgeId, new Date().toISOString(), previousKnowledgeId],
  );
}

async function loadExistingRows(
  siteId: string,
  driveId: string,
): Promise<Map<string, ExistingIndexRow>> {
  const data = await systemQuery<ExistingIndexRow>(
    "SELECT drive_item_id, etag, knowledge_id FROM sharepoint_document_index WHERE site_id = $1 AND drive_id = $2 AND status != 'deleted'",
    [siteId, driveId],
  );

  return new Map(data.map((row) => [row.drive_item_id, row]));
}

async function markMissingAsDeleted(
  siteId: string,
  driveId: string,
  seen: Set<string>,
): Promise<number> {
  const data = await systemQuery<{ id: string; drive_item_id: string; knowledge_id: string | null; status: string }>(
    "SELECT id, drive_item_id, knowledge_id, status FROM sharepoint_document_index WHERE site_id = $1 AND drive_id = $2 AND status != 'deleted'",
    [siteId, driveId],
  );

  if (!data.length) return 0;

  const now = new Date().toISOString();
  let deleted = 0;

  for (const row of data) {
    if (seen.has(row.drive_item_id)) continue;

    await systemQuery(
      'UPDATE sharepoint_document_index SET status = $1, updated_at = $2, last_synced_at = $3 WHERE id = $4',
      ['deleted', now, now, row.id],
    );

    if (row.knowledge_id) {
      await systemQuery(
        "UPDATE company_knowledge SET status = $1, last_validated_at = $2 WHERE id = $3 AND status = 'active'",
        ['deprecated', now, row.knowledge_id],
      );
    }

    deleted += 1;
  }

  return deleted;
}

async function touchIndexRow(driveItemId: string): Promise<void> {
  await systemQuery(
    "UPDATE sharepoint_document_index SET last_synced_at = $1, status = 'active' WHERE drive_item_id = $2",
    [new Date().toISOString(), driveItemId],
  );
}

async function upsertIndexRow(
  row: {
    site_id: string;
    drive_id: string;
    drive_item_id: string;
    name: string;
    path: string;
    web_url: string | null;
    etag: string | null;
    mime_type: string | null;
    content_hash?: string;
    last_modified_at: string | null;
    last_synced_at: string;
    status: 'active' | 'deleted' | 'error' | 'unsupported';
    error_text: string | null;
    knowledge_id: string | null;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  const now = new Date().toISOString();

  await systemQuery(
    `INSERT INTO sharepoint_document_index (site_id, drive_id, drive_item_id, name, path, web_url, etag, mime_type, content_hash, last_modified_at, last_synced_at, status, error_text, knowledge_id, metadata, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     ON CONFLICT (site_id, drive_id, drive_item_id) DO UPDATE SET
       name = $4, path = $5, web_url = $6, etag = $7, mime_type = $8, content_hash = $9,
       last_modified_at = $10, last_synced_at = $11, status = $12, error_text = $13,
       knowledge_id = $14, metadata = $15, updated_at = $16`,
    [
      row.site_id, row.drive_id, row.drive_item_id, row.name, row.path,
      row.web_url, row.etag, row.mime_type, row.content_hash ?? null,
      row.last_modified_at, row.last_synced_at, row.status, row.error_text,
      row.knowledge_id, JSON.stringify(row.metadata), now,
    ],
  );
}

function getExtension(fileName: string): string {
  const i = fileName.lastIndexOf('.');
  return i >= 0 ? fileName.slice(i).toLowerCase() : '';
}

function buildRootChildrenUrl(
  encodedSite: string,
  encodedDrive: string,
  rootPath: string | null,
  select: string,
): string {
  const cleaned = (rootPath ?? '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
  if (!cleaned) {
    return `${GRAPH_BASE}/sites/${encodedSite}/drives/${encodedDrive}/root/children?${select}`;
  }

  const encodedPath = cleaned
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  return `${GRAPH_BASE}/sites/${encodedSite}/drives/${encodedDrive}/root:/${encodedPath}:/children?${select}`;
}

function normalizeParentPath(path: string | undefined): string {
  if (!path) return '';
  const marker = '/root:';
  const markerIndex = path.indexOf(marker);
  if (markerIndex === -1) return path;
  const relative = path.slice(markerIndex + marker.length);
  return relative.replace(/^\/+/, '').replace(/\/+$/, '');
}

function buildKnowledgeText(
  fileName: string,
  path: string,
  webUrl: string | null,
  body: string,
): string {
  const clipped = body.trim().slice(0, 14_000);
  const sourceLine = webUrl ? `Source: ${webUrl}` : `Path: ${path}`;
  return `# SharePoint Document: ${fileName}\n\n${sourceLine}\n\n${clipped}`;
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/* ─── Upload & Search ─────────────────────────────────────────── */

export interface SharePointUploadOptions {
  siteId?: string;
  driveId?: string;
  folder?: string;
}

export interface SharePointSearchOptions {
  siteId?: string;
  driveId?: string;
  maxResults?: number;
}

export interface SharePointDocument {
  id: string;
  name: string;
  path: string;
  webUrl: string | null;
  lastModified: string | null;
  size?: number;
}

/**
 * Upload a markdown/text document to SharePoint and sync it to company_knowledge.
 */
export async function uploadToSharePoint(
  fileName: string,
  content: string,
  options?: SharePointUploadOptions,
): Promise<{ webUrl: string; knowledgeId: string }> {
  const siteId = options?.siteId ?? process.env.SHAREPOINT_SITE_ID;
  if (!siteId) throw new Error('Missing SHAREPOINT_SITE_ID');

  const token = await getM365Token('write_sharepoint');
  const driveId = options?.driveId ?? process.env.SHAREPOINT_DRIVE_ID ?? await getDefaultDriveId(token, siteId);

  const folder = options?.folder ?? process.env.SHAREPOINT_ROOT_FOLDER ?? 'Company-Agent-Knowledge';
  const safeName = fileName.replace(/[<>:"/\\|?*]/g, '-');
  const remotePath = folder ? `${folder}/${safeName}` : safeName;

  const encodedPath = remotePath.split('/').map(encodeURIComponent).join('/');
  const url = `${GRAPH_BASE}/sites/${encodeSiteId(siteId)}/drives/${encodeURIComponent(driveId)}/root:/${encodedPath}:/content`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'text/plain',
    },
    body: content,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to upload to SharePoint (${response.status}): ${text}`);
  }

  const item = (await response.json()) as GraphDriveItem;

  // Also insert into company_knowledge for immediate availability
  const knowledgeId = await saveKnowledgeEntry({
    content: buildKnowledgeText(safeName, remotePath, item.webUrl ?? null, content),
    evidence: item.webUrl ?? null,
    tags: ['sharepoint', 'document', getExtension(safeName).replace('.', '')],
  });

  await upsertIndexRow({
    site_id: siteId,
    drive_id: driveId,
    drive_item_id: item.id,
    name: safeName,
    path: remotePath,
    web_url: item.webUrl ?? null,
    etag: item.eTag ?? null,
    mime_type: item.file?.mimeType ?? null,
    content_hash: hashText(content),
    last_modified_at: item.lastModifiedDateTime ?? null,
    last_synced_at: new Date().toISOString(),
    status: 'active',
    error_text: null,
    knowledge_id: knowledgeId,
    metadata: { extension: getExtension(safeName), uploadedBy: 'agent' },
  });

  return { webUrl: item.webUrl ?? '', knowledgeId };
}

/**
 * Search SharePoint documents by keyword via Microsoft Graph Search API.
 */
export async function searchSharePoint(
  query: string,
  options?: SharePointSearchOptions,
): Promise<SharePointDocument[]> {
  const siteId = options?.siteId ?? process.env.SHAREPOINT_SITE_ID;
  if (!siteId) throw new Error('Missing SHAREPOINT_SITE_ID');

  const token = await getM365Token('search_sharepoint');
  const maxResults = options?.maxResults ?? 20;

  const searchUrl = `${GRAPH_BASE}/search/query`;
  // Region is required when using application permissions (client credentials)
  const region = (process.env.SHAREPOINT_REGION ?? 'NAM').trim();
  const response = await fetch(searchUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requests: [
        {
          entityTypes: ['driveItem'],
          query: { queryString: query },
          region,
          from: 0,
          size: maxResults,
        },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`SharePoint search failed (${response.status}): ${text}`);
  }

  const data: any = await response.json();
  const hits = data.value?.[0]?.hitsContainers?.[0]?.hits ?? [];

  return hits.map((hit: { resource: GraphDriveItem & { size?: number } }) => ({
    id: hit.resource.id,
    name: hit.resource.name,
    path: normalizeParentPath(hit.resource.parentReference?.path) + '/' + hit.resource.name,
    webUrl: hit.resource.webUrl ?? null,
    lastModified: hit.resource.lastModifiedDateTime ?? null,
    size: hit.resource.size,
  }));
}

/**
 * List all folders in the SharePoint knowledge root.
 */
export async function listSharePointFolders(
  options?: SharePointSearchOptions,
): Promise<string[]> {
  const siteId = options?.siteId ?? process.env.SHAREPOINT_SITE_ID;
  if (!siteId) throw new Error('Missing SHAREPOINT_SITE_ID');

  const token = await getM365Token('read_sharepoint');
  const driveId = options?.driveId ?? process.env.SHAREPOINT_DRIVE_ID ?? await getDefaultDriveId(token, siteId);
  const rootFolder = process.env.SHAREPOINT_ROOT_FOLDER ?? 'Company-Agent-Knowledge';

  const children = await listChildren(token, siteId, driveId, null, rootFolder);
  return children
    .filter((item) => item.folder)
    .map((item) => item.name);
}

/**
 * Read a specific document from SharePoint by path.
 */
export async function readSharePointDocument(
  filePath: string,
  options?: SharePointSearchOptions,
): Promise<{ content: string; webUrl: string | null; lastModified: string | null }> {
  const siteId = options?.siteId ?? process.env.SHAREPOINT_SITE_ID;
  if (!siteId) throw new Error('Missing SHAREPOINT_SITE_ID');

  const token = await getM365Token('read_sharepoint');
  const driveId = options?.driveId ?? process.env.SHAREPOINT_DRIVE_ID ?? await getDefaultDriveId(token, siteId);

  // Get item metadata
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
  const metaUrl = `${GRAPH_BASE}/sites/${encodeSiteId(siteId)}/drives/${encodeURIComponent(driveId)}/root:/${encodedPath}`;
  const metaRes = await fetch(metaUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!metaRes.ok) {
    throw new Error(`Document not found: ${filePath}`);
  }

  const meta = (await metaRes.json()) as GraphDriveItem;

  // Download content
  const content = await downloadTextContent(token, siteId, driveId, meta.id);

  return {
    content,
    webUrl: meta.webUrl ?? null,
    lastModified: meta.lastModifiedDateTime ?? null,
  };
}
