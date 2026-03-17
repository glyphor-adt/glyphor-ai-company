import { getSharePointToken, parseResponse, spoHeaders, tenantUrl } from '../auth/sharepoint.js';

export interface CreateSiteScriptParams {
  title: string;
  content: Record<string, unknown>;
  description?: string;
}

export async function createSiteScript(params: CreateSiteScriptParams): Promise<unknown> {
  const tenant = tenantUrl();
  const token = await getSharePointToken(tenant);
  const encodedTitle = encodeURIComponent(params.title);

  const response = await fetch(
    `${tenant}/_api/Microsoft.SharePoint.Utilities.WebTemplateExtensions.SiteScriptUtility.CreateSiteScript(Title=@title)?@title='${encodedTitle}'`,
    {
      method: 'POST',
      headers: spoHeaders(token),
      body: JSON.stringify({
        ...params.content,
        ...(params.description ? { Description: params.description } : {}),
      }),
    },
  );

  return parseResponse(response);
}

export async function getSiteScripts(): Promise<unknown> {
  const tenant = tenantUrl();
  const token = await getSharePointToken(tenant);

  const response = await fetch(
    `${tenant}/_api/Microsoft.SharePoint.Utilities.WebTemplateExtensions.SiteScriptUtility.GetSiteScripts`,
    {
      method: 'POST',
      headers: spoHeaders(token),
    },
  );

  return parseResponse(response);
}

export interface CreateSiteDesignParams {
  title: string;
  description?: string;
  site_script_ids: string[];
  template: string;
}

export async function createSiteDesign(params: CreateSiteDesignParams): Promise<unknown> {
  const tenant = tenantUrl();
  const token = await getSharePointToken(tenant);

  const response = await fetch(
    `${tenant}/_api/Microsoft.SharePoint.Utilities.WebTemplateExtensions.SiteScriptUtility.CreateSiteDesign`,
    {
      method: 'POST',
      headers: spoHeaders(token),
      body: JSON.stringify({
        info: {
          Title: params.title,
          Description: params.description ?? '',
          SiteScriptIds: params.site_script_ids,
          WebTemplate: params.template,
        },
      }),
    },
  );

  return parseResponse(response);
}

export async function applySiteDesign(params: { site_url: string; site_design_id: string }): Promise<unknown> {
  const token = await getSharePointToken(params.site_url);

  const response = await fetch(
    `${params.site_url}/_api/Microsoft.SharePoint.Utilities.WebTemplateExtensions.SiteScriptUtility.ApplySiteDesign`,
    {
      method: 'POST',
      headers: spoHeaders(token),
      body: JSON.stringify({
        siteDesignId: params.site_design_id,
        webUrl: params.site_url,
      }),
    },
  );

  return parseResponse(response);
}

export async function getSiteDesigns(): Promise<unknown> {
  const tenant = tenantUrl();
  const token = await getSharePointToken(tenant);

  const response = await fetch(
    `${tenant}/_api/Microsoft.SharePoint.Utilities.WebTemplateExtensions.SiteScriptUtility.GetSiteDesigns`,
    {
      method: 'POST',
      headers: spoHeaders(token),
    },
  );

  return parseResponse(response);
}

export interface GetSiteScriptFromWebParams {
  url: string;
  include_branding?: boolean;
  include_theme?: boolean;
  include_regional_settings?: boolean;
  include_external_sharing?: boolean;
  include_links?: boolean;
  included_lists?: string[];
}

export async function getSiteScriptFromWeb(params: GetSiteScriptFromWebParams): Promise<unknown> {
  const tenant = tenantUrl();
  const token = await getSharePointToken(tenant);

  const response = await fetch(
    `${tenant}/_api/Microsoft.SharePoint.Utilities.WebTemplateExtensions.SiteScriptUtility.GetSiteScriptFromWeb`,
    {
      method: 'POST',
      headers: spoHeaders(token),
      body: JSON.stringify({
        webUrl: params.url,
        info: {
          IncludeBranding: params.include_branding ?? true,
          IncludeTheme: params.include_theme ?? true,
          IncludeRegionalSettings: params.include_regional_settings ?? false,
          IncludeSiteExternalSharingCapability: params.include_external_sharing ?? false,
          IncludeLinksToExportedItems: params.include_links ?? true,
          IncludedLists: params.included_lists ?? [],
        },
      }),
    },
  );

  return parseResponse(response);
}
