/**
 * Canva Tools — Design creation, brand templates, asset management & export
 *
 * 9 tools that let agents create designs, autofill brand templates,
 * upload assets, list templates, and export finished designs.
 *
 * Self-contained: auth + API calls are in this file (same pattern as figmaTools + figmaAuth).
 *
 * Environment variables:
 *   CANVA_CLIENT_ID      — OAuth integration client ID
 *   CANVA_CLIENT_SECRET  — OAuth integration client secret
 *   CANVA_REFRESH_TOKEN  — Long-lived refresh token from initial OAuth flow
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';

// ── Canva OAuth Token Manager ────────────────────────────────

const CANVA_API = 'https://api.canva.com/rest/v1';
const CANVA_TOKEN_URL = 'https://api.canva.com/rest/v1/oauth/token';

interface TokenCache { accessToken: string; expiresAt: number }
let tokenCache: TokenCache | null = null;

function getCanvaCredentials() {
  const clientId = process.env.CANVA_CLIENT_ID;
  const clientSecret = process.env.CANVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('CANVA_CLIENT_ID and CANVA_CLIENT_SECRET must be configured');
  return { clientId, clientSecret };
}

async function getCanvaAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) return tokenCache.accessToken;

  const { clientId, clientSecret } = getCanvaCredentials();
  const refreshToken = process.env.CANVA_REFRESH_TOKEN;
  if (!refreshToken) throw new Error('No CANVA_REFRESH_TOKEN. Complete the Canva OAuth flow first.');

  const res = await fetch(CANVA_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  if (!res.ok) throw new Error(`Canva token refresh failed (${res.status}): ${await res.text()}`);

  const data = await res.json() as { access_token: string; expires_in: number };
  tokenCache = { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

async function canvaFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await getCanvaAccessToken();
  return fetch(`${CANVA_API}${path}`, {
    ...options,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers },
    signal: options.signal ?? AbortSignal.timeout(30_000),
  });
}

// ── Tool definitions ─────────────────────────────────────────

export function createCanvaTools(): ToolDefinition[] {
  return [
    // ─── DESIGNS ─────────────────────────────────────────────────

    {
      name: 'create_canva_design',
      description: 'Create a new blank Canva design (logo, presentation, doc, or custom dimensions).',
      parameters: {
        title: { type: 'string', description: 'Design title', required: true },
        preset: {
          type: 'string',
          description: 'Preset type (or omit for custom dimensions)',
          required: false,
          enum: ['presentation', 'doc', 'whiteboard'],
        },
        width: { type: 'number', description: 'Custom width in px (ignored if preset is set)', required: false },
        height: { type: 'number', description: 'Custom height in px (ignored if preset is set)', required: false },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const body: Record<string, unknown> = { title: params.title };
          if (params.preset) {
            body.design_type = { type: 'preset', name: params.preset };
          } else if (params.width && params.height) {
            body.design_type = { type: 'custom', width: params.width, height: params.height };
          }
          const res = await canvaFetch('/designs', { method: 'POST', body: JSON.stringify(body) });
          if (!res.ok) return { success: false, error: `Create design failed (${res.status}): ${await res.text()}` };
          const { design } = await res.json() as { design: any };
          return {
            success: true,
            data: { designId: design.id, title: design.title, editUrl: design.urls?.edit_url, thumbnail: design.thumbnail?.url },
          };
        } catch (err) {
          return { success: false, error: `Failed to create design: ${err}` };
        }
      },
    },

    {
      name: 'get_canva_design',
      description: 'Get metadata and URLs for a Canva design by ID.',
      parameters: {
        design_id: { type: 'string', description: 'Canva design ID', required: true },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const res = await canvaFetch(`/designs/${encodeURIComponent(params.design_id as string)}`);
          if (!res.ok) return { success: false, error: `Get design failed (${res.status})` };
          const { design } = await res.json() as { design: any };
          return {
            success: true,
            data: { designId: design.id, title: design.title, editUrl: design.urls?.edit_url, thumbnail: design.thumbnail?.url, updatedAt: design.updated_at },
          };
        } catch (err) {
          return { success: false, error: `Failed to get design: ${err}` };
        }
      },
    },

    {
      name: 'search_canva_designs',
      description: 'Search Canva designs by keyword.',
      parameters: {
        query: { type: 'string', description: 'Search query', required: false },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const qs = params.query ? `?query=${encodeURIComponent(params.query as string)}` : '';
          const res = await canvaFetch(`/designs${qs}`);
          if (!res.ok) return { success: false, error: `List designs failed (${res.status})` };
          const data = await res.json() as { items: any[] };
          return {
            success: true,
            data: { count: data.items.length, designs: data.items.map((d: any) => ({ id: d.id, title: d.title, thumbnail: d.thumbnail?.url })) },
          };
        } catch (err) {
          return { success: false, error: `Failed to list designs: ${err}` };
        }
      },
    },

    // ─── BRAND TEMPLATES ─────────────────────────────────────────

    {
      name: 'list_canva_brand_templates',
      description: 'List all available Canva brand templates. These templates have autofill fields that can be populated programmatically to generate logos, social cards, etc.',
      parameters: {},
      execute: async (): Promise<ToolResult> => {
        try {
          const res = await canvaFetch('/brand-templates');
          if (!res.ok) return { success: false, error: `List brand templates failed (${res.status})` };
          const data = await res.json() as { items: any[] };
          return {
            success: true,
            data: { count: data.items.length, templates: data.items.map((t: any) => ({ id: t.id, title: t.title, thumbnail: t.thumbnail?.url })) },
          };
        } catch (err) {
          return { success: false, error: `Failed to list brand templates: ${err}` };
        }
      },
    },

    {
      name: 'get_canva_template_fields',
      description: 'Get the autofillable data fields in a brand template (field names and types: text or image).',
      parameters: {
        template_id: { type: 'string', description: 'Brand template ID', required: true },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const res = await canvaFetch(`/brand-templates/${encodeURIComponent(params.template_id as string)}/dataset`);
          if (!res.ok) return { success: false, error: `Get template fields failed (${res.status})` };
          const data = await res.json() as { dataset: Record<string, { type: string }> };
          return { success: true, data: { templateId: params.template_id, fields: data.dataset } };
        } catch (err) {
          return { success: false, error: `Failed to get template fields: ${err}` };
        }
      },
    },

    // ─── AUTOFILL ────────────────────────────────────────────────

    {
      name: 'generate_canva_design',
      description:
        'Generate a design from a brand template by autofilling its fields. ' +
        'First use get_canva_template_fields to see available fields, then provide values. ' +
        'Returns the generated design URL and thumbnail.',
      parameters: {
        template_id: { type: 'string', description: 'Brand template ID to autofill', required: true },
        title: { type: 'string', description: 'Title for the generated design', required: false },
        fields: {
          type: 'object',
          description:
            'Key-value pairs for template fields. For text fields: { "FIELD_NAME": "value" }. ' +
            'For image fields: { "FIELD_NAME": "asset_id_from_upload_canva_asset" }.',
          required: true,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          // Get template dataset to determine field types
          const dsRes = await canvaFetch(`/brand-templates/${encodeURIComponent(params.template_id as string)}/dataset`);
          if (!dsRes.ok) return { success: false, error: `Get template dataset failed (${dsRes.status})` };
          const { dataset } = await dsRes.json() as { dataset: Record<string, { type: string }> };

          const rawFields = params.fields as Record<string, string>;
          const autofillData: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(rawFields)) {
            if (!dataset[key]) continue;
            autofillData[key] = dataset[key].type === 'image'
              ? { type: 'image', asset_id: value }
              : { type: 'text', text: value };
          }

          const body: Record<string, unknown> = { brand_template_id: params.template_id, data: autofillData };
          if (params.title) body.title = params.title;

          const res = await canvaFetch('/autofills', { method: 'POST', body: JSON.stringify(body) });
          if (!res.ok) return { success: false, error: `Create autofill job failed (${res.status}): ${await res.text()}` };

          const { job } = await res.json() as { job: { id: string; status: string } };

          // Poll until done (max 60s)
          const deadline = Date.now() + 60_000;
          while (Date.now() < deadline) {
            const pollRes = await canvaFetch(`/autofills/${encodeURIComponent(job.id)}`);
            if (!pollRes.ok) return { success: false, error: `Poll autofill failed (${pollRes.status})` };
            const { job: j } = await pollRes.json() as { job: { status: string; result?: { design: any }; error?: { message: string } } };
            if (j.status === 'success') {
              return {
                success: true,
                data: { designId: j.result?.design?.id, editUrl: j.result?.design?.urls?.edit_url, thumbnail: j.result?.design?.thumbnail?.url },
              };
            }
            if (j.status === 'failed') return { success: false, error: `Autofill failed: ${j.error?.message}` };
            await new Promise((r) => setTimeout(r, 2000));
          }
          return { success: false, error: 'Autofill job timed out' };
        } catch (err) {
          return { success: false, error: `Failed to generate design: ${err}` };
        }
      },
    },

    // ─── EXPORT ──────────────────────────────────────────────────

    {
      name: 'export_canva_design',
      description: 'Export a Canva design as PNG, PDF, JPG, GIF, PPTX, or MP4. Returns download URLs.',
      parameters: {
        design_id: { type: 'string', description: 'Canva design ID to export', required: true },
        format: { type: 'string', description: 'Export format', required: false, enum: ['png', 'pdf', 'jpg', 'gif', 'pptx', 'mp4'] },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const format = (params.format as string) || 'png';
          const res = await canvaFetch('/exports', {
            method: 'POST',
            body: JSON.stringify({ design_id: params.design_id, format: { type: format } }),
          });
          if (!res.ok) return { success: false, error: `Create export failed (${res.status}): ${await res.text()}` };
          const { job } = await res.json() as { job: { id: string; status: string } };

          // Poll (max 120s for video exports)
          const deadline = Date.now() + 120_000;
          while (Date.now() < deadline) {
            const pollRes = await canvaFetch(`/exports/${encodeURIComponent(job.id)}`);
            if (!pollRes.ok) return { success: false, error: `Poll export failed (${pollRes.status})` };
            const { job: j } = await pollRes.json() as { job: { status: string; urls?: string[]; error?: { message: string } } };
            if (j.status === 'success') return { success: true, data: { format, downloadUrls: j.urls } };
            if (j.status === 'failed') return { success: false, error: `Export failed: ${j.error?.message}` };
            await new Promise((r) => setTimeout(r, 2000));
          }
          return { success: false, error: 'Export job timed out' };
        } catch (err) {
          return { success: false, error: `Failed to export design: ${err}` };
        }
      },
    },

    // ─── ASSETS ──────────────────────────────────────────────────

    {
      name: 'upload_canva_asset',
      description:
        'Upload an image asset to Canva (logo icon, photo, background). ' +
        'Returns an asset ID that can be used in generate_canva_design for image fields.',
      parameters: {
        name: { type: 'string', description: 'Asset name (e.g., "glyphor-logo-icon.png")', required: true },
        image_url: { type: 'string', description: 'Public HTTPS URL of the image to upload', required: true },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const imageUrl = params.image_url as string;
          const parsed = new URL(imageUrl);
          if (!['http:', 'https:'].includes(parsed.protocol)) {
            return { success: false, error: 'image_url must be an HTTP or HTTPS URL' };
          }

          const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) });
          if (!imgRes.ok) return { success: false, error: `Failed to download image: ${imgRes.status}` };
          const buffer = await imgRes.arrayBuffer();
          const contentType = imgRes.headers.get('content-type') || 'image/png';

          const token = await getCanvaAccessToken();
          const formData = new FormData();
          formData.append('name', params.name as string);
          formData.append('file', new Blob([buffer], { type: contentType }), params.name as string);

          const uploadRes = await fetch(`${CANVA_API}/asset-uploads`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData,
            signal: AbortSignal.timeout(60_000),
          });
          if (!uploadRes.ok) return { success: false, error: `Upload failed (${uploadRes.status}): ${await uploadRes.text()}` };
          const { job } = await uploadRes.json() as { job: { id: string; status: string } };

          // Poll for completion
          const deadline = Date.now() + 60_000;
          while (Date.now() < deadline) {
            const pollRes = await canvaFetch(`/asset-uploads/${encodeURIComponent(job.id)}`);
            if (!pollRes.ok) return { success: false, error: `Poll upload failed (${pollRes.status})` };
            const { job: j } = await pollRes.json() as { job: { status: string; asset?: { id: string; name: string; thumbnail?: { url: string } } } };
            if (j.status === 'success' && j.asset) {
              return { success: true, data: { assetId: j.asset.id, name: j.asset.name, thumbnail: j.asset.thumbnail?.url } };
            }
            if (j.status === 'failed') return { success: false, error: 'Asset upload failed' };
            await new Promise((r) => setTimeout(r, 2000));
          }
          return { success: false, error: 'Asset upload timed out' };
        } catch (err) {
          return { success: false, error: `Failed to upload asset: ${err}` };
        }
      },
    },
  ];
}
