/**
 * Document Tools — Generate PDF and Word documents from agent content.
 *
 * Tools:
 *   generate_pdf      — Render markdown/HTML into a base64-encoded PDF via Playwright.
 *   generate_word_doc  — Render markdown into a base64-encoded .docx via the docx library.
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
} from 'docx';
import PDFDocument from 'pdfkit';
import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { getPlaywrightServiceUrl } from './playwrightServiceUrl.js';

/* ── Shared markdown helpers ──────────────────────────────────────────── */

/** Minimal markdown-to-HTML conversion for common report patterns. */
function markdownToHtml(md: string): string {
  let html = md
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^---$/gm, '<hr/>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br/>');

  html = `<p>${html}</p>`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; color: #1a1a1a; padding: 40px; line-height: 1.6; max-width: 800px; margin: 0 auto; }
  h1 { font-size: 24px; margin-top: 0; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; }
  h2 { font-size: 20px; margin-top: 24px; color: #374151; }
  h3 { font-size: 16px; margin-top: 16px; color: #4b5563; }
  table { border-collapse: collapse; width: 100%; margin: 16px 0; }
  th, td { border: 1px solid #d1d5db; padding: 8px 12px; text-align: left; font-size: 14px; }
  th { background: #f9fafb; font-weight: 600; }
  tr:nth-child(even) { background: #f9fafb; }
  hr { border: none; border-top: 1px solid #e5e7eb; margin: 24px 0; }
  code { background: #f3f4f6; padding: 2px 6px; border-radius: 3px; font-size: 13px; }
  pre { background: #f3f4f6; padding: 16px; border-radius: 6px; overflow-x: auto; }
</style>
</head>
<body>${html}</body>
</html>`;
}

/** Simple markdown table detection and conversion to HTML table. */
function convertMarkdownTables(html: string): string {
  return html.replace(
    /(<p>)?\|(.+)\|[\s]*<br\/>[\s]*\|[-| :]+\|([\s\S]*?)(?=<\/p>|<h[1-3]|<hr|$)/g,
    (_match, _p, headerRow: string, bodyBlock: string) => {
      const headers = headerRow.split('|').map((h: string) => h.trim()).filter(Boolean);
      const rows = bodyBlock
        .split(/<br\/>/)
        .map((r: string) => r.replace(/^\||\|$/g, '').trim())
        .filter((r: string) => r && !r.match(/^[-| :]+$/));

      let table = '<table><thead><tr>';
      for (const h of headers) table += `<th>${h}</th>`;
      table += '</tr></thead><tbody>';
      for (const row of rows) {
        const cells = row.split('|').map((c: string) => c.trim());
        table += '<tr>';
        for (const c of cells) table += `<td>${c}</td>`;
        table += '</tr>';
      }
      table += '</tbody></table>';
      return table;
    },
  );
}

/* ── Markdown → docx paragraph conversion ─────────────────────────────── */

interface ParsedTable {
  headers: string[];
  rows: string[][];
}

function parseMarkdownTable(block: string): ParsedTable | null {
  const lines = block.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return null;
  const headerLine = lines[0]!;
  if (!headerLine.includes('|')) return null;
  const separatorLine = lines[1]!;
  if (!/^[\s|:-]+$/.test(separatorLine)) return null;

  const extract = (line: string) =>
    line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

  const headers = extract(headerLine);
  const rows = lines.slice(2).map(extract);
  return { headers, rows };
}

function buildDocxTable(table: ParsedTable): Table {
  const BORDER = { style: BorderStyle.SINGLE, size: 1, color: 'D1D5DB' };
  const borders = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

  const headerRow = new TableRow({
    tableHeader: true,
    children: table.headers.map(
      (h) =>
        new TableCell({
          borders,
          shading: { type: 'clear' as unknown as undefined, fill: 'F3F4F6' },
          children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 20, font: 'Segoe UI' })] })],
          width: { size: Math.floor(100 / table.headers.length), type: WidthType.PERCENTAGE },
        }),
    ),
  });

  const dataRows = table.rows.map(
    (cells) =>
      new TableRow({
        children: cells.map(
          (c) =>
            new TableCell({
              borders,
              children: [new Paragraph({ children: [new TextRun({ text: c, size: 20, font: 'Segoe UI' })] })],
              width: { size: Math.floor(100 / table.headers.length), type: WidthType.PERCENTAGE },
            }),
        ),
      }),
  );

  return new Table({ rows: [headerRow, ...dataRows], width: { size: 100, type: WidthType.PERCENTAGE } });
}

function markdownToDocxChildren(md: string): (Paragraph | Table)[] {
  const children: (Paragraph | Table)[] = [];
  const lines = md.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Try to parse a table block starting at this line
    if (line.includes('|') && i + 1 < lines.length && /^[\s|:-]+$/.test(lines[i + 1]!)) {
      const tableLines: string[] = [];
      let j = i;
      while (j < lines.length && (lines[j]!.includes('|') || /^[\s|:-]+$/.test(lines[j]!))) {
        tableLines.push(lines[j]!);
        j++;
      }
      const parsed = parseMarkdownTable(tableLines.join('\n'));
      if (parsed) {
        children.push(buildDocxTable(parsed));
        i = j;
        continue;
      }
    }

    // Headings
    const h1 = line.match(/^# (.+)$/);
    if (h1) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: h1[1]!, font: 'Segoe UI' })] }));
      i++;
      continue;
    }
    const h2 = line.match(/^## (.+)$/);
    if (h2) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: h2[1]!, font: 'Segoe UI' })] }));
      i++;
      continue;
    }
    const h3 = line.match(/^### (.+)$/);
    if (h3) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun({ text: h3[1]!, font: 'Segoe UI' })] }));
      i++;
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      children.push(new Paragraph({ children: [], spacing: { before: 200, after: 200 } }));
      i++;
      continue;
    }

    // Bullet
    if (/^[-*] /.test(line)) {
      const text = line.replace(/^[-*] /, '');
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          children: inlineRuns(text),
        }),
      );
      i++;
      continue;
    }

    // Empty line
    if (!line.trim()) {
      i++;
      continue;
    }

    // Normal paragraph
    children.push(new Paragraph({ children: inlineRuns(line), spacing: { after: 120 } }));
    i++;
  }

  return children;
}

/** Convert inline bold/italic markdown to TextRun array. */
function inlineRuns(text: string): TextRun[] {
  const runs: TextRun[] = [];
  const regex = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) {
      runs.push(new TextRun({ text: text.slice(last, match.index), size: 22, font: 'Segoe UI' }));
    }
    if (match[1]) {
      runs.push(new TextRun({ text: match[1], bold: true, size: 22, font: 'Segoe UI' }));
    } else if (match[2]) {
      runs.push(new TextRun({ text: match[2], italics: true, size: 22, font: 'Segoe UI' }));
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    runs.push(new TextRun({ text: text.slice(last), size: 22, font: 'Segoe UI' }));
  }
  if (runs.length === 0) {
    runs.push(new TextRun({ text, size: 22, font: 'Segoe UI' }));
  }
  return runs;
}

/* ── Local PDF fallback via PDFKit ─────────────────────────────────── */

interface PdfLine {
  type: 'h1' | 'h2' | 'h3' | 'hr' | 'bullet' | 'paragraph';
  text: string;
}

function parseMarkdownLines(md: string): PdfLine[] {
  const lines: PdfLine[] = [];
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    if (!line) continue;
    if (/^### (.+)$/.test(line)) { lines.push({ type: 'h3', text: line.replace(/^### /, '') }); continue; }
    if (/^## (.+)$/.test(line)) { lines.push({ type: 'h2', text: line.replace(/^## /, '') }); continue; }
    if (/^# (.+)$/.test(line)) { lines.push({ type: 'h1', text: line.replace(/^# /, '') }); continue; }
    if (/^---+$/.test(line.trim())) { lines.push({ type: 'hr', text: '' }); continue; }
    if (/^[-*] /.test(line)) { lines.push({ type: 'bullet', text: line.replace(/^[-*] /, '') }); continue; }
    lines.push({ type: 'paragraph', text: line });
  }
  return lines;
}

function stripInlineMarkdown(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1');
}

const PAGE_SIZES: Record<string, [number, number]> = {
  A4: [595.28, 841.89],
  Letter: [612, 792],
  Legal: [612, 1008],
};

function generatePdfLocal(markdown: string, format: string, landscape: boolean): Promise<{ pdf: string; size_bytes: number }> {
  return new Promise((resolve, reject) => {
    const [baseW, baseH] = PAGE_SIZES[format] ?? PAGE_SIZES['A4']!;
    const size: [number, number] = landscape ? [baseH, baseW] : [baseW, baseH];

    const doc = new PDFDocument({
      size,
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
      autoFirstPage: true,
      bufferPages: true,
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => {
      const buffer = Buffer.concat(chunks);
      resolve({ pdf: buffer.toString('base64'), size_bytes: buffer.length });
    });
    doc.on('error', reject);

    const lines = parseMarkdownLines(markdown);
    const FONT = 'Helvetica';
    const FONT_BOLD = 'Helvetica-Bold';

    for (const line of lines) {
      const clean = stripInlineMarkdown(line.text);
      switch (line.type) {
        case 'h1':
          doc.moveDown(0.5).font(FONT_BOLD).fontSize(22).text(clean).moveDown(0.3);
          doc.moveTo(doc.x, doc.y).lineTo(doc.x + size[0] - 100, doc.y).strokeColor('#e5e7eb').stroke();
          doc.moveDown(0.3);
          break;
        case 'h2':
          doc.moveDown(0.4).font(FONT_BOLD).fontSize(18).fillColor('#374151').text(clean).fillColor('#1a1a1a').moveDown(0.2);
          break;
        case 'h3':
          doc.moveDown(0.3).font(FONT_BOLD).fontSize(14).fillColor('#4b5563').text(clean).fillColor('#1a1a1a').moveDown(0.2);
          break;
        case 'hr':
          doc.moveDown(0.5);
          doc.moveTo(doc.x, doc.y).lineTo(doc.x + size[0] - 100, doc.y).strokeColor('#e5e7eb').stroke();
          doc.moveDown(0.5);
          break;
        case 'bullet':
          doc.font(FONT).fontSize(11).text(`  •  ${clean}`, { indent: 10 }).moveDown(0.1);
          break;
        case 'paragraph':
          doc.font(FONT).fontSize(11).text(clean, { lineGap: 3 }).moveDown(0.2);
          break;
      }
    }

    doc.end();
  });
}

/* ── Exported tool factories ──────────────────────────────────────────── */

export function createPdfTools(): ToolDefinition[] {
  return [
    {
      name: 'generate_pdf',
      description:
        'Generate a PDF document from markdown or HTML content. Returns a base64-encoded PDF. ' +
        'Use this when you need to produce a downloadable report, brief, analysis export, or any document artifact as PDF.',
      parameters: {
        content: { type: 'string', description: 'Markdown or HTML content to render into a PDF.', required: true },
        title: { type: 'string', description: 'Document title (used in the page header).', required: false },
        format: { type: 'string', description: 'Page format.', required: false, enum: ['A4', 'Letter', 'Legal'] },
        landscape: { type: 'boolean', description: 'Use landscape orientation.', required: false },
        content_type: { type: 'string', description: 'Whether the content is markdown or raw HTML. Default: markdown.', required: false, enum: ['markdown', 'html'] },
      },
      execute: async (params): Promise<ToolResult> => {
        const contentType = (params.content_type as string) || 'markdown';
        const content = params.content as string;
        const title = params.title as string | undefined;
        const format = (params.format as string) || 'A4';
        const landscape = (params.landscape as boolean) ?? false;

        // ── Try Playwright service first ──────────────────────────────
        try {
          const serviceUrl = getPlaywrightServiceUrl();

          let html: string;
          if (contentType === 'html') {
            html = content;
          } else {
            const withTitle = title ? `# ${title}\n\n${content}` : content;
            html = convertMarkdownTables(markdownToHtml(withTitle));
          }

          const res = await fetch(`${serviceUrl}/pdf`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ html, format, landscape }),
            signal: AbortSignal.timeout(30_000),
          });

          if (res.ok) {
            const data = (await res.json()) as { pdf: string; size_bytes: number };
            return {
              success: true,
              data: {
                pdf_base64: data.pdf,
                size_bytes: data.size_bytes,
                format,
                message: `PDF generated successfully (${Math.round(data.size_bytes / 1024)} KB).`,
              },
            };
          }
          // Non-OK → fall through to local fallback
          console.warn(`[generate_pdf] Playwright service returned ${res.status}, falling back to local PDF generation.`);
        } catch (err) {
          console.warn(`[generate_pdf] Playwright service unavailable: ${(err as Error).message}. Falling back to local PDF generation.`);
        }

        // ── Local PDFKit fallback ─────────────────────────────────────
        try {
          const markdown = contentType === 'html'
            ? content  // Best-effort: PDFKit will render the raw text
            : (title ? `# ${title}\n\n${content}` : content);

          const data = await generatePdfLocal(markdown, format, landscape);
          return {
            success: true,
            data: {
              pdf_base64: data.pdf,
              size_bytes: data.size_bytes,
              format,
              message: `PDF generated locally (${Math.round(data.size_bytes / 1024)} KB). Note: local rendering may have simpler formatting than the full Playwright service.`,
            },
          };
        } catch (err) {
          return { success: false, error: `generate_pdf failed (both Playwright and local fallback): ${(err as Error).message}` };
        }
      },
    },
  ];
}

export function createWordTools(): ToolDefinition[] {
  return [
    {
      name: 'generate_word_doc',
      description:
        'Generate a Word (.docx) document from markdown content. Returns a base64-encoded .docx file. ' +
        'Use this when you need to produce a downloadable Word document, editable report, or any artifact the user will open in Word or Google Docs.',
      parameters: {
        content: { type: 'string', description: 'Markdown content to render into a Word document.', required: true },
        title: { type: 'string', description: 'Document title (rendered as a top-level heading).', required: false },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const content = params.content as string;
          const title = params.title as string | undefined;
          const fullMarkdown = title ? `# ${title}\n\n${content}` : content;

          const docChildren = markdownToDocxChildren(fullMarkdown);

          const doc = new Document({
            styles: {
              default: {
                document: {
                  run: { font: 'Segoe UI', size: 22 },
                },
              },
            },
            sections: [{ children: docChildren }],
          });

          const buffer = await Packer.toBuffer(doc);
          const base64 = buffer.toString('base64');

          return {
            success: true,
            data: {
              docx_base64: base64,
              size_bytes: buffer.length,
              message: `Word document generated successfully (${Math.round(buffer.length / 1024)} KB).`,
            },
          };
        } catch (err) {
          return { success: false, error: `generate_word_doc failed: ${(err as Error).message}` };
        }
      },
    },
  ];
}

/** Combined factory for both document tools. */
export function createDocumentTools(): ToolDefinition[] {
  return [...createPdfTools(), ...createWordTools()];
}
