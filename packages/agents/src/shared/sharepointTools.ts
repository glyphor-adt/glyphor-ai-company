/**
 * SharePoint Tools — Shared tools for knowledge management
 *
 * Provides search_sharepoint, read_sharepoint_document, upload_to_sharepoint,
 * list_sharepoint_folders, and create_sharepoint_page tools. These allow agents
 * to interact with the company knowledge SharePoint site directly.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import {
  searchSharePoint,
  readSharePointDocument,
  uploadToSharePoint,
  listSharePointFolders,
  listSharePointFiles,
  createSharePointPage,
} from '@glyphor/integrations';

/**
 * Create SharePoint knowledge tools for agents.
 * Available to all agents — the SharePoint site is the canonical
 * source of truth for company documents.
 */
export function createSharePointTools(): ToolDefinition[] {
  return [
    {
      name: 'search_sharepoint',
      description:
        'Search the company SharePoint knowledge base for documents. ' +
        'Returns matching files with their paths and URLs. Use this to find ' +
        'policies, briefs, strategy docs, meeting notes, and other company knowledge.',
      parameters: {
        query: {
          type: 'string',
          description: 'Search keywords (e.g., "pricing strategy", "Q1 roadmap", "brand guidelines")',
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
          const results = await searchSharePoint(params.query as string, {
            maxResults: (params.max_results as number) ?? 10,
          });

          if (results.length === 0) {
            return { success: true, data: 'No documents found matching that query.' };
          }

          const formatted = results.map((doc: { name: string; path: string; webUrl: string | null; lastModified: string | null }, i: number) =>
            `${i + 1}. **${doc.name}**\n   Path: ${doc.path}\n   URL: ${doc.webUrl ?? 'N/A'}\n   Modified: ${doc.lastModified ?? 'Unknown'}`,
          ).join('\n\n');

          return { success: true, data: { count: results.length, documents: formatted } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'read_sharepoint_document',
      description:
        'Read the full content of a document from SharePoint. ' +
        'Supports .md, .txt, .docx, .doc, .pptx, .xlsx files. ' +
        'Provide the file path as returned by search_sharepoint (e.g., "Strategy/CORE.md").',
      parameters: {
        path: {
          type: 'string',
          description: 'File path as returned by search_sharepoint (e.g., "Strategy/CORE.md", "Products/Pulse/roadmap.md")',
          required: true,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const doc = await readSharePointDocument(params.path as string);
          return {
            success: true,
            data: {
              content: doc.content,
              webUrl: doc.webUrl,
              lastModified: doc.lastModified,
            },
          };
        } catch (err) {
          const pathUsed = params.path as string;
          return {
            success: false,
            error: (err as Error).message,
            data: {
              hint: 'If the path looks like just a filename, search_sharepoint may have returned an incomplete path. '
                + 'Try listing the folder with list_sharepoint_files to find the correct subfolder, '
                + 'then retry with the full relative path (e.g., "Operations/Operating Models/file.docx").',
              pathProvided: pathUsed,
              suggestion: pathUsed.includes('/') ? undefined : 'This looks like a filename without a folder path. Try searching again or listing folders.',
            },
          };
        }
      },
    },

    {
      name: 'upload_to_sharepoint',
      description:
        'Upload a new document to the company SharePoint knowledge base. ' +
        'The document is also automatically synced to the company_knowledge table in Cloud SQL. ' +
        'Use this to publish briefs, research findings, policies, or analysis reports.',
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
                    + 'Try create_sharepoint_page as an alternative — it bypasses the knowledge index. '
                    + 'If the error persists, message Marcus (CTO) with the exact error for a fix.',
                  fallbackTool: 'create_sharepoint_page',
                }
              : {
                  hint: 'If this is a permissions error, try creating a SharePoint page instead (create_sharepoint_page), '
                    + 'which uses a different API path. Or try a different folder.',
                  fallbackTool: 'create_sharepoint_page',
                },
          };
        }
      },
    },

    {
      name: 'list_sharepoint_folders',
      description:
        'List the top-level folders in the company SharePoint knowledge base. ' +
        'Use this to understand the document structure before reading or uploading.',
      parameters: {},
      execute: async (): Promise<ToolResult> => {
        try {
          const folders = await listSharePointFolders();
          return {
            success: true,
            data: folders.length > 0
              ? `Folders: ${folders.join(', ')}`
              : 'No folders found in knowledge root.',
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'list_sharepoint_files',
      description:
        'List the files in a specific folder of the company SharePoint knowledge base. ' +
        'If no folder is specified, lists files in the root. Use this to discover documents ' +
        'before reading them.',
      parameters: {
        folder: {
          type: 'string',
          description: 'Folder path to list files from (e.g., "Design", "Operations", "Strategy"). Omit to list root-level files.',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const files = await listSharePointFiles(params.folder as string | undefined);

          if (files.length === 0) {
            return { success: true, data: 'No files found in this folder.' };
          }

          const formatted = files.map((f: { name: string; path: string; webUrl: string | null; lastModified: string | null }, i: number) =>
            `${i + 1}. **${f.name}**\n   Path: ${f.path}\n   URL: ${f.webUrl ?? 'N/A'}\n   Modified: ${f.lastModified ?? 'Unknown'}`,
          ).join('\n\n');

          return { success: true, data: { count: files.length, files: formatted } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'create_sharepoint_page',
      description:
        'Create a new page on the company SharePoint site. ' +
        'The page is published immediately. Content should be HTML. ' +
        'Use this for announcements, reports, wiki pages, or news posts.',
      parameters: {
        title: {
          type: 'string',
          description: 'Page title (e.g., "Q1 Growth Strategy", "Engineering Standards")',
          required: true,
        },
        content: {
          type: 'string',
          description: 'Page body in HTML (e.g., "<h2>Overview</h2><p>Key findings...</p>")',
          required: true,
        },
        type: {
          type: 'string',
          description: 'Page type: "page" for standard page, "newsPost" for news article (default: "page")',
          required: false,
        },
        description: {
          type: 'string',
          description: 'Short description for the page (optional)',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const result = await createSharePointPage(
            params.title as string,
            params.content as string,
            {
              promotionKind: (params.type as 'page' | 'newsPost') ?? 'page',
              description: params.description as string | undefined,
            },
          );
          return {
            success: true,
            data: {
              pageId: result.id,
              webUrl: result.webUrl,
              message: `SharePoint page "${params.title}" created and published.`,
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },
  ];
}
