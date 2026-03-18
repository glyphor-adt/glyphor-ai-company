/**
 * Legal Document Tools — Professional Legal Document Generation
 *
 * Provides the CLO (and any agent with legal drafting authority) the ability
 * to produce properly formatted .docx or .pdf legal documents and upload them
 * directly to SharePoint.
 *
 * Tools:
 *   draft_legal_document — Generate a professional Word or PDF document with
 *     legal formatting (Times New Roman, 1″ margins, numbered sections,
 *     signature blocks, headers/footers) and upload to SharePoint.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { uploadToSharePoint, markdownToPdf, DocuSignClient } from '@glyphor/integrations';

export function createLegalDocumentTools(): ToolDefinition[] {
  return [
    {
      name: 'draft_legal_document',
      description:
        'Draft and upload a professionally formatted legal document (.docx or .pdf) to SharePoint. ' +
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
        'The resulting document is automatically uploaded to SharePoint and indexed in company knowledge.',
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
            'Use .docx for editable Word documents or .pdf for finalized documents.',
          required: true,
        },
        format: {
          type: 'string',
          description:
            'Output format: "docx" for editable Word document (default), "pdf" for finalized PDF. ' +
            'Use docx when the document may need further edits; use pdf for final versions, ' +
            'filings, or documents that should not be modified.',
          required: false,
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
          const format = ((params.format as string) || 'docx').toLowerCase();
          const isPdf = format === 'pdf';

          // Ensure correct extension
          const ext = isPdf ? '.pdf' : '.docx';
          const baseName = rawName.replace(/\.[^.]+$/, '');
          const fileName = baseName + ext;

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

          const formatLabel = isPdf ? 'PDF' : 'Word (.docx)';
          return {
            success: true,
            data: {
              webUrl: result.webUrl,
              knowledgeId: result.knowledgeId,
              fileName,
              format: isPdf ? 'pdf' : 'docx',
              folder: `${rootFolder}/${folder}`,
              message: `Legal document "${title}" uploaded to SharePoint as ${fileName} (${formatLabel}). ` +
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

    // ── prepare_signing_envelope ─────────────────────────────────────────
    {
      name: 'prepare_signing_envelope',
      description:
        'Draft a professional legal document, render it to PDF, and create a DocuSign ' +
        'envelope as a DRAFT for founder review. This is the end-to-end tool for preparing ' +
        'documents that need signatures — board consents, stock agreements, RSPAs, NDAs, etc.\n\n' +
        'The envelope is saved as a DRAFT (not sent). Founders can review the document and ' +
        'approve sending from the DocuSign dashboard, or you can send it later with ' +
        'the existing create_signing_envelope tool.\n\n' +
        'Always YELLOW — requires one founder to approve before the envelope is sent.\n\n' +
        'FORMATTING: Same as draft_legal_document — use markdown headings, bold, italic, ' +
        'ALLCAPS titles, WHEREAS clauses, numbered sections, and [SIGNATURE BLOCK] markers.\n\n' +
        'SIGNERS: Provide each signer\'s name and email. For internal documents (board consents, ' +
        'equity agreements), use:\n' +
        '  - Kristina Denney: kristina@glyphor.com\n' +
        '  - Andrew Zwelling: andrew@glyphor.com\n' +
        'For external parties, use their actual email addresses.',
      parameters: {
        document_title: {
          type: 'string',
          description: 'Document title (appears in DocuSign email subject and PDF header)',
          required: true,
        },
        content: {
          type: 'string',
          description: 'Full legal document content in markdown format (same formatting as draft_legal_document)',
          required: true,
        },
        file_name: {
          type: 'string',
          description: 'File name for the document (e.g., "rspa-kristina-denney.pdf")',
          required: true,
        },
        signers: {
          type: 'array',
          description: 'List of people who need to sign this document',
          required: true,
          items: {
            type: 'object',
            description: 'A signer with email and full name',
            properties: {
              email: { type: 'string', description: 'Signer email address' },
              name: { type: 'string', description: 'Signer full name' },
            },
          },
        },
        cc_recipients: {
          type: 'array',
          description: 'People who should receive a copy after all parties have signed (optional)',
          required: false,
          items: {
            type: 'object',
            description: 'CC recipient with email and name',
            properties: {
              email: { type: 'string', description: 'Recipient email' },
              name: { type: 'string', description: 'Recipient name' },
            },
          },
        },
        email_message: {
          type: 'string',
          description: 'Brief message to include in the DocuSign signing request email (optional)',
          required: false,
        },
        folder: {
          type: 'string',
          description: 'SharePoint folder for the backup copy (e.g., "Corporate-Governance", "Equity/RSPAs"). Defaults to "Legal".',
          required: false,
        },
        confidential: {
          type: 'boolean',
          description: 'Add "CONFIDENTIAL" header to every page (default: true)',
          required: false,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        // ── 1. Validate DocuSign is configured ──
        let dsClient: DocuSignClient | null = null;
        try {
          dsClient = DocuSignClient.fromEnv();
        } catch {
          // fall through
        }
        if (!dsClient) {
          return {
            success: false,
            error:
              'DocuSign is not configured. Set DOCUSIGN_ACCOUNT_ID, DOCUSIGN_INTEGRATION_KEY, ' +
              'DOCUSIGN_USER_ID, and DOCUSIGN_RSA_PRIVATE_KEY environment variables. ' +
              'As a fallback, use draft_legal_document to create the document and send it manually.',
          };
        }

        try {
          const title = params.document_title as string;
          const content = params.content as string;
          const rawName = params.file_name as string;
          const folder = (params.folder as string) || 'Legal';
          const confidential = params.confidential !== false;
          const signers = params.signers as Array<{ email: string; name: string }>;
          const ccRecipients = params.cc_recipients as Array<{ email: string; name: string }> | undefined;
          const emailMessage = params.email_message as string | undefined;

          // Ensure .pdf extension for signing documents
          const baseName = rawName.replace(/\.[^.]+$/, '');
          const fileName = baseName + '.pdf';

          // ── 2. Render content to PDF with legal formatting ──
          const pdfBuffer = await markdownToPdf(content, {
            legalFormatting: true,
            title,
            confidential,
          });

          const documentBase64 = pdfBuffer.toString('base64');

          // ── 3. Create DocuSign draft envelope ──
          const envelope = await dsClient.createEnvelope({
            emailSubject: `[Signature Required] ${title}`,
            emailBlurb: emailMessage || `Please review and sign: ${title}`,
            documents: [{
              documentBase64,
              name: fileName,
              fileExtension: 'pdf',
              documentId: '1',
            }],
            signers: signers.map((s, i) => ({
              email: s.email,
              name: s.name,
              routingOrder: String(i + 1),
              tabs: {
                signHereTabs: [{ anchorString: '/sn' + (i + 1) + '/', anchorUnits: 'pixels', anchorXOffset: '0', anchorYOffset: '-4' }],
                dateSignedTabs: [{ anchorString: '/ds' + (i + 1) + '/', anchorUnits: 'pixels', anchorXOffset: '0', anchorYOffset: '-4' }],
              },
            })),
            ccRecipients,
            status: 'created', // DRAFT — requires founder to approve sending
          });

          // ── 4. Also upload a copy to SharePoint for records ──
          let sharePointUrl: string | null = null;
          try {
            const rootFolder = process.env.SHAREPOINT_ROOT_FOLDER ?? 'Company-Agent-Knowledge';
            const spResult = await uploadToSharePoint(fileName, content, {
              folder: `${rootFolder}/${folder}`,
              agentRole: ctx.agentRole,
              docxOptions: { legalFormatting: true, title, confidential },
            });
            sharePointUrl = spResult.webUrl;
          } catch {
            // SharePoint backup is best-effort; the DocuSign envelope is what matters
          }

          return {
            success: true,
            data: {
              envelope_id: envelope.envelopeId,
              envelope_status: 'created (draft)',
              signers: signers.map(s => `${s.name} <${s.email}>`),
              document: fileName,
              sharepoint_backup: sharePointUrl,
              message:
                `DocuSign envelope prepared as DRAFT for "${title}". ` +
                `Envelope ID: ${envelope.envelopeId}. ` +
                `Signers: ${signers.map(s => s.name).join(', ')}. ` +
                'The envelope is NOT sent yet — a founder must approve it in DocuSign or you can ' +
                'send it after founder approval using the DocuSign console.',
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to prepare signing envelope: ${err instanceof Error ? err.message : String(err)}`,
            data: {
              hint:
                'If DocuSign fails, use draft_legal_document to create the document on SharePoint, ' +
                'then manually create the DocuSign envelope through the DocuSign web console.',
            },
          };
        }
      },
    },
  ];
}
