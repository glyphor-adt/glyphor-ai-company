/**
 * Shared DocuSign Tools — Envelope & Signature Operations
 *
 * Enables agents (primarily CLO / legal) to prepare documents,
 * send envelopes for signature, check signing status, send reminders,
 * and void envelopes via the DocuSign eSignature REST API.
 *
 * Tools:
 *   create_signing_envelope  — Prepare & send a document for e-signature
 *   send_template_envelope   — Send an envelope from a DocuSign template
 *   check_envelope_status    — Check signing progress on an envelope
 *   list_envelopes           — List recent envelopes with optional filters
 *   void_envelope            — Void/cancel a pending envelope
 *   resend_envelope          — Resend reminder for a pending envelope
 *
 * Required env vars (see packages/integrations/src/docusign/client.ts):
 *   DOCUSIGN_ACCOUNT_ID, DOCUSIGN_INTEGRATION_KEY,
 *   DOCUSIGN_USER_ID, DOCUSIGN_RSA_PRIVATE_KEY
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { DocuSignClient } from '@glyphor/integrations';

export function createDocuSignTools(): ToolDefinition[] {
  let client: DocuSignClient | null = null;
  try {
    client = DocuSignClient.fromEnv();
  } catch {
    // DocuSign not configured — tools will return a helpful error
  }

  const notConfigured: ToolResult = {
    success: false,
    error:
      'DocuSign is not configured. Set DOCUSIGN_ACCOUNT_ID, DOCUSIGN_INTEGRATION_KEY, ' +
      'DOCUSIGN_USER_ID, and DOCUSIGN_RSA_PRIVATE_KEY environment variables.',
  };

  return [
    // ── create_signing_envelope ─────────────────────────────────────────
    {
      name: 'create_signing_envelope',
      description:
        'Prepare and send a document for e-signature via DocuSign. ' +
        'Always YELLOW — requires founder approval before sending. ' +
        'Provide the document content as base64, list signers with email/name, ' +
        'and optionally add CC recipients. Set status to "created" to save as ' +
        'draft without sending.',
      parameters: {
        email_subject: {
          type: 'string',
          description: 'Subject line of the signing request email',
          required: true,
        },
        email_message: {
          type: 'string',
          description: 'Brief message to include in the signing request email',
          required: false,
        },
        document_base64: {
          type: 'string',
          description: 'Base64-encoded document content (PDF, DOCX, etc.)',
          required: true,
        },
        document_name: {
          type: 'string',
          description: 'Document filename (e.g., "NDA_Acme_Corp.pdf")',
          required: true,
        },
        file_extension: {
          type: 'string',
          description: 'File extension without dot (e.g., "pdf", "docx")',
          required: true,
        },
        signers: {
          type: 'array',
          description: 'List of signers',
          required: true,
          items: {
            type: 'object',
            description: 'A signer with email, name, and optional routing_order',
            properties: {
              email: { type: 'string', description: 'Signer email address' },
              name: { type: 'string', description: 'Signer full name' },
              routing_order: {
                type: 'string',
                description: 'Signing order (1 = first, 2 = second, etc.)',
              },
            },
          },
        },
        cc_recipients: {
          type: 'array',
          description: 'List of CC recipients who receive a copy after signing',
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
        send_immediately: {
          type: 'boolean',
          description: 'If true, send immediately; if false, save as draft (default: true)',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        if (!client) return notConfigured;

        try {
          const signers = params.signers as Array<{
            email: string;
            name: string;
            routing_order?: string;
          }>;

          const result = await client.createEnvelope({
            emailSubject: params.email_subject as string,
            emailBlurb: (params.email_message as string) || undefined,
            documents: [
              {
                documentBase64: params.document_base64 as string,
                name: params.document_name as string,
                fileExtension: params.file_extension as string,
                documentId: '1',
              },
            ],
            signers: signers.map((s) => ({
              email: s.email,
              name: s.name,
              routingOrder: s.routing_order,
            })),
            ccRecipients: params.cc_recipients as
              | Array<{ email: string; name: string }>
              | undefined,
            status: params.send_immediately === false ? 'created' : 'sent',
          });

          return {
            success: true,
            data: {
              envelope_id: result.envelopeId,
              status: result.status,
              message:
                result.status === 'sent'
                  ? `Envelope sent to ${signers.map((s) => s.email).join(', ')}`
                  : 'Envelope saved as draft — use send_template_envelope or the DocuSign console to send.',
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to create envelope: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    // ── send_template_envelope ──────────────────────────────────────────
    {
      name: 'send_template_envelope',
      description:
        'Send an envelope using a pre-configured DocuSign template. ' +
        'Always YELLOW — requires founder approval. ' +
        'Templates must be set up in the DocuSign admin console first. ' +
        'Provide the template ID and assign signers to template roles.',
      parameters: {
        template_id: {
          type: 'string',
          description: 'DocuSign template ID (GUID)',
          required: true,
        },
        email_subject: {
          type: 'string',
          description: 'Subject line of the signing request email',
          required: true,
        },
        email_message: {
          type: 'string',
          description: 'Brief message to include in the signing email',
          required: false,
        },
        signers: {
          type: 'array',
          description: 'Signers to assign to template roles',
          required: true,
          items: {
            type: 'object',
            description: 'Signer with email, name, and role_name matching the template role',
            properties: {
              email: { type: 'string', description: 'Signer email address' },
              name: { type: 'string', description: 'Signer full name' },
              role_name: {
                type: 'string',
                description: 'Template role name (e.g., "signer1", "client")',
              },
            },
          },
        },
        send_immediately: {
          type: 'boolean',
          description: 'If true, send immediately; if false, save as draft (default: true)',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        if (!client) return notConfigured;

        try {
          const signers = params.signers as Array<{
            email: string;
            name: string;
            role_name?: string;
          }>;

          const result = await client.createEnvelopeFromTemplate({
            templateId: params.template_id as string,
            emailSubject: params.email_subject as string,
            emailBlurb: (params.email_message as string) || undefined,
            signers: signers.map((s) => ({
              email: s.email,
              name: s.name,
              recipientId: s.role_name,
            })),
            status: params.send_immediately === false ? 'created' : 'sent',
          });

          return {
            success: true,
            data: {
              envelope_id: result.envelopeId,
              status: result.status,
              message:
                result.status === 'sent'
                  ? `Template envelope sent to ${signers.map((s) => s.email).join(', ')}`
                  : 'Template envelope saved as draft.',
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to create template envelope: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    // ── check_envelope_status ───────────────────────────────────────────
    {
      name: 'check_envelope_status',
      description:
        'Check the signing status of a DocuSign envelope. GREEN — safe to call anytime. ' +
        'Returns envelope status, recipient signing progress, and timestamps.',
      parameters: {
        envelope_id: {
          type: 'string',
          description: 'DocuSign envelope ID (GUID)',
          required: true,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        if (!client) return notConfigured;

        try {
          const status = await client.getEnvelopeStatus(params.envelope_id as string);

          const signers = status.recipients?.signers?.map((s) => ({
            name: s.name,
            email: s.email,
            status: s.status,
            signed_at: s.signedDateTime || null,
            delivered_at: s.deliveredDateTime || null,
            declined_at: s.declinedDateTime || null,
            declined_reason: s.declinedReason || null,
          })) || [];

          return {
            success: true,
            data: {
              envelope_id: status.envelopeId,
              status: status.status,
              subject: status.emailSubject,
              sent_at: status.sentDateTime || null,
              completed_at: status.completedDateTime || null,
              voided_at: status.voidedDateTime || null,
              signers,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to check envelope status: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    // ── list_envelopes ──────────────────────────────────────────────────
    {
      name: 'list_envelopes',
      description:
        'List recent DocuSign envelopes with optional filters. GREEN — safe to call anytime. ' +
        'Use to review pending, completed, or voided envelopes.',
      parameters: {
        status_filter: {
          type: 'string',
          description:
            'Filter by status: "sent", "delivered", "completed", "declined", "voided" (comma-separated for multiple)',
          required: false,
        },
        from_date: {
          type: 'string',
          description: 'Only show envelopes from this date (ISO 8601, e.g., "2026-01-01")',
          required: false,
        },
        count: {
          type: 'number',
          description: 'Maximum number of envelopes to return (default: 25)',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        if (!client) return notConfigured;

        try {
          const envelopes = await client.listEnvelopes({
            status: (params.status_filter as string) || undefined,
            fromDate: (params.from_date as string) || undefined,
            count: (params.count as number) || 25,
          });

          return {
            success: true,
            data: {
              count: envelopes.length,
              envelopes: envelopes.map((e) => ({
                envelope_id: e.envelopeId,
                status: e.status,
                subject: e.emailSubject,
                sent_at: e.sentDateTime || null,
                completed_at: e.completedDateTime || null,
                last_change: e.statusChangedDateTime,
              })),
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to list envelopes: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    // ── void_envelope ───────────────────────────────────────────────────
    {
      name: 'void_envelope',
      description:
        'Void (cancel) a pending DocuSign envelope that has not yet been completed. ' +
        'Always RED — irreversible action, requires explicit founder approval. ' +
        'Cannot void already-completed envelopes.',
      parameters: {
        envelope_id: {
          type: 'string',
          description: 'DocuSign envelope ID to void',
          required: true,
        },
        reason: {
          type: 'string',
          description: 'Reason for voiding the envelope',
          required: true,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        if (!client) return notConfigured;

        try {
          await client.voidEnvelope(
            params.envelope_id as string,
            params.reason as string,
          );
          return {
            success: true,
            data: {
              envelope_id: params.envelope_id,
              voided: true,
              reason: params.reason,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to void envelope: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    // ── resend_envelope ─────────────────────────────────────────────────
    {
      name: 'resend_envelope',
      description:
        'Resend a reminder notification for a pending DocuSign envelope. ' +
        'YELLOW — sends an email to signers who haven\'t completed signing yet.',
      parameters: {
        envelope_id: {
          type: 'string',
          description: 'DocuSign envelope ID to resend',
          required: true,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        if (!client) return notConfigured;

        try {
          await client.resendEnvelope(params.envelope_id as string);
          return {
            success: true,
            data: {
              envelope_id: params.envelope_id,
              reminder_sent: true,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to resend envelope: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },
  ];
}
