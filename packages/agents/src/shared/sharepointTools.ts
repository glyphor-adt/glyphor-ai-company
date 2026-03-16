/**
 * SharePoint Tools — Search, read, and upload with Cloud SQL knowledge sync
 *
 * upload_to_sharepoint syncs uploaded documents to the Cloud SQL company_knowledge table.
 * search_sharepoint and read_sharepoint_document use app-level permissions
 * (Sites.Read.All) which work across all sites without per-user membership.
 * Agent365 mcp_ODSPRemoteServer tools are also available but depend on the
 * agentic user's SharePoint site membership, which may not cover all sites.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { uploadToSharePoint, searchSharePoint, readSharePointDocument } from '@glyphor/integrations';

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

    {
      name: 'search_sharepoint',
      description:
        'Search for documents in the company SharePoint site by keyword. ' +
        'Uses app-level permissions so it can find files across all document libraries, ' +
        'not just the agent knowledge folder. Use this to find company documents like ' +
        'policies, certificates, legal filings, briefs, or any file stored in SharePoint. ' +
        'Returns file names, paths, and web URLs. Prefer this over mcp_ODSPRemoteServer ' +
        'for finding files by name or keyword.',
      parameters: {
        query: {
          type: 'string',
          description: 'Search keywords (e.g., "certificate of incorporation", "brand guidelines")',
          required: true,
        },
        max_results: {
          type: 'number',
          description: 'Maximum results to return (default: 10)',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const results = await searchSharePoint(
            params.query as string,
            { maxResults: (params.max_results as number) ?? 10 },
          );

          if (results.length === 0) {
            return {
              success: true,
              data: {
                count: 0,
                documents: [],
                hint: 'No documents matched this query. Try broader keywords or different terms.',
              },
            };
          }

          return {
            success: true,
            data: {
              count: results.length,
              documents: results.map(d => ({
                name: d.name,
                path: d.path,
                webUrl: d.webUrl,
                lastModified: d.lastModified,
                size: d.size,
              })),
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'read_sharepoint_document',
      description:
        'Read the text content of a document from SharePoint by file path. ' +
        'Supports .md, .txt, and Office files (.docx, .pptx, .xlsx). ' +
        'Use search_sharepoint first to find the file path, then use this to read it.',
      parameters: {
        file_path: {
          type: 'string',
          description: 'Path to the file within SharePoint (e.g., "Legal/certificate-of-incorporation.pdf" or the full path from search results)',
          required: true,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const result = await readSharePointDocument(params.file_path as string);
          return {
            success: true,
            data: {
              content: result.content,
              webUrl: result.webUrl,
              lastModified: result.lastModified,
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },
  ];
}
