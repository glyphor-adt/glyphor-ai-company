import { normalizeText } from './normalizeText';

type FormatOptions = {
  hideReasoning?: boolean;
};

function parseTagAttributes(rawAttrs: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRe = /(\w+)\s*=\s*"([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(rawAttrs)) !== null) {
    attrs[match[1].toLowerCase()] = match[2];
  }
  return attrs;
}

export function formatDashboardContent(text: string, options: FormatOptions = {}): string {
  const sectionLabels: Record<string, string> = {
    reasoning: 'Reasoning',
    approach: 'Approach',
    tradeoffs: 'Tradeoffs',
    risks: 'Risks',
    alternatives: 'Alternatives',
  };

  let value = normalizeText(text).trim();

  if (!value) return '';

  // Fix malformed markdown headings observed in persisted outputs.
  value = value.replace(/^##\s*#\s*/gm, '## ');

  if (options.hideReasoning) {
    value = value.replace(/<reasoning>[\s\S]*?<\/reasoning>\s*/gi, '').trim();
  } else {
    for (const [tag, label] of Object.entries(sectionLabels)) {
      const openTag = new RegExp(`<${tag}>`, 'gi');
      const closeTag = new RegExp(`</${tag}>`, 'gi');
      value = value.replace(openTag, `\n\n### ${label}\n`);
      value = value.replace(closeTag, '');
    }
  }

  value = value.replace(
    /<notify\b([^>]*)>([\s\S]*?)<\/notify>/gi,
    (_match, rawAttrs: string, body: string) => {
      const attrs = parseTagAttributes(rawAttrs ?? '');
      const type = (attrs.type ?? 'notice').trim();
      const to = (attrs.to ?? 'team').trim();
      const title = (attrs.title ?? 'Notification').trim();
      return `\n\n> **[${type.toUpperCase()}]** **${title}**\n> *${type}* -> ${to}\n>\n> ${body.trim().replace(/\n/g, '\n> ')}\n`;
    },
  );

  value = value.replace(
    /<action\b[^>]*>([\s\S]*?)<\/action>/gi,
    (_match, body: string) => `\n\n**Action:** ${body.trim()}\n`,
  );

  value = value.replace(
    /<result\b[^>]*>([\s\S]*?)<\/result>/gi,
    (_match, body: string) => `\n\n**Result:** ${body.trim()}\n`,
  );

  // Strip known orchestration tags while preserving their content.
  value = value.replace(/<\/?(plan|summary|observation|diagnosis|recommendation|approach|tradeoffs|risks|alternatives|reasoning)\b[^>]*>/gi, '');

  // Wrap standalone JSON objects for readable rendering.
  value = value.replace(
    /(?:^|\n)([ \t]*\{[\s\S]*?\n[ \t]*\})/g,
    (match) => {
      if (/```/.test(match)) return match;
      return `\n\`\`\`json\n${match.trim()}\n\`\`\`\n`;
    },
  );

  return value.replace(/\n{3,}/g, '\n\n').trim();
}
