import { randomUUID } from 'node:crypto';
import { getGraphToken, graphHeaders, parseResponse } from '../auth/sharepoint.js';

interface TitleArea {
  layout?: string;
  text_alignment?: string;
  show_author?: boolean;
  text_above_title?: string;
  image_url?: string;
}

interface CanvasWebPart {
  type?: string;
  inner_html?: string;
  web_part_type?: string;
  data?: Record<string, unknown>;
}

interface CanvasColumn {
  width: number;
  webparts: CanvasWebPart[];
}

interface CanvasSection {
  layout: string;
  columns: CanvasColumn[];
}

interface CanvasLayout {
  horizontal_sections: CanvasSection[];
}

export interface CreateSitePageParams {
  site_url: string;
  name: string;
  title: string;
  page_layout?: 'article' | 'home';
  title_area?: TitleArea;
  canvas_layout?: CanvasLayout;
}

async function getSiteId(siteUrl: string): Promise<string> {
  const token = await getGraphToken();
  const parsed = new URL(siteUrl);
  const host = parsed.hostname;
  const path = parsed.pathname.replace(/^\//, '');
  const address = path ? `${host}:/${path}` : host;

  const response = await fetch(`https://graph.microsoft.com/v1.0/sites/${address}`, {
    headers: graphHeaders(token),
  });

  const data = await parseResponse(response) as { id?: string };
  if (!data.id) {
    throw new Error(`Unable to resolve Graph site id for ${siteUrl}`);
  }
  return data.id;
}

function buildCanvasLayout(layout?: CanvasLayout): Record<string, unknown> | undefined {
  if (!layout?.horizontal_sections?.length) return undefined;

  return {
    horizontalSections: layout.horizontal_sections.map((section, sectionIndex) => ({
      id: String(sectionIndex + 1),
      layout: section.layout,
      emphasis: 'none',
      columns: section.columns.map((column, columnIndex) => ({
        id: String(columnIndex + 1),
        width: column.width,
        webparts: column.webparts.map((part) => {
          if (part.inner_html) {
            return {
              id: randomUUID(),
              innerHtml: part.inner_html,
            };
          }
          return {
            id: randomUUID(),
            webPartType: part.web_part_type ?? part.type,
            data: part.data ?? {},
          };
        }),
      })),
    })),
  };
}

export async function createSitePage(params: CreateSitePageParams): Promise<unknown> {
  const token = await getGraphToken();
  const siteId = await getSiteId(params.site_url);

  const body: Record<string, unknown> = {
    '@odata.type': '#microsoft.graph.sitePage',
    name: params.name,
    title: params.title,
    pageLayout: params.page_layout ?? 'article',
  };

  if (params.title_area) {
    body.titleArea = {
      layout: params.title_area.layout ?? 'plain',
      textAlignment: params.title_area.text_alignment ?? 'left',
      showAuthor: params.title_area.show_author ?? true,
      showPublishedDate: true,
      textAboveTitle: params.title_area.text_above_title ?? '',
      ...(params.title_area.image_url ? {
        imageWebUrl: params.title_area.image_url,
        enableGradientEffect: true,
      } : {}),
    };
  }

  const canvasLayout = buildCanvasLayout(params.canvas_layout);
  if (canvasLayout) {
    body.canvasLayout = canvasLayout;
  }

  const response = await fetch(`https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(siteId)}/pages`, {
    method: 'POST',
    headers: graphHeaders(token),
    body: JSON.stringify(body),
  });

  return parseResponse(response);
}

export async function publishPage(params: { site_url: string; page_id: string }): Promise<unknown> {
  const token = await getGraphToken();
  const siteId = await getSiteId(params.site_url);

  const response = await fetch(
    `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(siteId)}/pages/${encodeURIComponent(params.page_id)}/publish`,
    {
      method: 'POST',
      headers: graphHeaders(token),
    },
  );

  await parseResponse(response);
  return { success: true, status: response.status };
}

export async function getPages(params: { site_url: string }): Promise<unknown> {
  const token = await getGraphToken();
  const siteId = await getSiteId(params.site_url);

  const response = await fetch(
    `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(siteId)}/pages`,
    { headers: graphHeaders(token) },
  );

  return parseResponse(response);
}

export interface UpdateSitePageParams {
  site_url: string;
  page_id: string;
  title?: string;
  canvas_layout?: CanvasLayout;
  promote_as_news?: boolean;
}

export async function updateSitePage(params: UpdateSitePageParams): Promise<unknown> {
  const token = await getGraphToken();
  const siteId = await getSiteId(params.site_url);

  const body: Record<string, unknown> = {};
  if (params.title) body.title = params.title;
  if (params.promote_as_news) body.promotionKind = 'newsPost';

  const canvasLayout = buildCanvasLayout(params.canvas_layout);
  if (canvasLayout) {
    body.canvasLayout = canvasLayout;
  }

  const response = await fetch(
    `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(siteId)}/pages/${encodeURIComponent(params.page_id)}`,
    {
      method: 'PATCH',
      headers: graphHeaders(token),
      body: JSON.stringify(body),
    },
  );

  return parseResponse(response);
}

export async function deletePage(params: { site_url: string; page_id: string }): Promise<unknown> {
  const token = await getGraphToken();
  const siteId = await getSiteId(params.site_url);

  const response = await fetch(
    `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(siteId)}/pages/${encodeURIComponent(params.page_id)}`,
    {
      method: 'DELETE',
      headers: graphHeaders(token),
    },
  );

  await parseResponse(response);
  return { success: true, status: response.status };
}
