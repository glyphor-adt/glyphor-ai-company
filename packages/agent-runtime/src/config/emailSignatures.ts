import { AGENT_EMAIL_MAP } from './agentEmails.js';

const SIGNATURE_HTML_MARKER = '<!-- GLYPHOR_SIGNATURE_V1 -->';
const SIGNATURE_TEXT_MARKER = '[GLYPHOR_SIGNATURE_V1]';
const DISCLOSURE_HTML_MARKER = '<!-- GLYPHOR_DISCLOSURE_V1 -->';
const DISCLOSURE_TEXT_MARKER = '[GLYPHOR_DISCLOSURE_V1]';

const DEFAULT_COMPANY_NAME = 'Glyphor';
const DEFAULT_COMPANY_WEBSITE = 'https://glyphor.ai';

interface SignatureProfile {
  displayName: string;
  title: string;
  email: string;
}

export interface EmailSignatureOptions {
  format?: 'html' | 'text';
  internal?: boolean;
  logoUrl?: string;
}

const AGENT_SIGNATURE_BY_EMAIL = new Map<string, SignatureProfile>(
  Object.values(AGENT_EMAIL_MAP).map((entry) => [
    entry.email.toLowerCase(),
    {
      displayName: entry.displayName,
      title: entry.title,
      email: entry.email,
    },
  ]),
);

const FOUNDER_SIGNATURE_BY_EMAIL: Record<string, SignatureProfile> = {
  'kristina@glyphor.ai': {
    displayName: process.env.GLYPHOR_FOUNDER_KRISTINA_NAME?.trim() || 'Kristina Denney',
    title: process.env.GLYPHOR_FOUNDER_KRISTINA_TITLE?.trim() || 'Founder',
    email: 'kristina@glyphor.ai',
  },
  'andrew@glyphor.ai': {
    displayName: process.env.GLYPHOR_FOUNDER_ANDREW_NAME?.trim() || 'Andrew Zwelling',
    title: process.env.GLYPHOR_FOUNDER_ANDREW_TITLE?.trim() || 'Founder',
    email: 'andrew@glyphor.ai',
  },
};

export function containsGlyphorSignatureMarker(body: string): boolean {
  return body.includes(SIGNATURE_HTML_MARKER)
    || body.includes(SIGNATURE_TEXT_MARKER)
    || body.includes(DISCLOSURE_HTML_MARKER)
    || body.includes(DISCLOSURE_TEXT_MARKER);
}

export function isGlyphorInternalEmail(email: string): boolean {
  const normalized = normalizeEmail(email);
  return normalized.endsWith('@glyphor.ai');
}

export function appendGlyphorEmailSignature(
  body: string,
  senderEmail: string | null | undefined,
  options: EmailSignatureOptions = {},
): string {
  if (!senderEmail) return body;
  if (containsGlyphorSignatureMarker(body)) return body;

  const profile = resolveSignatureProfile(senderEmail);
  if (!profile) return body;

  const format = options.format ?? 'text';
  const internal = options.internal === true;
  const logoUrl = resolveLogoUrl(options.logoUrl);
  const companyName = process.env.GLYPHOR_EMAIL_COMPANY_NAME?.trim() || DEFAULT_COMPANY_NAME;
  const website = process.env.GLYPHOR_EMAIL_WEBSITE?.trim() || DEFAULT_COMPANY_WEBSITE;

  if (format === 'html') {
    const normalizedBody = normalizeBodyForHtml(body);
    return `${normalizedBody}<br><br>${buildHtmlSignature(profile, { internal, logoUrl, companyName, website })}`;
  }

  return `${body}\n\n${buildTextSignature(profile, { internal, logoUrl, companyName, website })}`;
}

function resolveSignatureProfile(senderEmail: string): SignatureProfile | null {
  const normalizedEmail = normalizeEmail(senderEmail);
  const agentProfile = AGENT_SIGNATURE_BY_EMAIL.get(normalizedEmail);
  if (agentProfile) return agentProfile;

  const founderProfile = FOUNDER_SIGNATURE_BY_EMAIL[normalizedEmail];
  if (founderProfile) return founderProfile;

  if (!normalizedEmail.includes('@')) return null;

  return {
    displayName: humanizeLocalPart(normalizedEmail.split('@')[0] ?? normalizedEmail),
    title: 'Team Member',
    email: normalizedEmail,
  };
}

function resolveLogoUrl(logoUrlOverride?: string): string | null {
  const fromOption = logoUrlOverride?.trim();
  if (fromOption) return fromOption;

  const fromEnv = process.env.GLYPHOR_EMAIL_LOGO_URL?.trim();
  return fromEnv || null;
}

function normalizeBodyForHtml(body: string): string {
  if (isLikelyHtml(body)) return body;
  return escapeHtml(body).replace(/\r?\n/g, '<br>');
}

function buildHtmlSignature(
  profile: SignatureProfile,
  options: { internal: boolean; logoUrl: string | null; companyName: string; website: string },
): string {
  const websiteLabel = stripProtocol(options.website);
  const logoCell = options.logoUrl
    ? `<td style="padding-right:12px;vertical-align:top;"><img src="${escapeHtml(options.logoUrl)}" alt="${escapeHtml(options.companyName)} logo" style="display:block;width:120px;height:auto;border:0;outline:none;text-decoration:none;"></td>`
    : '';
  const internalLine = options.internal
    ? '<div style="margin-top:8px;color:#6b7280;font-size:11px;line-height:1.4;">Internal communication - Glyphor</div>'
    : '';

  return [
    SIGNATURE_HTML_MARKER,
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-family:Segoe UI,Arial,sans-serif;color:#111827;">',
    '<tr>',
    logoCell,
    '<td style="vertical-align:top;">',
    `<div style="font-size:14px;font-weight:600;line-height:1.4;">${escapeHtml(profile.displayName)}</div>`,
    `<div style="font-size:12px;color:#4b5563;line-height:1.4;">${escapeHtml(profile.title)}</div>`,
    `<div style="font-size:12px;line-height:1.6;"><a href="mailto:${escapeHtml(profile.email)}" style="color:#2563eb;text-decoration:none;">${escapeHtml(profile.email)}</a></div>`,
    `<div style="font-size:12px;line-height:1.6;"><a href="${escapeHtml(options.website)}" style="color:#2563eb;text-decoration:none;">${escapeHtml(websiteLabel)}</a></div>`,
    internalLine,
    '</td>',
    '</tr>',
    '</table>',
  ].join('');
}

function buildTextSignature(
  profile: SignatureProfile,
  options: { internal: boolean; logoUrl: string | null; companyName: string; website: string },
): string {
  const lines = [
    '--',
    profile.displayName,
    profile.title,
    options.companyName,
    profile.email,
    options.website,
  ];

  if (options.logoUrl) lines.push(`Logo: ${options.logoUrl}`);
  if (options.internal) lines.push('Internal communication - Glyphor');
  lines.push(SIGNATURE_TEXT_MARKER);

  return lines.join('\n');
}

function isLikelyHtml(body: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(body);
}

function normalizeEmail(input: string): string {
  const trimmed = input.trim().toLowerCase();
  const match = trimmed.match(/<([^>]+)>/);
  return (match ? match[1] : trimmed).trim();
}

function stripProtocol(url: string): string {
  return url.replace(/^https?:\/\//i, '');
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function humanizeLocalPart(localPart: string): string {
  const words = localPart
    .split(/[._-]+/)
    .map((w) => w.trim())
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return words.length > 0 ? words.join(' ') : localPart;
}