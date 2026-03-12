/**
 * Agent Entra Role Mapping — Maps agent roles to Entra app role values
 *
 * These roles are defined on the Agent 365 blueprint app:
 *   5604df3b-a3a3-4c7e-a8c4-e6f9ed04ad6a
 *
 * Each agent identity is assigned a subset of these roles, which controls
 * which tools the Glyphor MCP servers expose to that agent.
 *
 * See docs/MCP.md Step 4 for the full mapping specification.
 */

import type { CompanyAgentRole } from '../types.js';

/** All 22 Glyphor Entra app role values */
export const GLYPHOR_APP_ROLES = [
  'Glyphor.Marketing.Read',
  'Glyphor.Marketing.Content.Write',
  'Glyphor.Marketing.Publish',
  'Glyphor.Marketing.SEO.Read',
  'Glyphor.Marketing.Social.Write',
  'Glyphor.Finance.Revenue.Read',
  'Glyphor.Finance.Cost.Read',
  'Glyphor.Finance.Banking.Read',
  'Glyphor.Product.Read',
  'Glyphor.Support.Read',
  'Glyphor.Research.Read',
  'Glyphor.Engineering.Read',
  'Glyphor.Code.Read',
  'Glyphor.Code.Write',
  'Glyphor.Deploy.Preview',
  'Glyphor.Deploy.Production',
  'Glyphor.Design.Read',
  'Glyphor.Design.Write',
  'Glyphor.Figma.Read',
  'Glyphor.Figma.Write',
  'Glyphor.Ops.Read',
  'Glyphor.Admin.Read',
] as const;

export type GlyphorAppRole = (typeof GLYPHOR_APP_ROLES)[number];

/** Entra app role IDs on blueprint app 5604df3b-a3a3-4c7e-a8c4-e6f9ed04ad6a */
export const APP_ROLE_IDS: Record<GlyphorAppRole, string> = {
  'Glyphor.Marketing.Read':          '49289e18-663d-4cab-ba93-cbd14e1ac2e0',
  'Glyphor.Marketing.Content.Write': '07b96a22-1d6a-4ca8-8768-2333a9de7b25',
  'Glyphor.Marketing.Publish':       'ef50797a-2d66-4575-9397-f5e635f77bd5',
  'Glyphor.Marketing.SEO.Read':      'aa356ee9-d46b-4f7a-8a23-d31655241823',
  'Glyphor.Marketing.Social.Write':  '86abc32d-2828-490b-abca-efd0d4074bbe',
  'Glyphor.Finance.Revenue.Read':    '5a3fa380-ec3f-4fae-8f57-5af2224ec352',
  'Glyphor.Finance.Cost.Read':       '396de83a-e3a3-47b8-9576-3900cd5c935a',
  'Glyphor.Finance.Banking.Read':    'b18819c8-ef11-45a7-b061-ad9e8f9da96c',
  'Glyphor.Product.Read':            '6e615978-aec9-4acf-9dd5-5c3f9a4d759f',
  'Glyphor.Support.Read':            'dd0ffccd-7942-4a06-afdb-cd31f1761281',
  'Glyphor.Research.Read':           'c3586f27-a7de-45a6-8a50-abfe16608d8a',
  'Glyphor.Engineering.Read':        'dc1b4a2d-c0a3-404d-aa90-3fbd9fa341a6',
  'Glyphor.Code.Read':               'a6049082-b5f5-4c29-a704-619f6605e5f8',
  'Glyphor.Code.Write':              '8b1bbe51-699b-43c3-9e93-99dc1a7d51e5',
  'Glyphor.Deploy.Preview':          'c9012023-9ef2-4cd3-b87c-abb2a429381c',
  'Glyphor.Deploy.Production':       'e6dc2325-7b3c-4c4e-8e08-3ae48e1f01c4',
  'Glyphor.Design.Read':             '132ec6a1-4cf1-4d0b-9c68-21b4b04fcb6f',
  'Glyphor.Design.Write':            '5d3b4a7c-511d-4a8b-95a5-3b8da2e5828d',
  'Glyphor.Figma.Read':              '8d41fcad-cde6-449f-b131-13e697213baa',
  'Glyphor.Figma.Write':             'd1294cc3-28d9-4ebb-b276-5dd14b0d6e0a',
  'Glyphor.Ops.Read':                'd37493b8-3282-46de-9e48-160da48c499f',
  'Glyphor.Admin.Read':              '44f8632a-2269-4f1f-ab0e-eab6ab0c30b1',
};

/**
 * Per-agent Entra app role assignments.
 * Determines which Glyphor MCP server tools each agent can access.
 */
export const AGENT_ROLE_ASSIGNMENTS: Record<CompanyAgentRole, GlyphorAppRole[]> = {
  // C-Suite
  'chief-of-staff':       ['Glyphor.Admin.Read', 'Glyphor.Ops.Read'],
  'cto':                  ['Glyphor.Code.Read', 'Glyphor.Code.Write', 'Glyphor.Deploy.Production', 'Glyphor.Engineering.Read'],
  'cfo':                  ['Glyphor.Finance.Revenue.Read', 'Glyphor.Finance.Cost.Read', 'Glyphor.Finance.Banking.Read'],
  'cmo':                  ['Glyphor.Marketing.Read', 'Glyphor.Marketing.Content.Write', 'Glyphor.Marketing.Publish', 'Glyphor.Marketing.Social.Write'],
  'cpo':                  ['Glyphor.Product.Read', 'Glyphor.Research.Read'],
  'clo':                  ['Glyphor.Admin.Read'],
  'vp-sales':             ['Glyphor.Research.Read'],
  'vp-design':            ['Glyphor.Design.Read', 'Glyphor.Design.Write', 'Glyphor.Figma.Read', 'Glyphor.Figma.Write', 'Glyphor.Code.Read'],

  // Engineering team
  'platform-engineer':    ['Glyphor.Code.Read', 'Glyphor.Code.Write', 'Glyphor.Engineering.Read'],
  'quality-engineer':     ['Glyphor.Code.Read', 'Glyphor.Engineering.Read'],
  'devops-engineer':      ['Glyphor.Code.Read', 'Glyphor.Deploy.Preview', 'Glyphor.Engineering.Read'],
  'm365-admin':           ['Glyphor.Admin.Read'],

  // Product team
  'user-researcher':      ['Glyphor.Product.Read', 'Glyphor.Support.Read'],
  'competitive-intel':    ['Glyphor.Product.Read', 'Glyphor.Research.Read'],

  // Marketing team
  'content-creator':      ['Glyphor.Marketing.Read', 'Glyphor.Marketing.Content.Write'],
  'seo-analyst':          ['Glyphor.Marketing.SEO.Read', 'Glyphor.Marketing.Read'],
  'social-media-manager': ['Glyphor.Marketing.Read', 'Glyphor.Marketing.Social.Write'],

  // Design & Frontend team
  'ui-ux-designer':       ['Glyphor.Design.Read', 'Glyphor.Figma.Read'],
  'frontend-engineer':    ['Glyphor.Design.Read', 'Glyphor.Code.Read', 'Glyphor.Code.Write'],
  'design-critic':        ['Glyphor.Design.Read', 'Glyphor.Figma.Read'],
  'template-architect':   ['Glyphor.Design.Read', 'Glyphor.Design.Write', 'Glyphor.Code.Read', 'Glyphor.Code.Write'],

  // Operations
  'ops':                  ['Glyphor.Ops.Read', 'Glyphor.Admin.Read'],
  'global-admin':         ['Glyphor.Admin.Read'],

  // People & Culture
  'head-of-hr':           ['Glyphor.Admin.Read'],

  // Research & Intelligence
  'vp-research':          ['Glyphor.Research.Read', 'Glyphor.Product.Read'],
  'competitive-research-analyst': ['Glyphor.Research.Read'],
  'market-research-analyst':      ['Glyphor.Research.Read'],
  'bob-the-tax-pro':               ['Glyphor.Finance.Revenue.Read'],
  'marketing-intelligence-analyst': ['Glyphor.Marketing.Read', 'Glyphor.Research.Read'],
  'adi-rose':                      ['Glyphor.Admin.Read', 'Glyphor.Ops.Read'],
};

/**
 * Get the app role IDs for a given agent role.
 * Returns the Entra app role UUIDs to assign to the agent's service principal.
 */
export function getAgentRoleIds(agentRole: CompanyAgentRole): string[] {
  const roles = AGENT_ROLE_ASSIGNMENTS[agentRole] ?? [];
  return roles.map(r => APP_ROLE_IDS[r]);
}

/**
 * Get the app role values (scope strings) for a given agent role.
 * Used by MCP servers to validate incoming token claims.
 */
export function getAgentScopes(agentRole: CompanyAgentRole): string[] {
  return AGENT_ROLE_ASSIGNMENTS[agentRole] ?? [];
}
