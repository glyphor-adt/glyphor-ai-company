/**
 * Shared DocuSign Tools — Envelope & Signature Operations
 *
 * Enables agents (primarily CLO / legal) to prepare documents,
 * send envelopes for signature, check signing status, send reminders,
 * and void envelopes via the DocuSign eSignature REST API.
 *
 * Tools:
 *   create_signing_envelope   — Prepare & send document(s) for e-signature
 *   send_template_envelope    — Send an envelope from a DocuSign template
 *   check_envelope_status     — Check signing progress on an envelope
 *   list_envelopes            — List recent envelopes with optional filters
 *   void_envelope             — Void/cancel a pending envelope
 *   resend_envelope           — Resend reminder for a pending envelope
 *   send_draft_envelope       — Send a draft envelope (created → sent)
 *   get_envelope_documents    — List documents attached to an envelope
 *   get_envelope_form_data    — Get form field values from a signed envelope
 *   get_envelope_audit_trail  — Get compliance audit trail for an envelope
 *   add_envelope_recipients   — Add signers or CC recipients to a draft
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
        'Prepare and send one or more documents for e-signature via DocuSign. ' +
        'Always YELLOW — requires founder approval before sending. ' +
        'Provide documents as an array (or a single document via the legacy ' +
        'document_base64/document_name/file_extension params). List signers ' +
        'with email/name, and optionally add CC recipients. Set ' +
        'send_immediately to false to save as draft without sending.',
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
        documents: {
          type: 'array',
          description: 'Array of documents to include in the envelope. Use this for multi-doc envelopes.',
          required: false,
          items: {
            type: 'object',
            description: 'A document with base64 content, name, and extension',
            properties: {
              document_base64: { type: 'string', description: 'Base64-encoded document content' },
              document_name: { type: 'string', description: 'Document filename (e.g., "NDA.pdf")' },
              file_extension: { type: 'string', description: 'File extension without dot (e.g., "pdf")' },
            },
          },
        },
        document_base64: {
          type: 'string',
          description: 'Base64-encoded document content (single-doc shorthand; use "documents" array for multiple)',
          required: false,
        },
        document_name: {
          type: 'string',
          description: 'Document filename (e.g., "NDA_Acme_Corp.pdf")',
          required: false,
        },
        file_extension: {
          type: 'string',
          description: 'File extension without dot (e.g., "pdf", "docx")',
          required: false,
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

          // Build documents array — support both multi-doc "documents" param and single-doc legacy params
          const docsParam = params.documents as Array<{
            document_base64: string;
            document_name: string;
            file_extension: string;
          }> | undefined;

          const documents = docsParam?.length
            ? docsParam.map((d, i) => ({
                documentBase64: d.document_base64,
                name: d.document_name,
                fileExtension: d.file_extension,
                documentId: String(i + 1),
              }))
            : [
                {
                  documentBase64: params.document_base64 as string,
                  name: params.document_name as string,
                  fileExtension: params.file_extension as string,
                  documentId: '1',
                },
              ];

          const result = await client.createEnvelope({
            emailSubject: params.email_subject as string,
            emailBlurb: (params.email_message as string) || undefined,
            documents,
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
              document_count: documents.length,
              message:
                result.status === 'sent'
                  ? `Envelope sent to ${signers.map((s) => s.email).join(', ')} with ${documents.length} document(s)`
                  : `Envelope saved as draft (${documents.length} document(s)). Use send_draft_envelope to send after founder approval.`,
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

    // ── send_draft_envelope ─────────────────────────────────────────────
    {
      name: 'send_draft_envelope',
      description:
        'Send a draft DocuSign envelope that was previously created with ' +
        'send_immediately=false or via prepare_signing_envelope. This transitions ' +
        'the envelope from "created" (draft) to "sent" status. ' +
        'Always YELLOW — requires founder approval before sending.',
      parameters: {
        envelope_id: {
          type: 'string',
          description: 'DocuSign envelope ID of the draft to send',
          required: true,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        if (!client) return notConfigured;

        try {
          await client.sendEnvelope(params.envelope_id as string);
          return {
            success: true,
            data: {
              envelope_id: params.envelope_id,
              status: 'sent',
              message: 'Draft envelope has been sent to all recipients for signing.',
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to send draft envelope: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    // ── get_envelope_documents ───────────────────────────────────────────
    {
      name: 'get_envelope_documents',
      description:
        'List all documents attached to a DocuSign envelope. GREEN — safe to call anytime. ' +
        'Returns document IDs, names, and page counts. Use the document ID with ' +
        'download_document if you need the actual file content.',
      parameters: {
        envelope_id: {
          type: 'string',
          description: 'DocuSign envelope ID',
          required: true,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        if (!client) return notConfigured;

        try {
          const result = await client.listDocuments(params.envelope_id as string);
          return {
            success: true,
            data: {
              envelope_id: result.envelopeId,
              document_count: result.envelopeDocuments.length,
              documents: result.envelopeDocuments.map((d) => ({
                document_id: d.documentId,
                name: d.name,
                type: d.type,
                page_count: d.pages?.length || 0,
              })),
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to list documents: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    // ── get_envelope_form_data ───────────────────────────────────────────
    {
      name: 'get_envelope_form_data',
      description:
        'Get form field data that recipients have filled in on a signed DocuSign envelope. ' +
        'GREEN — safe to call anytime. Useful for extracting completed values like dates, ' +
        'amounts, addresses, or any text fields after signing.',
      parameters: {
        envelope_id: {
          type: 'string',
          description: 'DocuSign envelope ID',
          required: true,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        if (!client) return notConfigured;

        try {
          const result = await client.getFormData(params.envelope_id as string);
          return {
            success: true,
            data: {
              envelope_id: result.envelopeId,
              form_fields: result.formData,
              recipient_data: result.recipientFormData?.map((r) => ({
                name: r.name,
                email: r.email,
                fields: r.formData,
              })),
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to get form data: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    // ── get_envelope_audit_trail ─────────────────────────────────────────
    {
      name: 'get_envelope_audit_trail',
      description:
        'Get the full audit trail for a DocuSign envelope — every action taken ' +
        'from creation through completion. GREEN — safe to call anytime. ' +
        'Essential for legal compliance, disputes, and regulatory filings.',
      parameters: {
        envelope_id: {
          type: 'string',
          description: 'DocuSign envelope ID',
          required: true,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        if (!client) return notConfigured;

        try {
          const result = await client.getAuditEvents(params.envelope_id as string);
          const events = result.auditEvents.map((e) => {
            const fields: Record<string, string> = {};
            for (const f of e.eventFields) {
              fields[f.name] = f.value;
            }
            return fields;
          });
          return {
            success: true,
            data: {
              envelope_id: params.envelope_id,
              event_count: events.length,
              events,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to get audit trail: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    // ── add_envelope_recipients ──────────────────────────────────────────
    {
      name: 'add_envelope_recipients',
      description:
        'Add signers or CC recipients to an existing draft envelope. ' +
        'YELLOW — modifies an envelope. Use when you need to add a party after ' +
        'creating a draft (e.g., adding a co-signer or CC\'ing legal counsel). ' +
        'Cannot add recipients to already-completed envelopes.',
      parameters: {
        envelope_id: {
          type: 'string',
          description: 'DocuSign envelope ID',
          required: true,
        },
        signers: {
          type: 'array',
          description: 'Additional signers to add',
          required: false,
          items: {
            type: 'object',
            description: 'A signer with email and name',
            properties: {
              email: { type: 'string', description: 'Signer email address' },
              name: { type: 'string', description: 'Signer full name' },
            },
          },
        },
        cc_recipients: {
          type: 'array',
          description: 'Additional CC recipients to add',
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
      },
      execute: async (params): Promise<ToolResult> => {
        if (!client) return notConfigured;

        try {
          const signers = params.signers as Array<{ email: string; name: string }> | undefined;
          const ccRecipients = params.cc_recipients as Array<{ email: string; name: string }> | undefined;

          if (!signers?.length && !ccRecipients?.length) {
            return { success: false, error: 'Provide at least one signer or CC recipient to add.' };
          }

          const result = await client.addRecipients(params.envelope_id as string, {
            signers: signers?.map((s) => ({ email: s.email, name: s.name })),
            ccRecipients,
          });

          const added: string[] = [];
          if (signers?.length) added.push(`${signers.length} signer(s)`);
          if (ccRecipients?.length) added.push(`${ccRecipients.length} CC recipient(s)`);

          return {
            success: true,
            data: {
              envelope_id: params.envelope_id,
              added: added.join(' and '),
              message: `Added ${added.join(' and ')} to envelope.`,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to add recipients: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },
  ];
}
