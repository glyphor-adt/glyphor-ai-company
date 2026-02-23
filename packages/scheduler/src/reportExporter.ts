/**
 * Report Exporter
 *
 * Generates downloadable documents from analysis, simulation, and CoT reports.
 * Supports JSON, Markdown, Word (.docx), and PowerPoint (.pptx) formats.
 */

import type { AnalysisReport, AnalysisRecord } from './analysisEngine.js';
import type { SimulationReport, SimulationRecord } from './simulationEngine.js';
import type { CotReport, CotRecord } from './cotEngine.js';
import PptxGenJS from 'pptxgenjs';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, PageNumber, Header, Footer, Tab, TabStopPosition, TabStopType, convertInchesToTwip } from 'docx';

/* ── Shared PPTX theme ──────────────────────── */

const SLIDE_BG    = '0D1117';
const SLIDE_BG2   = '161B22';  // slightly lighter panel bg
const SLIDE_TEXT  = 'E6EDF3';
const SLIDE_MUTED = '8B949E';
const SLIDE_CYAN  = '00E0FF';
const SLIDE_AMBER = 'FBBF24';
const SLIDE_GREEN = '34D399';
const SLIDE_RED   = 'FB7185';
const SLIDE_ACCENT = '623CEA';
const SLIDE_WHITE = 'FFFFFF';
const FONT_HEADING = 'Segoe UI';
const FONT_BODY    = 'Segoe UI';

/** Branded footer bar on every slide */
function addSlideFooter(slide: PptxGenJS.Slide, pptx: PptxGenJS): void {
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 5.1, w: 10, h: 0.15, fill: { color: SLIDE_CYAN } });
  slide.addText('GLYPHOR AI  ·  Confidential', { x: 0.3, y: 4.85, w: 5, fontSize: 7, color: SLIDE_MUTED, fontFace: FONT_BODY });
}

function pptxTitleSlide(pptx: PptxGenJS, title: string, subtitle: string, meta: string): void {
  const slide = pptx.addSlide();
  slide.background = { color: SLIDE_BG };
  // Top accent bar
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: SLIDE_CYAN } });
  // Brand mark
  slide.addText('G L Y P H O R   A I', { x: 0.6, y: 0.4, w: 9, fontSize: 13, color: SLIDE_CYAN, fontFace: FONT_HEADING, bold: true, charSpacing: 5 });
  // Accent rule
  slide.addShape(pptx.ShapeType.rect, { x: 0.6, y: 0.8, w: 1.4, h: 0.04, fill: { color: SLIDE_CYAN } });
  // Title
  slide.addText(title, { x: 0.6, y: 1.6, w: 8.5, fontSize: 36, color: SLIDE_WHITE, fontFace: FONT_HEADING, bold: true, lineSpacingMultiple: 1.1 });
  // Subtitle
  slide.addText(subtitle, { x: 0.6, y: 2.8, w: 8.5, fontSize: 16, color: SLIDE_MUTED, fontFace: FONT_BODY, lineSpacingMultiple: 1.3 });
  // Meta
  slide.addText(meta, { x: 0.6, y: 4.4, w: 8, fontSize: 11, color: SLIDE_MUTED, fontFace: FONT_BODY });
  addSlideFooter(slide, pptx);
}

/** Paginated section slide — splits items across multiple slides if needed */
function pptxSectionSlides(pptx: PptxGenJS, heading: string, items: string[], color: string, opts?: { numbered?: boolean }): void {
  const ITEMS_PER_SLIDE = 6;
  const chunks: string[][] = [];
  for (let i = 0; i < items.length; i += ITEMS_PER_SLIDE) {
    chunks.push(items.slice(i, i + ITEMS_PER_SLIDE));
  }
  if (chunks.length === 0) chunks.push([]);

  chunks.forEach((chunk, pageIdx) => {
    const slide = pptx.addSlide();
    slide.background = { color: SLIDE_BG };
    // Top accent bar
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.06, fill: { color } });
    // Left color accent
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.06, h: 5.63, fill: { color } });
    // Section heading
    slide.addText(heading + (chunks.length > 1 ? ` (${pageIdx + 1}/${chunks.length})` : ''), {
      x: 0.6, y: 0.25, w: 9, fontSize: 22, color, fontFace: FONT_HEADING, bold: true,
    });
    slide.addShape(pptx.ShapeType.rect, { x: 0.6, y: 0.65, w: 1.0, h: 0.035, fill: { color } });

    chunk.forEach((item, idx) => {
      const globalIdx = pageIdx * ITEMS_PER_SLIDE + idx;
      const prefix = opts?.numbered ? `${globalIdx + 1}.` : '●';
      const yPos = 1.0 + idx * 0.65;
      // Item card with subtle bg
      slide.addShape(pptx.ShapeType.roundRect, {
        x: 0.5, y: yPos - 0.05, w: 9, h: 0.55,
        fill: { color: SLIDE_BG2 }, line: { color: '30363D', width: 0.5 }, rectRadius: 0.05,
      });
      slide.addText(`${prefix}  ${item}`, {
        x: 0.7, y: yPos, w: 8.6, h: 0.45,
        fontSize: 13, color: SLIDE_TEXT, fontFace: FONT_BODY, valign: 'middle', lineSpacingMultiple: 1.15,
      });
    });

    addSlideFooter(slide, pptx);
  });
}

/* ── Analysis Export: Markdown ────────────── */

export function exportAnalysisMarkdown(record: AnalysisRecord): string {
  const report = record.report;
  const lines: string[] = [
    `# Strategic Analysis: ${record.type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}`,
    '',
    `**Query:** ${record.query}`,
    `**Depth:** ${record.depth}`,
    `**Requested by:** ${record.requested_by}`,
    `**Created:** ${new Date(record.created_at).toLocaleString()}`,
    `**Status:** ${record.status}`,
    '',
  ];

  if (!report) {
    lines.push('*Report not yet generated.*');
    return lines.join('\n');
  }

  // Summary
  lines.push('## Executive Summary', '', report.summary, '');

  // SWOT
  lines.push('## SWOT Analysis', '');
  lines.push('### Strengths');
  for (const s of report.swot.strengths) lines.push(`- ${s}`);
  lines.push('', '### Weaknesses');
  for (const w of report.swot.weaknesses) lines.push(`- ${w}`);
  lines.push('', '### Opportunities');
  for (const o of report.swot.opportunities) lines.push(`- ${o}`);
  lines.push('', '### Threats');
  for (const t of report.swot.threats) lines.push(`- ${t}`);
  lines.push('');

  // Recommendations
  lines.push('## Recommendations', '');
  for (const rec of report.recommendations) {
    lines.push(`### ${rec.title} [${rec.priority.toUpperCase()}]`, '', rec.detail, '');
  }

  // Thread details
  lines.push('## Research Threads', '');
  for (const thread of report.threads) {
    lines.push(
      `### ${thread.label} (${thread.status})`,
      '',
      thread.result ?? '*No result*',
      '',
      '---',
      '',
    );
  }

  return lines.join('\n');
}

export function exportAnalysisJSON(record: AnalysisRecord): string {
  return JSON.stringify({
    id: record.id,
    type: record.type,
    query: record.query,
    depth: record.depth,
    status: record.status,
    requested_by: record.requested_by,
    created_at: record.created_at,
    completed_at: record.completed_at,
    report: record.report,
  }, null, 2);
}

/* ── Simulation Export ─────────────────────── */

export function exportSimulationMarkdown(record: SimulationRecord): string {
  const report = record.report;
  const lines: string[] = [
    `# T+1 Simulation Report`,
    '',
    `**Action:** ${record.action}`,
    `**Perspective:** ${record.perspective}`,
    `**Requested by:** ${record.requested_by}`,
    `**Created:** ${new Date(record.created_at).toLocaleString()}`,
    `**Status:** ${record.status}`,
    '',
  ];

  if (!report) {
    lines.push('*Report not yet generated.*');
    return lines.join('\n');
  }

  lines.push(
    `**Overall Score:** ${report.overallScore}/10`,
    `**Recommendation:** ${report.recommendation.replace(/_/g, ' ')}`,
    '',
  );

  // Summary
  lines.push('## Summary', '', report.summary, '');

  // Impact Matrix
  lines.push('## Impact Matrix', '');
  lines.push('| Area | Impact | Magnitude | Confidence | Reasoning |');
  lines.push('|------|--------|-----------|------------|-----------|');
  for (const dim of report.dimensions) {
    lines.push(
      `| ${dim.area} | ${dim.impact} | ${dim.magnitude}/10 | ${Math.round(dim.confidence * 100)}% | ${dim.reasoning.slice(0, 80)} |`,
    );
  }
  lines.push('');

  // Cascade Chain
  if (report.cascadeChain.length > 0) {
    lines.push('## Cascade Effects', '');
    for (const link of report.cascadeChain) {
      lines.push(`- **${link.from}** → **${link.to}**: ${link.effect} *(${link.delay})*`);
    }
    lines.push('');
  }

  // Votes
  lines.push('## Agent Votes', '');
  for (const vote of report.votes) {
    const emoji = vote.vote === 'approve' ? '✅' : vote.vote === 'reject' ? '❌' : '⚠️';
    lines.push(`- ${emoji} **${vote.agent}**: ${vote.vote} — ${vote.reasoning.slice(0, 100)}`);
  }

  return lines.join('\n');
}

export function exportSimulationJSON(record: SimulationRecord): string {
  return JSON.stringify({
    id: record.id,
    action: record.action,
    perspective: record.perspective,
    status: record.status,
    requested_by: record.requested_by,
    created_at: record.created_at,
    completed_at: record.completed_at,
    report: record.report,
  }, null, 2);
}

/* ── Analysis Export: PPTX ─────────────────── */

export async function exportAnalysisPPTX(record: AnalysisRecord): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = 'Glyphor AI';
  pptx.title = `Strategic Analysis: ${record.type.replace(/_/g, ' ')}`;

  const report = record.report;
  const typeLabel = record.type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  // 1. Title slide
  pptxTitleSlide(pptx, typeLabel, record.query, `Depth: ${record.depth}  ·  ${new Date(record.created_at).toLocaleDateString()}  ·  Glyphor AI Strategy Lab`);

  if (!report) {
    const slide = pptx.addSlide();
    slide.background = { color: SLIDE_BG };
    slide.addText('Report not yet generated.', { x: 1, y: 2, w: 8, fontSize: 18, color: SLIDE_MUTED, fontFace: FONT_BODY, align: 'center' });
    return (await pptx.write({ outputType: 'nodebuffer' })) as unknown as Buffer;
  }

  // 2. Executive Summary — multi-paragraph with key stat callout
  {
    const slide = pptx.addSlide();
    slide.background = { color: SLIDE_BG };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: SLIDE_CYAN } });
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.06, h: 5.63, fill: { color: SLIDE_CYAN } });
    slide.addText('Executive Summary', { x: 0.6, y: 0.25, w: 9, fontSize: 24, color: SLIDE_CYAN, fontFace: FONT_HEADING, bold: true });
    slide.addShape(pptx.ShapeType.rect, { x: 0.6, y: 0.7, w: 1.2, h: 0.035, fill: { color: SLIDE_CYAN } });

    // Summary text in a card
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 0.5, y: 0.95, w: 9, h: 3.8,
      fill: { color: SLIDE_BG2 }, line: { color: '30363D', width: 0.5 }, rectRadius: 0.08,
    });
    // Split summary into paragraphs, limit to ~600 chars per slide
    const summaryText = report.summary.length > 800 ? report.summary.slice(0, 800) + '…' : report.summary;
    slide.addText(summaryText, {
      x: 0.8, y: 1.1, w: 8.4, h: 3.5,
      fontSize: 13.5, color: SLIDE_TEXT, fontFace: FONT_BODY, valign: 'top', lineSpacingMultiple: 1.4,
    });

    // Key stats strip at bottom
    const statsData = [
      { label: 'Strengths', val: String(report.swot.strengths.length), clr: SLIDE_GREEN },
      { label: 'Weaknesses', val: String(report.swot.weaknesses.length), clr: SLIDE_RED },
      { label: 'Opportunities', val: String(report.swot.opportunities.length), clr: SLIDE_CYAN },
      { label: 'Threats', val: String(report.swot.threats.length), clr: SLIDE_AMBER },
      { label: 'Recommendations', val: String(report.recommendations.length), clr: SLIDE_ACCENT },
    ];
    statsData.forEach((s, idx) => {
      const xPos = 0.5 + idx * 1.85;
      slide.addShape(pptx.ShapeType.roundRect, {
        x: xPos, y: 4.85, w: 1.7, h: 0.55,
        fill: { color: SLIDE_BG2 }, line: { color: s.clr, width: 1 }, rectRadius: 0.05,
      });
      slide.addText(s.val, { x: xPos, y: 4.82, w: 1.7, fontSize: 18, color: s.clr, fontFace: FONT_HEADING, bold: true, align: 'center' });
      slide.addText(s.label, { x: xPos, y: 5.08, w: 1.7, fontSize: 8, color: SLIDE_MUTED, fontFace: FONT_BODY, align: 'center' });
    });
    addSlideFooter(slide, pptx);
  }

  // 3. Key Findings (strengths + opportunities)
  const keyFindings = [...report.swot.strengths, ...report.swot.opportunities];
  if (keyFindings.length > 0) {
    pptxSectionSlides(pptx, 'Key Findings', keyFindings, SLIDE_AMBER);
  }

  // 4. SWOT Analysis — polished 2×2 matrix
  {
    const slide = pptx.addSlide();
    slide.background = { color: SLIDE_BG };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: SLIDE_WHITE } });
    slide.addText('SWOT Analysis', { x: 0.5, y: 0.2, w: 9, fontSize: 22, color: SLIDE_WHITE, fontFace: FONT_HEADING, bold: true });
    slide.addShape(pptx.ShapeType.rect, { x: 0.5, y: 0.6, w: 1.0, h: 0.035, fill: { color: SLIDE_WHITE } });

    const quadrants = [
      { label: 'STRENGTHS', items: report.swot.strengths, color: SLIDE_GREEN, x: 0.3, y: 0.85 },
      { label: 'WEAKNESSES', items: report.swot.weaknesses, color: SLIDE_RED, x: 5.15, y: 0.85 },
      { label: 'OPPORTUNITIES', items: report.swot.opportunities, color: SLIDE_CYAN, x: 0.3, y: 2.95 },
      { label: 'THREATS', items: report.swot.threats, color: SLIDE_AMBER, x: 5.15, y: 2.95 },
    ];
    for (const q of quadrants) {
      // Card bg
      slide.addShape(pptx.ShapeType.roundRect, {
        x: q.x, y: q.y, w: 4.65, h: 1.95,
        fill: { color: SLIDE_BG2 }, line: { color: q.color, width: 1.5 }, rectRadius: 0.08,
      });
      // Label with colored bg strip
      slide.addShape(pptx.ShapeType.rect, { x: q.x, y: q.y, w: 4.65, h: 0.3, fill: { color: q.color } });
      slide.addText(q.label, { x: q.x + 0.15, y: q.y + 0.02, w: 4.3, fontSize: 11, color: SLIDE_BG, fontFace: FONT_HEADING, bold: true, charSpacing: 2 });
      // Bullet items (up to 5)
      const bullets = q.items.slice(0, 5).map((item, i) => `${i + 1}. ${item}`).join('\n');
      slide.addText(bullets || 'None identified', {
        x: q.x + 0.15, y: q.y + 0.38, w: 4.35, h: 1.45,
        fontSize: 9.5, color: SLIDE_TEXT, fontFace: FONT_BODY, valign: 'top', lineSpacingMultiple: 1.35,
      });
    }
    addSlideFooter(slide, pptx);
  }

  // 5. Strategic Recommendations — one per slide for high-priority, grouped for others
  if (report.recommendations.length > 0) {
    const highPriority = report.recommendations.filter((r) => r.priority === 'high');
    const otherRecs = report.recommendations.filter((r) => r.priority !== 'high');

    // High-priority: individual slides for emphasis
    highPriority.forEach((rec, idx) => {
      const slide = pptx.addSlide();
      slide.background = { color: SLIDE_BG };
      slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: SLIDE_RED } });
      slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.06, h: 5.63, fill: { color: SLIDE_RED } });
      slide.addText(`HIGH PRIORITY  ·  Recommendation ${idx + 1}`, {
        x: 0.6, y: 0.3, w: 9, fontSize: 12, color: SLIDE_RED, fontFace: FONT_HEADING, bold: true, charSpacing: 2,
      });
      slide.addText(rec.title, { x: 0.6, y: 0.8, w: 8.5, fontSize: 28, color: SLIDE_WHITE, fontFace: FONT_HEADING, bold: true });
      slide.addShape(pptx.ShapeType.rect, { x: 0.6, y: 1.5, w: 1.0, h: 0.035, fill: { color: SLIDE_RED } });
      slide.addShape(pptx.ShapeType.roundRect, {
        x: 0.5, y: 1.75, w: 9, h: 2.8,
        fill: { color: SLIDE_BG2 }, line: { color: '30363D', width: 0.5 }, rectRadius: 0.08,
      });
      slide.addText(rec.detail, {
        x: 0.8, y: 1.9, w: 8.4, h: 2.5,
        fontSize: 14, color: SLIDE_TEXT, fontFace: FONT_BODY, valign: 'top', lineSpacingMultiple: 1.4,
      });
      addSlideFooter(slide, pptx);
    });

    // Medium/Low grouped
    if (otherRecs.length > 0) {
      pptxSectionSlides(
        pptx,
        'Additional Recommendations',
        otherRecs.map((r) => `[${r.priority.toUpperCase()}] ${r.title}: ${r.detail.slice(0, 120)}`),
        SLIDE_CYAN,
        { numbered: true },
      );
    }
  }

  // 6. Risk Considerations
  const risks = [...report.swot.weaknesses, ...report.swot.threats];
  if (risks.length > 0) {
    pptxSectionSlides(pptx, 'Risk Considerations', risks, SLIDE_RED);
  }

  // 7. Closing slide
  {
    const slide = pptx.addSlide();
    slide.background = { color: SLIDE_BG };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 2.6, w: 10, h: 0.04, fill: { color: SLIDE_CYAN } });
    slide.addText('G L Y P H O R   A I', { x: 0.6, y: 1.8, w: 8.8, fontSize: 28, color: SLIDE_CYAN, fontFace: FONT_HEADING, bold: true, align: 'center', charSpacing: 6 });
    slide.addText('Strategic Intelligence Platform', { x: 0.6, y: 2.9, w: 8.8, fontSize: 14, color: SLIDE_MUTED, fontFace: FONT_BODY, align: 'center' });
    slide.addText(`Generated ${new Date().toLocaleDateString()}  ·  Confidential`, { x: 0.6, y: 3.5, w: 8.8, fontSize: 10, color: SLIDE_MUTED, fontFace: FONT_BODY, align: 'center' });
    addSlideFooter(slide, pptx);
  }

  return (await pptx.write({ outputType: 'nodebuffer' })) as unknown as Buffer;
}

/* ── Analysis Export: DOCX ─────────────────── */

/** Color-accented section heading with a thin colored top border */
function docxSectionHeading(text: string, color: string): Paragraph[] {
  return [
    new Paragraph({
      spacing: { before: 480, after: 40 },
      border: { top: { style: BorderStyle.SINGLE, size: 6, color, space: 8 } },
      children: [],
    }),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 0, after: 200 },
      children: [new TextRun({ text, bold: true, size: 28, color, font: 'Segoe UI' })],
    }),
  ];
}

function docxBulletItem(text: string, color?: string): Paragraph {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 80 },
    children: [new TextRun({ text, size: 21, color: color ?? '333333', font: 'Segoe UI' })],
  });
}

export async function exportAnalysisDOCX(record: AnalysisRecord): Promise<Buffer> {
  const report = record.report;
  const typeLabel = record.type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  const children: (Paragraph | Table)[] = [];

  // ── Branded header ──
  children.push(new Paragraph({
    spacing: { after: 60 },
    children: [new TextRun({ text: 'G L Y P H O R   A I', bold: true, size: 20, color: '00B4D8', font: 'Segoe UI' })],
  }));
  children.push(new Paragraph({
    spacing: { after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '00B4D8', space: 6 } },
    children: [],
  }));

  // ── Title block ──
  children.push(new Paragraph({
    spacing: { before: 200, after: 80 },
    children: [new TextRun({ text: `Strategic Analysis: ${typeLabel}`, bold: true, size: 48, font: 'Segoe UI', color: '1A1A2E' })],
  }));
  children.push(new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({ text: record.query, italics: true, size: 24, color: '555555', font: 'Segoe UI' })],
  }));
  children.push(new Paragraph({
    spacing: { after: 400 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD', space: 12 } },
    children: [
      new TextRun({ text: `Depth: ${record.depth}`, size: 18, color: '888888', font: 'Segoe UI' }),
      new TextRun({ text: `  ·  Date: ${new Date(record.created_at).toLocaleDateString()}`, size: 18, color: '888888', font: 'Segoe UI' }),
      new TextRun({ text: `  ·  Status: ${record.status}`, size: 18, color: '888888', font: 'Segoe UI' }),
    ],
  }));

  if (!report) {
    children.push(new Paragraph({ children: [new TextRun({ text: 'Report not yet generated.', italics: true })] }));
    return Packer.toBuffer(new Document({ sections: [{ children }] }));
  }

  // ── Executive Summary ──
  children.push(...docxSectionHeading('Executive Summary', '00B4D8'));
  for (const para of report.summary.split('\n').filter(Boolean)) {
    children.push(new Paragraph({
      spacing: { after: 160 },
      children: [new TextRun({ text: para, size: 22, font: 'Segoe UI', color: '2D2D2D' })],
    }));
  }

  // ── Key Findings ──
  const keyFindings = [...report.swot.strengths, ...report.swot.opportunities];
  if (keyFindings.length > 0) {
    children.push(...docxSectionHeading('Key Findings', 'D97706'));
    for (const finding of keyFindings) {
      children.push(docxBulletItem(finding, '3D3D3D'));
    }
  }

  // ── SWOT Analysis as a proper table ──
  children.push(...docxSectionHeading('SWOT Analysis', '1A1A2E'));

  const swotData: [string, string[], string][] = [
    ['Strengths', report.swot.strengths, '059669'],
    ['Weaknesses', report.swot.weaknesses, 'DC2626'],
    ['Opportunities', report.swot.opportunities, '0284C7'],
    ['Threats', report.swot.threats, 'D97706'],
  ];

  // 2×2 SWOT table
  const swotRows: TableRow[] = [];
  for (let row = 0; row < 2; row++) {
    const cells: TableCell[] = [];
    for (let col = 0; col < 2; col++) {
      const [label, items, color] = swotData[row * 2 + col];
      const cellChildren: Paragraph[] = [
        new Paragraph({
          spacing: { after: 100 },
          children: [new TextRun({ text: label.toUpperCase(), bold: true, size: 20, color, font: 'Segoe UI' })],
        }),
      ];
      if (items.length === 0) {
        cellChildren.push(new Paragraph({ children: [new TextRun({ text: 'None identified', italics: true, size: 18, color: '999999', font: 'Segoe UI' })] }));
      } else {
        for (const item of items) {
          cellChildren.push(new Paragraph({
            bullet: { level: 0 },
            spacing: { after: 60 },
            children: [new TextRun({ text: item, size: 19, color: '444444', font: 'Segoe UI' })],
          }));
        }
      }
      cells.push(new TableCell({
        width: { size: 50, type: WidthType.PERCENTAGE },
        borders: {
          top: { style: BorderStyle.SINGLE, size: 3, color },
          bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E5E5E5' },
          left: { style: BorderStyle.SINGLE, size: 1, color: 'E5E5E5' },
          right: { style: BorderStyle.SINGLE, size: 1, color: 'E5E5E5' },
        },
        margins: { top: convertInchesToTwip(0.1), bottom: convertInchesToTwip(0.1), left: convertInchesToTwip(0.12), right: convertInchesToTwip(0.12) },
        children: cellChildren,
      }));
    }
    swotRows.push(new TableRow({ children: cells }));
  }
  children.push(new Table({
    rows: swotRows,
    width: { size: 100, type: WidthType.PERCENTAGE },
  }));

  // ── Strategic Recommendations ──
  if (report.recommendations.length > 0) {
    children.push(...docxSectionHeading('Strategic Recommendations', '00B4D8'));
    const sorted = [...report.recommendations].sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return (order[a.priority] ?? 2) - (order[b.priority] ?? 2);
    });
    for (let i = 0; i < sorted.length; i++) {
      const rec = sorted[i];
      const priorityColor = rec.priority === 'high' ? 'DC2626' : rec.priority === 'medium' ? 'D97706' : '2563EB';
      children.push(new Paragraph({
        spacing: { before: 240, after: 80 },
        children: [
          new TextRun({ text: `${i + 1}. `, bold: true, size: 22, color: '00B4D8', font: 'Segoe UI' }),
          new TextRun({ text: rec.title, bold: true, size: 22, font: 'Segoe UI', color: '1A1A2E' }),
          new TextRun({ text: `  [${rec.priority.toUpperCase()}]`, bold: true, size: 18, color: priorityColor, font: 'Segoe UI' }),
        ],
      }));
      children.push(new Paragraph({
        spacing: { after: 120 },
        indent: { left: convertInchesToTwip(0.3) },
        children: [new TextRun({ text: rec.detail, size: 21, color: '444444', font: 'Segoe UI' })],
      }));
    }
  }

  // ── Risk Considerations ──
  const risks = [...report.swot.weaknesses, ...report.swot.threats];
  if (risks.length > 0) {
    children.push(...docxSectionHeading('Risk Considerations', 'DC2626'));
    for (const risk of risks) {
      children.push(docxBulletItem(risk, '555555'));
    }
  }

  // ── Appendix: Research Threads ──
  if (report.threads.length > 0) {
    children.push(...docxSectionHeading('Appendix: Research Threads', '888888'));
    for (const thread of report.threads) {
      children.push(new Paragraph({
        spacing: { before: 240, after: 60 },
        children: [
          new TextRun({ text: `${thread.label}`, bold: true, size: 20, font: 'Segoe UI', color: '333333' }),
          new TextRun({ text: ` (${thread.perspective})`, size: 18, color: '888888', font: 'Segoe UI' }),
          new TextRun({ text: `  —  ${thread.status}`, size: 18, color: thread.status === 'completed' ? '059669' : '888888', font: 'Segoe UI' }),
        ],
      }));
      if (thread.result) {
        for (const line of thread.result.split('\n').filter(Boolean).slice(0, 30)) {
          children.push(new Paragraph({
            spacing: { after: 40 },
            indent: { left: convertInchesToTwip(0.2) },
            children: [new TextRun({ text: line, size: 18, color: '666666', font: 'Segoe UI' })],
          }));
        }
      }
    }
  }

  // ── Footer line ──
  children.push(new Paragraph({
    spacing: { before: 600 },
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: '00B4D8', space: 12 } },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: `Glyphor AI  ·  Strategic Analysis  ·  ${new Date().toLocaleDateString()}  ·  Confidential`, size: 16, color: '999999', font: 'Segoe UI' })],
  }));

  return Packer.toBuffer(new Document({
    creator: 'Glyphor AI',
    title: `Strategic Analysis: ${typeLabel}`,
    sections: [{
      properties: {
        page: {
          margin: { top: convertInchesToTwip(0.8), bottom: convertInchesToTwip(0.8), left: convertInchesToTwip(1.0), right: convertInchesToTwip(1.0) },
        },
      },
      children: children as Paragraph[],
    }],
  }));
}

/* ── Simulation Export: PPTX ───────────────── */

export async function exportSimulationPPTX(record: SimulationRecord): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = 'Glyphor AI';
  pptx.title = `T+1 Simulation: ${record.action.slice(0, 60)}`;

  pptxTitleSlide(pptx, 'T+1 Impact Simulation', record.action, `Perspective: ${record.perspective}  ·  ${new Date(record.created_at).toLocaleDateString()}  ·  Glyphor AI Strategy Lab`);

  const report = record.report;
  if (!report) {
    return (await pptx.write({ outputType: 'nodebuffer' })) as unknown as Buffer;
  }

  // Summary + Score Dashboard
  {
    const slide = pptx.addSlide();
    slide.background = { color: SLIDE_BG };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: SLIDE_CYAN } });
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.06, h: 5.63, fill: { color: SLIDE_CYAN } });
    slide.addText('Executive Summary', { x: 0.6, y: 0.25, w: 7, fontSize: 22, color: SLIDE_CYAN, fontFace: FONT_HEADING, bold: true });

    // Score callout
    const scoreColor = report.overallScore >= 3 ? SLIDE_GREEN : report.overallScore >= 0 ? SLIDE_AMBER : SLIDE_RED;
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 7.8, y: 0.15, w: 1.8, h: 1.0,
      fill: { color: SLIDE_BG2 }, line: { color: scoreColor, width: 2 }, rectRadius: 0.1,
    });
    slide.addText(`${report.overallScore > 0 ? '+' : ''}${report.overallScore}`, {
      x: 7.8, y: 0.15, w: 1.8, fontSize: 36, color: scoreColor, fontFace: FONT_HEADING, bold: true, align: 'center',
    });
    slide.addText('IMPACT', { x: 7.8, y: 0.7, w: 1.8, fontSize: 8, color: SLIDE_MUTED, fontFace: FONT_BODY, align: 'center', charSpacing: 3 });

    // Recommendation badge
    const recLabel = report.recommendation.replace(/_/g, ' ').toUpperCase();
    const recColor = report.recommendation === 'proceed' ? SLIDE_GREEN : report.recommendation === 'proceed_with_caution' ? SLIDE_AMBER : SLIDE_RED;
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 7.8, y: 1.3, w: 1.8, h: 0.35,
      fill: { color: SLIDE_BG2 }, line: { color: recColor, width: 1 }, rectRadius: 0.05,
    });
    slide.addText(recLabel, { x: 7.8, y: 1.3, w: 1.8, h: 0.35, fontSize: 8, color: recColor, fontFace: FONT_HEADING, bold: true, align: 'center', valign: 'middle' });

    // Summary card
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 0.5, y: 1.0, w: 7.0, h: 3.6,
      fill: { color: SLIDE_BG2 }, line: { color: '30363D', width: 0.5 }, rectRadius: 0.08,
    });
    const summaryText = report.summary.length > 600 ? report.summary.slice(0, 600) + '…' : report.summary;
    slide.addText(summaryText, {
      x: 0.7, y: 1.15, w: 6.6, h: 3.3,
      fontSize: 13, color: SLIDE_TEXT, fontFace: FONT_BODY, valign: 'top', lineSpacingMultiple: 1.4,
    });
    addSlideFooter(slide, pptx);
  }

  // Impact by Department — individual cards with color coding
  if (report.dimensions.length > 0) {
    const slide = pptx.addSlide();
    slide.background = { color: SLIDE_BG };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: SLIDE_CYAN } });
    slide.addText('Impact by Department', { x: 0.6, y: 0.25, w: 9, fontSize: 22, color: SLIDE_CYAN, fontFace: FONT_HEADING, bold: true });
    slide.addShape(pptx.ShapeType.rect, { x: 0.6, y: 0.65, w: 1.0, h: 0.035, fill: { color: SLIDE_CYAN } });

    const maxPerSlide = 6;
    report.dimensions.slice(0, maxPerSlide).forEach((dim, idx) => {
      const col = idx % 3;
      const row = Math.floor(idx / 3);
      const xPos = 0.3 + col * 3.2;
      const yPos = 0.9 + row * 2.05;
      const dimColor = dim.impact === 'positive' ? SLIDE_GREEN : dim.impact === 'negative' ? SLIDE_RED : SLIDE_MUTED;

      slide.addShape(pptx.ShapeType.roundRect, {
        x: xPos, y: yPos, w: 3.0, h: 1.9,
        fill: { color: SLIDE_BG2 }, line: { color: dimColor, width: 1.5 }, rectRadius: 0.06,
      });
      // Header strip
      slide.addShape(pptx.ShapeType.rect, { x: xPos, y: yPos, w: 3.0, h: 0.28, fill: { color: dimColor } });
      slide.addText(dim.area, { x: xPos + 0.1, y: yPos + 0.02, w: 2.2, fontSize: 10, color: SLIDE_BG, fontFace: FONT_HEADING, bold: true });
      slide.addText(`${dim.magnitude > 0 ? '+' : ''}${dim.magnitude}`, { x: xPos + 2.2, y: yPos + 0.02, w: 0.7, fontSize: 12, color: SLIDE_BG, fontFace: FONT_HEADING, bold: true, align: 'right' });
      // Reasoning
      slide.addText(dim.reasoning.slice(0, 140), {
        x: xPos + 0.1, y: yPos + 0.38, w: 2.8, h: 1.0,
        fontSize: 9, color: SLIDE_TEXT, fontFace: FONT_BODY, valign: 'top', lineSpacingMultiple: 1.3,
      });
      // Confidence bar
      slide.addText(`${Math.round(dim.confidence * 100)}% confidence`, {
        x: xPos + 0.1, y: yPos + 1.5, w: 2.8, fontSize: 7.5, color: SLIDE_MUTED, fontFace: FONT_BODY,
      });
    });
    addSlideFooter(slide, pptx);
  }

  // Executive Votes
  if (report.votes.length > 0) {
    const voteItems = report.votes.map((v) => {
      const emoji = v.vote === 'approve' ? '✓ APPROVE' : v.vote === 'reject' ? '✗ REJECT' : '⚠ CAUTION';
      return `${v.agent}  [${emoji}]  —  ${v.reasoning.slice(0, 100)}`;
    });
    pptxSectionSlides(pptx, 'Executive Votes', voteItems, SLIDE_ACCENT);
  }

  // Closing slide
  {
    const slide = pptx.addSlide();
    slide.background = { color: SLIDE_BG };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 2.6, w: 10, h: 0.04, fill: { color: SLIDE_CYAN } });
    slide.addText('G L Y P H O R   A I', { x: 0.6, y: 1.8, w: 8.8, fontSize: 28, color: SLIDE_CYAN, fontFace: FONT_HEADING, bold: true, align: 'center', charSpacing: 6 });
    slide.addText('T+1 Impact Simulation Complete', { x: 0.6, y: 2.9, w: 8.8, fontSize: 14, color: SLIDE_MUTED, fontFace: FONT_BODY, align: 'center' });
    addSlideFooter(slide, pptx);
  }

  return (await pptx.write({ outputType: 'nodebuffer' })) as unknown as Buffer;
}

/* ── Simulation Export: DOCX ───────────────── */

export async function exportSimulationDOCX(record: SimulationRecord): Promise<Buffer> {
  const report = record.report;
  const children: (Paragraph | Table)[] = [];

  // ── Branded header ──
  children.push(new Paragraph({
    spacing: { after: 60 },
    children: [new TextRun({ text: 'G L Y P H O R   A I', bold: true, size: 20, color: '00B4D8', font: 'Segoe UI' })],
  }));
  children.push(new Paragraph({
    spacing: { after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '00B4D8', space: 6 } },
    children: [],
  }));

  // ── Title ──
  children.push(new Paragraph({
    spacing: { before: 200, after: 80 },
    children: [new TextRun({ text: 'T+1 Impact Simulation', bold: true, size: 48, font: 'Segoe UI', color: '1A1A2E' })],
  }));
  children.push(new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({ text: record.action, italics: true, size: 24, color: '555555', font: 'Segoe UI' })],
  }));
  children.push(new Paragraph({
    spacing: { after: 400 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD', space: 12 } },
    children: [
      new TextRun({ text: `Perspective: ${record.perspective}`, size: 18, color: '888888', font: 'Segoe UI' }),
      new TextRun({ text: `  ·  Date: ${new Date(record.created_at).toLocaleDateString()}`, size: 18, color: '888888', font: 'Segoe UI' }),
    ],
  }));

  if (!report) {
    children.push(new Paragraph({ children: [new TextRun({ text: 'Report not yet generated.', italics: true })] }));
    return Packer.toBuffer(new Document({ sections: [{ children: children as Paragraph[] }] }));
  }

  // ── Executive Summary with Score ──
  children.push(...docxSectionHeading('Executive Summary', '00B4D8'));
  const scoreColor = report.overallScore >= 3 ? '059669' : report.overallScore >= 0 ? 'D97706' : 'DC2626';
  children.push(new Paragraph({
    spacing: { after: 160 },
    children: [
      new TextRun({ text: 'Overall Impact Score: ', bold: true, size: 24, font: 'Segoe UI', color: '333333' }),
      new TextRun({ text: `${report.overallScore > 0 ? '+' : ''}${report.overallScore}/10`, bold: true, size: 28, font: 'Segoe UI', color: scoreColor }),
      new TextRun({ text: `    Recommendation: ${report.recommendation.replace(/_/g, ' ').toUpperCase()}`, bold: true, size: 20, font: 'Segoe UI', color: scoreColor }),
    ],
  }));
  children.push(new Paragraph({
    spacing: { after: 200 },
    children: [new TextRun({ text: report.summary, size: 22, font: 'Segoe UI', color: '2D2D2D' })],
  }));

  // ── Impact by Department as table ──
  if (report.dimensions.length > 0) {
    children.push(...docxSectionHeading('Impact by Department', '00B4D8'));

    // Header row
    const headerCells = ['Department', 'Impact', 'Score', 'Confidence', 'Analysis'].map((label) =>
      new TableCell({
        shading: { fill: '1A1A2E', type: ShadingType.CLEAR, color: 'FFFFFF' },
        margins: { top: 60, bottom: 60, left: 80, right: 80 },
        children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 18, color: 'FFFFFF', font: 'Segoe UI' })] })],
      }),
    );

    const dataRows = report.dimensions.map((dim) => {
      const impactColor = dim.impact === 'positive' ? '059669' : dim.impact === 'negative' ? 'DC2626' : '888888';
      return new TableRow({
        children: [
          new TableCell({ margins: { top: 50, bottom: 50, left: 80, right: 80 }, children: [new Paragraph({ children: [new TextRun({ text: dim.area, bold: true, size: 19, font: 'Segoe UI', color: '333333' })] })] }),
          new TableCell({ margins: { top: 50, bottom: 50, left: 80, right: 80 }, children: [new Paragraph({ children: [new TextRun({ text: dim.impact.toUpperCase(), bold: true, size: 17, font: 'Segoe UI', color: impactColor })] })] }),
          new TableCell({ margins: { top: 50, bottom: 50, left: 80, right: 80 }, children: [new Paragraph({ children: [new TextRun({ text: `${dim.magnitude > 0 ? '+' : ''}${dim.magnitude}`, bold: true, size: 20, font: 'Segoe UI', color: impactColor })] })] }),
          new TableCell({ margins: { top: 50, bottom: 50, left: 80, right: 80 }, children: [new Paragraph({ children: [new TextRun({ text: `${Math.round(dim.confidence * 100)}%`, size: 18, font: 'Segoe UI', color: '666666' })] })] }),
          new TableCell({
            width: { size: 45, type: WidthType.PERCENTAGE },
            margins: { top: 50, bottom: 50, left: 80, right: 80 },
            children: [new Paragraph({ children: [new TextRun({ text: dim.reasoning, size: 18, font: 'Segoe UI', color: '555555' })] })],
          }),
        ],
      });
    });

    children.push(new Table({
      rows: [new TableRow({ children: headerCells }), ...dataRows],
      width: { size: 100, type: WidthType.PERCENTAGE },
    }));
  }

  // ── Cascade Chain ──
  if (report.cascadeChain.length > 0) {
    children.push(...docxSectionHeading('Cascade Effects', 'D97706'));
    for (const link of report.cascadeChain) {
      children.push(new Paragraph({
        spacing: { after: 80 },
        children: [
          new TextRun({ text: `${link.from}`, bold: true, size: 20, color: '00B4D8', font: 'Segoe UI' }),
          new TextRun({ text: '  →  ', size: 20, color: '888888', font: 'Segoe UI' }),
          new TextRun({ text: `${link.to}`, bold: true, size: 20, color: '333333', font: 'Segoe UI' }),
          new TextRun({ text: `: ${link.effect}`, size: 20, color: '555555', font: 'Segoe UI' }),
          new TextRun({ text: `  (${link.delay})`, italics: true, size: 18, color: '888888', font: 'Segoe UI' }),
        ],
      }));
    }
  }

  // ── Executive Votes ──
  if (report.votes.length > 0) {
    children.push(...docxSectionHeading('Executive Votes', '623CEA'));
    for (const v of report.votes) {
      const icon = v.vote === 'approve' ? '✓' : v.vote === 'reject' ? '✗' : '⚠';
      const vColor = v.vote === 'approve' ? '059669' : v.vote === 'reject' ? 'DC2626' : 'D97706';
      children.push(new Paragraph({
        spacing: { after: 120 },
        children: [
          new TextRun({ text: `${icon} ${v.agent}`, bold: true, size: 22, font: 'Segoe UI', color: vColor }),
          new TextRun({ text: `  [${v.vote.toUpperCase()}]`, bold: true, size: 18, color: vColor, font: 'Segoe UI' }),
        ],
      }));
      children.push(new Paragraph({
        spacing: { after: 100 },
        indent: { left: convertInchesToTwip(0.3) },
        children: [new TextRun({ text: v.reasoning, size: 20, color: '555555', font: 'Segoe UI' })],
      }));
    }
  }

  // ── Footer ──
  children.push(new Paragraph({
    spacing: { before: 600 },
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: '00B4D8', space: 12 } },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: `Glyphor AI  ·  T+1 Simulation  ·  ${new Date().toLocaleDateString()}  ·  Confidential`, size: 16, color: '999999', font: 'Segoe UI' })],
  }));

  return Packer.toBuffer(new Document({
    creator: 'Glyphor AI',
    title: `T+1 Simulation: ${record.action.slice(0, 60)}`,
    sections: [{
      properties: {
        page: {
          margin: { top: convertInchesToTwip(0.8), bottom: convertInchesToTwip(0.8), left: convertInchesToTwip(1.0), right: convertInchesToTwip(1.0) },
        },
      },
      children: children as Paragraph[],
    }],
  }));
}

/* ── CoT Export: Markdown ──────────────────── */

export function exportCotMarkdown(record: CotRecord): string {
  const report = record.report;
  const lines: string[] = [
    '# Chain of Thought Planning',
    '',
    `**Question:** ${record.query}`,
    `**Requested by:** ${record.requested_by}`,
    `**Created:** ${new Date(record.created_at).toLocaleString()}`,
    `**Status:** ${record.status}`,
    '',
  ];

  if (!report) {
    lines.push('*Report not yet generated.*');
    return lines.join('\n');
  }

  lines.push('## Summary', '', report.summary, '');

  // Problems
  lines.push('## Core Problems', '');
  for (const p of report.problems) {
    lines.push(`### ${p.title} [${p.severity.toUpperCase()}]`, '', p.description, '');
  }

  // Root Causes
  lines.push('## Root Causes', '');
  for (const rc of report.rootCauses) {
    lines.push(`- **${rc.cause}** (links to: ${rc.linkedProblem})`);
    lines.push(`  Evidence: ${rc.evidence}`, '');
  }

  // Solutions
  lines.push('## Solution Space', '');
  for (const s of report.solutions) {
    lines.push(`### ${s.title} (Feasibility: ${Math.round(s.feasibility * 100)}%)`, '', s.description);
    lines.push(`- Timeframe: ${s.timeframe}`, `- Resources: ${s.resources}`, '');
  }

  // Options
  lines.push('## Strategic Options', '');
  for (const opt of report.options) {
    lines.push(`### ${opt.title} (Score: ${opt.feasibilityScore}/10)`, '');
    lines.push('**Pros:**');
    for (const p of opt.pros) lines.push(`- ${p}`);
    lines.push('', '**Cons:**');
    for (const c of opt.cons) lines.push(`- ${c}`);
    lines.push('', `**Reasoning:** ${opt.reasoning}`, '');
  }

  // Validations
  lines.push('## Logical Validation', '');
  for (const v of report.validations) {
    const icon = v.status === 'valid' ? '✅' : v.status === 'questionable' ? '⚠️' : '❌';
    lines.push(`- ${icon} **${v.assumption}** [${v.status}]: ${v.evidence}`);
  }

  return lines.join('\n');
}

export function exportCotJSON(record: CotRecord): string {
  return JSON.stringify({
    id: record.id,
    query: record.query,
    status: record.status,
    requested_by: record.requested_by,
    created_at: record.created_at,
    completed_at: record.completed_at,
    report: record.report,
  }, null, 2);
}

/* ── Analysis: Visual (SVG Infographic) ──── */

export function buildVisualPrompt(record: AnalysisRecord): string {
  const report = record.report;
  if (!report) return '';
  const typeLabel = record.type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  return [
    `Create a professional SVG infographic summarizing this strategic analysis. Use a dark theme (#0D1117 background, white/light text).`,
    `The SVG should be 800x1200 pixels and contain:`,
    `1. Title: "${typeLabel}" at the top`,
    `2. A visual summary section with the executive summary as concise bullet points`,
    `3. A SWOT quadrant diagram with: ${report.swot.strengths.length} strengths, ${report.swot.weaknesses.length} weaknesses, ${report.swot.opportunities.length} opportunities, ${report.swot.threats.length} threats`,
    `4. Key recommendations shown as numbered action items`,
    `5. Color coding: Cyan (#00E0FF) for primary, Amber (#FBBF24) for findings, Green (#34D399) for positives, Rose (#FB7185) for risks`,
    ``,
    `Data:`,
    `Query: ${record.query}`,
    `Summary: ${report.summary.slice(0, 300)}`,
    `Strengths: ${report.swot.strengths.slice(0, 3).join('; ')}`,
    `Weaknesses: ${report.swot.weaknesses.slice(0, 3).join('; ')}`,
    `Opportunities: ${report.swot.opportunities.slice(0, 3).join('; ')}`,
    `Threats: ${report.swot.threats.slice(0, 3).join('; ')}`,
    `Top recommendations: ${report.recommendations.slice(0, 3).map((r) => r.title).join('; ')}`,
    ``,
    `Respond ONLY with the SVG markup starting with <svg and ending with </svg>. No markdown fences, no commentary.`,
  ].join('\n');
}
