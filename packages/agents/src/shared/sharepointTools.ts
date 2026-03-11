/**
 * SharePoint Tools — Upload with Cloud SQL knowledge sync
 *
 * Only upload_to_sharepoint is kept as a custom tool because it syncs
 * uploaded documents to the Cloud SQL company_knowledge table.
 * All other SharePoint operations (search, read, list, create page)
 * are handled by Agent365 mcp_ODSPRemoteServer.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { uploadToSharePoint } from '@glyphor/integrations';

/**
 * Create SharePoint upload tool for agents.
 * Search, read, list, and page creation are covered by Agent365 mcp_ODSPRemoteServer.
 */
export function createSharePointTools(): ToolDefinition[] {
  return [
    {
      name: 'upload_to_sharepoint',
      description:
        'Upload a new document to the company SharePoint knowledge base. ' +
        'The document is also automatically synced to the company_knowledge table in Cloud SQL. ' +
        'Use this to publish briefs, research findings, policies, or analysis reports. ' +
        'Supports .md, .txt, and .docx files. When uploading a .docx file, the content is ' +
        'automatically converted from markdown/text into a proper Word document with headings, ' +
        'bold, italic, and list formatting.',
      parameters: {
        file_name: {
          type: 'string',
          description: 'File name with extension (e.g., "q1-growth-strategy.md", "competitive-analysis.txt")',
          required: true,
        },
        content: {
          type: 'string',
          description: 'The document content (markdown or plain text)',
          required: true,
        },
        folder: {
          type: 'string',
          description: 'Target folder within the knowledge root (e.g., "Strategy", "Products/Pulse", "Briefs")',
          required: false,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        try {
          const rootFolder = process.env.SHAREPOINT_ROOT_FOLDER ?? 'Company-Agent-Knowledge';
          const folder = params.folder
            ? `${rootFolder}/${params.folder as string}`
            : rootFolder;

          const result = await uploadToSharePoint(
            params.file_name as string,
            params.content as string,
            { folder },
          );

          return {
            success: true,
            data: {
              webUrl: result.webUrl,
              knowledgeId: result.knowledgeId,
              message: `Document uploaded to SharePoint and indexed in company knowledge.`,
            },
            memoryKeysWritten: 1,
          };
        } catch (err) {
          const message = (err as Error).message;
          // If the upload to SharePoint succeeded but the DB sync failed,
          // suggest creating a SharePoint page as an alternative.
          const isDbError = message.includes('malformed') || message.includes('column') || message.includes('constraint');
          return {
            success: false,
            error: message,
            data: isDbError
              ? {
                  hint: 'The file may have uploaded to SharePoint but the database sync failed. '
                    + 'Try using Agent365 mcp_ODSPRemoteServer tools to upload directly — they bypass the knowledge index. '
                    + 'If the error persists, message Marcus (CTO) with the exact error for a fix.',
                }
              : {
                  hint: 'If this is a permissions error, try using Agent365 mcp_ODSPRemoteServer tools to upload directly, '
                    + 'which uses a different API path. Or try a different folder.',
                },
          };
        }
      },
    },
  ];
}
