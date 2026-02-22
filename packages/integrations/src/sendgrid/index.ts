/**
 * SendGrid Integration — Email sending for various departments
 *
 * Scoped API keys per use case:
 * - api-key-emergency: Sarah (1/day max)
 * - api-key-support: David (support replies)
 * - api-key-onboarding: Emma (onboarding templates)
 * - api-key-nurture: James (nurture sequences)
 * - api-key-marketing: Maya (marketing campaigns, requires Yellow)
 */

interface SendGridConfig {
  apiKey: string;
  fromEmail?: string;
  fromName?: string;
}

interface EmailParams {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  templateId?: string;
  dynamicData?: Record<string, unknown>;
  categories?: string[];
}

interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export class SendGridClient {
  private readonly apiKey: string;
  private readonly fromEmail: string;
  private readonly fromName: string;

  constructor(config: SendGridConfig) {
    this.apiKey = config.apiKey;
    this.fromEmail = config.fromEmail ?? 'team@glyphor.com';
    this.fromName = config.fromName ?? 'Glyphor';
  }

  static fromEnv(keyName: string): SendGridClient {
    const apiKey = process.env[`SENDGRID_API_KEY_${keyName.toUpperCase()}`]
      ?? process.env.SENDGRID_API_KEY;
    if (!apiKey) throw new Error(`SendGrid API key not found for ${keyName}`);
    return new SendGridClient({ apiKey });
  }

  async send(params: EmailParams): Promise<SendResult> {
    const body: Record<string, unknown> = {
      personalizations: [{ to: [{ email: params.to }], dynamic_template_data: params.dynamicData }],
      from: { email: this.fromEmail, name: this.fromName },
      subject: params.subject,
      categories: params.categories,
    };

    if (params.templateId) {
      body.template_id = params.templateId;
    } else {
      body.content = [];
      if (params.text) (body.content as unknown[]).push({ type: 'text/plain', value: params.text });
      if (params.html) (body.content as unknown[]).push({ type: 'text/html', value: params.html });
    }

    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (response.ok || response.status === 202) {
      return { success: true, messageId: response.headers.get('x-message-id') ?? undefined };
    }

    const errorText = await response.text().catch(() => 'Unknown error');
    return { success: false, error: `SendGrid ${response.status}: ${errorText}` };
  }

  async sendTemplated(
    to: string,
    templateId: string,
    dynamicData: Record<string, unknown>,
    categories?: string[],
  ): Promise<SendResult> {
    return this.send({ to, subject: '', templateId, dynamicData, categories });
  }
}
