import { systemQuery } from '@glyphor/shared/db';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { getM365Token, type M365Operation } from '../credentials/m365Router.js';
import { getAgenticGraphToken } from '../agent365/index.js';
import { logMicrosoftWriteAudit } from '../audit.js';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, TabStopType, TabStopPosition, BorderStyle,
  Table, TableRow, TableCell, WidthType, convertInchesToTwip,
  Header, Footer, PageNumber, NumberFormat,
} from 'docx';

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

/**
 * Encode a Graph API drive ID for use in URL paths.
 * Unlike encodeURIComponent, this preserves `!` which is a sub-delimiter
 * safe in URL paths (RFC 3986) and required by Graph API drive IDs (e.g. `b!xxx`).
 */
function encodeDriveId(driveId: string): string {
  return encodeURIComponent(driveId).replace(/%21/g, '!');
}

type SharePointGraphOperation = Extract<
  M365Operation,
  'read_sharepoint' | 'write_sharepoint' | 'search_sharepoint'
>;

export interface ResolvedSharePointGraphToken {
  token: string;
  identityType: 'agent365' | 'app-only-graph';
  /** True when Agent365 was on and we used app-only after agentic failed. */
  fallbackUsed: boolean;
  agentRole?: string;
}

/**
 * Resolve Microsoft Graph tokens for SharePoint operations.
 *
 * - **Agent runs** (`agentRole` set): **Agent365 agentic user token only** — no AZURE_FILES fallback.
 * - **System jobs** (no `agentRole`, e.g. scheduled knowledge sync): app-only `AZURE_FILES` via {@link getM365Token}.
 */
export async function resolveSharePointGraphToken(
  operation: SharePointGraphOperation,
  agentRole?: string,
): Promise<ResolvedSharePointGraphToken> {
  if (!agentRole?.trim()) {
    return {
      token: await getM365Token(operation),
      identityType: 'app-only-graph',
      fallbackUsed: false,
    };
  }

  const role = agentRole.trim();
  const agenticToken = await getAgenticGraphToken(role);
  if (!agenticToken) {
    throw new Error(
      `SharePoint ${operation} requires an Agent365 Graph token for "${role}". `
      + 'Set AGENT365_ENABLED=true with AGENT365_CLIENT_ID / AGENT365_CLIENT_SECRET / AGENT365_TENANT_ID, '
      + 'and ensure agentIdentities.json (or AGENT365_APP_INSTANCE_ID + AGENT365_AGENTIC_USER_ID) '
      + 'defines blueprintSpId and entraUserId for this role.',
    );
  }

  console.log(`[SharePoint] Using agentic user token for ${operation} (${role})`);
  return {
    token: agenticToken,
    identityType: 'agent365',
    fallbackUsed: false,
    agentRole: role,
  };
}

export async function syncSharePointKnowledge(
  options?: SharePointSyncOptions,
): Promise<SharePointSyncResult> {
  const siteId = (options?.siteId ?? process.env.SHAREPOINT_SITE_ID ?? '').trim();
  if (!siteId) {
    throw new Error('Missing SHAREPOINT_SITE_ID for SharePoint knowledge sync.');
  }

  const rootFolder = (options?.rootFolder ?? process.env.SHAREPOINT_ROOT_FOLDER ?? 'Company-Agent-Knowledge').trim();
  const maxFiles = options?.maxFiles ?? parseInt(process.env.SHAREPOINT_MAX_FILES ?? '300', 10);

  const token = await getM365Token('read_sharepoint');
  const driveId = (options?.driveId ?? process.env.SHAREPOINT_DRIVE_ID ?? await getDefaultDriveId(token, siteId)).trim();

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
  const encodedDrive = encodeDriveId(driveId);

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

/** Strip HTML to plain text. */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<td[^>]*>/gi, '\t')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Download Office documents (docx, pptx, xlsx) as readable text via Graph API.
 * Tries HTML conversion first, then PDF conversion, then raw binary text extraction.
 */
async function downloadOfficeAsText(
  token: string,
  siteId: string,
  driveId: string,
  itemId: string,
  fileName: string,
): Promise<string> {
  const site = encodeSiteId(siteId);
  const drive = encodeDriveId(driveId);
  const item = encodeURIComponent(itemId);
  const baseUrl = `${GRAPH_BASE}/sites/${site}/drives/${drive}/items/${item}`;

  // Strategy 1: HTML conversion (works for most Office docs)
  const htmlRes = await fetch(`${baseUrl}/content?format=html`, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'follow',
  });
  if (htmlRes.ok) {
    return htmlToPlainText(await htmlRes.text());
  }

  // Strategy 2: PDF conversion — Graph can convert Office docs to PDF even when
  // HTML conversion fails (406). Download the PDF and extract text heuristically.
  const pdfRes = await fetch(`${baseUrl}/content?format=pdf`, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'follow',
  });
  if (pdfRes.ok) {
    const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
    const text = extractTextFromPdf(pdfBuffer);
    if (text.length > 50) return text;
  }

  // Strategy 3: Download the raw .docx (it's a ZIP containing XML) and
  // extract text from the document.xml entry.
  const rawRes = await fetch(`${baseUrl}/content`, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'follow',
  });
  if (rawRes.ok) {
    const buf = Buffer.from(await rawRes.arrayBuffer());
    const text = extractTextFromDocx(buf);
    if (text.length > 20) return text;
  }

  throw new Error(
    `Cannot read ${fileName} — all conversion strategies failed (HTML ${htmlRes.status}, PDF ${pdfRes.status}). ` +
    `Upload this file as .md or .pdf to the Design/ folder for agents to read it.`,
  );
}

/**
 * Heuristic text extraction from a PDF buffer.
 * Pulls readable ASCII/UTF-8 text streams — not a full parser but good enough
 * for most text-heavy Office-converted PDFs.
 */
function extractTextFromPdf(buffer: Buffer): string {
  const raw = buffer.toString('latin1');
  const textChunks: string[] = [];

  // Extract text between BT (begin text) and ET (end text) operators
  const btEtRegex = /BT\s([\s\S]*?)ET/g;
  let match: RegExpExecArray | null;
  while ((match = btEtRegex.exec(raw)) !== null) {
    const block = match[1];
    // Extract Tj and TJ string operands
    const tjRegex = /\(([^)]*)\)\s*Tj/g;
    let tj: RegExpExecArray | null;
    while ((tj = tjRegex.exec(block)) !== null) {
      textChunks.push(tj[1]);
    }
    // TJ arrays: [(text) kerning (text) ...]
    const tjArrayRegex = /\[((?:\([^)]*\)|[^[\]])*)\]\s*TJ/gi;
    let tja: RegExpExecArray | null;
    while ((tja = tjArrayRegex.exec(block)) !== null) {
      const inner = tja[1];
      const parts = inner.match(/\(([^)]*)\)/g);
      if (parts) {
        textChunks.push(parts.map(p => p.slice(1, -1)).join(''));
      }
    }
  }

  return textChunks
    .join(' ')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\s{3,}/g, '\n\n')
    .trim();
}

/**
 * Extract text from a raw .docx buffer by parsing the ZIP to find word/document.xml
 * and extracting text from <w:t> tags.
 */
function extractTextFromDocx(buffer: Buffer): string {
  // Parse the ZIP central directory to find word/document.xml
  const xml = extractFileFromZip(buffer, 'word/document.xml');
  if (!xml) {
    // Fallback: try reading the buffer as utf-8 and strip XML tags
    const raw = buffer.toString('utf-8');
    const noTags = raw.replace(/<[^>]+>/g, ' ').replace(/[^\x20-\x7E\n\r\t]/g, '');
    const words = noTags.split(/\s+/).filter(w => w.length > 1 && /[a-zA-Z]/.test(w));
    return words.join(' ').slice(0, 15_000).trim();
  }

  const textParts: string[] = [];
  const xmlStr = xml.toString('utf-8');

  // Extract text from <w:t> and <w:t xml:space="preserve"> tags
  const wtRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
  let match: RegExpExecArray | null;
  while ((match = wtRegex.exec(xmlStr)) !== null) {
    textParts.push(match[1]);
  }

  // Detect paragraph breaks from </w:p> to add newlines
  const paragraphs: string[] = [];
  const parRegex = /<w:p[\s>][\s\S]*?<\/w:p>/g;
  let parMatch: RegExpExecArray | null;
  while ((parMatch = parRegex.exec(xmlStr)) !== null) {
    const parText: string[] = [];
    const innerWt = /<w:t[^>]*>([^<]*)<\/w:t>/g;
    let wt: RegExpExecArray | null;
    while ((wt = innerWt.exec(parMatch[0])) !== null) {
      parText.push(wt[1]);
    }
    if (parText.length > 0) {
      paragraphs.push(parText.join(''));
    }
  }

  const result = paragraphs.length > 0
    ? paragraphs.join('\n')
    : textParts.join('');

  return result.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Extract a file entry from a ZIP buffer by parsing local file headers.
 * Uses Node.js built-in zlib for DEFLATE decompression.
 */
function extractFileFromZip(zipBuffer: Buffer, targetPath: string): Buffer | null {
  let offset = 0;
  const LOCAL_FILE_HEADER_SIG = 0x04034b50;

  while (offset + 30 <= zipBuffer.length) {
    const sig = zipBuffer.readUInt32LE(offset);
    if (sig !== LOCAL_FILE_HEADER_SIG) break;

    const compressionMethod = zipBuffer.readUInt16LE(offset + 8);
    const compressedSize = zipBuffer.readUInt32LE(offset + 18);
    const uncompressedSize = zipBuffer.readUInt32LE(offset + 22);
    const fileNameLen = zipBuffer.readUInt16LE(offset + 26);
    const extraFieldLen = zipBuffer.readUInt16LE(offset + 28);

    const fileNameStart = offset + 30;
    const fileName = zipBuffer.toString('utf-8', fileNameStart, fileNameStart + fileNameLen);
    const dataStart = fileNameStart + fileNameLen + extraFieldLen;

    if (fileName === targetPath && compressedSize > 0) {
      const compressedData = zipBuffer.subarray(dataStart, dataStart + compressedSize);

      if (compressionMethod === 0) {
        // Stored (no compression)
        return compressedData;
      } else if (compressionMethod === 8) {
        // DEFLATE
        try {
          return inflateRawSync(compressedData);
        } catch {
          return null;
        }
      }
      return null;
    }

    offset = dataStart + compressedSize;
  }

  return null;
}

async function downloadTextContent(
  token: string,
  siteId: string,
  driveId: string,
  itemId: string,
): Promise<string> {
  const url = `${GRAPH_BASE}/sites/${encodeSiteId(siteId)}/drives/${encodeDriveId(driveId)}/items/${encodeURIComponent(itemId)}/content`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to download SharePoint content (${response.status}): ${body}`);
  }

  return response.text();
}

async function downloadPdfAsText(
  token: string,
  siteId: string,
  driveId: string,
  itemId: string,
  fileName: string,
): Promise<string> {
  const url = `${GRAPH_BASE}/sites/${encodeSiteId(siteId)}/drives/${encodeDriveId(driveId)}/items/${encodeURIComponent(itemId)}/content`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'follow',
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to download SharePoint PDF (${response.status}): ${body}`);
  }

  const pdfBuffer = Buffer.from(await response.arrayBuffer());
  const text = extractTextFromPdf(pdfBuffer);
  if (text.length > 20) {
    return text;
  }

  throw new Error(`Cannot extract readable text from PDF: ${fileName}`);
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
      ['m365-admin'],
      'sharepoint_import',
      [],
      [],
      0.85,
      input.tags,
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

/**
 * Convert markdown/plain-text content to a proper .docx buffer.
 * Handles headings (# / ## / ###), bold (**), italic (*), bullet lists (- / *),
 * and numbered lists (1.). Produces valid Office Open XML that Word can open.
 */
/** Default font used when no legal styling is requested. */
const DEFAULT_FONT = 'Calibri';
const DEFAULT_FONT_SIZE = 22; // half-points → 11pt

/** Legal document font settings. */
const LEGAL_FONT = 'Times New Roman';
const LEGAL_FONT_SIZE = 24; // half-points → 12pt
const LEGAL_HEADING_SIZE = 28; // 14pt

export interface DocxConvertOptions {
  /** Use legal-document styling (Times New Roman, 1″ margins, signature blocks). */
  legalFormatting?: boolean;
  /** Document title for header/footer. */
  title?: string;
  /** Add "CONFIDENTIAL" header. */
  confidential?: boolean;
}

async function markdownToDocx(markdown: string, opts?: DocxConvertOptions): Promise<Buffer> {
  const legal = opts?.legalFormatting ?? false;
  const font = legal ? LEGAL_FONT : DEFAULT_FONT;
  const fontSize = legal ? LEGAL_FONT_SIZE : DEFAULT_FONT_SIZE;
  const headingSize = legal ? LEGAL_HEADING_SIZE : 28;

  const lines = markdown.split('\n');
  const children: (Paragraph | Table)[] = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trimEnd();

    // Blank line → spacing paragraph
    if (!line.trim()) {
      children.push(new Paragraph({ spacing: { after: legal ? 120 : 0 } }));
      i++;
      continue;
    }

    // Horizontal rule → signature line (--- or ___)
    if (/^(\s*[-_]{3,}\s*)$/.test(line)) {
      children.push(new Paragraph({
        spacing: { before: 200, after: 0 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 1, space: 1, color: '000000' } },
        children: [new TextRun({ text: '', font: { name: font }, size: fontSize })],
      }));
      i++;
      continue;
    }

    // Signature block: ``` SIGNATURE BLOCK ``` or [SIGNATURE BLOCK]
    if (/^```\s*SIGNATURE\s*BLOCK\s*```$/i.test(line.trim()) || /^\[SIGNATURE\s*BLOCK\]$/i.test(line.trim())) {
      // Collect parties from the following lines until blank line or end
      i++;
      const sigParties: string[][] = [];
      let currentParty: string[] = [];
      while (i < lines.length) {
        const sigLine = lines[i].trim();
        if (!sigLine) {
          if (currentParty.length > 0) { sigParties.push(currentParty); currentParty = []; }
          i++;
          if (i < lines.length && !lines[i].trim()) break; // double blank = end of block
          continue;
        }
        currentParty.push(sigLine);
        i++;
      }
      if (currentParty.length > 0) sigParties.push(currentParty);

      // Render each party's signature block
      for (const party of sigParties) {
        children.push(new Paragraph({ spacing: { before: 600 } })); // space before sig
        // Signature line
        children.push(new Paragraph({
          spacing: { after: 0 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 1, space: 1, color: '000000' } },
          children: [new TextRun({ text: '', font: { name: font }, size: fontSize })],
        }));
        // Party info lines
        for (const pLine of party) {
          children.push(new Paragraph({
            spacing: { after: 40 },
            children: parseInlineRuns(pLine, font, fontSize),
          }));
        }
        // Date line
        children.push(new Paragraph({
          spacing: { before: 200, after: 40 },
          children: [new TextRun({ text: 'Date: _______________________', font: { name: font }, size: fontSize })],
        }));
      }
      continue;
    }

    // Table: lines starting with | (collect contiguous |...| lines)
    if (line.startsWith('|') && line.endsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
        const tl = lines[i].trim();
        // Skip separator rows (|---|---|)
        if (!/^\|[\s-:|]+\|$/.test(tl)) {
          tableLines.push(tl);
        }
        i++;
      }
      if (tableLines.length > 0) {
        children.push(parseMarkdownTable(tableLines, font, fontSize));
      }
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,3})\s+(.*)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingLevel = level === 1 ? HeadingLevel.HEADING_1
        : level === 2 ? HeadingLevel.HEADING_2
        : HeadingLevel.HEADING_3;
      const hSize = level === 1 ? headingSize : level === 2 ? headingSize - 2 : headingSize - 4;
      children.push(new Paragraph({
        heading: headingLevel,
        spacing: { before: legal ? 240 : 0, after: legal ? 120 : 0 },
        alignment: level === 1 && legal ? AlignmentType.CENTER : undefined,
        children: parseInlineRuns(headingMatch[2], font, hSize, true),
      }));
      i++;
      continue;
    }

    // "WHEREAS" / "NOW, THEREFORE" / "RECITALS" / "WITNESSETH" — legal recital styling
    if (legal && /^(WHEREAS|NOW,?\s*THEREFORE|RECITALS|WITNESSETH)/i.test(line.trim())) {
      children.push(new Paragraph({
        spacing: { before: 200, after: 120 },
        indent: { left: convertInchesToTwip(0.5) },
        children: parseInlineRuns(line, font, fontSize, false, true),
      }));
      i++;
      continue;
    }

    // Centered text (legal): lines that are ALL CAPS and short (likely titles/headers)
    if (legal && line === line.toUpperCase() && line.trim().length > 2 && line.trim().length < 80) {
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 200, after: 120 },
        children: [new TextRun({ text: line.trim(), font: { name: font }, size: headingSize, bold: true })],
      }));
      i++;
      continue;
    }

    // Bullet list (- or *)
    const bulletMatch = line.match(/^(\s*)[-*]\s+(.*)/);
    if (bulletMatch) {
      const indent = Math.floor((bulletMatch[1]?.length ?? 0) / 2);
      children.push(new Paragraph({
        bullet: { level: Math.min(indent, 2) },
        children: parseInlineRuns(bulletMatch[2], font, fontSize),
      }));
      i++;
      continue;
    }

    // Numbered list
    const numberedMatch = line.match(/^(\s*)\d+[.)]\s+(.*)/);
    if (numberedMatch) {
      const indent = Math.floor((numberedMatch[1]?.length ?? 0) / 2);
      children.push(new Paragraph({
        numbering: { reference: 'default-numbering', level: Math.min(indent, 2) },
        children: parseInlineRuns(numberedMatch[2], font, fontSize),
      }));
      i++;
      continue;
    }

    // Section numbering: "1.2.3 Title" → indented numbered section (legal)
    const sectionMatch = legal ? line.match(/^(\d+(?:\.\d+)*)\s+(.*)/) : null;
    if (sectionMatch) {
      const depth = (sectionMatch[1].match(/\./g) || []).length;
      const isTopLevel = depth === 0;
      children.push(new Paragraph({
        spacing: { before: isTopLevel ? 240 : 120, after: 80 },
        indent: depth > 0 ? { left: convertInchesToTwip(0.5 * depth) } : undefined,
        children: [
          new TextRun({
            text: `${sectionMatch[1]}  `,
            font: { name: font },
            size: isTopLevel ? headingSize - 2 : fontSize,
            bold: isTopLevel,
          }),
          ...parseInlineRuns(sectionMatch[2], font, isTopLevel ? headingSize - 2 : fontSize, isTopLevel),
        ],
      }));
      i++;
      continue;
    }

    // Regular paragraph
    children.push(new Paragraph({
      spacing: { after: legal ? 120 : 0 },
      children: parseInlineRuns(line, font, fontSize),
    }));
    i++;
  }

  // Build header/footer for legal docs
  const headerChildren: Paragraph[] = [];
  if (opts?.confidential) {
    headerChildren.push(new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: 'CONFIDENTIAL', font: { name: font }, size: 16, bold: true, color: '888888' })],
    }));
  }
  if (opts?.title) {
    headerChildren.push(new Paragraph({
      alignment: AlignmentType.LEFT,
      children: [new TextRun({ text: opts.title, font: { name: font }, size: 16, italics: true, color: '888888' })],
    }));
  }

  const footerChildren: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: 'Page ', font: { name: font }, size: 16 }),
        new TextRun({ children: [PageNumber.CURRENT], font: { name: font }, size: 16 }),
        new TextRun({ text: ' of ', font: { name: font }, size: 16 }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], font: { name: font }, size: 16 }),
      ],
    }),
  ];

  const margins = legal
    ? { top: convertInchesToTwip(1), bottom: convertInchesToTwip(1), left: convertInchesToTwip(1), right: convertInchesToTwip(1) }
    : undefined;

  const doc = new Document({
    numbering: {
      config: [{
        reference: 'default-numbering',
        levels: [
          { level: 0, format: NumberFormat.DECIMAL as any, text: '%1.', alignment: AlignmentType.START as any },
          { level: 1, format: NumberFormat.LOWER_LETTER as any, text: '%2)', alignment: AlignmentType.START as any },
          { level: 2, format: NumberFormat.LOWER_ROMAN as any, text: '%3.', alignment: AlignmentType.START as any },
        ],
      }],
    },
    sections: [{
      properties: {
        page: { margin: margins },
      },
      headers: headerChildren.length > 0 ? { default: new Header({ children: headerChildren }) } : undefined,
      footers: legal ? { default: new Footer({ children: footerChildren }) } : undefined,
      children,
    }],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}

/** Parse bold (**text**), italic (*text*), and underline (__text__) into TextRun array with font/size. */
function parseInlineRuns(
  text: string,
  fontName: string,
  size: number,
  bold?: boolean,
  firstWordBold?: boolean,
): TextRun[] {
  const runs: TextRun[] = [];
  // Match __underline__, **bold**, *italic*, or plain text segments
  const pattern = /(__(.+?)__|\*\*(.+?)\*\*|\*(.+?)\*|([^_*]+))/g;
  let m: RegExpExecArray | null;
  let isFirst = true;
  while ((m = pattern.exec(text)) !== null) {
    if (m[2]) {
      runs.push(new TextRun({ text: m[2], underline: {}, font: { name: fontName }, size, bold }));
    } else if (m[3]) {
      runs.push(new TextRun({ text: m[3], bold: true, font: { name: fontName }, size }));
    } else if (m[4]) {
      runs.push(new TextRun({ text: m[4], italics: true, font: { name: fontName }, size, bold }));
    } else if (m[5]) {
      if (firstWordBold && isFirst) {
        const spaceIdx = m[5].indexOf(' ');
        if (spaceIdx > 0) {
          runs.push(new TextRun({ text: m[5].slice(0, spaceIdx), bold: true, font: { name: fontName }, size }));
          runs.push(new TextRun({ text: m[5].slice(spaceIdx), font: { name: fontName }, size, bold }));
        } else {
          runs.push(new TextRun({ text: m[5], bold: true, font: { name: fontName }, size }));
        }
      } else {
        runs.push(new TextRun({ text: m[5], font: { name: fontName }, size, bold }));
      }
    }
    isFirst = false;
  }
  if (runs.length === 0) {
    runs.push(new TextRun({ text, font: { name: fontName }, size, bold }));
  }
  return runs;
}

/** Parse markdown table rows into a docx Table. */
function parseMarkdownTable(tableLines: string[], fontName: string, fontSize: number): Table {
  const parsed = tableLines.map(line =>
    line.split('|').slice(1, -1).map(cell => cell.trim()),
  );
  const colCount = Math.max(...parsed.map(r => r.length));
  const rows = parsed.map((cells, rowIdx) =>
    new TableRow({
      children: Array.from({ length: colCount }, (_, ci) =>
        new TableCell({
          width: { size: Math.floor(9000 / colCount), type: WidthType.DXA },
          children: [
            new Paragraph({
              children: [new TextRun({
                text: cells[ci] ?? '',
                font: { name: fontName },
                size: fontSize,
                bold: rowIdx === 0,
              })],
            }),
          ],
        }),
      ),
    }),
  );
  return new Table({ rows, width: { size: 9000, type: WidthType.DXA } });
}

// ─── PDF Generation ──────────────────────────────────────────────

/**
 * Convert markdown/plain-text to a professional PDF buffer.
 * Uses the same legal-formatting conventions as markdownToDocx:
 * headings, bold/italic, WHEREAS clauses, signature blocks, tables, numbered sections.
 */
export async function markdownToPdf(markdown: string, opts?: DocxConvertOptions): Promise<Buffer> {
  const PDFDocument = (await import('pdfkit')).default;

  const legal = opts?.legalFormatting ?? false;
  const fontName = 'Times-Roman';
  const boldFont = 'Times-Bold';
  const italicFont = 'Times-Italic';
  const bodySize = legal ? 12 : 11;
  const h1Size = legal ? 16 : 14;
  const h2Size = legal ? 14 : 13;
  const h3Size = legal ? 13 : 12;
  const margin = legal ? 72 : 54; // 1 inch = 72pt; 0.75 inch = 54pt

  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: margin, bottom: margin, left: margin, right: margin },
    bufferPages: true,
    info: {
      Title: opts?.title ?? 'Document',
      Author: 'Glyphor, Inc.',
      Creator: 'Glyphor Legal AI',
    },
  });

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  const pageWidth = 612 - margin * 2;

  // Helper: write text run with inline formatting (bold/italic)
  function writeFormatted(text: string, options?: { fontSize?: number; align?: string; indent?: number }) {
    const { fontSize: size = bodySize, align = 'left', indent = 0 } = options ?? {};
    const x = margin + indent;
    const maxW = pageWidth - indent;

    // Parse inline markers into segments
    const segments: { text: string; bold: boolean; italic: boolean; underline: boolean }[] = [];
    const pattern = /(__(.+?)__|\*\*(.+?)\*\*|\*(.+?)\*|([^_*]+))/g;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      if (m[2]) segments.push({ text: m[2], bold: false, italic: false, underline: true });
      else if (m[3]) segments.push({ text: m[3], bold: true, italic: false, underline: false });
      else if (m[4]) segments.push({ text: m[4], bold: false, italic: true, underline: false });
      else if (m[5]) segments.push({ text: m[5], bold: false, italic: false, underline: false });
    }
    if (segments.length === 0) segments.push({ text, bold: false, italic: false, underline: false });

    // Render each segment inline
    for (const seg of segments) {
      const f = seg.bold ? boldFont : seg.italic ? italicFont : fontName;
      doc.font(f).fontSize(size);
      const textOpts: PDFKit.Mixins.TextOptions = { width: maxW, align: align as any, continued: seg !== segments[segments.length - 1], underline: seg.underline };
      doc.text(seg.text, x, undefined, textOpts);
    }
  }

  const lines = markdown.split('\n');
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trimEnd();

    // Blank line
    if (!line.trim()) { doc.moveDown(0.5); i++; continue; }

    // Horizontal rule → signature line
    if (/^(\s*[-_]{3,}\s*)$/.test(line)) {
      doc.moveDown(1);
      const y = doc.y;
      doc.moveTo(margin, y).lineTo(margin + pageWidth * 0.5, y).stroke();
      doc.moveDown(0.3);
      i++;
      continue;
    }

    // Signature block
    if (/^```\s*SIGNATURE\s*BLOCK\s*```$/i.test(line.trim()) || /^\[SIGNATURE\s*BLOCK\]$/i.test(line.trim())) {
      i++;
      const parties: string[][] = [];
      let current: string[] = [];
      while (i < lines.length) {
        const sl = lines[i].trim();
        if (!sl) {
          if (current.length) { parties.push(current); current = []; }
          i++;
          if (i < lines.length && !lines[i].trim()) break;
          continue;
        }
        current.push(sl);
        i++;
      }
      if (current.length) parties.push(current);
      for (const party of parties) {
        doc.moveDown(2);
        const y = doc.y;
        doc.moveTo(margin, y).lineTo(margin + pageWidth * 0.45, y).stroke();
        doc.moveDown(0.3);
        for (const pl of party) {
          doc.font(fontName).fontSize(bodySize).text(pl, margin);
        }
        doc.font(fontName).fontSize(bodySize).text('Date: _______________________', margin);
        doc.moveDown(0.5);
      }
      continue;
    }

    // Table
    if (line.startsWith('|') && line.endsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
        const tl = lines[i].trim();
        if (!/^\|[\s-:|]+\|$/.test(tl)) tableLines.push(tl);
        i++;
      }
      if (tableLines.length > 0) {
        const parsed = tableLines.map(l => l.split('|').slice(1, -1).map(c => c.trim()));
        const cols = Math.max(...parsed.map(r => r.length));
        const colW = pageWidth / cols;
        for (let ri = 0; ri < parsed.length; ri++) {
          const y = doc.y;
          for (let ci = 0; ci < cols; ci++) {
            const cellX = margin + ci * colW;
            const f = ri === 0 ? boldFont : fontName;
            doc.font(f).fontSize(bodySize - 1).text(parsed[ri][ci] ?? '', cellX, y, { width: colW - 4, align: 'left' });
          }
          doc.y = y + bodySize + 6;
          // Draw row separator
          const lineY = doc.y;
          doc.moveTo(margin, lineY).lineTo(margin + pageWidth, lineY).lineWidth(0.5).stroke();
          doc.moveDown(0.2);
        }
        doc.moveDown(0.5);
      }
      continue;
    }

    // Headings
    const hm = line.match(/^(#{1,3})\s+(.*)/);
    if (hm) {
      const level = hm[1].length;
      const sz = level === 1 ? h1Size : level === 2 ? h2Size : h3Size;
      doc.moveDown(level === 1 ? 1 : 0.7);
      doc.font(boldFont).fontSize(sz);
      const align = (level === 1 && legal) ? 'center' : 'left';
      doc.text(hm[2], margin, undefined, { width: pageWidth, align: align as any });
      doc.moveDown(0.3);
      i++;
      continue;
    }

    // ALLCAPS title (legal)
    if (legal && line === line.toUpperCase() && line.trim().length > 2 && line.trim().length < 80) {
      doc.moveDown(0.7);
      doc.font(boldFont).fontSize(h1Size).text(line.trim(), margin, undefined, { width: pageWidth, align: 'center' });
      doc.moveDown(0.3);
      i++;
      continue;
    }

    // WHEREAS / recitals
    if (legal && /^(WHEREAS|NOW,?\s*THEREFORE|RECITALS|WITNESSETH)/i.test(line.trim())) {
      doc.moveDown(0.3);
      // First word bold
      const spaceIdx = line.trim().indexOf(' ');
      if (spaceIdx > 0) {
        doc.font(boldFont).fontSize(bodySize).text(line.trim().slice(0, spaceIdx), margin + 36, undefined, { continued: true });
        doc.font(fontName).fontSize(bodySize).text(line.trim().slice(spaceIdx));
      } else {
        doc.font(boldFont).fontSize(bodySize).text(line.trim(), margin + 36);
      }
      doc.moveDown(0.2);
      i++;
      continue;
    }

    // Section numbering (legal): "1.2.3 Title"
    const sm = legal ? line.match(/^(\d+(?:\.\d+)*)\s+(.*)/) : null;
    if (sm) {
      const depth = (sm[1].match(/\./g) || []).length;
      const indent = depth * 36; // 0.5 inch per level
      const isTop = depth === 0;
      doc.moveDown(isTop ? 0.6 : 0.3);
      doc.font(isTop ? boldFont : fontName).fontSize(isTop ? h2Size : bodySize);
      doc.text(`${sm[1]}  `, margin + indent, undefined, { continued: true });
      writeFormatted(sm[2], { fontSize: isTop ? h2Size : bodySize, indent });
      doc.moveDown(0.2);
      i++;
      continue;
    }

    // Bullet list
    const bm = line.match(/^(\s*)[-*]\s+(.*)/);
    if (bm) {
      const indent = Math.min(Math.floor((bm[1]?.length ?? 0) / 2), 2) * 18;
      doc.font(fontName).fontSize(bodySize).text('\u2022  ', margin + indent, undefined, { continued: true });
      writeFormatted(bm[2], { indent: indent + 12 });
      i++;
      continue;
    }

    // Numbered list
    const nm = line.match(/^(\s*)(\d+)[.)]\s+(.*)/);
    if (nm) {
      const indent = Math.min(Math.floor((nm[1]?.length ?? 0) / 2), 2) * 18;
      doc.font(fontName).fontSize(bodySize).text(`${nm[2]}.  `, margin + indent, undefined, { continued: true });
      writeFormatted(nm[3], { indent: indent + 18 });
      i++;
      continue;
    }

    // Regular paragraph
    writeFormatted(line);
    i++;
  }

  // Add page numbers and optional headers to all pages
  const pageCount = doc.bufferedPageRange().count;
  for (let p = 0; p < pageCount; p++) {
    doc.switchToPage(p);
    // Footer: page number
    doc.font(fontName).fontSize(9).text(
      `Page ${p + 1} of ${pageCount}`,
      margin, 612 + 72 - 36, // LETTER height minus bottom margin + some offset
      { width: pageWidth, align: 'center' },
    );
    // Header: confidential + title
    if (opts?.confidential) {
      doc.font(boldFont).fontSize(8).fillColor('#888888').text(
        'CONFIDENTIAL',
        margin, margin - 24,
        { width: pageWidth, align: 'right' },
      );
      doc.fillColor('#000000');
    }
    if (opts?.title) {
      doc.font(italicFont).fontSize(8).fillColor('#888888').text(
        opts.title,
        margin, margin - 24,
        { width: pageWidth, align: 'left' },
      );
      doc.fillColor('#000000');
    }
  }

  doc.end();

  return new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
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

/**
 * Extract the parent folder path from a SharePoint webUrl when parentReference.path
 * is unavailable (common in Search API responses). Looks for the rootFolder segment
 * in the URL, then returns everything from rootFolder forward (excluding the filename).
 */
function extractParentPathFromWebUrl(webUrl: string, rootFolder: string): string {
  try {
    // webUrl looks like:
    // https://tenant.sharepoint.com/sites/sitename/Shared Documents/Company-Agent-Knowledge/Operations/file.docx
    const decoded = decodeURIComponent(new URL(webUrl).pathname);
    const rootIdx = decoded.indexOf('/' + rootFolder + '/');
    if (rootIdx === -1) return '';
    // Get everything after the leading / up to (but not including) the filename
    const afterSlash = decoded.slice(rootIdx + 1); // "Company-Agent-Knowledge/Operations/file.docx"
    const lastSlash = afterSlash.lastIndexOf('/');
    if (lastSlash === -1) return '';
    return afterSlash.slice(0, lastSlash); // "Company-Agent-Knowledge/Operations"
  } catch {
    return '';
  }
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

function hashBuffer(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

async function resolveUploadTarget(
  fileName: string,
  options?: SharePointUploadOptions,
): Promise<{
  siteId: string;
  driveId: string;
  remotePath: string;
  safeName: string;
  token: string;
  agentRole?: string;
  identityType: 'agent365' | 'app-only-graph';
  fallbackUsed: boolean;
}> {
  const siteId = (options?.siteId ?? process.env.SHAREPOINT_SITE_ID ?? '').trim();
  if (!siteId) throw new Error('Missing SHAREPOINT_SITE_ID');

  const agentRole = options?.agentRole;
  const resolved = await resolveSharePointGraphToken('write_sharepoint', agentRole);
  const token = resolved.token;
  const driveId = (options?.driveId ?? process.env.SHAREPOINT_DRIVE_ID ?? await getDefaultDriveId(token, siteId)).trim();

  const folder = options?.folder ?? process.env.SHAREPOINT_ROOT_FOLDER ?? 'Company-Agent-Knowledge';
  const safeName = fileName.replace(/[<>:"/\\|?*]/g, '-');
  const remotePath = folder ? `${folder}/${safeName}` : safeName;

  return {
    siteId,
    driveId,
    remotePath,
    safeName,
    token,
    agentRole: resolved.agentRole,
    identityType: resolved.identityType,
    fallbackUsed: resolved.fallbackUsed,
  };
}

async function putSharePointFile(
  target: {
    siteId: string;
    driveId: string;
    remotePath: string;
    safeName: string;
    token: string;
  },
  uploadBody: Buffer | string,
  contentType: string,
): Promise<GraphDriveItem> {
  const encodedPath = target.remotePath.split('/').map(encodeURIComponent).join('/');
  const url = `${GRAPH_BASE}/sites/${encodeSiteId(target.siteId)}/drives/${encodeDriveId(target.driveId)}/root:/${encodedPath}:/content`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${target.token}`,
      'Content-Type': contentType,
    },
    body: uploadBody,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to upload to SharePoint (${response.status}): ${text}`);
  }

  return (await response.json()) as GraphDriveItem;
}

function buildBinaryKnowledgeText(
  fileName: string,
  path: string,
  webUrl: string | null,
  summary?: string,
): string {
  const sourceLine = webUrl ? `Source: ${webUrl}` : `Path: ${path}`;
  const details = summary?.trim() || 'Binary asset uploaded to SharePoint for durable delivery and downstream reference.';
  return `# SharePoint Asset: ${fileName}\n\n${sourceLine}\n\n${details}`;
}

/* ─── Upload & Search ─────────────────────────────────────────── */

export interface SharePointUploadOptions {
  siteId?: string;
  driveId?: string;
  folder?: string;
  /** Agent role — when set, the upload uses the agent's agentic user token so
   *  SharePoint attributes the file to the agent instead of "SharePoint App". */
  agentRole?: string;
  /** Docx conversion options (legal formatting, title, confidential header). */
  docxOptions?: DocxConvertOptions;
}

export interface SharePointBinaryUploadOptions extends SharePointUploadOptions {
  contentType?: string;
  summary?: string;
  evidence?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface SharePointSearchOptions {
  siteId?: string;
  driveId?: string;
  maxResults?: number;
  /** When set with Agent365 enabled, Graph calls use the agent identity first. */
  agentRole?: string;
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
  // Auto-convert .md and .txt files to .docx so SharePoint gets proper Word docs
  // (.pdf files are handled separately below)
  const lowerName = fileName.toLowerCase();
  const effectiveName = lowerName.endsWith('.md')
    ? fileName.slice(0, -3) + '.docx'
    : lowerName.endsWith('.txt')
      ? fileName.slice(0, -4) + '.docx'
      : fileName;

  const target = await resolveUploadTarget(effectiveName, options);

  // Generate the appropriate binary format
  const isDocx = target.safeName.toLowerCase().endsWith('.docx');
  const isPdf = target.safeName.toLowerCase().endsWith('.pdf');
  let uploadBody: Buffer | string;
  let contentType: string;

  if (isPdf) {
    uploadBody = await markdownToPdf(content, options?.docxOptions);
    contentType = 'application/pdf';
  } else if (isDocx) {
    uploadBody = await markdownToDocx(content, options?.docxOptions);
    contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  } else {
    uploadBody = content;
    contentType = 'text/plain';
  }

  const item = await putSharePointFile(target, uploadBody, contentType);
  await logMicrosoftWriteAudit({
    agentRole: target.agentRole ?? 'system',
    action: 'sharepoint.upload_document',
    resource: `sites/${target.siteId}/drives/${target.driveId}/root:/${target.remotePath}`,
    identityType: target.identityType,
    workspaceKey: 'glyphor-internal',
    toolName: 'upload_to_sharepoint',
    outcome: 'success',
    fallbackUsed: target.fallbackUsed,
    targetType: 'sharepoint-drive-item',
    targetId: target.remotePath,
    responseCode: 200,
    responseSummary: item.webUrl ?? 'uploaded',
  });

  // Also insert into company_knowledge for immediate availability
  const knowledgeId = await saveKnowledgeEntry({
    content: buildKnowledgeText(target.safeName, target.remotePath, item.webUrl ?? null, content),
    evidence: item.webUrl ?? null,
    tags: ['sharepoint', 'document', getExtension(target.safeName).replace('.', '')],
  });

  await upsertIndexRow({
    site_id: target.siteId,
    drive_id: target.driveId,
    drive_item_id: item.id,
    name: target.safeName,
    path: target.remotePath,
    web_url: item.webUrl ?? null,
    etag: item.eTag ?? null,
    mime_type: item.file?.mimeType ?? null,
    content_hash: hashText(content),
    last_modified_at: item.lastModifiedDateTime ?? null,
    last_synced_at: new Date().toISOString(),
    status: 'active',
    error_text: null,
    knowledge_id: knowledgeId,
    metadata: { extension: getExtension(target.safeName), uploadedBy: target.agentRole ?? 'agent' },
  });

  return { webUrl: item.webUrl ?? '', knowledgeId };
}

export async function uploadBinaryToSharePoint(
  fileName: string,
  content: Buffer,
  options?: SharePointBinaryUploadOptions,
): Promise<{ webUrl: string; knowledgeId: string; path: string }> {
  const target = await resolveUploadTarget(fileName, options);
  const contentType = options?.contentType?.trim() || 'application/octet-stream';
  const item = await putSharePointFile(target, content, contentType);
  await logMicrosoftWriteAudit({
    agentRole: target.agentRole ?? 'system',
    action: 'sharepoint.upload_binary',
    resource: `sites/${target.siteId}/drives/${target.driveId}/root:/${target.remotePath}`,
    identityType: target.identityType,
    workspaceKey: 'glyphor-internal',
    toolName: 'upload_to_sharepoint',
    outcome: 'success',
    fallbackUsed: target.fallbackUsed,
    targetType: 'sharepoint-drive-item',
    targetId: target.remotePath,
    responseCode: 200,
    responseSummary: item.webUrl ?? 'uploaded',
  });

  const knowledgeId = await saveKnowledgeEntry({
    content: buildBinaryKnowledgeText(
      target.safeName,
      target.remotePath,
      item.webUrl ?? null,
      options?.summary,
    ),
    evidence: options?.evidence ?? item.webUrl ?? null,
    tags: options?.tags?.length
      ? options.tags
      : ['sharepoint', 'asset', getExtension(target.safeName).replace('.', '') || 'bin'],
  });

  await upsertIndexRow({
    site_id: target.siteId,
    drive_id: target.driveId,
    drive_item_id: item.id,
    name: target.safeName,
    path: target.remotePath,
    web_url: item.webUrl ?? null,
    etag: item.eTag ?? null,
    mime_type: item.file?.mimeType ?? contentType,
    content_hash: hashBuffer(content),
    last_modified_at: item.lastModifiedDateTime ?? null,
    last_synced_at: new Date().toISOString(),
    status: 'active',
    error_text: null,
    knowledge_id: knowledgeId,
    metadata: {
      extension: getExtension(target.safeName),
      uploadedBy: target.agentRole ?? 'agent',
      kind: 'binary',
      ...(options?.metadata ?? {}),
    },
  });

  return {
    webUrl: item.webUrl ?? '',
    knowledgeId,
    path: target.remotePath,
  };
}

/**
 * Search SharePoint documents by keyword via Microsoft Graph Search API.
 */
export async function searchSharePoint(
  query: string,
  options?: SharePointSearchOptions,
): Promise<SharePointDocument[]> {
  const siteId = (options?.siteId ?? process.env.SHAREPOINT_SITE_ID ?? '').trim();
  if (!siteId) throw new Error('Missing SHAREPOINT_SITE_ID');

  const { token } = await resolveSharePointGraphToken('search_sharepoint', options?.agentRole);
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

  const rootFolder = (process.env.SHAREPOINT_ROOT_FOLDER ?? 'Company-Agent-Knowledge').trim();

  return hits.map((hit: { resource: GraphDriveItem & { size?: number } }) => {
    // Build the full path from the Graph parentReference
    let parentPath = normalizeParentPath(hit.resource.parentReference?.path);

    // The Search API often omits parentReference.path — extract from webUrl instead
    if (!parentPath && hit.resource.webUrl) {
      parentPath = extractParentPathFromWebUrl(hit.resource.webUrl, rootFolder);
    }

    const fullPath = parentPath ? parentPath + '/' + hit.resource.name : hit.resource.name;

    // Strip the rootFolder prefix so the path is relative to the knowledge root —
    // this matches what read_sharepoint_document expects.
    let relativePath = fullPath;
    if (relativePath.startsWith(rootFolder + '/')) {
      relativePath = relativePath.slice(rootFolder.length + 1);
    }

    return {
      id: hit.resource.id,
      name: hit.resource.name,
      path: relativePath,
      webUrl: hit.resource.webUrl ?? null,
      lastModified: hit.resource.lastModifiedDateTime ?? null,
      size: hit.resource.size,
    };
  });
}

/**
 * List all folders in the SharePoint knowledge root.
 */
export async function listSharePointFolders(
  options?: SharePointSearchOptions,
): Promise<string[]> {
  const siteId = (options?.siteId ?? process.env.SHAREPOINT_SITE_ID ?? '').trim();
  if (!siteId) throw new Error('Missing SHAREPOINT_SITE_ID');

  const { token } = await resolveSharePointGraphToken('read_sharepoint', options?.agentRole);
  const driveId = (options?.driveId ?? process.env.SHAREPOINT_DRIVE_ID ?? await getDefaultDriveId(token, siteId)).trim();
  const rootFolder = (process.env.SHAREPOINT_ROOT_FOLDER ?? 'Company-Agent-Knowledge').trim();

  const children = await listChildren(token, siteId, driveId, null, rootFolder);
  return children
    .filter((item) => item.folder)
    .map((item) => item.name);
}

/**
 * List files in a SharePoint folder (or the root if no folder specified).
 * Returns file names with their paths, sizes, and last modified dates.
 */
export async function listSharePointFiles(
  folder?: string,
  options?: SharePointSearchOptions,
): Promise<Array<{ name: string; path: string; webUrl: string | null; lastModified: string | null }>> {
  const siteId = (options?.siteId ?? process.env.SHAREPOINT_SITE_ID ?? '').trim();
  if (!siteId) throw new Error('Missing SHAREPOINT_SITE_ID');

  const { token } = await resolveSharePointGraphToken('read_sharepoint', options?.agentRole);
  const driveId = (options?.driveId ?? process.env.SHAREPOINT_DRIVE_ID ?? await getDefaultDriveId(token, siteId)).trim();
  const rootFolder = (process.env.SHAREPOINT_ROOT_FOLDER ?? 'Company-Agent-Knowledge').trim();

  const targetFolder = folder ? `${rootFolder}/${folder}` : rootFolder;
  const children = await listChildren(token, siteId, driveId, null, targetFolder);

  return children
    .filter((item) => item.file)
    .map((item) => ({
      name: item.name,
      path: folder ? `${folder}/${item.name}` : item.name,
      webUrl: item.webUrl ?? null,
      lastModified: item.lastModifiedDateTime ?? null,
    }));
}

/**
 * Given a resolved driveItem, download and return its text content.
 */
async function readDriveItem(
  token: string,
  siteId: string,
  driveId: string,
  meta: GraphDriveItem,
): Promise<{ content: string; webUrl: string | null; lastModified: string | null }> {
  const ext = getExtension(meta.name).toLowerCase();
  const OFFICE_EXTENSIONS = new Set(['.docx', '.doc', '.pptx', '.ppt', '.xlsx', '.xls']);
  let content: string;

  if (OFFICE_EXTENSIONS.has(ext)) {
    content = await downloadOfficeAsText(token, siteId, driveId, meta.id, meta.name);
  } else if (ext === '.pdf') {
    content = await downloadPdfAsText(token, siteId, driveId, meta.id, meta.name);
  } else {
    content = await downloadTextContent(token, siteId, driveId, meta.id);
  }

  return {
    content,
    webUrl: meta.webUrl ?? null,
    lastModified: meta.lastModifiedDateTime ?? null,
  };
}

/**
 * Read a specific document from SharePoint by path.
 */
export async function readSharePointDocument(
  filePath: string,
  options?: SharePointSearchOptions,
): Promise<{ content: string; webUrl: string | null; lastModified: string | null }> {
  const siteId = (options?.siteId ?? process.env.SHAREPOINT_SITE_ID ?? '').trim();
  if (!siteId) throw new Error('Missing SHAREPOINT_SITE_ID');

  const { token } = await resolveSharePointGraphToken('read_sharepoint', options?.agentRole);
  const driveId = (options?.driveId ?? process.env.SHAREPOINT_DRIVE_ID ?? await getDefaultDriveId(token, siteId)).trim();

  const rootFolder = process.env.SHAREPOINT_ROOT_FOLDER ?? 'Company-Agent-Knowledge';

  // Try multiple path strategies:
  // 1. rootFolder/filePath (expected convention — search results are relative to root)
  // 2. filePath as-is (handles absolute paths or files outside rootFolder)
  const candidates = [
    `${rootFolder}/${filePath}`,
    filePath,
  ];
  // Deduplicate if filePath already starts with rootFolder
  const paths = [...new Set(candidates)];

  let lastError: Error | null = null;
  for (const candidatePath of paths) {
    const encodedPath = candidatePath.split('/').map(encodeURIComponent).join('/');
    const metaUrl = `${GRAPH_BASE}/sites/${encodeSiteId(siteId)}/drives/${encodeDriveId(driveId)}/root:/${encodedPath}`;
    const metaRes = await fetch(metaUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!metaRes.ok) {
      lastError = new Error(`Document not found: ${candidatePath}`);
      continue;
    }

    const meta = (await metaRes.json()) as GraphDriveItem;
    return readDriveItem(token, siteId, driveId, meta);
  }

  // Fallback: if path-based lookup failed, search for the file by name and read by item ID.
  // This handles Search API results where parentReference.path was missing and the returned
  // path was incomplete.
  const fileName = filePath.split('/').pop() ?? filePath;
  try {
    const searchResults = await searchSharePoint(fileName, {
      siteId,
      driveId,
      maxResults: 5,
      agentRole: options?.agentRole,
    });
    const match = searchResults.find(
      (r: SharePointDocument) => r.name === fileName || r.name.toLowerCase() === fileName.toLowerCase(),
    );
    if (match?.id) {
      const itemUrl = `${GRAPH_BASE}/sites/${encodeSiteId(siteId)}/drives/${encodeDriveId(driveId)}/items/${encodeURIComponent(match.id)}`;
      const itemRes = await fetch(itemUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (itemRes.ok) {
        const meta = (await itemRes.json()) as GraphDriveItem;
        return readDriveItem(token, siteId, driveId, meta);
      }
    }
  } catch {
    // Search fallback failed — fall through to original error
  }

  throw lastError ?? new Error(`Document not found: ${filePath}`);
}

/**
 * Create a SharePoint site page with HTML content.
 * Uses the Graph API beta endpoint for site pages.
 */
export async function createSharePointPage(
  title: string,
  htmlContent: string,
  options?: {
    siteId?: string;
    description?: string;
    promotionKind?: 'page' | 'newsPost';
    agentRole?: string;
  },
): Promise<{ id: string; webUrl: string }> {
  const siteId = (options?.siteId ?? process.env.SHAREPOINT_SITE_ID ?? '').trim();
  if (!siteId) throw new Error('Missing SHAREPOINT_SITE_ID');

  const { token } = await resolveSharePointGraphToken('write_sharepoint', options?.agentRole);
  const promotionKind = options?.promotionKind ?? 'page';

  // Create the page
  const createUrl = `${GRAPH_BASE}/sites/${encodeSiteId(siteId)}/pages`;
  const createRes = await fetch(createUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      '@odata.type': '#microsoft.graph.sitePage',
      name: `${title.replace(/[<>:"/\\|?*]/g, '-').replace(/\s+/g, '-')}.aspx`,
      title,
      pageLayout: 'article',
      promotionKind,
      ...(options?.description ? { description: options.description } : {}),
      canvasLayout: {
        horizontalSections: [
          {
            layout: 'fullWidth',
            columns: [
              {
                width: 0,
                webparts: [
                  {
                    '@odata.type': '#microsoft.graph.textWebPart',
                    innerHtml: htmlContent,
                  },
                ],
              },
            ],
          },
        ],
      },
    }),
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Failed to create SharePoint page (${createRes.status}): ${errText}`);
  }

  const page = (await createRes.json()) as { id: string; webUrl?: string };

  // Publish the page so it's visible
  const publishUrl = `${GRAPH_BASE}/sites/${encodeSiteId(siteId)}/pages/${encodeURIComponent(page.id)}/microsoft.graph.sitePage/publish`;
  const publishRes = await fetch(publishUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!publishRes.ok) {
    console.warn(`[SharePoint] Page created but publish failed (${publishRes.status})`);
  }

  return {
    id: page.id,
    webUrl: page.webUrl ?? '',
  };
}
