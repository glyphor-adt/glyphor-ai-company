import type { SupabaseClient } from '@supabase/supabase-js';
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

export async function syncSharePointKnowledge(
  supabase: SupabaseClient,
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

  const existingByItem = await loadExistingRows(supabase, siteId, driveId);
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
        await upsertIndexRow(supabase, {
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
        await touchIndexRow(supabase, item.id);
        result.skipped += 1;
        continue;
      }

      try {
        const text = await downloadTextContent(token, siteId, driveId, item.id);
        if (text.trim().length < 40) {
          await upsertIndexRow(supabase, {
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

        const knowledgeId = await saveKnowledgeEntry(supabase, {
          content: buildKnowledgeText(item.name, itemPath, item.webUrl ?? null, text),
          evidence: item.webUrl ?? null,
          tags: ['sharepoint', 'document', extension.replace('.', '')],
        });

        if (existing?.knowledge_id && existing.knowledge_id !== knowledgeId) {
          await markKnowledgeSuperseded(supabase, existing.knowledge_id, knowledgeId);
        }

        await upsertIndexRow(supabase, {
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
        await upsertIndexRow(supabase, {
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

  result.deleted = await markMissingAsDeleted(supabase, siteId, driveId, seen);
  return result;
}

async function getDefaultDriveId(token: string, siteId: string): Promise<string> {
  const response = await fetch(`${GRAPH_BASE}/sites/${encodeURIComponent(siteId)}/drive`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to load SharePoint default drive (${response.status}): ${body}`);
  }

  const data = (await response.json()) as { id: string };
  if (!data.id) throw new Error('SharePoint drive response did not include an id.');
  return data.id;
}

async function listChildren(
  token: string,
  siteId: string,
  driveId: string,
  itemId: string | null,
  rootPath: string | null,
): Promise<GraphDriveItem[]> {
  const encodedSite = encodeURIComponent(siteId);
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
  const url = `${GRAPH_BASE}/sites/${encodeURIComponent(siteId)}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/content`;
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
  supabase: SupabaseClient,
  input: { content: string; evidence: string | null; tags: string[] },
): Promise<string> {
  const { data, error } = await supabase
    .from('company_knowledge')
    .insert({
      knowledge_type: 'policy',
      content: input.content,
      evidence: input.evidence,
      discovered_by: 'sharepoint-sync',
      contributing_agents: ['m365-admin'],
      discovery_context: 'sharepoint_import',
      departments_affected: [],
      agents_who_need_this: [],
      confidence: 0.85,
      tags: input.tags,
      status: 'active',
    })
    .select('id')
    .single();

  if (error || !data?.id) {
    throw new Error(`Failed to insert company knowledge row: ${error?.message ?? 'unknown error'}`);
  }

  return data.id as string;
}

async function markKnowledgeSuperseded(
  supabase: SupabaseClient,
  previousKnowledgeId: string,
  replacementKnowledgeId: string,
): Promise<void> {
  await supabase
    .from('company_knowledge')
    .update({
      status: 'superseded',
      superseded_by: replacementKnowledgeId,
      last_validated_at: new Date().toISOString(),
    })
    .eq('id', previousKnowledgeId)
    .eq('status', 'active');
}

async function loadExistingRows(
  supabase: SupabaseClient,
  siteId: string,
  driveId: string,
): Promise<Map<string, ExistingIndexRow>> {
  const { data, error } = await supabase
    .from('sharepoint_document_index')
    .select('drive_item_id, etag, knowledge_id')
    .eq('site_id', siteId)
    .eq('drive_id', driveId)
    .neq('status', 'deleted');

  if (error) {
    throw new Error(`Failed to load SharePoint index rows: ${error.message}`);
  }

  return new Map((data ?? []).map((row) => [row.drive_item_id as string, row as ExistingIndexRow]));
}

async function markMissingAsDeleted(
  supabase: SupabaseClient,
  siteId: string,
  driveId: string,
  seen: Set<string>,
): Promise<number> {
  const { data, error } = await supabase
    .from('sharepoint_document_index')
    .select('id, drive_item_id, knowledge_id, status')
    .eq('site_id', siteId)
    .eq('drive_id', driveId)
    .neq('status', 'deleted');

  if (error || !data?.length) return 0;

  const now = new Date().toISOString();
  let deleted = 0;

  for (const row of data) {
    const driveItemId = row.drive_item_id as string;
    if (seen.has(driveItemId)) continue;

    await supabase
      .from('sharepoint_document_index')
      .update({ status: 'deleted', updated_at: now, last_synced_at: now })
      .eq('id', row.id as string);

    const knowledgeId = row.knowledge_id as string | null;
    if (knowledgeId) {
      await supabase
        .from('company_knowledge')
        .update({ status: 'deprecated', last_validated_at: now })
        .eq('id', knowledgeId)
        .eq('status', 'active');
    }

    deleted += 1;
  }

  return deleted;
}

async function touchIndexRow(supabase: SupabaseClient, driveItemId: string): Promise<void> {
  await supabase
    .from('sharepoint_document_index')
    .update({ last_synced_at: new Date().toISOString(), status: 'active' })
    .eq('drive_item_id', driveItemId);
}

async function upsertIndexRow(
  supabase: SupabaseClient,
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
  const payload = {
    ...row,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('sharepoint_document_index')
    .upsert(payload, { onConflict: 'site_id,drive_id,drive_item_id' });

  if (error) {
    throw new Error(`Failed to upsert SharePoint index row: ${error.message}`);
  }
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
