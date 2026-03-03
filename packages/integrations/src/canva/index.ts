/**
 * Canva Connect API — REST client
 *
 * Wraps the Canva Connect REST API v1 for design creation, asset management,
 * brand template autofill, and design export.
 *
 * Endpoint reference: https://www.canva.dev/docs/connect/api-reference/
 *
 * Environment variables:
 *   CANVA_CLIENT_ID      — OAuth integration client ID
 *   CANVA_CLIENT_SECRET  — OAuth integration client secret
 *   CANVA_REFRESH_TOKEN  — Long-lived refresh token from initial OAuth flow
 */

const CANVA_API_BASE = 'https://api.canva.com/rest/v1';
const CANVA_TOKEN_URL = 'https://api.canva.com/rest/v1/oauth/token';

// ── Token cache ──────────────────────────────────────────────

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

function getCredentials() {
  const clientId = process.env.CANVA_CLIENT_ID;
  const clientSecret = process.env.CANVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('CANVA_CLIENT_ID and CANVA_CLIENT_SECRET must be configured');
  }
  return { clientId, clientSecret };
}

async function refreshAccessToken(): Promise<string> {
  const { clientId, clientSecret } = getCredentials();
  const refreshToken = process.env.CANVA_REFRESH_TOKEN;
  if (!refreshToken) {
    throw new Error(
      'No CANVA_REFRESH_TOKEN found. Complete the OAuth flow first: ' +
      'POST /oauth/canva/callback on the scheduler with the authorization code.',
    );
  }

  const res = await fetch(CANVA_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Canva token refresh failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    token_type: string;
    expires_in: number;
    refresh_token?: string;
    scope: string;
  };

  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return data.access_token;
}

async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.accessToken;
  }
  return refreshAccessToken();
}

// ── Authenticated fetch ──────────────────────────────────────

export async function canvaFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const token = await getAccessToken();
  const url = path.startsWith('http') ? path : `${CANVA_API_BASE}${path}`;

  return fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
    signal: options.signal ?? AbortSignal.timeout(30_000),
  });
}

// ── OAuth code exchange (one-time setup) ─────────────────────

export async function exchangeCanvaCode(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const { clientId, clientSecret } = getCredentials();

  const res = await fetch(CANVA_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Canva code exchange failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
    scope: string;
  };

  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  };
}

// ── Design APIs ──────────────────────────────────────────────

export interface CreateDesignOptions {
  title?: string;
  /** Preset design type or custom dimensions */
  designType?: { type: 'preset'; name: 'doc' | 'whiteboard' | 'presentation' }
    | { type: 'custom'; width: number; height: number };
  /** Asset ID to insert into the design */
  assetId?: string;
}

export interface CanvaDesign {
  id: string;
  title?: string;
  urls?: { edit_url?: string; view_url?: string };
  thumbnail?: { url: string; width: number; height: number };
  created_at?: number;
  updated_at?: number;
}

export async function createDesign(opts: CreateDesignOptions = {}): Promise<CanvaDesign> {
  const body: Record<string, unknown> = {};
  if (opts.title) body.title = opts.title;
  if (opts.designType) body.design_type = opts.designType;
  if (opts.assetId) body.asset_id = opts.assetId;

  const res = await canvaFetch('/designs', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Create design failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { design: CanvaDesign };
  return data.design;
}

export async function getDesign(designId: string): Promise<CanvaDesign> {
  const res = await canvaFetch(`/designs/${encodeURIComponent(designId)}`);
  if (!res.ok) throw new Error(`Get design failed (${res.status})`);
  const data = (await res.json()) as { design: CanvaDesign };
  return data.design;
}

export async function listDesigns(query?: string, continuation?: string): Promise<{ items: CanvaDesign[]; continuation?: string }> {
  const params = new URLSearchParams();
  if (query) params.set('query', query);
  if (continuation) params.set('continuation', continuation);
  const qs = params.toString();
  const res = await canvaFetch(`/designs${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error(`List designs failed (${res.status})`);
  return res.json() as Promise<{ items: CanvaDesign[]; continuation?: string }>;
}

// ── Asset APIs ───────────────────────────────────────────────

export interface CanvaAsset {
  id: string;
  name?: string;
  tags?: string[];
  thumbnail?: { url: string; width: number; height: number };
  created_at?: number;
  updated_at?: number;
}

export async function uploadAsset(
  name: string,
  imageBytes: ArrayBuffer,
  mimeType = 'image/png',
): Promise<{ jobId: string }> {
  // Canva uses a two-step upload: create job, then poll
  const token = await getAccessToken();

  const formData = new FormData();
  formData.append('name', name);
  const blob = new Blob([imageBytes], { type: mimeType });
  formData.append('file', blob, name);

  const res = await fetch(`${CANVA_API_BASE}/asset-uploads`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: formData,
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Asset upload failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { job: { id: string; status: string } };
  return { jobId: data.job.id };
}

export async function getAssetUploadJob(jobId: string): Promise<{ status: string; asset?: CanvaAsset }> {
  const res = await canvaFetch(`/asset-uploads/${encodeURIComponent(jobId)}`);
  if (!res.ok) throw new Error(`Get asset upload job failed (${res.status})`);
  const data = (await res.json()) as { job: { id: string; status: string; asset?: CanvaAsset } };
  return { status: data.job.status, asset: data.job.asset };
}

// ── Brand Template APIs ──────────────────────────────────────

export interface BrandTemplate {
  id: string;
  title?: string;
  thumbnail?: { url: string; width: number; height: number };
  created_at?: number;
  updated_at?: number;
}

export interface TemplateDataset {
  dataset: Record<string, { type: 'text' | 'image' }>;
}

export async function listBrandTemplates(continuation?: string): Promise<{ items: BrandTemplate[]; continuation?: string }> {
  const params = continuation ? `?continuation=${encodeURIComponent(continuation)}` : '';
  const res = await canvaFetch(`/brand-templates${params}`);
  if (!res.ok) throw new Error(`List brand templates failed (${res.status})`);
  return res.json() as Promise<{ items: BrandTemplate[]; continuation?: string }>;
}

export async function getBrandTemplateDataset(templateId: string): Promise<TemplateDataset> {
  const res = await canvaFetch(`/brand-templates/${encodeURIComponent(templateId)}/dataset`);
  if (!res.ok) throw new Error(`Get brand template dataset failed (${res.status})`);
  return res.json() as Promise<TemplateDataset>;
}

// ── Autofill APIs ────────────────────────────────────────────

export interface AutofillData {
  [field: string]: { type: 'text'; text: string } | { type: 'image'; asset_id: string };
}

export interface AutofillJob {
  id: string;
  status: 'in_progress' | 'success' | 'failed';
  result?: {
    type: 'create_design';
    design: CanvaDesign;
  };
  error?: { code: string; message: string };
}

export async function createAutofillJob(
  brandTemplateId: string,
  data: AutofillData,
  title?: string,
): Promise<AutofillJob> {
  const body: Record<string, unknown> = {
    brand_template_id: brandTemplateId,
    data,
  };
  if (title) body.title = title;

  const res = await canvaFetch('/autofills', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Create autofill job failed (${res.status}): ${text}`);
  }

  const result = (await res.json()) as { job: AutofillJob };
  return result.job;
}

export async function getAutofillJob(jobId: string): Promise<AutofillJob> {
  const res = await canvaFetch(`/autofills/${encodeURIComponent(jobId)}`);
  if (!res.ok) throw new Error(`Get autofill job failed (${res.status})`);
  const data = (await res.json()) as { job: AutofillJob };
  return data.job;
}

/** Poll an autofill job until it completes or times out */
export async function waitForAutofillJob(jobId: string, timeoutMs = 60_000): Promise<AutofillJob> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await getAutofillJob(jobId);
    if (job.status !== 'in_progress') return job;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Autofill job ${jobId} timed out after ${timeoutMs}ms`);
}

// ── Export APIs ──────────────────────────────────────────────

export type ExportFormat = 'pdf' | 'jpg' | 'png' | 'gif' | 'pptx' | 'mp4';

export interface ExportJob {
  id: string;
  status: 'in_progress' | 'success' | 'failed';
  urls?: string[];
  error?: { code: string; message: string };
}

export async function createExportJob(
  designId: string,
  format: ExportFormat = 'png',
): Promise<ExportJob> {
  const res = await canvaFetch('/exports', {
    method: 'POST',
    body: JSON.stringify({
      design_id: designId,
      format: { type: format },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Create export job failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { job: ExportJob };
  return data.job;
}

export async function getExportJob(jobId: string): Promise<ExportJob> {
  const res = await canvaFetch(`/exports/${encodeURIComponent(jobId)}`);
  if (!res.ok) throw new Error(`Get export job failed (${res.status})`);
  const data = (await res.json()) as { job: ExportJob };
  return data.job;
}

/** Poll an export job until completion */
export async function waitForExportJob(jobId: string, timeoutMs = 120_000): Promise<ExportJob> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await getExportJob(jobId);
    if (job.status !== 'in_progress') return job;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Export job ${jobId} timed out after ${timeoutMs}ms`);
}

// ── Clear cache (testing) ────────────────────────────────────

export function clearCanvaTokenCache(): void {
  tokenCache = null;
}
