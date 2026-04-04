/**
 * Single-shot chat demo apps — one HTML document, no GitHub/Vercel/deploy polling.
 * For dashboard "build me X app" requests; use invoke_web_build when they need a real repo + preview URL.
 */

import { ModelClient, type ToolContext, type ToolDefinition, type ToolResult } from '@glyphor/agent-runtime';
import { getSpecialized } from '@glyphor/shared';

/** Override with `QUICK_DEMO_WEB_MODEL`; default is centralized Codex (Azure Foundry). */
const QUICK_DEMO_MODEL = process.env.QUICK_DEMO_WEB_MODEL?.trim() || getSpecialized('quick_demo_web');

const QUICK_DEMO_SYSTEM = `You output ONE self-contained web demo as raw HTML only.

Rules:
- Return a complete HTML5 document: <!DOCTYPE html> through </html>.
- Put all CSS in a single <style> in <head>. Put all JS in <script> before </body>.
- No external build step (no Vite, no npm). You MAY use CDN scripts (e.g. unpkg.com/skypack for React only if truly needed) but prefer vanilla HTML/CSS/JS for speed and reliability.
- The UI must be visually distinctive (not generic gray SaaS). Use a clear color system and readable typography.
- If the app needs live data (weather, etc.), use the browser fetch() API to a public free API OR clearly labeled mock data with comments showing where to paste an API key. Never invent secret keys.
- Do not wrap the document in markdown code fences.
- No prose before or after the HTML.`;

function createQuickDemoModelClient(): ModelClient {
  return new ModelClient({
    geminiApiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY,
    azureFoundryEndpoint: process.env.AZURE_FOUNDRY_ENDPOINT,
    azureFoundryApi: process.env.AZURE_FOUNDRY_API,
    azureFoundryApiVersion: process.env.AZURE_FOUNDRY_API_VERSION,
  });
}

function extractHtmlDocument(text: string): string | null {
  let t = text.trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:html)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  }
  const lower = t.toLowerCase();
  const docIdx = lower.indexOf('<!doctype html');
  const htmlIdx = lower.indexOf('<html');
  const start = docIdx >= 0 ? docIdx : htmlIdx >= 0 ? htmlIdx : -1;
  if (start < 0) return null;
  const end = lower.lastIndexOf('</html>');
  if (end < 0) return null;
  return t.slice(start, end + '</html>'.length);
}

export function createQuickDemoWebAppTools(): ToolDefinition[] {
  return [
    {
      name: 'quick_demo_web_app',
      description:
        'Offline / emergency only: generate ONE self-contained HTML file (no GitHub, no Vercel, **no live URL**). '
        + '**Do not use for dashboard users who expect a preview link** — they should get `normalize_design_brief` + `invoke_web_build` with `tier: prototype` (`preview_url`). '
        + 'If this tool is used, explain that it is a local file preview, not a hosted deployment.',
      parameters: {
        description: {
          type: 'string',
          description:
            'What to build (features, audience, data sources). Be specific; include any city/API preferences.',
          required: true,
        },
        aesthetic: {
          type: 'string',
          description: 'Optional visual direction (e.g. dark observatory, coastal minimal, brutalist).',
          required: false,
        },
      },
      async execute(params, ctx: ToolContext): Promise<ToolResult> {
        const brief = String(params.description ?? '').trim();
        if (!brief) {
          return { success: false, error: 'Parameter "description" is required.' };
        }
        const aesthetic = typeof params.aesthetic === 'string' ? params.aesthetic.trim() : '';
        const userContent = aesthetic
          ? `Build this web demo.\n\nAesthetic: ${aesthetic}\n\nRequirements:\n${brief}`
          : `Build this web demo.\n\nRequirements:\n${brief}`;

        const client = createQuickDemoModelClient();
        try {
          const res = await client.generate({
            model: QUICK_DEMO_MODEL,
            systemInstruction: QUICK_DEMO_SYSTEM,
            contents: [{ role: 'user', content: userContent, timestamp: Date.now() }],
            temperature: 0.75,
            maxTokens: 24_000,
            callTimeoutMs: Math.max(60_000, Number(process.env.TOOL_QUICK_DEMO_MODEL_TIMEOUT_MS ?? '240000')),
            signal: ctx.abortSignal,
            source: 'on_demand',
            metadata: {
              agentRole: ctx.agentRole,
              runId: ctx.runId,
              assignmentId: ctx.assignmentId,
              turnNumber: ctx.turnNumber,
            },
          });

          const raw = res.text?.trim() ?? '';
          const html = extractHtmlDocument(raw);
          if (!html) {
            return {
              success: false,
              error:
                'Model did not return a parseable HTML document. Ask the user to try again or shorten the request.',
            };
          }

          return {
            success: true,
            data: {
              format: 'single_file_html',
              html_document: html,
              char_count: html.length,
              model: QUICK_DEMO_MODEL,
              how_to_preview:
                'Save the html_document as index.html and open it in a browser, or paste into an HTML preview. '
                + 'For a deployed preview URL and Git repo, run invoke_web_build with tier prototype.',
            },
          };
        } catch (e) {
          return {
            success: false,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      },
    },
  ];
}
