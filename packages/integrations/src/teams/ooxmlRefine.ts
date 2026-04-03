/**
 * Fix MIME/filename when Teams/Graph returns generic types or names without extensions
 * for Office Open XML (zip) payloads.
 */

export function refineOoxmlFromZipBuffer(
  name: string,
  mimeType: string,
  buf: ArrayBuffer,
): { name: string; mimeType: string } {
  const b = Buffer.from(buf);
  if (b.length < 4 || b[0] !== 0x50 || b[1] !== 0x4b) {
    return { name, mimeType };
  }
  let kind: 'pptx' | 'docx' | 'xlsx' | null = null;
  if (b.includes(Buffer.from('ppt/slides/slide')) || b.includes(Buffer.from('ppt/presentation.xml'))) {
    kind = 'pptx';
  } else if (b.includes(Buffer.from('word/document.xml'))) {
    kind = 'docx';
  } else if (b.includes(Buffer.from('xl/workbook.xml'))) {
    kind = 'xlsx';
  }
  if (!kind) return { name, mimeType };

  const mimeByKind: Record<'pptx' | 'docx' | 'xlsx', string> = {
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
  const ext = `.${kind}`;
  const hasOfficeExt = /\.(pptx|docx|xlsx|ppt|doc|xls)$/i.test(name);
  const nextName = hasOfficeExt ? name : `${name}${ext}`;
  const vagueMime =
    mimeType === 'application/octet-stream' ||
    mimeType === 'binary/octet-stream' ||
    mimeType === '' ||
    mimeType === 'reference';
  const nextMime = vagueMime ? mimeByKind[kind] : mimeType;
  return { name: nextName, mimeType: nextMime };
}
