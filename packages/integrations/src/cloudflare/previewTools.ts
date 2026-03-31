import type { ToolContext, ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { getWebsitePipelineBucket, requireWebsitePipelineEnv } from '../websitePipelineEnv.js';

const R2_BUCKET = getWebsitePipelineBucket();
const PREVIEW_DOMAIN = 'preview.glyphor.ai';

function getR2Config(): { endpoint: string; accessKeyId: string; secretAccessKey: string } {
  const endpoint = requireWebsitePipelineEnv('r2-endpoint');
  const accessKeyId = requireWebsitePipelineEnv('r2-access-key-id');
  const secretAccessKey = requireWebsitePipelineEnv('r2-secret-access-key');

  return { endpoint, accessKeyId, secretAccessKey };
}

async function sha256(message: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(message));
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function hmac(key: ArrayBuffer | string, message: string): Promise<ArrayBuffer> {
  const importedKey = await crypto.subtle.importKey(
    'raw',
    typeof key === 'string' ? new TextEncoder().encode(key) : key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', importedKey, new TextEncoder().encode(message));
}

async function signedR2Put(
  endpoint: string,
  accessKeyId: string,
  secretAccessKey: string,
  bucket: string,
  key: string,
  body: string,
  contentType: string,
): Promise<{ ok: boolean; status: number }> {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]/g, '').replace(/\.\d{3}Z/, 'Z');
  const dateStamp = amzDate.slice(0, 8);
  const host = new URL(endpoint).hostname;
  const url = `${endpoint}/${bucket}/${key}`;
  const payloadHash = toHex(await sha256(body));

  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = ['PUT', `/${bucket}/${key}`, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    toHex(await sha256(canonicalRequest)),
  ].join('\n');

  const signingKey = await hmac(
    await hmac(await hmac(await hmac(`AWS4${secretAccessKey}`, dateStamp), 'auto'), 's3'),
    'aws4_request',
  );
  const signature = toHex(await hmac(signingKey, stringToSign));
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      Authorization: authorization,
    },
    body,
  });

  return { ok: response.ok, status: response.status };
}

async function writePreviewMetadata(
  projectSlug: string,
  vercelDeploymentUrl: string,
  githubRepoUrl: string | null,
  projectName: string,
): Promise<{ previewUrl: string; r2Key: string }> {
  const { endpoint, accessKeyId, secretAccessKey } = getR2Config();
  const previewUrl = `https://${projectSlug}.${PREVIEW_DOMAIN}`;
  const normalizedVercelUrl = vercelDeploymentUrl.replace(/\/$/, '');
  const r2Key = `deployments/${projectSlug}.json`;
  const body = JSON.stringify({
    deployment_url: normalizedVercelUrl,
    preview_url: previewUrl,
    github_repo_url: githubRepoUrl,
    project_name: projectName,
    registered_at: new Date().toISOString(),
  }, null, 2);

  const result = await signedR2Put(
    endpoint,
    accessKeyId,
    secretAccessKey,
    R2_BUCKET,
    r2Key,
    body,
    'application/json',
  );

  if (!result.ok) {
    throw new Error(`Failed to write deployment metadata to R2 (HTTP ${result.status}).`);
  }

  return { previewUrl, r2Key };
}

function buildPreviewTool(
  name: 'cloudflare_register_preview' | 'cloudflare_update_preview',
  description: string,
): ToolDefinition {
  return {
    name,
    description,
    parameters: {
      project_slug: {
        type: 'string',
        description: 'URL-safe project slug.',
        required: true,
      },
      vercel_deployment_url: {
        type: 'string',
        description: 'Vercel deployment URL.',
        required: true,
      },
      github_repo_url: {
        type: 'string',
        description: 'Optional GitHub repository URL.',
        required: false,
      },
      project_name: {
        type: 'string',
        description: 'Optional human-readable project name.',
        required: false,
      },
    },
    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
      const projectSlug = String(params.project_slug ?? '').trim();
      if (!projectSlug) return { success: false, error: 'project_slug is required.' };
      if (!/^[a-z0-9-]+$/.test(projectSlug)) {
        return { success: false, error: 'project_slug must use lowercase letters, numbers, and hyphens only.' };
      }

      const vercelDeploymentUrl = String(params.vercel_deployment_url ?? '').trim();
      if (!vercelDeploymentUrl) {
        return { success: false, error: 'vercel_deployment_url is required.' };
      }

      try {
        const { previewUrl, r2Key } = await writePreviewMetadata(
          projectSlug,
          vercelDeploymentUrl,
          String(params.github_repo_url ?? '').trim() || null,
          String(params.project_name ?? '').trim() || projectSlug,
        );
        return {
          success: true,
          data: {
            preview_url: previewUrl,
            vercel_url: vercelDeploymentUrl.replace(/\/$/, ''),
            r2_key: r2Key,
          },
        };
      } catch (err) {
        return {
          success: false,
          error: `Failed to write preview metadata: ${(err as Error).message}`,
        };
      }
    },
  };
}

export function createCloudflarePreviewTools(): ToolDefinition[] {
  return [
    buildPreviewTool(
      'cloudflare_register_preview',
      'Register a Vercel deployment with the Glyphor preview system and return the clean preview URL.',
    ),
    buildPreviewTool(
      'cloudflare_update_preview',
      'Update an existing Glyphor preview registration to point at the latest Vercel deployment.',
    ),
  ];
}