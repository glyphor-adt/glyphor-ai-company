/**
 * Logo Tools — SVG logo variation and restyling for Glyphor brand
 *
 * Tools:
 *   create_logo_variation — Generate logo layouts (horizontal, stacked, icon-only, wordmark-only)
 *   restyle_logo          — Apply color/background changes (monochrome, reversed, custom colors)
 *   create_social_avatar  — Generate circular social media avatar
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { AGENCY_FONT_BASE64 } from './agencyFont.js';

// ── Brand Constants ────────────────────────────────────────────────────────
const BRAND = {
  name: 'GLYPHOR',
  gradientStart: '#00E0FF',
  gradientEnd: '#0097FF',
  fontFamily: 'Agency',
} as const;

// ── Font Face Declaration ──────────────────────────────────────────────────
function fontFaceSvg(): string {
  return `<style>
    @font-face {
      font-family: 'Agency';
      src: url('data:font/woff2;base64,${AGENCY_FONT_BASE64}') format('woff2');
      font-weight: normal;
      font-style: normal;
    }
  </style>`;
}

// ── Gradient Defs ──────────────────────────────────────────────────────────
function gradientDefs(
  id: string,
  startColor: string,
  endColor: string,
  vertical = true,
): string {
  return vertical
    ? `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${startColor}"/>
        <stop offset="100%" stop-color="${endColor}"/>
      </linearGradient>`
    : `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="${startColor}"/>
        <stop offset="100%" stop-color="${endColor}"/>
      </linearGradient>`;
}

// ── Icon Mark (hexagonal brain/circuit) ────────────────────────────────────
function iconMark(
  strokeRef: string,
  fillRef: string,
  offsetX = 0,
  offsetY = 0,
  scale = 1,
): string {
  const t = (x: number, y: number) =>
    `${(x * scale + offsetX).toFixed(1)},${(y * scale + offsetY).toFixed(1)}`;

  const line = (x1: number, y1: number, x2: number, y2: number, w: number) =>
    `<line x1="${(x1*scale+offsetX).toFixed(1)}" y1="${(y1*scale+offsetY).toFixed(1)}" x2="${(x2*scale+offsetX).toFixed(1)}" y2="${(y2*scale+offsetY).toFixed(1)}" stroke="${strokeRef}" stroke-width="${(w*scale).toFixed(1)}"/>`;

  const circle = (cx: number, cy: number, r: number, fill: boolean) =>
    fill
      ? `<circle cx="${(cx*scale+offsetX).toFixed(1)}" cy="${(cy*scale+offsetY).toFixed(1)}" r="${(r*scale).toFixed(1)}" fill="${fillRef}"/>`
      : `<circle cx="${(cx*scale+offsetX).toFixed(1)}" cy="${(cy*scale+offsetY).toFixed(1)}" r="${(r*scale).toFixed(1)}" stroke="${strokeRef}" fill="none"/>`;

  const hex = (points: [number, number][], sw: number) => {
    const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${t(p[0], p[1])}`).join(' ') + ' Z';
    return `<path d="${d}" stroke="${strokeRef}" stroke-width="${(sw*scale).toFixed(1)}" stroke-linejoin="round" fill="none"/>`;
  };

  return [
    // Outer hexagon
    hex([[100,10],[178,52],[178,148],[100,190],[22,148],[22,52]], 10),
    // Inner hexagon
    hex([[100,38],[156,70],[156,134],[100,166],[44,134],[44,70]], 6),
    // Center vertical line
    line(100,50,100,175,5),
    // Left brain circuits
    line(100,65,68,65,4), line(68,65,55,80,4), circle(55,80,5,true),
    line(100,90,60,90,4), line(60,90,52,100,4), circle(52,100,5,true),
    line(100,110,70,110,4), circle(70,110,5,true),
    line(100,135,65,135,4), line(65,135,55,125,4), circle(55,125,5,true),
    line(68,65,70,110,3),
    // Right brain circuits
    line(100,75,132,75,4), line(132,75,140,65,4), circle(140,65,5,true),
    line(100,100,140,100,4), circle(140,100,5,true),
    line(100,120,135,120,4), line(135,120,145,130,4), circle(145,130,5,true),
    line(100,145,130,145,4), circle(130,145,5,true),
    line(132,75,135,120,3),
    // Center node accents
    circle(100,65,4,true), circle(100,90,4,true),
    circle(100,110,4,true), circle(100,135,4,true),
  ].join('\n    ');
}

// ── Wordmark Text ──────────────────────────────────────────────────────────
function wordmarkText(
  fillRef: string,
  x: number,
  y: number,
  fontSize: number,
  anchor: 'start' | 'middle' | 'end' = 'middle',
): string {
  return `<text x="${x}" y="${y}" font-family="'Agency', sans-serif" font-size="${fontSize}" fill="${fillRef}" text-anchor="${anchor}" dominant-baseline="central" letter-spacing="8">${BRAND.name}</text>`;
}

// ── SVG Wrapper ────────────────────────────────────────────────────────────
function wrapSvg(
  width: number,
  height: number,
  defs: string,
  body: string,
  bg?: string,
): string {
  const bgRect = bg ? `<rect width="${width}" height="${height}" fill="${bg}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" fill="none">
  <defs>
    ${defs}
  </defs>
  ${fontFaceSvg()}
  ${bgRect}
  ${body}
</svg>`;
}

// ── Layout Builders ────────────────────────────────────────────────────────

type LayoutName = 'horizontal' | 'stacked' | 'icon_only' | 'wordmark_only';

function buildHorizontal(
  startColor: string,
  endColor: string,
  bg?: string,
): string {
  const gradId = 'gGrad';
  const strokeRef = `url(#${gradId})`;
  const fillRef = strokeRef;
  const defs = gradientDefs(gradId, startColor, endColor);
  // Icon on the left (scaled 0.55, origin shifted), wordmark to the right
  const iconScale = 0.55;
  const iconW = 200 * iconScale; // 110
  const totalW = 420;
  const totalH = 130;
  const iconOffsetX = 5;
  const iconOffsetY = 5;
  const icon = iconMark(strokeRef, fillRef, iconOffsetX, iconOffsetY, iconScale);
  const text = wordmarkText(fillRef, 270, 68, 52, 'middle');
  return wrapSvg(totalW, totalH, defs, `${icon}\n  ${text}`, bg);
}

function buildStacked(
  startColor: string,
  endColor: string,
  bg?: string,
): string {
  const gradId = 'gGrad';
  const strokeRef = `url(#${gradId})`;
  const fillRef = strokeRef;
  const defs = gradientDefs(gradId, startColor, endColor);
  const iconScale = 0.7;
  const totalW = 260;
  const totalH = 220;
  const iconOffsetX = (totalW - 200 * iconScale) / 2;
  const iconOffsetY = 0;
  const icon = iconMark(strokeRef, fillRef, iconOffsetX, iconOffsetY, iconScale);
  const text = wordmarkText(fillRef, totalW / 2, 195, 40, 'middle');
  return wrapSvg(totalW, totalH, defs, `${icon}\n  ${text}`, bg);
}

function buildIconOnly(
  startColor: string,
  endColor: string,
  bg?: string,
): string {
  const gradId = 'gGrad';
  const strokeRef = `url(#${gradId})`;
  const fillRef = strokeRef;
  const defs = gradientDefs(gradId, startColor, endColor);
  const icon = iconMark(strokeRef, fillRef, 0, 0, 1);
  return wrapSvg(200, 200, defs, icon, bg);
}

function buildWordmarkOnly(
  startColor: string,
  endColor: string,
  bg?: string,
): string {
  const gradId = 'gGrad';
  const strokeRef = `url(#${gradId})`;
  const defs = gradientDefs(gradId, startColor, endColor);
  const text = wordmarkText(strokeRef, 180, 40, 56, 'middle');
  return wrapSvg(360, 80, defs, text, bg);
}

// ── Tool Definitions ───────────────────────────────────────────────────────

export function createLogoTools(): ToolDefinition[] {
  return [
    // ── create_logo_variation ────────────────────────────────────────────
    {
      name: 'create_logo_variation',
      description:
        'Generate a Glyphor logo SVG in different layouts. Returns raw SVG string. ' +
        'Layouts: horizontal (icon + wordmark side by side), stacked (icon above wordmark), ' +
        'icon_only (hex brain mark), wordmark_only (text only). ' +
        'Optionally override brand colors or add a background.',
      parameters: {
        layout: {
          type: 'string',
          description: 'Logo layout variant',
          required: true,
          enum: ['horizontal', 'stacked', 'icon_only', 'wordmark_only'],
        },
        primary_color: {
          type: 'string',
          description: 'Gradient start color (default: #00E0FF)',
          required: false,
        },
        secondary_color: {
          type: 'string',
          description: 'Gradient end color (default: #0097FF)',
          required: false,
        },
        background_color: {
          type: 'string',
          description: 'Optional background fill color (e.g. #1E1B4B for dark, #FFFFFF for light)',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const layout = (params.layout as LayoutName) || 'horizontal';
        const start = (params.primary_color as string) || BRAND.gradientStart;
        const end = (params.secondary_color as string) || BRAND.gradientEnd;
        const bg = params.background_color as string | undefined;

        // Validate hex colors
        const hexPattern = /^#[0-9A-Fa-f]{3,8}$/;
        for (const c of [start, end, bg]) {
          if (c && !hexPattern.test(c)) {
            return { success: false, error: `Invalid hex color: ${c}` };
          }
        }

        let svg: string;
        switch (layout) {
          case 'horizontal':
            svg = buildHorizontal(start, end, bg);
            break;
          case 'stacked':
            svg = buildStacked(start, end, bg);
            break;
          case 'icon_only':
            svg = buildIconOnly(start, end, bg);
            break;
          case 'wordmark_only':
            svg = buildWordmarkOnly(start, end, bg);
            break;
          default:
            return { success: false, error: `Unknown layout: ${layout}` };
        }

        return {
          success: true,
          data: {
            svg,
            layout,
            colors: { primary: start, secondary: end, background: bg ?? 'transparent' },
            note: 'Raw SVG string with embedded Agency font. Can be saved directly as .svg file.',
          },
        };
      },
    },

    // ── restyle_logo ────────────────────────────────────────────────────
    {
      name: 'restyle_logo',
      description:
        'Generate a pre-styled Glyphor logo variant. Presets: ' +
        'monochrome_dark (single dark color on transparent), ' +
        'monochrome_light (single light color on transparent), ' +
        'reversed (light logo on dark background), ' +
        'white_on_dark (white logo on #1E1B4B), ' +
        'dark_on_light (dark logo on white).',
      parameters: {
        preset: {
          type: 'string',
          description: 'Style preset name',
          required: true,
          enum: [
            'monochrome_dark',
            'monochrome_light',
            'reversed',
            'white_on_dark',
            'dark_on_light',
          ],
        },
        layout: {
          type: 'string',
          description: 'Logo layout (default: horizontal)',
          required: false,
          enum: ['horizontal', 'stacked', 'icon_only', 'wordmark_only'],
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const preset = params.preset as string;
        const layout = (params.layout as LayoutName) || 'horizontal';

        let start: string;
        let end: string;
        let bg: string | undefined;

        switch (preset) {
          case 'monochrome_dark':
            start = '#1E1B4B';
            end = '#1E1B4B';
            break;
          case 'monochrome_light':
            start = '#FFFFFF';
            end = '#FFFFFF';
            break;
          case 'reversed':
            start = '#00E0FF';
            end = '#0097FF';
            bg = '#0F172A';
            break;
          case 'white_on_dark':
            start = '#FFFFFF';
            end = '#FFFFFF';
            bg = '#1E1B4B';
            break;
          case 'dark_on_light':
            start = '#1E1B4B';
            end = '#1E1B4B';
            bg = '#FFFFFF';
            break;
          default:
            return { success: false, error: `Unknown preset: ${preset}` };
        }

        let svg: string;
        switch (layout) {
          case 'horizontal':
            svg = buildHorizontal(start, end, bg);
            break;
          case 'stacked':
            svg = buildStacked(start, end, bg);
            break;
          case 'icon_only':
            svg = buildIconOnly(start, end, bg);
            break;
          case 'wordmark_only':
            svg = buildWordmarkOnly(start, end, bg);
            break;
          default:
            return { success: false, error: `Unknown layout: ${layout}` };
        }

        return {
          success: true,
          data: {
            svg,
            preset,
            layout,
            colors: { primary: start, secondary: end, background: bg ?? 'transparent' },
          },
        };
      },
    },

    // ── create_social_avatar ────────────────────────────────────────────
    {
      name: 'create_social_avatar',
      description:
        'Generate a circular social media avatar with the Glyphor icon in the center. ' +
        'Returns SVG with a circular clip and optional background.',
      parameters: {
        size: {
          type: 'number',
          description: 'Avatar size in pixels (default: 512)',
          required: false,
        },
        background_color: {
          type: 'string',
          description: 'Circle background color (default: #0F172A)',
          required: false,
        },
        icon_color_start: {
          type: 'string',
          description: 'Icon gradient start (default: #00E0FF)',
          required: false,
        },
        icon_color_end: {
          type: 'string',
          description: 'Icon gradient end (default: #0097FF)',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const size = (params.size as number) || 512;
        const bg = (params.background_color as string) || '#0F172A';
        const start = (params.icon_color_start as string) || BRAND.gradientStart;
        const end = (params.icon_color_end as string) || BRAND.gradientEnd;

        const hexPattern = /^#[0-9A-Fa-f]{3,8}$/;
        for (const c of [bg, start, end]) {
          if (c && !hexPattern.test(c)) {
            return { success: false, error: `Invalid hex color: ${c}` };
          }
        }

        const gradId = 'gGrad';
        const strokeRef = `url(#${gradId})`;
        const fillRef = strokeRef;
        const r = size / 2;
        const iconScale = size / 320; // leaves comfortable padding
        const iconOffset = (size - 200 * iconScale) / 2;

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" fill="none">
  <defs>
    ${gradientDefs(gradId, start, end)}
    <clipPath id="circleClip">
      <circle cx="${r}" cy="${r}" r="${r}"/>
    </clipPath>
  </defs>
  ${fontFaceSvg()}
  <g clip-path="url(#circleClip)">
    <circle cx="${r}" cy="${r}" r="${r}" fill="${bg}"/>
    ${iconMark(strokeRef, fillRef, iconOffset, iconOffset, iconScale)}
  </g>
</svg>`;

        return {
          success: true,
          data: {
            svg,
            size,
            colors: { background: bg, iconStart: start, iconEnd: end },
            note: 'Circular avatar SVG. Use as social media profile picture or favicon source.',
          },
        };
      },
    },
  ];
}
