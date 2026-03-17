import { getSharePointToken, parseResponse, spoHeaders, tenantUrl } from '../auth/sharepoint.js';

type SiteTemplate = 'SITEPAGEPUBLISHING#0' | 'STS#3';

export interface CreateSiteParams {
  title: string;
  url: string;
  template: SiteTemplate;
  description?: string;
  owner?: string;
  lcid?: number;
  site_design_id?: string;
}

export async function createSite(params: CreateSiteParams): Promise<unknown> {
  const tenant = tenantUrl();
  const token = await getSharePointToken(tenant);

  const response = await fetch(`${tenant}/_api/SPSiteManager/create`, {
    method: 'POST',
    headers: spoHeaders(token),
    body: JSON.stringify({
      request: {
        Title: params.title,
        Url: params.url,
        Lcid: params.lcid ?? 1033,
        ShareByEmailEnabled: false,
        Description: params.description ?? '',
        WebTemplate: params.template,
        SiteDesignId: params.site_design_id ?? '96c933ac-3698-44c7-9f4a-5fd17d71af9e',
        Owner: params.owner ?? process.env.SPO_DEFAULT_OWNER,
      },
    }),
  });

  return parseResponse(response);
}

export async function getSiteStatus(params: { url: string }): Promise<unknown> {
  const tenant = tenantUrl();
  const token = await getSharePointToken(tenant);
  const encoded = encodeURIComponent(params.url);

  const response = await fetch(`${tenant}/_api/SPSiteManager/status?url='${encoded}'`, {
    method: 'GET',
    headers: spoHeaders(token),
  });

  return parseResponse(response);
}

export async function deleteSite(params: { site_id: string }): Promise<unknown> {
  const tenant = tenantUrl();
  const token = await getSharePointToken(tenant);

  const response = await fetch(`${tenant}/_api/SPSiteManager/delete`, {
    method: 'POST',
    headers: spoHeaders(token),
    body: JSON.stringify({ siteId: params.site_id }),
  });

  const payload = await parseResponse(response);
  return { success: true, status: response.status, payload };
}
