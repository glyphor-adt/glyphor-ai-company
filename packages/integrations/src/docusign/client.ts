/**
 * DocuSign eSignature REST API Client
 *
 * Uses JWT Grant (service integration) for server-to-server auth.
 * Provides envelope lifecycle operations: create draft, send, check status,
 * download completed documents, and void envelopes.
 *
 * Required env vars:
 *   DOCUSIGN_ACCOUNT_ID      — DocuSign account GUID
 *   DOCUSIGN_INTEGRATION_KEY — OAuth integration key (client ID)
 *   DOCUSIGN_USER_ID         — Impersonated user GUID
 *   DOCUSIGN_RSA_PRIVATE_KEY — PEM-encoded RSA private key (or base64)
 *   DOCUSIGN_BASE_URL        — (optional) defaults to production
 */

import * as crypto from 'node:crypto';

// ── Types ────────────────────────────────────────────────────────────────────

export interface DocuSignConfig {
  accountId: string;
  integrationKey: string;
  userId: string;
  rsaPrivateKey: string;
  baseUrl?: string;        // e.g. https://na4.docusign.net  (production)
  oauthHost?: string;      // e.g. account.docusign.com      (production)
}

export interface Signer {
  email: string;
  name: string;
  recipientId?: string;
  routingOrder?: string;
  /** Tab anchors — if omitted, DocuSign uses auto-placement */
  tabs?: SignerTabs;
}

export interface SignerTabs {
  signHereTabs?: TabPosition[];
  dateSignedTabs?: TabPosition[];
  initialHereTabs?: TabPosition[];
  textTabs?: (TabPosition & { value?: string; locked?: boolean })[];
}

export interface TabPosition {
  anchorString?: string;
  anchorXOffset?: string;
  anchorYOffset?: string;
  anchorUnits?: string;
  documentId?: string;
  pageNumber?: string;
  xPosition?: string;
  yPosition?: string;
}

export interface EnvelopeDocument {
  /** Base64-encoded document content */
  documentBase64: string;
  name: string;
  fileExtension: string;
  documentId: string;
}

export interface CreateEnvelopeOptions {
  emailSubject: string;
  emailBlurb?: string;
  documents: EnvelopeDocument[];
  signers: Signer[];
  ccRecipients?: { email: string; name: string; recipientId?: string }[];
  /** 'sent' to send immediately, 'created' to save as draft */
  status?: 'sent' | 'created';
}

export interface EnvelopeStatus {
  envelopeId: string;
  status: string;
  statusChangedDateTime: string;
  sentDateTime?: string;
  completedDateTime?: string;
  voidedDateTime?: string;
  emailSubject: string;
  recipients?: {
    signers: RecipientStatus[];
    carbonCopies?: RecipientStatus[];
  };
}

export interface RecipientStatus {
  recipientId: string;
  email: string;
  name: string;
  status: string;
  signedDateTime?: string;
  deliveredDateTime?: string;
  declinedDateTime?: string;
  declinedReason?: string;
}

export interface EnvelopeSummary {
  envelopeId: string;
  status: string;
  emailSubject: string;
  sentDateTime?: string;
  completedDateTime?: string;
  statusChangedDateTime: string;
}

// ── JWT Token Cache ──────────────────────────────────────────────────────────

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

let tokenCache: CachedToken | null = null;

// ── Client ───────────────────────────────────────────────────────────────────

export class DocuSignClient {
  private readonly config: DocuSignConfig;
  private readonly baseUrl: string;
  private readonly oauthHost: string;

  constructor(config: DocuSignConfig) {
    this.config = config;
    this.baseUrl = (config.baseUrl || 'https://na4.docusign.net').replace(/\/$/, '');
    this.oauthHost = config.oauthHost || 'account.docusign.com';
  }

  /**
   * Create a client from environment variables.
   * Returns null if required vars are missing (graceful degradation).
   */
  static fromEnv(): DocuSignClient | null {
    const accountId = process.env.DOCUSIGN_ACCOUNT_ID;
    const integrationKey = process.env.DOCUSIGN_INTEGRATION_KEY;
    const userId = process.env.DOCUSIGN_USER_ID;
    let rsaKey = process.env.DOCUSIGN_RSA_PRIVATE_KEY;

    if (!accountId || !integrationKey || !userId || !rsaKey) {
      return null;
    }

    // Support base64-encoded PEM (for Secret Manager / env vars with no newlines)
    if (!rsaKey.includes('-----BEGIN')) {
      rsaKey = Buffer.from(rsaKey, 'base64').toString('utf-8');
    }

    return new DocuSignClient({
      accountId,
      integrationKey,
      userId,
      rsaPrivateKey: rsaKey,
      baseUrl: process.env.DOCUSIGN_BASE_URL,
      oauthHost: process.env.DOCUSIGN_OAUTH_HOST,
    });
  }

  // ── Authentication ──────────────────────────────────────────────────────

  /**
   * Obtain an access token via JWT Grant flow.
   * Tokens are cached until 5 minutes before expiry.
   */
  private async getAccessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (tokenCache && tokenCache.expiresAt > now + 300) {
      return tokenCache.accessToken;
    }

    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = {
      iss: this.config.integrationKey,
      sub: this.config.userId,
      aud: this.oauthHost,
      iat: now,
      exp: now + 3600,
      scope: 'signature impersonation',
    };

    const segments = [
      Buffer.from(JSON.stringify(header)).toString('base64url'),
      Buffer.from(JSON.stringify(payload)).toString('base64url'),
    ];
    const signingInput = segments.join('.');

    const sign = crypto.createSign('RSA-SHA256');
    sign.update(signingInput);
    const signature = sign.sign(this.config.rsaPrivateKey, 'base64url');

    const jwt = `${signingInput}.${signature}`;

    const res = await fetch(`https://${this.oauthHost}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`DocuSign JWT auth failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as { access_token: string; expires_in: number };
    tokenCache = {
      accessToken: data.access_token,
      expiresAt: now + data.expires_in,
    };
    return data.access_token;
  }

  /**
   * Make an authenticated request to the DocuSign eSignature REST API.
   */
  private async apiRequest<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const token = await this.getAccessToken();
    const url = `${this.baseUrl}/restapi/v2.1/accounts/${this.config.accountId}${path}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    const res = await fetch(url, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`DocuSign API ${method} ${path} failed (${res.status}): ${text}`);
    }

    // 204 No Content
    if (res.status === 204) return undefined as T;

    return (await res.json()) as T;
  }

  // ── Envelope Operations ─────────────────────────────────────────────────

  /**
   * Create (and optionally send) an envelope with documents and signers.
   */
  async createEnvelope(options: CreateEnvelopeOptions): Promise<{ envelopeId: string; status: string; uri: string }> {
    // Build recipients
    let recipientIdx = 1;
    const signers = options.signers.map((s, i) => ({
      email: s.email,
      name: s.name,
      recipientId: s.recipientId || String(recipientIdx++),
      routingOrder: s.routingOrder || String(i + 1),
      tabs: s.tabs,
    }));

    const carbonCopies = (options.ccRecipients || []).map((cc) => ({
      email: cc.email,
      name: cc.name,
      recipientId: cc.recipientId || String(recipientIdx++),
      routingOrder: String(signers.length + 1),
    }));

    const envelopeDefinition = {
      emailSubject: options.emailSubject,
      emailBlurb: options.emailBlurb || '',
      documents: options.documents.map((d) => ({
        documentBase64: d.documentBase64,
        name: d.name,
        fileExtension: d.fileExtension,
        documentId: d.documentId,
      })),
      recipients: {
        signers,
        carbonCopies: carbonCopies.length > 0 ? carbonCopies : undefined,
      },
      status: options.status || 'sent',
    };

    return this.apiRequest<{ envelopeId: string; status: string; uri: string }>(
      'POST',
      '/envelopes',
      envelopeDefinition,
    );
  }

  /**
   * Get the status and recipient details of an envelope.
   */
  async getEnvelopeStatus(envelopeId: string): Promise<EnvelopeStatus> {
    const envelope = await this.apiRequest<EnvelopeStatus>(
      'GET',
      `/envelopes/${encodeURIComponent(envelopeId)}?include=recipients`,
    );
    return envelope;
  }

  /**
   * List recent envelopes with optional status filter.
   */
  async listEnvelopes(options?: {
    fromDate?: string;
    status?: string;
    count?: number;
  }): Promise<EnvelopeSummary[]> {
    const params = new URLSearchParams();
    if (options?.fromDate) params.set('from_date', options.fromDate);
    if (options?.status) params.set('status', options.status);
    params.set('count', String(options?.count || 25));

    const result = await this.apiRequest<{ envelopes?: EnvelopeSummary[] }>(
      'GET',
      `/envelopes?${params.toString()}`,
    );
    return result.envelopes || [];
  }

  /**
   * Void an in-progress envelope (not yet completed).
   */
  async voidEnvelope(envelopeId: string, voidedReason: string): Promise<void> {
    await this.apiRequest<void>('PUT', `/envelopes/${encodeURIComponent(envelopeId)}`, {
      status: 'voided',
      voidedReason,
    });
  }

  /**
   * Download a completed envelope's combined document as a Buffer.
   */
  async downloadDocument(envelopeId: string, documentId: string = 'combined'): Promise<Buffer> {
    const token = await this.getAccessToken();
    const url = `${this.baseUrl}/restapi/v2.1/accounts/${this.config.accountId}/envelopes/${encodeURIComponent(envelopeId)}/documents/${encodeURIComponent(documentId)}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`DocuSign download failed (${res.status}): ${text}`);
    }

    return Buffer.from(await res.arrayBuffer());
  }

  /**
   * Create an envelope from a DocuSign server-side template.
   */
  async createEnvelopeFromTemplate(options: {
    templateId: string;
    emailSubject: string;
    emailBlurb?: string;
    signers: Signer[];
    ccRecipients?: { email: string; name: string; recipientId?: string }[];
    status?: 'sent' | 'created';
  }): Promise<{ envelopeId: string; status: string; uri: string }> {
    let recipientIdx = 1;

    const templateRoles = options.signers.map((s, i) => ({
      email: s.email,
      name: s.name,
      roleName: s.recipientId || `signer${i + 1}`,
      routingOrder: s.routingOrder || String(i + 1),
      tabs: s.tabs,
    }));

    const envelopeDefinition = {
      templateId: options.templateId,
      emailSubject: options.emailSubject,
      emailBlurb: options.emailBlurb || '',
      templateRoles,
      status: options.status || 'sent',
    };

    return this.apiRequest<{ envelopeId: string; status: string; uri: string }>(
      'POST',
      '/envelopes',
      envelopeDefinition,
    );
  }

  /**
   * Send a reminder notification for a pending envelope.
   */
  async resendEnvelope(envelopeId: string): Promise<void> {
    await this.apiRequest<void>(
      'PUT',
      `/envelopes/${encodeURIComponent(envelopeId)}?resend_envelope=true`,
      { status: 'sent' },
    );
  }
}
