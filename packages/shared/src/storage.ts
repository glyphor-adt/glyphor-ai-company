import { Storage } from '@google-cloud/storage';

const storage = new Storage({ projectId: 'ai-glyphor-company' });
const bucket = storage.bucket('glyphor-platform-assets');

export async function uploadFile(
  path: string,
  content: Buffer | string,
  contentType: string = 'application/octet-stream'
): Promise<string> {
  const file = bucket.file(path);
  await file.save(content, { contentType });
  return `https://storage.googleapis.com/glyphor-platform-assets/${path}`;
}

export async function getSignedUrl(path: string, expiresInMinutes: number = 60): Promise<string> {
  const file = bucket.file(path);
  const [url] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + expiresInMinutes * 60 * 1000,
  });
  return url;
}

export async function downloadFile(path: string): Promise<Buffer> {
  const file = bucket.file(path);
  const [content] = await file.download();
  return content;
}

export async function deleteFile(path: string): Promise<void> {
  const file = bucket.file(path);
  await file.delete({ ignoreNotFound: true });
}

export async function uploadTenantFile(
  tenantId: string,
  filename: string,
  content: Buffer | string,
  contentType: string
): Promise<string> {
  return uploadFile(`tenants/${tenantId}/${filename}`, content, contentType);
}
