import { systemQuery } from '@glyphor/shared/db';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { getM365Token } from '../credentials/m365Router.js';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';

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
async function markdownToDocx(markdown: string): Promise<Buffer> {
  const lines = markdown.split('\n');
  const children: Paragraph[] = [];

  for (const raw of lines) {
    const line = raw.trimEnd();

    // Blank line → empty paragraph
    if (!line.trim()) {
      children.push(new Paragraph({}));
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,3})\s+(.*)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingLevel = level === 1 ? HeadingLevel.HEADING_1
        : level === 2 ? HeadingLevel.HEADING_2
        : HeadingLevel.HEADING_3;
      children.push(new Paragraph({
        heading: headingLevel,
        children: parseInlineFormatting(headingMatch[2]),
      }));
      continue;
    }

    // Bullet list (- or *)
    const bulletMatch = line.match(/^\s*[-*]\s+(.*)/);
    if (bulletMatch) {
      children.push(new Paragraph({
        bullet: { level: 0 },
        children: parseInlineFormatting(bulletMatch[1]),
      }));
      continue;
    }

    // Numbered list
    const numberedMatch = line.match(/^\s*\d+[.)]\s+(.*)/);
    if (numberedMatch) {
      children.push(new Paragraph({
        numbering: { reference: 'default-numbering', level: 0 },
        children: parseInlineFormatting(numberedMatch[1]),
      }));
      continue;
    }

    // Regular paragraph
    children.push(new Paragraph({
      children: parseInlineFormatting(line),
    }));
  }

  const doc = new Document({
    numbering: {
      config: [{
        reference: 'default-numbering',
        levels: [{
          level: 0,
          format: 'decimal' as any,
          text: '%1.',
          alignment: 'start' as any,
        }],
      }],
    },
    sections: [{
      children,
    }],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}

/** Parse bold (**text**) and italic (*text*) inline formatting into TextRun array. */
function parseInlineFormatting(text: string): TextRun[] {
  const runs: TextRun[] = [];
  // Match **bold**, *italic*, or plain text segments
  const pattern = /(\*\*(.+?)\*\*|\*(.+?)\*|([^*]+))/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match[2]) {
      // Bold
      runs.push(new TextRun({ text: match[2], bold: true }));
    } else if (match[3]) {
      // Italic
      runs.push(new TextRun({ text: match[3], italics: true }));
    } else if (match[4]) {
      // Plain text
      runs.push(new TextRun({ text: match[4] }));
    }
  }
  if (runs.length === 0) {
    runs.push(new TextRun({ text }));
  }
  return runs;
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
  const siteId = (options?.siteId ?? process.env.SHAREPOINT_SITE_ID ?? '').trim();
  if (!siteId) throw new Error('Missing SHAREPOINT_SITE_ID');

  const token = await getM365Token('write_sharepoint');
  const driveId = (options?.driveId ?? process.env.SHAREPOINT_DRIVE_ID ?? await getDefaultDriveId(token, siteId)).trim();

  const folder = options?.folder ?? process.env.SHAREPOINT_ROOT_FOLDER ?? 'Company-Agent-Knowledge';
  const safeName = fileName.replace(/[<>:"/\\|?*]/g, '-');
  const remotePath = folder ? `${folder}/${safeName}` : safeName;

  const encodedPath = remotePath.split('/').map(encodeURIComponent).join('/');
  const url = `${GRAPH_BASE}/sites/${encodeSiteId(siteId)}/drives/${encodeDriveId(driveId)}/root:/${encodedPath}:/content`;

  // If filename is .docx, generate a proper Office Open XML document
  // instead of uploading raw text (which corrupts the file).
  const isDocx = safeName.toLowerCase().endsWith('.docx');
  let uploadBody: Buffer | string;
  let contentType: string;

  if (isDocx) {
    uploadBody = await markdownToDocx(content);
    contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  } else {
    uploadBody = content;
    contentType = 'text/plain';
  }

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': contentType,
    },
    body: uploadBody,
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
  const siteId = (options?.siteId ?? process.env.SHAREPOINT_SITE_ID ?? '').trim();
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

  const token = await getM365Token('read_sharepoint');
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

  const token = await getM365Token('read_sharepoint');
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

  const token = await getM365Token('read_sharepoint');
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
    const searchResults = await searchSharePoint(fileName, { siteId, driveId, maxResults: 5 });
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
  options?: { siteId?: string; description?: string; promotionKind?: 'page' | 'newsPost' },
): Promise<{ id: string; webUrl: string }> {
  const siteId = (options?.siteId ?? process.env.SHAREPOINT_SITE_ID ?? '').trim();
  if (!siteId) throw new Error('Missing SHAREPOINT_SITE_ID');

  const token = await getM365Token('write_sharepoint');
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
