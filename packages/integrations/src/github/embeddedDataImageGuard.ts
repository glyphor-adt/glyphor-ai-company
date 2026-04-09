/**
 * Block embedded raster data URLs in GitHub-bound text and catch mistaken data-URL
 * payloads passed as "binary" image paths (website pipeline / agents).
 */

/** Raster (or SVG) data URIs in source — use real media files + paths instead. */
const DATA_IMAGE_BASE64_PATTERN = /data:image\/[a-zA-Z0-9.+-]+;base64,/i;

export function isBinaryMediaPath(filePath: string): boolean {
  return /\.(png|jpg|jpeg|gif|webp|svg|ico|mp4|webm|avif|bmp|tiff?)$/i.test(filePath);
}

/**
 * Lines like `path: reason` for batch push validation.
 */
export function dataImageUriViolations(files: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [filePath, raw] of Object.entries(files)) {
    const line = violationForPlannedCommit(filePath, raw);
    if (line) out.push(line);
  }
  return out;
}

function violationForPlannedCommit(filePath: string, raw: string): string | null {
  const content = typeof raw === 'string' ? raw : '';
  if (!content) return null;

  if (isBinaryMediaPath(filePath)) {
    if (DATA_IMAGE_BASE64_PATTERN.test(content) || /^data:image\//i.test(content.trimStart())) {
      return `${filePath}: expected raw base64 image bytes for this path, not a data: URL`;
    }
    return null;
  }

  if (DATA_IMAGE_BASE64_PATTERN.test(content)) {
    return `${filePath}: embedded data:image/*;base64 URI in text source`;
  }
  return null;
}

const EMBEDDED_URI_USER_MESSAGE =
  'Refused: embedded data:image/*;base64 in file content. Commit JPEG/PNG (or other) binaries and reference paths, or use upload_asset / CDN URLs.';

/** Throws if UTF-8 text content contains an embedded raster data URI. */
export function assertNoEmbeddedDataImageInTextContent(content: string): void {
  if (DATA_IMAGE_BASE64_PATTERN.test(content)) {
    throw new Error(EMBEDDED_URI_USER_MESSAGE);
  }
}

/**
 * Throws if a buffer committed as binary media looks like a data-URL string instead of raw bytes.
 */
export function assertBinaryImageBufferNotDataUri(path: string, content: Buffer): void {
  if (!isBinaryMediaPath(path) || content.length === 0) return;
  const sample = content.subarray(0, Math.min(content.length, 256)).toString('latin1');
  if (DATA_IMAGE_BASE64_PATTERN.test(sample) || /^[\s\n]*data:image\//i.test(sample)) {
    throw new Error(
      `${EMBEDDED_URI_USER_MESSAGE} (${path}: use raw image bytes, not a data: URL string).`,
    );
  }
}
