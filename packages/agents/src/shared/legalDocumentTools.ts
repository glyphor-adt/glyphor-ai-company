/**
 * Legal Document Tools — Professional Legal Document Generation
 *
 * Provides the CLO (and any agent with legal drafting authority) the ability
 * to produce properly formatted .docx legal documents and upload them directly
 * to SharePoint.
 *
 * Tools:
 *   draft_legal_document — Generate a professional Word document with legal
 *     formatting (Times New Roman, 1″ margins, numbered sections, signature
 *     blocks, headers/footers) and upload to SharePoint.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { uploadToSharePoint } from '@glyphor/integrations';

export function createLegalDocumentTools(): ToolDefinition[] {
  return [
    {
      name: 'draft_legal_document',
      description:
        'Draft and upload a professionally formatted legal document (.docx) to SharePoint. ' +
        'The document is rendered with Times New Roman font, 1-inch margins, proper section ' +
        'numbering, and page numbers — suitable for board consents, stock agreements, RSPAs, ' +
        'NDAs, policies, and any formal legal document.\n\n' +
        'FORMATTING GUIDE for the `content` parameter:\n' +
        '- Use # / ## / ### for headings (H1 is centered for legal docs)\n' +
        '- Use **bold** and *italic* for emphasis, __underline__ for defined terms\n' +
        '- Use ALLCAPS lines for document titles (auto-centered and bolded)\n' +
        '- Use "1.1 Section title" numbering for article/section numbering with auto-indentation\n' +
        '- Start lines with WHEREAS / NOW, THEREFORE for recital styling\n' +
        '- Use `[SIGNATURE BLOCK]` on its own line, followed by party info lines:\n' +
        '    [SIGNATURE BLOCK]\n' +
        '    Name: Kristina Denney\n' +
        '    Title: CEO\n' +
        '    Company: Glyphor, Inc.\n\n' +
        '    Name: Andrew Zwelling\n' +
        '    Title: COO\n' +
        '    Company: Glyphor, Inc.\n' +
        '- Use markdown tables (| Col1 | Col2 |) for cap tables or schedules\n' +
        '- Use --- for signature lines\n\n' +
        'The resulting .docx is automatically uploaded to SharePoint and indexed in company knowledge.',
      parameters: {
        document_title: {
          type: 'string',
          description: 'Document title (e.g., "Board Consent — Equity Restructuring", "Restricted Stock Purchase Agreement")',
          required: true,
        },
        content: {
          type: 'string',
          description:
            'The full legal document content in markdown format. Use the formatting guide ' +
            'in the tool description. Include all recitals, articles, sections, exhibits, ' +
            'and signature blocks.',
          required: true,
        },
        file_name: {
          type: 'string',
          description:
            'File name for the document (e.g., "board-consent-equity-restructuring.docx"). ' +
            'Will be saved as .docx regardless of extension provided.',
          required: true,
        },
        folder: {
          type: 'string',
          description:
            'Target folder within the Legal knowledge root (e.g., "Corporate-Governance", ' +
            '"Equity/RSPAs", "Contracts/NDAs"). Defaults to "Legal".',
          required: false,
        },
        confidential: {
          type: 'boolean',
          description: 'Add a "CONFIDENTIAL" header to every page (default: true for legal docs).',
          required: false,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        try {
          const title = params.document_title as string;
          const content = params.content as string;
          const rawName = params.file_name as string;
          const folder = (params.folder as string) || 'Legal';
          const confidential = params.confidential !== false; // default true

          // Ensure .docx extension
          const fileName = rawName.toLowerCase().endsWith('.docx')
            ? rawName
            : rawName.replace(/\.[^.]+$/, '') + '.docx';

          const rootFolder = process.env.SHAREPOINT_ROOT_FOLDER ?? 'Company-Agent-Knowledge';

          const result = await uploadToSharePoint(fileName, content, {
            folder: `${rootFolder}/${folder}`,
            agentRole: ctx.agentRole,
            docxOptions: {
              legalFormatting: true,
              title,
              confidential,
            },
          });

          return {
            success: true,
            data: {
              webUrl: result.webUrl,
              knowledgeId: result.knowledgeId,
              fileName,
              folder: `${rootFolder}/${folder}`,
              message: `Legal document "${title}" uploaded to SharePoint as ${fileName}. ` +
                'The document has professional legal formatting: Times New Roman, 1″ margins, ' +
                'page numbers, and section formatting.',
            },
            memoryKeysWritten: 1,
          };
        } catch (err) {
          const message = (err as Error).message;
          return {
            success: false,
            error: message,
            data: {
              hint:
                'If this is a permissions error, try upload_to_sharepoint as a fallback ' +
                '(it also converts to Word but with basic formatting). ' +
                'If the error persists, message Marcus (CTO) with the exact error.',
            },
          };
        }
      },
    },
  ];
}
