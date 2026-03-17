import {
  createSite,
  deleteSite,
  getSiteStatus,
  type CreateSiteParams,
} from './sites.js';
import {
  applySiteDesign,
  createSiteDesign,
  createSiteScript,
  getSiteDesigns,
  getSiteScriptFromWeb,
  getSiteScripts,
  type CreateSiteDesignParams,
  type CreateSiteScriptParams,
  type GetSiteScriptFromWebParams,
} from './designs.js';
import {
  createSitePage,
  deletePage,
  getPages,
  publishPage,
  updateSitePage,
  type CreateSitePageParams,
  type UpdateSitePageParams,
} from './pages.js';
import { updateNavigation, type UpdateNavigationParams } from './navigation.js';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
  allowedRoles?: string[];
  handler: (params: Record<string, unknown>) => Promise<unknown>;
}

const ADMIN_ROLES = ['m365-admin', 'global-admin', 'chief-of-staff'];
const AUTHORING_ROLES = ['m365-admin', 'global-admin', 'chief-of-staff', 'cmo', 'content-creator'];

export const tools: ToolDefinition[] = [
  {
    name: 'spo_create_site',
    description: 'Create a SharePoint site collection (communication or team site) using SPSiteManager.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Site title.' },
        url: { type: 'string', description: 'Absolute site URL to create.' },
        template: { type: 'string', description: 'Site template.', enum: ['SITEPAGEPUBLISHING#0', 'STS#3'] },
        description: { type: 'string', description: 'Optional site description.' },
        owner: { type: 'string', description: 'Optional owner UPN/email.' },
        lcid: { type: 'number', description: 'Locale ID (default 1033).' },
        site_design_id: { type: 'string', description: 'Optional site design GUID.' },
      },
      required: ['title', 'url', 'template'],
    },
    allowedRoles: ADMIN_ROLES,
    handler: (params) => createSite(params as unknown as CreateSiteParams),
  },
  {
    name: 'spo_get_site_status',
    description: 'Get asynchronous provisioning status for a SharePoint site URL.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Site URL to check.' },
      },
      required: ['url'],
    },
    allowedRoles: AUTHORING_ROLES,
    handler: (params) => getSiteStatus(params as { url: string }),
  },
  {
    name: 'spo_delete_site',
    description: 'Delete a SharePoint site by site GUID.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site collection GUID.' },
      },
      required: ['site_id'],
    },
    allowedRoles: ADMIN_ROLES,
    handler: (params) => deleteSite(params as { site_id: string }),
  },
  {
    name: 'spo_create_site_script',
    description: 'Create a reusable SharePoint site script JSON definition.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Site script title.' },
        description: { type: 'string', description: 'Optional script description.' },
        content: { type: 'object', description: 'Site script JSON content.' },
      },
      required: ['title', 'content'],
    },
    allowedRoles: ADMIN_ROLES,
    handler: (params) => createSiteScript(params as unknown as CreateSiteScriptParams),
  },
  {
    name: 'spo_get_site_scripts',
    description: 'List all SharePoint site scripts available at tenant scope.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    allowedRoles: AUTHORING_ROLES,
    handler: () => getSiteScripts(),
  },
  {
    name: 'spo_create_site_design',
    description: 'Create a SharePoint site design that references one or more site scripts.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Site design title.' },
        description: { type: 'string', description: 'Optional site design description.' },
        site_script_ids: { type: 'array', description: 'Array of site script GUIDs.' },
        template: { type: 'string', description: 'Web template code (64 team, 68 communication).' },
      },
      required: ['title', 'site_script_ids', 'template'],
    },
    allowedRoles: ADMIN_ROLES,
    handler: (params) => createSiteDesign(params as unknown as CreateSiteDesignParams),
  },
  {
    name: 'spo_apply_site_design',
    description: 'Apply a site design to an existing site URL.',
    inputSchema: {
      type: 'object',
      properties: {
        site_url: { type: 'string', description: 'Target site URL.' },
        site_design_id: { type: 'string', description: 'Site design GUID.' },
      },
      required: ['site_url', 'site_design_id'],
    },
    allowedRoles: ADMIN_ROLES,
    handler: (params) => applySiteDesign(params as { site_url: string; site_design_id: string }),
  },
  {
    name: 'spo_get_site_designs',
    description: 'List all SharePoint site designs available at tenant scope.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    allowedRoles: AUTHORING_ROLES,
    handler: () => getSiteDesigns(),
  },
  {
    name: 'spo_get_site_script_from_web',
    description: 'Extract a site script definition from an existing SharePoint site.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Source site URL.' },
        include_branding: { type: 'boolean', description: 'Include branding settings.' },
        include_theme: { type: 'boolean', description: 'Include theme settings.' },
        include_regional_settings: { type: 'boolean', description: 'Include regional settings.' },
        include_external_sharing: { type: 'boolean', description: 'Include external sharing capability.' },
        include_links: { type: 'boolean', description: 'Include links to exported items.' },
        included_lists: { type: 'array', description: 'Optional list titles to include.' },
      },
      required: ['url'],
    },
    allowedRoles: AUTHORING_ROLES,
    handler: (params) => getSiteScriptFromWeb(params as unknown as GetSiteScriptFromWebParams),
  },
  {
    name: 'spo_create_site_page',
    description: 'Create a modern SharePoint page via Microsoft Graph.',
    inputSchema: {
      type: 'object',
      properties: {
        site_url: { type: 'string', description: 'Target site URL.' },
        name: { type: 'string', description: 'Page filename, e.g. q1-update.aspx.' },
        title: { type: 'string', description: 'Page title.' },
        page_layout: { type: 'string', description: 'Page layout.', enum: ['article', 'home'] },
        title_area: { type: 'object', description: 'Optional title area payload.' },
        canvas_layout: { type: 'object', description: 'Optional canvas layout payload.' },
      },
      required: ['site_url', 'name', 'title'],
    },
    allowedRoles: AUTHORING_ROLES,
    handler: (params) => createSitePage(params as unknown as CreateSitePageParams),
  },
  {
    name: 'spo_publish_page',
    description: 'Publish an existing SharePoint page.',
    inputSchema: {
      type: 'object',
      properties: {
        site_url: { type: 'string', description: 'Target site URL.' },
        page_id: { type: 'string', description: 'Page GUID or Graph item id.' },
      },
      required: ['site_url', 'page_id'],
    },
    allowedRoles: AUTHORING_ROLES,
    handler: (params) => publishPage(params as { site_url: string; page_id: string }),
  },
  {
    name: 'spo_get_pages',
    description: 'List modern pages for a SharePoint site.',
    inputSchema: {
      type: 'object',
      properties: {
        site_url: { type: 'string', description: 'Target site URL.' },
      },
      required: ['site_url'],
    },
    allowedRoles: AUTHORING_ROLES,
    handler: (params) => getPages(params as { site_url: string }),
  },
  {
    name: 'spo_update_site_page',
    description: 'Update title, canvas layout, or news promotion for a SharePoint page.',
    inputSchema: {
      type: 'object',
      properties: {
        site_url: { type: 'string', description: 'Target site URL.' },
        page_id: { type: 'string', description: 'Page GUID or Graph item id.' },
        title: { type: 'string', description: 'New page title.' },
        canvas_layout: { type: 'object', description: 'Optional replacement canvas layout.' },
        promote_as_news: { type: 'boolean', description: 'Promote page as a news post.' },
      },
      required: ['site_url', 'page_id'],
    },
    allowedRoles: AUTHORING_ROLES,
    handler: (params) => updateSitePage(params as unknown as UpdateSitePageParams),
  },
  {
    name: 'spo_delete_page',
    description: 'Delete a modern SharePoint page.',
    inputSchema: {
      type: 'object',
      properties: {
        site_url: { type: 'string', description: 'Target site URL.' },
        page_id: { type: 'string', description: 'Page GUID or Graph item id.' },
      },
      required: ['site_url', 'page_id'],
    },
    allowedRoles: ADMIN_ROLES,
    handler: (params) => deletePage(params as { site_url: string; page_id: string }),
  },
  {
    name: 'spo_update_navigation',
    description: 'Replace quick-launch or top navigation nodes for a SharePoint site.',
    inputSchema: {
      type: 'object',
      properties: {
        site_url: { type: 'string', description: 'Target site URL.' },
        navigation_type: { type: 'string', description: 'Navigation rail to update.', enum: ['quickLaunch', 'topNavigation'] },
        nodes: { type: 'array', description: 'Array of { title, url } navigation nodes.' },
      },
      required: ['site_url', 'navigation_type', 'nodes'],
    },
    allowedRoles: ADMIN_ROLES,
    handler: (params) => updateNavigation(params as unknown as UpdateNavigationParams),
  },
];
