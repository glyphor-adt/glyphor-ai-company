/**
 * Cloudflare Preview Registration Tool
 *
 * After Vercel deploys a client site, this tool writes deployment metadata
 * to R2 so the Cloudflare Worker (glyphor-preview-proxy) can serve it at:
 * https://{slug}.preview.glyphor.ai
 *
 * The Worker reads: deployments/{slug}.json from glyphor-fuse-storage R2 bucket.
 * This tool writes exactly that file.
 *
 * Add to: packages/integrations/src/cloudflare/previewTools.ts
 * Register in: packages/agents/src/shared/scaffoldTools.ts
 *
 * Required secrets in GCP Secret Manager:
 *   PREVIEWS_R2_ENDPOINT          — R2 S3-compatible endpoint URL
 *   PREVIEWS_R2_ACCESS_KEY_ID     — R2 access key ID
 *   PREVIEWS_R2_SECRET_ACCESS_KEY — R2 secret access key
 *   PREVIEWS_R2_BUCKET            — bucket name (default: glyphor-fuse-storage)
 */

import type { ToolContext, ToolDefinition, ToolResult } from '@glyphor/agent-runtime';

const R2_BUCKET = process.env.PREVIEWS_R2_BUCKET || 'glyphor-fuse-storage';
const PREVIEW_DOMAIN = 'preview.glyphor.ai';

// ─── AWS Signature V4 (R2 is S3-compatible) ───────────────────────────────────

function getR2Config(): { endpoint: string; accessKeyId: string; secretAccessKey: string } {
  const endpoint = process.env.PREVIEWS_R2_ENDPOINT?.trim();
  const accessKeyId = process.env.PREVIEWS_R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.PREVIEWS_R2_SECRET_ACCESS_KEY?.trim();

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'R2 credentials not configured. Set PREVIEWS_R2_ENDPOINT, ' +
      'PREVIEWS_R2_ACCESS_KEY_ID, and PREVIEWS_R2_SECRET_ACCESS_KEY in Secret Manager.',
    );
  }

  return { endpoint, accessKeyId, secretAccessKey };
}

async function sha256(message: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  return crypto.subtle.digest('SHA-256', data);
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmac(key: ArrayBuffer | string, message: string): Promise<ArrayBuffer> {
  const keyMaterial =
    typeof key === 'string'
      ? await crypto.subtle.importKey(
          'raw',
          new TextEncoder().encode(key),
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign'],
        )
      : await crypto.subtle.importKey(
          'raw',
          key,
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign'],
        );
  return crypto.subtle.sign('HMAC', keyMaterial, new TextEncoder().encode(message));
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

  const endpointUrl = new URL(endpoint);
  const host = endpointUrl.hostname;
  const url = `${endpoint}/${bucket}/${key}`;

  const payloadHash = toHex(await sha256(body));
  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;

  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [
    'PUT',
    `/${bucket}/${key}`,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    toHex(await sha256(canonicalRequest)),
  ].join('\n');

  const signingKey = await hmac(
    await hmac(
      await hmac(
        await hmac(`AWS4${secretAccessKey}`, dateStamp),
        'auto',
      ),
      's3',
    ),
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

// ─── Tool Definition ───────────────────────────────────────────────────────────

export function createCloudflarePreviewTools(): ToolDefinition[] {
  return [
    {
      name: 'cloudflare_register_preview',
      description:
        'Registers a Vercel deployment with the Glyphor preview system. ' +
        'Writes deployment metadata to R2 so the Cloudflare Worker serves it at ' +
        'https://{slug}.preview.glyphor.ai. ' +
        'Always call this after vercel_get_preview_url returns READY. ' +
        'Returns the clean preview URL to use for screenshots and client sharing.',
      parameters: {
        project_slug: {
          type: 'string',
          description:
            'URL-safe project slug. Must match the repo name. ' +
            'e.g. "acme-corp-landing". Lowercase, hyphens only.',
          required: true,
        },
        vercel_deployment_url: {
          type: 'string',
          description:
            'The Vercel deployment URL returned by vercel_get_preview_url. ' +
            'e.g. "https://acme-corp-landing-xxx.vercel.app"',
          required: true,
        },
        github_repo_url: {
          type: 'string',
          description:
            'GitHub repo URL for this project. ' +
            'e.g. "https://github.com/Glyphor-Fuse/acme-corp-landing"',
          required: false,
        },
        project_name: {
          type: 'string',
          description:
            'Human-readable project name. e.g. "Acme Corp Landing Page"',
          required: false,
        },
      },
      async execute(
        params: Record<string, unknown>,
        _ctx: ToolContext,
      ): Promise<ToolResult> {
        const projectSlug = String(params.project_slug ?? '').trim();
        if (!projectSlug) {
          return { success: false, error: 'project_slug is required.' };
        }

        // Validate slug format
        if (!/^[a-z0-9-]+$/.test(projectSlug)) {
          return {
            success: false,
            error:
              `project_slug must be lowercase letters, numbers, and hyphens only. ` +
              `Received: "${projectSlug}"`,
          };
        }

        const vercelDeploymentUrl = String(params.vercel_deployment_url ?? '').trim();
        if (!vercelDeploymentUrl) {
          return { success: false, error: 'vercel_deployment_url is required.' };
        }

        const githubRepoUrl = String(params.github_repo_url ?? '').trim() || null;
        const projectName = String(params.project_name ?? '').trim() || projectSlug;
        const previewUrl = `https://${projectSlug}.${PREVIEW_DOMAIN}`;

        // Normalize Vercel URL — strip trailing slash
        const normalizedVercelUrl = vercelDeploymentUrl.replace(/\/$/, '');

        // Build the metadata object the Worker expects
        const metadata = {
          deployment_url: normalizedVercelUrl,
          preview_url: previewUrl,
          github_repo_url: githubRepoUrl,
          project_name: projectName,
          registered_at: new Date().toISOString(),
        };

        const r2Key = `deployments/${projectSlug}.json`;
        const body = JSON.stringify(metadata, null, 2);

        console.log(
          `[CloudflarePreview] Writing R2 key: ${r2Key} → ${normalizedVercelUrl}`,
        );

        try {
          const { endpoint, accessKeyId, secretAccessKey } = getR2Config();

          const { ok, status } = await signedR2Put(
            endpoint,
            accessKeyId,
            secretAccessKey,
            R2_BUCKET,
            r2Key,
            body,
            'application/json',
          );

          if (!ok) {
            return {
              success: false,
              error:
                `Failed to write deployment metadata to R2 (HTTP ${status}). ` +
                `Check PREVIEWS_R2_* credentials and bucket permissions.`,
            };
          }

          console.log(
            `[CloudflarePreview] ✅ Registered: ${previewUrl} → ${normalizedVercelUrl}`,
          );

          return {
            success: true,
            data: {
              preview_url: previewUrl,
              vercel_url: normalizedVercelUrl,
              r2_key: r2Key,
              message:
                `Preview registered. Live at: ${previewUrl}. ` +
                `Use this URL for screenshots and client sharing. ` +
                `Note: Cloudflare may take 10-30s to serve the first request.`,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to register preview: ${(err as Error).message}`,
          };
        }
      },
    },

    {
      name: 'cloudflare_update_preview',
      description:
        'Updates an existing preview registration with a new Vercel deployment URL. ' +
        'Use during iteration rounds when a new Vercel deployment replaces the previous one. ' +
        'Same as cloudflare_register_preview but makes intent explicit during revision cycles.',
      parameters: {
        project_slug: {
          type: 'string',
          description: 'The project slug to update.',
          required: true,
        },
        vercel_deployment_url: {
          type: 'string',
          description: 'The new Vercel deployment URL.',
          required: true,
        },
      },
      async execute(
        params: Record<string, unknown>,
        ctx: ToolContext,
      ): Promise<ToolResult> {
        // Delegates to register — R2 PUT is idempotent, overwrites existing key
        return createCloudflarePreviewTools()[0].execute(params, ctx);
      },
    },
  ];
}
