/**
 * Glyphor Logo — base64-encoded PNG for embedding in PPTX / DOCX exports.
 * pptxgenjs accepts data URIs via `slide.addImage({ data: '...' })`.
 */

import fs from 'node:fs';
import path from 'node:path';

const LOGO_PATHS = [
  path.resolve(import.meta.dirname, '../../dashboard/public/glyphor-logo.png'),
  path.resolve(import.meta.dirname, '../public/glyphor-logo.png'),
  path.resolve(import.meta.dirname, '../../../public/FullLogo_Transparent.png'),
];

function loadLogoPng(): Buffer | null {
  for (const p of LOGO_PATHS) {
    try { if (fs.existsSync(p)) return fs.readFileSync(p); } catch { /* skip */ }
  }
  return null;
}

const logoBuf = loadLogoPng();

/** Base64-encoded PNG data URI for pptxgenjs addImage({ data }) */
export const LOGO_DATA_URI: string | null = logoBuf
  ? `data:image/png;base64,${logoBuf.toString('base64')}`
  : null;

/** Raw PNG buffer (for docx ImageRun or other embedding) */
export const LOGO_PNG_BUFFER: Buffer | null = logoBuf;
