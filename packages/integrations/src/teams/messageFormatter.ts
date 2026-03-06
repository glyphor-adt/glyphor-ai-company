/**
 * Teams Message Formatter
 *
 * Converts raw agent markdown output into Teams-optimized formats:
 * - Short messages → cleaned markdown (Teams subset)
 * - Long structured messages → Adaptive Cards with proper section headers
 *
 * Teams chat markdown supports: bold, italic, strikethrough, bullet lists,
 * numbered lists, links, inline code, code blocks, blockquotes.
 * Teams chat does NOT support: # headers, --- horizontal rules, tables.
 */

import type { AdaptiveCard, AdaptiveCardElement } from './webhooks.js';

// ─── Thresholds ─────────────────────────────────────────────────

/** Messages longer than this (chars) get converted to Adaptive Cards. */
const CARD_THRESHOLD = 2000;

// ─── Types ──────────────────────────────────────────────────────

interface Section {
  title: string | null;
  level: number;
  lines: string[];
}

export interface FormattedTeamsMessage {
  kind: 'text' | 'card';
  text?: string;
  card?: AdaptiveCard;
}

// ─── Public API ─────────────────────────────────────────────────

/**
 * Format an agent's markdown output for Teams delivery.
 *
 * Short messages are returned as cleaned Teams-compatible markdown text.
 * Long messages are converted to Adaptive Cards with proper visual hierarchy.
 *
 * @param agentName - Display name of the agent (e.g. "Mia Tanaka")
 * @param markdown  - Raw markdown output from the agent
 */
export function formatTeamsMessage(
  agentName: string,
  markdown: string,
): FormattedTeamsMessage {
  const cleaned = cleanMarkdownForTeams(markdown);

  if (cleaned.length < CARD_THRESHOLD) {
    return { kind: 'text', text: `**${agentName}:**\n\n${cleaned}` };
  }

  // Long output → Adaptive Card
  const sections = parseMarkdownSections(markdown);
  const card = buildSectionedCard(agentName, sections);
  return { kind: 'card', card };
}

/**
 * Convert markdown to HTML suitable for Graph API chat messages.
 * Much more comprehensive than the old markdownToHtml that only handled
 * bold, italic, code, and newlines.
 */
export function markdownToTeamsHtml(md: string): string {
  let html = md;

  // Code blocks (``` ... ```) — must be done before inline processing
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) => {
    const escaped = escapeHtml(code.trimEnd());
    return `<pre style="background:#f4f4f4;padding:8px;border-radius:4px;font-size:13px;overflow-x:auto"><code>${escaped}</code></pre>`;
  });

  // Headers → bold text on its own line (Teams HTML in chat doesn't render <h1>–<h6> well)
  html = html.replace(/^#{1,2}\s+(.+)$/gm, '<br/><b style="font-size:15px">$1</b><br/>');
  html = html.replace(/^#{3,6}\s+(.+)$/gm, '<br/><b>$1</b><br/>');

  // Horizontal rules
  html = html.replace(/^[-*_]{3,}$/gm, '<hr style="border:none;border-top:1px solid #ddd;margin:8px 0"/>');

  // Bold + italic combo
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<b><i>$1</i></b>');
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  // Italic
  html = html.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<i>$1</i>');
  // Strikethrough
  html = html.replace(/~~(.+?)~~/g, '<s>$1</s>');
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code style="background:#f4f4f4;padding:1px 4px;border-radius:3px;font-size:13px">$1</code>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Blockquotes (must be before list processing)
  html = html.replace(/^>\s?(.*)$/gm, '<blockquote style="border-left:3px solid #ccc;padding-left:8px;margin:4px 0;color:#555">$1</blockquote>');

  // Unordered lists: convert - or * at start of line
  html = html.replace(/^[ \t]*[-*+]\s+(.+)$/gm, '<li>$1</li>');
  // Wrap consecutive <li> in <ul>
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul style="margin:4px 0;padding-left:20px">$1</ul>');

  // Ordered lists
  html = html.replace(/^[ \t]*\d+\.\s+(.+)$/gm, '<li>$1</li>');

  // Line breaks — but skip lines that are already HTML block elements
  html = html.replace(/\n(?!<\/?(?:ul|ol|li|pre|blockquote|hr|br|div|b style))/g, '<br/>');

  // Clean up redundant <br/> sequences
  html = html.replace(/(<br\/>){3,}/g, '<br/><br/>');

  return html;
}

// ─── Teams Markdown Cleanup ─────────────────────────────────────

/**
 * Clean markdown for Teams chat compatibility.
 * Replaces features Teams doesn't render with alternatives.
 */
function cleanMarkdownForTeams(md: string): string {
  let clean = md;

  // Convert headers to bold lines (Teams doesn't render # syntax)
  clean = clean.replace(/^#{1,2}\s+(.+)$/gm, '\n**$1**\n');
  clean = clean.replace(/^#{3,6}\s+(.+)$/gm, '\n**$1**');

  // Convert horizontal rules to visual separator
  clean = clean.replace(/^[-*_]{3,}$/gm, '───────────────');

  // Collapse excessive blank lines
  clean = clean.replace(/\n{4,}/g, '\n\n\n');

  return clean.trim();
}

// ─── Markdown Section Parser ────────────────────────────────────

/**
 * Parse markdown into sections split by headers.
 * Each header starts a new section; content before any header
 * goes into a section with title = null.
 */
function parseMarkdownSections(md: string): Section[] {
  const lines = md.split('\n');
  const sections: Section[] = [];
  let current: Section = { title: null, level: 0, lines: [] };

  for (const line of lines) {
    const headerMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headerMatch) {
      // Save current section if it has content
      if (current.lines.length > 0 || current.title) {
        sections.push(current);
      }
      current = {
        title: headerMatch[2].trim(),
        level: headerMatch[1].length,
        lines: [],
      };
    } else {
      current.lines.push(line);
    }
  }

  // Push final section
  if (current.lines.length > 0 || current.title) {
    sections.push(current);
  }

  return sections;
}

// ─── Adaptive Card Builder ──────────────────────────────────────

/**
 * Build an Adaptive Card from parsed markdown sections.
 * Uses TextBlock sizes/weights for visual hierarchy,
 * separators between sections, and wrap on all text.
 */
function buildSectionedCard(
  agentName: string,
  sections: Section[],
): AdaptiveCard {
  const body: AdaptiveCardElement[] = [
    {
      type: 'TextBlock',
      text: agentName,
      size: 'large',
      weight: 'bolder',
      wrap: true,
    },
  ];

  for (const section of sections) {
    if (section.title) {
      const size = section.level <= 1 ? 'medium' : 'small';
      body.push({
        type: 'TextBlock',
        text: section.title,
        size,
        weight: 'bolder',
        separator: true,
        spacing: 'medium',
        wrap: true,
      });
    }

    const content = section.lines.join('\n').trim();
    if (content) {
      // Clean any remaining header markers from the content
      const cleaned = content.replace(/^#{1,6}\s+/gm, '');
      // Adaptive Card TextBlocks support a subset of markdown:
      // bold, italic, bullet lists, numbered lists, links
      body.push({
        type: 'TextBlock',
        text: cleaned,
        wrap: true,
      });
    }
  }

  return {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.5',
    body,
  };
}

// ─── Utilities ──────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
