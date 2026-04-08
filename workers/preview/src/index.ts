/**
 * Glyphor Preview Worker
 *
 * Strategy:
 * 1. Extract project slug from subdomain: {slug}.preview.glyphor.ai
 * 2. Look up deployment metadata in R2: deployments/{slug}.json
 * 3. Proxy content from deployment_url stored in metadata
 *    (always the canonical public Vercel URL, never auth-protected preview URLs)
 *
 * Bindings (wrangler.toml):
 *   R2 bucket: PREVIEW_REGISTRY → glyphor-fuse-storage
 */

interface PreviewMetadata {
  deployment_url: string;
  preview_url?: string;
  github_repo_url?: string | null;
  project_name?: string | null;
  repo_name?: string | null;
}

interface R2ObjectLike {
  json<T = unknown>(): Promise<T>;
}

interface R2BucketLike {
  get(key: string): Promise<R2ObjectLike | null>;
}

interface Env {
  PREVIEW_REGISTRY: R2BucketLike;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: getCorsHeaders() });
    }

    const url = new URL(request.url);
    const projectSlug = extractProjectSlug(url.hostname);

    if (!projectSlug) {
      return Response.redirect('https://glyphor.ai', 302);
    }

    console.log(`[Preview Worker] Request for slug: ${projectSlug}`);

    try {
      if (!env.PREVIEW_REGISTRY) {
        console.error('[Preview Worker] ❌ PREVIEW_REGISTRY R2 bucket not bound');
        return htmlResponse(generateErrorPage(projectSlug, '500 - Configuration Error', null), 500);
      }

      // R2 lookup
      const metadata = await getMetadataFromR2(projectSlug, env.PREVIEW_REGISTRY);

      if (!metadata?.deployment_url) {
        console.error(`[Preview Worker] ❌ No metadata for slug: ${projectSlug}`);
        return htmlResponse(generateErrorPage(projectSlug, 'Deployment Not Found', null, true), 404);
      }

      // Validate preview_url matches incoming request
      const incomingOrigin = `${url.protocol}//${url.hostname}`.replace(/\/$/, '');
      const metadataOrigin = String(metadata.preview_url ?? '').replace(/\/$/, '');
      if (metadataOrigin && metadataOrigin !== incomingOrigin) {
        console.error(`[Preview Worker] ❌ preview_url mismatch: request=${incomingOrigin} metadata=${metadataOrigin}`);
        return htmlResponse(generateErrorPage(projectSlug, 'Preview Mapping Mismatch', metadata.github_repo_url ?? null), 409);
      }

      const targetUrl = new URL(metadata.deployment_url);
      targetUrl.pathname = url.pathname;
      targetUrl.search = url.search;

      console.log(`[Preview Worker] ✅ Proxying to: ${targetUrl}`);

      let upstream = await fetch(targetUrl.toString(), {
        headers: { 'User-Agent': request.headers.get('User-Agent') ?? 'Glyphor-Preview-Worker/1.0' },
      });

      // 401 resilience: retry against canonical Vercel domain
      if (upstream.status === 401) {
        const canonical = buildCanonicalVercelUrl(metadata, projectSlug, url);
        if (canonical && canonical !== targetUrl.toString()) {
          console.warn(`[Preview Worker] ⚠️ 401, retrying canonical: ${canonical}`);
          upstream = await fetch(canonical, {
            headers: { 'User-Agent': request.headers.get('User-Agent') ?? 'Glyphor-Preview-Worker/1.0' },
          });
        }
      }

      if (!upstream.ok) {
        console.error(`[Preview Worker] ❌ Upstream ${upstream.status}`);
        return htmlResponse(generateErrorPage(projectSlug, '404 - Project Not Found', metadata.github_repo_url ?? null), 404);
      }

      const contentType = upstream.headers.get('Content-Type') ?? 'text/html';
      const isBinary = /^(image|audio|video|font)\//.test(contentType)
        || /octet-stream|pdf|zip|wasm/.test(contentType);

      const body = isBinary ? await upstream.arrayBuffer() : await upstream.text();

      return new Response(body, {
        status: upstream.status,
        headers: { ...getResponseHeaders(contentType), 'X-Content-Type-Options': 'nosniff' },
      });

    } catch (err) {
      console.error('[Preview Worker] ❌ Unhandled error:', err);
      return htmlResponse(generateErrorPage(projectSlug, '500 - Internal Server Error', null), 500);
    }
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractProjectSlug(hostname: string): string | null {
  const match = hostname.match(/^([^.]+)\.preview\.glyphor\.ai$/);
  return match ? match[1] : null;
}

async function getMetadataFromR2(slug: string, bucket: R2BucketLike): Promise<PreviewMetadata | null> {
  try {
    const key = `deployments/${slug}.json`;
    console.log(`[Preview Worker] R2 lookup: ${key}`);
    const obj = await bucket.get(key);
    if (!obj) { console.log(`[Preview Worker] R2 miss: ${key}`); return null; }
    const data = await obj.json<PreviewMetadata>();
    console.log(`[Preview Worker] ✅ R2 hit: ${slug}`);
    return data;
  } catch (e) {
    console.error('[Preview Worker] R2 error:', e);
    return null;
  }
}

function buildCanonicalVercelUrl(metadata: PreviewMetadata, slug: string, incomingUrl: URL): string | null {
  try {
    const candidates = [metadata.repo_name, metadata.project_name, slug].filter(Boolean) as string[];
    for (const raw of candidates) {
      const n = raw.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').replace(/--+/g, '-');
      if (!n) continue;
      const u = new URL(incomingUrl.toString());
      u.hostname = `${n}.vercel.app`;
      return u.toString();
    }
  } catch (e) {
    console.warn('[Preview Worker] canonical URL build failed:', e);
  }
  return null;
}

function getCorsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function getResponseHeaders(contentType: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': contentType, ...getCorsHeaders() };
  if (contentType.includes('text/html')) {
    headers['X-Frame-Options'] = 'ALLOWALL';
    headers['Content-Security-Policy'] = "frame-ancestors *; default-src * 'unsafe-inline' 'unsafe-eval' data: blob:";
  }
  return headers;
}

function htmlResponse(body: string, status: number): Response {
  return new Response(body, { status, headers: getResponseHeaders('text/html') });
}

function generateErrorPage(slug: string, message: string, repoUrl: string | null, showTroubleshoot = false): string {
  const troubleshoot = showTroubleshoot
    ? `<p><strong>Just built?</strong> Wait 1–2 min for R2 to update, then refresh.</p>
       <p><strong>Otherwise:</strong> Check that Cloud Run has R2 secrets and the build pipeline completed.</p>`
    : '';
  const repoLink = repoUrl ? `<p><a href="${repoUrl}" target="_blank">View on GitHub</a></p>` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Preview Not Found — ${slug}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
           display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0;
           background: linear-gradient(135deg,#667eea 0%,#764ba2 100%); color:white; }
    .box { text-align:center; padding:2rem; max-width:560px; }
    h1 { font-size:2.2rem; margin-bottom:1rem; }
    p  { font-size:1rem; opacity:.9; text-align:left; margin-bottom:.75rem; }
    .slug { font-size:.9rem; opacity:.6; margin-top:1.5rem; }
    a { color:white; }
    code { background:rgba(0,0,0,.2); padding:.1em .3em; border-radius:3px; }
  </style>
</head>
<body>
  <div class="box">
    <h1>🚫 ${message}</h1>
    <p>No deployment found for this preview.</p>
    ${troubleshoot}${repoLink}
    <div class="slug">Slug: ${slug}</div>
  </div>
</body>
</html>`;
}

