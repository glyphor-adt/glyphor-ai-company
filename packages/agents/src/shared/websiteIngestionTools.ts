/**
 * Website Ingestion Tools — scrape_website
 *
 * Crawls a customer website, extracts text from the landing page and up to
 * 5 internal links (about, pricing, product, features, team), then stores
 * the raw page text as customer_knowledge entries.
 *
 * The CMO (or any agent with this tool) can then synthesize brand signals
 * from the stored pages using its own model reasoning.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

const MAX_PAGES = 6; // landing + up to 5 internal links
const MAX_SOCIAL_PAGES = 6;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_TEXT_LENGTH = 12_000;

const SOCIAL_HOSTS = [
  /(^|\.)linkedin\.com$/i,
  /(^|\.)x\.com$/i,
  /(^|\.)twitter\.com$/i,
  /(^|\.)facebook\.com$/i,
  /(^|\.)instagram\.com$/i,
  /(^|\.)threads\.net$/i,
  /(^|\.)youtube\.com$/i,
  /(^|\.)youtu\.be$/i,
  /(^|\.)tiktok\.com$/i,
  /(^|\.)pinterest\.com$/i,
  /(^|\.)github\.com$/i,
];

/** Allowlisted path patterns that likely contain useful brand/product content. */
const USEFUL_PATHS = [
  /^\/?about/i,
  /^\/?pricing/i,
  /^\/?product/i,
  /^\/?features/i,
  /^\/?team/i,
  /^\/?services/i,
  /^\/?solutions/i,
  /^\/?company/i,
  /^\/?customers/i,
  /^\/?case-stud/i,
];

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitle(html: string): string {
  const match = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  return match?.[1]?.trim() ?? '';
}

function extractInternalLinks(html: string, origin: string): string[] {
  const seen = new Set<string>();
  const re = /href="([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    try {
      const resolved = new URL(href, origin);
      if (resolved.origin !== origin) continue;
      const path = resolved.pathname.replace(/\/$/, '');
      if (!path || path === '' || seen.has(path)) continue;
      if (USEFUL_PATHS.some((p) => p.test(path))) {
        seen.add(resolved.href);
      }
    } catch {
      // skip invalid URLs
    }
  }
  return [...seen].slice(0, MAX_PAGES - 1);
}

function isSocialHost(hostname: string): boolean {
  return SOCIAL_HOSTS.some((pattern) => pattern.test(hostname));
}

function isSocialUrl(url: string): boolean {
  try {
    return isSocialHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

function extractSocialLinks(html: string, origin: string): string[] {
  const seen = new Set<string>();
  const re = /href="([^"]+)"/gi;
  let m: RegExpExecArray | null;

  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    try {
      const resolved = new URL(href, origin);
      if (resolved.origin === origin) continue;
      if (!isSocialHost(resolved.hostname)) continue;
      const normalized = resolved.href.replace(/#.*$/, '');
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
    } catch {
      // skip invalid URLs
    }
  }

  return [...seen].slice(0, MAX_SOCIAL_PAGES);
}

async function fetchPage(url: string): Promise<{ html: string; text: string; title: string } | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Glyphor-Agent/1.0',
        Accept: 'text/html,application/xhtml+xml,text/plain',
      },
      redirect: 'follow',
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const html = await res.text();
    return {
      html,
      text: stripHtml(html).slice(0, MAX_TEXT_LENGTH),
      title: extractTitle(html),
    };
  } catch {
    return null;
  }
}

export function createWebsiteIngestionTools(): ToolDefinition[] {
  return [
    {
      name: 'scrape_website',
      description:
        'Crawl a customer website to extract brand and product information. ' +
        'Fetches the landing page plus key internal pages (about, pricing, product, features, etc.). ' +
        'Stores extracted text in customer_knowledge for later synthesis. ' +
        'Returns the scraped page summaries so you can synthesize a company brief.',
      parameters: {
        url: {
          type: 'string',
          description: 'The root URL of the customer website (e.g. "https://acme.com").',
          required: true,
        },
        tenant_id: {
          type: 'string',
          description: 'The tenant UUID to store knowledge under.',
          required: true,
        },
      },
      async execute(params): Promise<ToolResult> {
        const rawUrl = params.url as string;
        const tenantId = params.tenant_id as string;

        if (!rawUrl || !tenantId) {
          return { success: false, error: 'Missing required parameters: url and tenant_id' };
        }

        let origin: string;
        try {
          const parsed = new URL(rawUrl);
          if (!['http:', 'https:'].includes(parsed.protocol)) {
            return { success: false, error: 'Only HTTP/HTTPS URLs are allowed.' };
          }
          origin = parsed.origin;
        } catch {
          return { success: false, error: 'Invalid URL.' };
        }

        // Fetch landing page
        const landing = await fetchPage(rawUrl);
        if (!landing) {
          return { success: false, error: `Could not fetch ${rawUrl}` };
        }

        // Discover internal links
        const internalLinks = extractInternalLinks(landing.html, origin);

        // Fetch internal pages in parallel
        const internalPages = await Promise.all(
          internalLinks.map(async (link) => {
            const page = await fetchPage(link);
            return page ? { url: link, ...page } : null;
          }),
        );

        const sourcePages = [
          { url: rawUrl, text: landing.text, title: landing.title, html: landing.html },
          ...internalPages
            .filter((p): p is { url: string; text: string; title: string; html: string } => p !== null)
            .map((p) => ({ url: p.url, text: p.text, title: p.title, html: p.html })),
        ];

        const socialLinks = [...new Set(sourcePages.flatMap((page) => extractSocialLinks(page.html, origin)))];

        const socialPages = await Promise.all(
          socialLinks.map(async (link) => {
            const page = await fetchPage(link);
            return page ? { url: link, ...page } : null;
          }),
        );

        const allPages = [
          ...sourcePages.map((page) => ({ url: page.url, text: page.text, title: page.title })),
          ...socialPages
            .filter((p): p is { url: string; text: string; title: string; html: string } => p !== null)
            .map((p) => ({ url: p.url, text: p.text, title: p.title })),
        ];

        // Store each page as customer_knowledge
        for (const page of allPages) {
          if (!page.text) continue;
          const section = isSocialUrl(page.url) ? 'social' : 'website';
          const tags = isSocialUrl(page.url)
            ? ['onboarding', 'social', 'scraped']
            : ['onboarding', 'website', 'scraped'];
          await systemQuery(
            `INSERT INTO customer_knowledge
               (tenant_id, section, title, content, content_type, audience, tags, is_active, version, last_edited_by)
             VALUES ($1, $2, $3, $4, 'text', 'all', $5, true, 1, 'scrape_website')
             ON CONFLICT DO NOTHING`,
            [tenantId, section, page.title || page.url, `Source: ${page.url}\n\n${page.text}`, tags],
          );
        }

        return {
          success: true,
          data: {
            pages_scraped: sourcePages.length,
            social_pages_scraped: socialPages.filter((page) => page !== null).length,
            pages: allPages.map((p) => ({
              url: p.url,
              title: p.title,
              text_length: p.text.length,
              text_preview: p.text.slice(0, 500),
            })),
            social_links: socialLinks,
          },
        };
      },
    },
  ];
}
