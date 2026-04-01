interface PreviewMetadata {
  deployment_url: string;
  preview_url?: string;
  github_repo_url?: string | null;
  project_name?: string;
  registered_at?: string;
}

interface R2ObjectLike {
  text(): Promise<string>;
  httpEtag?: string;
}

interface R2BucketLike {
  get(key: string): Promise<R2ObjectLike | null>;
}

interface Env {
  PREVIEW_REGISTRY: R2BucketLike;
  PREVIEW_DOMAIN?: string;
  PREVIEW_REGISTRY_PREFIX?: string;
  ALLOWED_ORIGIN_SUFFIX?: string;
}

interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

const DEFAULT_PREVIEW_DOMAIN = 'preview.glyphor.ai';
const DEFAULT_REGISTRY_PREFIX = 'deployments';
const DEFAULT_ALLOWED_ORIGIN_SUFFIX = '.vercel.app';

function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(init?.headers ?? {}),
    },
  });
}

function getPreviewDomain(env: Env): string {
  return (env.PREVIEW_DOMAIN || DEFAULT_PREVIEW_DOMAIN).trim().toLowerCase();
}

function getRegistryPrefix(env: Env): string {
  return (env.PREVIEW_REGISTRY_PREFIX || DEFAULT_REGISTRY_PREFIX).trim().replace(/^\/+|\/+$/g, '');
}

function getAllowedOriginSuffix(env: Env): string {
  return (env.ALLOWED_ORIGIN_SUFFIX || DEFAULT_ALLOWED_ORIGIN_SUFFIX).trim().toLowerCase();
}

function buildRegistrationKey(env: Env, slug: string): string {
  return `${getRegistryPrefix(env)}/${slug}.json`;
}

function deriveSlug(hostname: string, previewDomain: string): string | null {
  const host = hostname.toLowerCase();
  if (host === previewDomain) return null;
  const suffix = `.${previewDomain}`;
  if (!host.endsWith(suffix)) return null;
  const slug = host.slice(0, -suffix.length);
  if (!slug || slug.includes('.')) return null;
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  return slug;
}

function normalizeDeploymentUrl(value: string, allowedOriginSuffix: string): URL {
  const candidate = value.trim();
  const url = new URL(candidate.startsWith('http') ? candidate : `https://${candidate}`);
  if (url.protocol !== 'https:') {
    throw new Error('deployment_url must use https.');
  }
  const hostname = url.hostname.toLowerCase();
  if (allowedOriginSuffix && !hostname.endsWith(allowedOriginSuffix)) {
    throw new Error(`deployment_url host must end with ${allowedOriginSuffix}.`);
  }
  return url;
}

async function readRegistration(env: Env, slug: string): Promise<{ metadata: PreviewMetadata; etag?: string }> {
  const object = await env.PREVIEW_REGISTRY.get(buildRegistrationKey(env, slug));
  if (!object) {
    throw new Response(`No preview registration found for ${slug}.`, { status: 404 });
  }

  let parsed: PreviewMetadata;
  try {
    parsed = JSON.parse(await object.text()) as PreviewMetadata;
  } catch {
    throw new Response(`Preview registration for ${slug} is not valid JSON.`, { status: 502 });
  }

  if (!parsed.deployment_url) {
    throw new Response(`Preview registration for ${slug} is missing deployment_url.`, { status: 502 });
  }

  return { metadata: parsed, etag: object.httpEtag };
}

function rewriteLocation(location: string, targetOrigin: URL, requestUrl: URL): string {
  const resolved = new URL(location, targetOrigin);
  if (resolved.origin === targetOrigin.origin) {
    resolved.protocol = requestUrl.protocol;
    resolved.host = requestUrl.host;
  }
  return resolved.toString();
}

function copyProxyHeaders(request: Request, slug: string): Headers {
  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.set('x-forwarded-host', new URL(request.url).host);
  headers.set('x-glyphor-preview-slug', slug);
  return headers;
}

function buildOriginRequest(request: Request, targetUrl: URL, slug: string): Request {
  const init: RequestInit = {
    method: request.method,
    headers: copyProxyHeaders(request, slug),
    redirect: 'manual',
  };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
  }

  return new Request(targetUrl.toString(), init);
}

async function handleMetadata(requestUrl: URL, env: Env, slug: string): Promise<Response> {
  const { metadata, etag } = await readRegistration(env, slug);
  return json(
    {
      slug,
      preview_domain: getPreviewDomain(env),
      registration_key: buildRegistrationKey(env, slug),
      ...metadata,
    },
    {
      status: 200,
      headers: etag ? { etag } : undefined,
    },
  );
}

async function handleProxy(request: Request, env: Env, slug: string): Promise<Response> {
  const { metadata } = await readRegistration(env, slug);
  const requestUrl = new URL(request.url);
  const targetOrigin = normalizeDeploymentUrl(metadata.deployment_url, getAllowedOriginSuffix(env));
  const targetUrl = new URL(requestUrl.pathname + requestUrl.search, targetOrigin);

  const originResponse = await fetch(buildOriginRequest(request, targetUrl, slug));
  const responseHeaders = new Headers(originResponse.headers);
  responseHeaders.set('x-robots-tag', 'noindex, nofollow');
  responseHeaders.set('x-glyphor-preview-slug', slug);
  responseHeaders.set('cache-control', 'no-store');

  const location = responseHeaders.get('location');
  if (location) {
    responseHeaders.set('location', rewriteLocation(location, targetOrigin, requestUrl));
  }

  return new Response(originResponse.body, {
    status: originResponse.status,
    statusText: originResponse.statusText,
    headers: responseHeaders,
  });
}

async function routeRequest(request: Request, env: Env): Promise<Response> {
  const requestUrl = new URL(request.url);
  const previewDomain = getPreviewDomain(env);
  const slug = deriveSlug(requestUrl.hostname, previewDomain);

  if (requestUrl.pathname === '/__preview/health') {
    return json({ ok: true, preview_domain: previewDomain, hostname: requestUrl.hostname });
  }

  if (!slug) {
    return json(
      {
        ok: false,
        error: `Expected a hostname like <slug>.${previewDomain}.`,
      },
      { status: 404 },
    );
  }

  if (requestUrl.pathname === '/__preview/meta') {
    return handleMetadata(requestUrl, env, slug);
  }

  return handleProxy(request, env, slug);
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContextLike): Promise<Response> {
    try {
      return await routeRequest(request, env);
    } catch (error) {
      if (error instanceof Response) {
        return error;
      }

      return json(
        {
          ok: false,
          error: error instanceof Error ? error.message : 'Unexpected preview worker error.',
        },
        { status: 500 },
      );
    }
  },
};