/**
 * Document Text Extraction
 *
 * Extracts plain text from binary document formats (.docx, .pptx, .xlsx, .pdf)
 * so they can be provided to LLMs as text context instead of raw binary.
 */

import JSZip from 'jszip';
import { parseOffice } from 'officeparser';

/** MIME types that require binary-to-text extraction. */
const OFFICE_MIME_TYPES = new Set([
  'application/pdf',                                                            // .pdf
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',   // .docx
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',         // .xlsx
  'application/msword',                                                         // .doc
  'application/vnd.ms-excel',                                                   // .xls
  'application/vnd.ms-powerpoint',                                              // .ppt
  'application/vnd.oasis.opendocument.text',                                    // .odt
  'application/vnd.oasis.opendocument.spreadsheet',                             // .ods
  'application/vnd.oasis.opendocument.presentation',                            // .odp
]);

/** File extensions that indicate Office formats (fallback when MIME type is generic). */
const OFFICE_EXTENSIONS = new Set([
  '.pdf', '.docx', '.doc', '.pptx', '.ppt', '.xlsx', '.xls', '.odt', '.ods', '.odp',
]);

/**
 * Returns true if the attachment is a binary Office document that needs
 * text extraction (rather than raw UTF-8 decode).
 */
export function isOfficeDocument(mimeType: string, fileName: string): boolean {
  if (OFFICE_MIME_TYPES.has(mimeType)) return true;
  const ext = fileName.toLowerCase().match(/\.[^.]+$/)?.[0];
  return ext ? OFFICE_EXTENSIONS.has(ext) : false;
}

/** OOXML zip: detect pptx structure without full unzip (for unnamed/octet-stream Teams uploads). */
export function looksLikePptxBuffer(buf: Buffer): boolean {
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) return false;
  return (
    buf.includes(Buffer.from('ppt/slides/slide')) ||
    buf.includes(Buffer.from('ppt/presentation.xml')) ||
    buf.includes(Buffer.from('presentationml.presentation'))
  );
}

/**
 * Pull text from pptx slide XML (DrawingML <a:t>) when officeparser returns little or nothing.
 */
async function extractPptxTextViaJsZip(buffer: Buffer): Promise<string | null> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const slidePaths = Object.keys(zip.files)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
      .sort((a, b) => {
        const na = parseInt(/\d+/.exec(a)?.[0] ?? '0', 10);
        const nb = parseInt(/\d+/.exec(b)?.[0] ?? '0', 10);
        return na - nb;
      });
    const parts: string[] = [];
    for (const path of slidePaths) {
      const entry = zip.file(path);
      if (!entry) continue;
      const xml = await entry.async('string');
      const texts = [...xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)].map((m) => m[1].trim()).filter(Boolean);
      if (texts.length) parts.push(texts.join(' '));
    }
    const merged = parts.join('\n\n').trim();
    return merged.length > 0 ? merged : null;
  } catch {
    return null;
  }
}

async function tryExtractPptxFallback(buffer: Buffer, fileName: string): Promise<string | null> {
  const lower = fileName.toLowerCase();
  if (!lower.endsWith('.pptx') && !looksLikePptxBuffer(buffer)) return null;
  return extractPptxTextViaJsZip(buffer);
}

/**
 * Extract plain text from a base64-encoded Office document.
 * Returns the extracted text, or an error message if extraction fails.
 */
export async function extractDocumentText(base64Data: string, fileName: string): Promise<string> {
  const buffer = Buffer.from(base64Data, 'base64');
  const pdfHint =
    ' If this is a slide deck, export to PDF or paste key bullets — image-only slides have no extractable text.';

  try {
    const ast = await parseOffice(buffer);
    const text = ast.toText();
    if (text && text.trim().length > 0) {
      return text.trim();
    }
    const fb = await tryExtractPptxFallback(buffer, fileName);
    if (fb) return fb;
    console.warn(`[documentExtractor] No text from officeparser for "${fileName}" (${buffer.length} bytes); fallback empty`);
    return `[Document "${fileName}" contained no extractable text.]${pdfHint}`;
  } catch (err) {
    const fb = await tryExtractPptxFallback(buffer, fileName);
    if (fb) return fb;
    const msg = (err as Error).message ?? String(err);
    console.warn(`[documentExtractor] extract failed "${fileName}": ${msg}`);
    return `[Failed to extract text from "${fileName}".${pdfHint} (${msg})]`;
  }
}
