/**
 * Download SharePoint / OneDrive-for-business files linked inside Teams message HTML
 * using Microsoft Graph shares API (encoded sharing URL → driveItem → content).
 *
 * Teams often surfaces PPTX/PDF as a link in the message body while Graph's
 * chat `attachments` array is empty or lacks a usable contentUrl — agents then
 * "find" the file via search but never receive bytes.
 *
 * @see https://learn.microsoft.com/en-us/graph/api/shares-get
 *
 * Application permissions: Graph docs list **Files.ReadWrite.All** as the
 * least-privileged *application* permission for `/shares/{token}`. If metadata
 * returns 403, add Files.ReadWrite.All (or try delegated) and re-consent.
 */

import type { ConversationAttachment } from '@glyphor/agent-runtime';
import { refineOoxmlFromZipBuffer } from './ooxmlRefine.js';

/** Encode a full browser sharing URL for Graph `GET /shares/{token}/...`. */
export function encodeSharingUrlForGraph(sharingUrl: string): string {
  const b64 = Buffer.from(sharingUrl, 'utf8').toString('base64');
  const urlSafe = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `u!${urlSafe}`;
}

/** Pull SharePoint / OneDrive for Business URLs from Teams HTML or plain text. */
export function extractSharePointUrlsFromTeamsBody(body: string): string[] {
  const seen = new Set<string>();
  const re =
    /https?:\/\/[a-z0-9A-Z.-]+\.sharepoint(?:-df)?\.com[^"'<>\s\)]*/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    let u = m[0].replace(/&amp;/g, '&').replace(/&quot;/g, '"');
    while (/[.,);]$/.test(u)) u = u.slice(0, -1);
    try {
      const parsed = new URL(u);
      if (parsed.pathname.toLowerCase().includes('/forms/')) continue;
      seen.add(parsed.href);
    } catch {
      /* ignore */
    }
  }
  return [...seen];
}

export async function downloadDriveItemViaSharingUrl(
  token: string,
  sharingUrl: string,
  maxBytes: number,
): Promise<ConversationAttachment | null> {
  const shareToken = encodeSharingUrlForGraph(sharingUrl);
  const seg = encodeURIComponent(shareToken);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Prefer: 'redeemSharingLinkIfNecessary',
  };

  const metaUrl = `https://graph.microsoft.com/v1.0/shares/${seg}/driveItem?$select=name,file,size`;
  const metaRes = await fetch(metaUrl, { headers });
  if (!metaRes.ok) {
    const hint = await metaRes.text();
    console.warn(
      `[GraphChat] shares/driveItem ${metaRes.status} for SharePoint link — ` +
        `ensure app has Files.ReadWrite.All (application) for /shares API. Body: ${hint.slice(0, 160)}`,
    );
    return null;
  }

  const meta = (await metaRes.json()) as {
    name?: string;
    file?: { mimeType?: string };
    size?: number;
  };
  const declared = meta.size ?? 0;
  if (declared > maxBytes) {
    console.warn(`[GraphChat] Shared file too large (${declared}): ${meta.name}`);
    return null;
  }

  const contentUrl = `https://graph.microsoft.com/v1.0/shares/${seg}/driveItem/content`;
  const binRes = await fetch(contentUrl, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'follow',
  });
  if (!binRes.ok) {
    console.warn(`[GraphChat] shares/driveItem/content ${binRes.status} for ${meta.name ?? sharingUrl.slice(0, 80)}`);
    return null;
  }

  const buf = await binRes.arrayBuffer();
  if (buf.byteLength > maxBytes) {
    console.warn(`[GraphChat] Downloaded shared file exceeds cap: ${meta.name}`);
    return null;
  }

  let name = (meta.name ?? 'shared-file').replace(/[/\\]/g, '_');
  let mimeType = meta.file?.mimeType ?? 'application/octet-stream';
  const refined = refineOoxmlFromZipBuffer(name, mimeType, buf);
  return {
    name: refined.name,
    mimeType: refined.mimeType,
    data: Buffer.from(buf).toString('base64'),
  };
}

/**
 * Try each unique SharePoint URL from HTML (max `maxUrls`) until downloads succeed.
 */
export async function downloadAttachmentsFromSharePointLinksInBody(
  token: string,
  body: string,
  maxBytesPerFile: number,
  maxUrls: number,
): Promise<ConversationAttachment[]> {
  const urls = extractSharePointUrlsFromTeamsBody(body);
  const out: ConversationAttachment[] = [];
  const tried = new Set<string>();

  for (const url of urls) {
    if (out.length >= maxUrls) break;
    if (tried.has(url)) continue;
    tried.add(url);
    const att = await downloadDriveItemViaSharingUrl(token, url, maxBytesPerFile);
    if (att) {
      console.log(`[GraphChat] Loaded file from SharePoint link in message: ${att.name} (${att.mimeType})`);
      out.push(att);
    }
  }
  return out;
}
