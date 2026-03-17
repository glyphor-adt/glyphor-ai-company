import { getSharePointToken, parseResponse, spoHeaders } from '../auth/sharepoint.js';

interface NavigationNode {
  title: string;
  url: string;
}

interface NavigationResponse {
  value?: Array<{ Id?: number; id?: number }>;
}

export interface UpdateNavigationParams {
  site_url: string;
  navigation_type: 'quickLaunch' | 'topNavigation';
  nodes: NavigationNode[];
}

function resolveEndpoint(type: UpdateNavigationParams['navigation_type']): string {
  return type === 'quickLaunch' ? 'quicklaunch' : 'topnavigationbar';
}

export async function updateNavigation(params: UpdateNavigationParams): Promise<unknown> {
  const token = await getSharePointToken(params.site_url);
  const endpoint = resolveEndpoint(params.navigation_type);

  const existingResponse = await fetch(
    `${params.site_url}/_api/web/navigation/${endpoint}`,
    { headers: spoHeaders(token) },
  );

  const existing = await parseResponse(existingResponse) as NavigationResponse;

  for (const node of existing.value ?? []) {
    const id = node.Id ?? node.id;
    if (!id) continue;
    const deleteResponse = await fetch(
      `${params.site_url}/_api/web/navigation/${endpoint}(${id})`,
      {
        method: 'DELETE',
        headers: {
          ...spoHeaders(token),
          'IF-MATCH': '*',
        },
      },
    );
    await parseResponse(deleteResponse);
  }

  const created: unknown[] = [];
  for (const node of params.nodes) {
    const createResponse = await fetch(
      `${params.site_url}/_api/web/navigation/${endpoint}`,
      {
        method: 'POST',
        headers: spoHeaders(token),
        body: JSON.stringify({
          __metadata: { type: 'SP.NavigationNode' },
          Title: node.title,
          Url: node.url,
          IsExternal: false,
        }),
      },
    );

    created.push(await parseResponse(createResponse));
  }

  return { success: true, nodes_added: created.length, nodes: created };
}
