/**
 * Document Text Extraction
 *
 * Extracts plain text from binary Office formats (.docx, .pptx, .xlsx)
 * so they can be provided to LLMs as text context instead of raw binary gibberish.
 */

import { parseOffice } from 'officeparser';

/** MIME types that require binary-to-text extraction (Office Open XML formats). */
const OFFICE_MIME_TYPES = new Set([
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
  '.docx', '.doc', '.pptx', '.ppt', '.xlsx', '.xls', '.odt', '.ods', '.odp',
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

/**
 * Extract plain text from a base64-encoded Office document.
 * Returns the extracted text, or an error message if extraction fails.
 */
export async function extractDocumentText(base64Data: string, fileName: string): Promise<string> {
  try {
    const buffer = Buffer.from(base64Data, 'base64');
    const text = await parseOffice(buffer, { outputEncoding: 'utf8' }) as string;
    if (!text || text.trim().length === 0) {
      return `[Document "${fileName}" contained no extractable text]`;
    }
    return text.trim();
  } catch {
    return `[Failed to extract text from "${fileName}" — the file may be corrupted or password-protected]`;
  }
}
