/**
 * Figma Tools — Full Figma REST API integration
 *
 * 17 tools covering file content, components, styles, comments,
 * metadata, version history, projects, dev resources, and webhooks.
 * Uses OAuth token manager from figmaAuth.ts.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { figmaFetch } from './figmaAuth.js';

export function createFigmaTools(): ToolDefinition[] {
  return [
    // ─── FILE CONTENT ──────────────────────────────────────────────

    {
      name: 'get_figma_file',
      description: 'Get JSON tree of a Figma file',
      parameters: {
        file_key: { type: 'string', description: 'Figma file key', required: true },
        node_ids: { type: 'string', description: 'Comma-separated node IDs to scope the response', required: false },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const fileKey = params.file_key as string;
          const nodeIds = params.node_ids as string | undefined;
          const path = nodeIds
            ? `/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeIds)}`
            : `/v1/files/${fileKey}`;
          const response = await figmaFetch(path);
          if (!response.ok) {
            return { success: false, error: `Figma API error: ${response.status} ${response.statusText}` };
          }
          const data = await response.json();
          return { success: true, data };
        } catch (err) {
          return { success: false, error: `Failed to get Figma file: ${err}` };
        }
      },
    },

    {
      name: 'export_figma_images',
      description: 'Render nodes as PNG/SVG/JPG/PDF',
      parameters: {
        file_key: { type: 'string', description: 'Figma file key', required: true },
        node_ids: { type: 'string', description: 'Comma-separated node IDs to export', required: true },
        format: { type: 'string', description: 'Export format', required: false, enum: ['png', 'svg', 'jpg', 'pdf'] },
        scale: { type: 'number', description: 'Export scale (1-4)', required: false },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const fileKey = params.file_key as string;
          const nodeIds = params.node_ids as string;
          const format = (params.format as string) || 'png';
          const scale = (params.scale as number) || 2;
          const path = `/v1/images/${fileKey}?ids=${encodeURIComponent(nodeIds)}&format=${format}&scale=${scale}`;
          const response = await figmaFetch(path);
          if (!response.ok) {
            return { success: false, error: `Figma API error: ${response.status} ${response.statusText}` };
          }
          const data = await response.json();
          return { success: true, data };
        } catch (err) {
          return { success: false, error: `Failed to export images: ${err}` };
        }
      },
    },

    {
      name: 'get_figma_image_fills',
      description: 'Get URLs for fill images in a file',
      parameters: {
        file_key: { type: 'string', description: 'Figma file key', required: true },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const fileKey = params.file_key as string;
          const response = await figmaFetch(`/v1/files/${fileKey}/images`);
          if (!response.ok) {
            return { success: false, error: `Figma API error: ${response.status} ${response.statusText}` };
          }
          const data = await response.json();
          return { success: true, data };
        } catch (err) {
          return { success: false, error: `Failed to get image fills: ${err}` };
        }
      },
    },

    // ─── COMPONENTS & STYLES ───────────────────────────────────────

    {
      name: 'get_figma_components',
      description: 'List components in a file',
      parameters: {
        file_key: { type: 'string', description: 'Figma file key', required: true },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const fileKey = params.file_key as string;
          const response = await figmaFetch(`/v1/files/${fileKey}/components`);
          if (!response.ok) {
            return { success: false, error: `Figma API error: ${response.status} ${response.statusText}` };
          }
          const data = await response.json();
          return { success: true, data };
        } catch (err) {
          return { success: false, error: `Failed to get components: ${err}` };
        }
      },
    },

    {
      name: 'get_figma_team_components',
      description: 'List published components across team library',
      parameters: {
        team_id: { type: 'string', description: 'Figma team ID', required: true },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const teamId = params.team_id as string;
          const response = await figmaFetch(`/v1/teams/${teamId}/components`);
          if (!response.ok) {
            return { success: false, error: `Figma API error: ${response.status} ${response.statusText}` };
          }
          const data = await response.json();
          return { success: true, data };
        } catch (err) {
          return { success: false, error: `Failed to get team components: ${err}` };
        }
      },
    },

    {
      name: 'get_figma_styles',
      description: 'List styles in a file',
      parameters: {
        file_key: { type: 'string', description: 'Figma file key', required: true },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const fileKey = params.file_key as string;
          const response = await figmaFetch(`/v1/files/${fileKey}/styles`);
          if (!response.ok) {
            return { success: false, error: `Figma API error: ${response.status} ${response.statusText}` };
          }
          const data = await response.json();
          return { success: true, data };
        } catch (err) {
          return { success: false, error: `Failed to get styles: ${err}` };
        }
      },
    },

    {
      name: 'get_figma_team_styles',
      description: 'List published styles across team',
      parameters: {
        team_id: { type: 'string', description: 'Figma team ID', required: true },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const teamId = params.team_id as string;
          const response = await figmaFetch(`/v1/teams/${teamId}/styles`);
          if (!response.ok) {
            return { success: false, error: `Figma API error: ${response.status} ${response.statusText}` };
          }
          const data = await response.json();
          return { success: true, data };
        } catch (err) {
          return { success: false, error: `Failed to get team styles: ${err}` };
        }
      },
    },

    // ─── COMMENTS ──────────────────────────────────────────────────

    {
      name: 'get_figma_comments',
      description: 'Read comments on a file',
      parameters: {
        file_key: { type: 'string', description: 'Figma file key', required: true },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const fileKey = params.file_key as string;
          const response = await figmaFetch(`/v1/files/${fileKey}/comments`);
          if (!response.ok) {
            return { success: false, error: `Figma API error: ${response.status} ${response.statusText}` };
          }
          const data = await response.json();
          return { success: true, data };
        } catch (err) {
          return { success: false, error: `Failed to get comments: ${err}` };
        }
      },
    },

    {
      name: 'post_figma_comment',
      description: 'Add comment at location on a file',
      parameters: {
        file_key: { type: 'string', description: 'Figma file key', required: true },
        message: { type: 'string', description: 'Comment message text', required: true },
        node_id: { type: 'string', description: 'Node ID to attach the comment to', required: false },
        x: { type: 'number', description: 'X offset within the node', required: false },
        y: { type: 'number', description: 'Y offset within the node', required: false },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const fileKey = params.file_key as string;
          const message = params.message as string;
          const nodeId = params.node_id as string | undefined;
          const x = params.x as number | undefined;
          const y = params.y as number | undefined;

          const body: Record<string, unknown> = { message };
          if (nodeId) {
            body.client_meta = {
              node_id: nodeId,
              node_offset: { x: x ?? 0, y: y ?? 0 },
            };
          }

          const response = await figmaFetch(`/v1/files/${fileKey}/comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (!response.ok) {
            return { success: false, error: `Figma API error: ${response.status} ${response.statusText}` };
          }
          const data = await response.json();
          return { success: true, data };
        } catch (err) {
          return { success: false, error: `Failed to post comment: ${err}` };
        }
      },
    },

    {
      name: 'resolve_figma_comment',
      description: 'Resolve/delete a comment',
      parameters: {
        file_key: { type: 'string', description: 'Figma file key', required: true },
        comment_id: { type: 'string', description: 'Comment ID to resolve', required: true },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const fileKey = params.file_key as string;
          const commentId = params.comment_id as string;
          const response = await figmaFetch(`/v1/files/${fileKey}/comments/${commentId}`, {
            method: 'DELETE',
          });
          if (!response.ok) {
            return { success: false, error: `Figma API error: ${response.status} ${response.statusText}` };
          }
          return { success: true, data: { resolved: true, comment_id: commentId } };
        } catch (err) {
          return { success: false, error: `Failed to resolve comment: ${err}` };
        }
      },
    },

    // ─── METADATA & HISTORY ────────────────────────────────────────

    {
      name: 'get_figma_file_metadata',
      description: 'Get lightweight file info (depth=1)',
      parameters: {
        file_key: { type: 'string', description: 'Figma file key', required: true },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const fileKey = params.file_key as string;
          const response = await figmaFetch(`/v1/files/${fileKey}?depth=1`);
          if (!response.ok) {
            return { success: false, error: `Figma API error: ${response.status} ${response.statusText}` };
          }
          const data = await response.json();
          return { success: true, data };
        } catch (err) {
          return { success: false, error: `Failed to get file metadata: ${err}` };
        }
      },
    },

    {
      name: 'get_figma_version_history',
      description: 'Get version history for a file',
      parameters: {
        file_key: { type: 'string', description: 'Figma file key', required: true },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const fileKey = params.file_key as string;
          const response = await figmaFetch(`/v1/files/${fileKey}/versions`);
          if (!response.ok) {
            return { success: false, error: `Figma API error: ${response.status} ${response.statusText}` };
          }
          const data = await response.json();
          return { success: true, data };
        } catch (err) {
          return { success: false, error: `Failed to get version history: ${err}` };
        }
      },
    },

    // ─── PROJECTS ──────────────────────────────────────────────────

    {
      name: 'get_figma_team_projects',
      description: 'List team projects',
      parameters: {
        team_id: { type: 'string', description: 'Figma team ID', required: true },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const teamId = params.team_id as string;
          const response = await figmaFetch(`/v1/teams/${teamId}/projects`);
          if (!response.ok) {
            return { success: false, error: `Figma API error: ${response.status} ${response.statusText}` };
          }
          const data = await response.json();
          return { success: true, data };
        } catch (err) {
          return { success: false, error: `Failed to get team projects: ${err}` };
        }
      },
    },

    {
      name: 'get_figma_project_files',
      description: 'List files in a project',
      parameters: {
        project_id: { type: 'string', description: 'Figma project ID', required: true },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const projectId = params.project_id as string;
          const response = await figmaFetch(`/v1/projects/${projectId}/files`);
          if (!response.ok) {
            return { success: false, error: `Figma API error: ${response.status} ${response.statusText}` };
          }
          const data = await response.json();
          return { success: true, data };
        } catch (err) {
          return { success: false, error: `Failed to get project files: ${err}` };
        }
      },
    },

    // ─── DEV RESOURCES ─────────────────────────────────────────────

    {
      name: 'get_figma_dev_resources',
      description: 'List dev resources on nodes in a file',
      parameters: {
        file_key: { type: 'string', description: 'Figma file key', required: true },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const fileKey = params.file_key as string;
          const response = await figmaFetch(`/v1/files/${fileKey}/dev_resources`);
          if (!response.ok) {
            return { success: false, error: `Figma API error: ${response.status} ${response.statusText}` };
          }
          const data = await response.json();
          return { success: true, data };
        } catch (err) {
          return { success: false, error: `Failed to get dev resources: ${err}` };
        }
      },
    },

    {
      name: 'create_figma_dev_resource',
      description: 'Attach a dev resource to a node',
      parameters: {
        file_key: { type: 'string', description: 'Figma file key', required: true },
        node_id: { type: 'string', description: 'Node ID to attach the resource to', required: true },
        name: { type: 'string', description: 'Resource name', required: true },
        url: { type: 'string', description: 'Resource URL', required: true },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const fileKey = params.file_key as string;
          const nodeId = params.node_id as string;
          const name = params.name as string;
          const url = params.url as string;

          const response = await figmaFetch('/v1/dev_resources', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, url, file_key: fileKey, node_id: nodeId }),
          });
          if (!response.ok) {
            return { success: false, error: `Figma API error: ${response.status} ${response.statusText}` };
          }
          const data = await response.json();
          return { success: true, data };
        } catch (err) {
          return { success: false, error: `Failed to create dev resource: ${err}` };
        }
      },
    },

    // ─── WEBHOOKS ──────────────────────────────────────────────────

    {
      name: 'manage_figma_webhooks',
      description: 'Create, list, or get webhooks',
      parameters: {
        action: { type: 'string', description: 'Webhook action', required: true, enum: ['create', 'list', 'get'] },
        team_id: { type: 'string', description: 'Team ID (required for create/list)', required: false },
        webhook_id: { type: 'string', description: 'Webhook ID (for get)', required: false },
        event_type: {
          type: 'string',
          description: 'Event type (for create)',
          required: false,
          enum: ['FILE_UPDATE', 'FILE_DELETE', 'FILE_VERSION_UPDATE', 'LIBRARY_PUBLISH', 'FILE_COMMENT'],
        },
        callback_url: { type: 'string', description: 'Callback URL (for create)', required: false },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const action = params.action as string;

          if (action === 'create') {
            const teamId = params.team_id as string | undefined;
            const eventType = params.event_type as string | undefined;
            const callbackUrl = params.callback_url as string | undefined;
            if (!teamId || !eventType || !callbackUrl) {
              return { success: false, error: 'team_id, event_type, and callback_url are required for create' };
            }
            const response = await figmaFetch('/v2/webhooks', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                team_id: teamId,
                event_type: eventType,
                endpoint: callbackUrl,
              }),
            });
            if (!response.ok) {
              return { success: false, error: `Figma API error: ${response.status} ${response.statusText}` };
            }
            const data = await response.json();
            return { success: true, data };
          }

          if (action === 'list') {
            const teamId = params.team_id as string | undefined;
            if (!teamId) {
              return { success: false, error: 'team_id is required for list' };
            }
            const response = await figmaFetch(`/v2/teams/${teamId}/webhooks`);
            if (!response.ok) {
              return { success: false, error: `Figma API error: ${response.status} ${response.statusText}` };
            }
            const data = await response.json();
            return { success: true, data };
          }

          if (action === 'get') {
            const webhookId = params.webhook_id as string | undefined;
            if (!webhookId) {
              return { success: false, error: 'webhook_id is required for get' };
            }
            const response = await figmaFetch(`/v2/webhooks/${webhookId}`);
            if (!response.ok) {
              return { success: false, error: `Figma API error: ${response.status} ${response.statusText}` };
            }
            const data = await response.json();
            return { success: true, data };
          }

          return { success: false, error: `Unknown action: ${action}` };
        } catch (err) {
          return { success: false, error: `Failed to manage webhooks: ${err}` };
        }
      },
    },
  ];
}
