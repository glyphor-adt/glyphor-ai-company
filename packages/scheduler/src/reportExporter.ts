/**
 * Report Exporter
 *
 * Generates downloadable documents from analysis, simulation, and CoT reports.
 * Supports JSON, Markdown, Word (.docx), and PowerPoint (.pptx) formats.
 */

import type { AnalysisReport, AnalysisRecord } from './analysisEngine.js';
import type { SimulationReport, SimulationRecord } from './simulationEngine.js';
import type { CotReport, CotRecord } from './cotEngine.js';
import type { DeepDiveRecord, DeepDiveReport } from './deepDiveEngine.js';
import type { DeepDiveRecord, DeepDiveReport } from './deepDiveEngine.js';
import type { StrategyAnalysisRecord, SynthesisOutput } from './strategyLabEngine.js';
import PptxGenJS from 'pptxgenjs';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, PageNumber, Header, Footer, Tab, TabStopPosition, TabStopType, convertInchesToTwip } from 'docx';

/* ── Shared PPTX theme ──────────────────────── */

const SLIDE_BG    = 'FFFFFF';
const SLIDE_BG2   = 'F3F4F6';  // light gray card/panel bg
const SLIDE_TEXT  = '1F2937';
const SLIDE_MUTED = '6B7280';
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
  slide.addText('GLYPHOR AI  ·  Confidential', { x: 0.3, y: 4.85, w: 5, fontSize: 9, color: SLIDE_MUTED, fontFace: FONT_BODY });
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
  slide.addText(title, { x: 0.6, y: 1.6, w: 8.5, fontSize: 36, color: SLIDE_TEXT, fontFace: FONT_HEADING, bold: true, lineSpacingMultiple: 1.1 });
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
        fill: { color: SLIDE_BG2 }, line: { color: 'E5E7EB', width: 0.5 }, rectRadius: 0.05,
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
    const emoji = vote.vote === 'approve' ? 'APPROVE' : vote.vote === 'reject' ? 'REJECT' : 'CAUTION';
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
      fill: { color: SLIDE_BG2 }, line: { color: 'E5E7EB', width: 0.5 }, rectRadius: 0.08,
    });
    const summaryText = report.summary;
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
      slide.addText(s.label, { x: xPos, y: 5.08, w: 1.7, fontSize: 10, color: SLIDE_MUTED, fontFace: FONT_BODY, align: 'center' });
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
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: SLIDE_CYAN } });
    slide.addText('SWOT Analysis', { x: 0.5, y: 0.2, w: 9, fontSize: 22, color: SLIDE_TEXT, fontFace: FONT_HEADING, bold: true });
    slide.addShape(pptx.ShapeType.rect, { x: 0.5, y: 0.6, w: 1.0, h: 0.035, fill: { color: SLIDE_CYAN } });

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
      slide.addText(q.label, { x: q.x + 0.15, y: q.y + 0.02, w: 4.3, fontSize: 11, color: SLIDE_WHITE, fontFace: FONT_HEADING, bold: true, charSpacing: 2 });
      const bullets = q.items.slice(0, 7).map((item, i) => `${i + 1}. ${item}`).join('\n');
      slide.addText(bullets || 'None identified', {
        x: q.x + 0.15, y: q.y + 0.38, w: 4.35, h: 1.45,
        fontSize: 11, color: SLIDE_TEXT, fontFace: FONT_BODY, valign: 'top', lineSpacingMultiple: 1.35,
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
      slide.addText(rec.title, { x: 0.6, y: 0.8, w: 8.5, fontSize: 28, color: SLIDE_TEXT, fontFace: FONT_HEADING, bold: true });
      slide.addShape(pptx.ShapeType.rect, { x: 0.6, y: 1.5, w: 1.0, h: 0.035, fill: { color: SLIDE_RED } });
      slide.addShape(pptx.ShapeType.roundRect, {
        x: 0.5, y: 1.75, w: 9, h: 2.8,
        fill: { color: SLIDE_BG2 }, line: { color: 'E5E7EB', width: 0.5 }, rectRadius: 0.08,
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
        otherRecs.map((r) => `[${r.priority.toUpperCase()}] ${r.title}: ${r.detail}`),
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
    slide.addText('IMPACT', { x: 7.8, y: 0.7, w: 1.8, fontSize: 10, color: SLIDE_MUTED, fontFace: FONT_BODY, align: 'center', charSpacing: 3 });

    // Recommendation badge
    const recLabel = report.recommendation.replace(/_/g, ' ').toUpperCase();
    const recColor = report.recommendation === 'proceed' ? SLIDE_GREEN : report.recommendation === 'proceed_with_caution' ? SLIDE_AMBER : SLIDE_RED;
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 7.8, y: 1.3, w: 1.8, h: 0.35,
      fill: { color: SLIDE_BG2 }, line: { color: recColor, width: 1 }, rectRadius: 0.05,
    });
    slide.addText(recLabel, { x: 7.8, y: 1.3, w: 1.8, h: 0.35, fontSize: 10, color: recColor, fontFace: FONT_HEADING, bold: true, align: 'center', valign: 'middle' });

    // Summary card
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 0.5, y: 1.0, w: 7.0, h: 3.6,
      fill: { color: SLIDE_BG2 }, line: { color: 'E5E7EB', width: 0.5 }, rectRadius: 0.08,
    });
    const summaryText = report.summary;
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
      slide.addText(dim.area, { x: xPos + 0.1, y: yPos + 0.02, w: 2.2, fontSize: 10, color: SLIDE_WHITE, fontFace: FONT_HEADING, bold: true });
      slide.addText(`${dim.magnitude > 0 ? '+' : ''}${dim.magnitude}`, { x: xPos + 2.2, y: yPos + 0.02, w: 0.7, fontSize: 12, color: SLIDE_WHITE, fontFace: FONT_HEADING, bold: true, align: 'right' });
      // Reasoning
      slide.addText(dim.reasoning, {
        x: xPos + 0.1, y: yPos + 0.38, w: 2.8, h: 1.0,
        fontSize: 10, color: SLIDE_TEXT, fontFace: FONT_BODY, valign: 'top', lineSpacingMultiple: 1.3,
      });
      // Confidence bar
      slide.addText(`${Math.round(dim.confidence * 100)}% confidence`, {
        x: xPos + 0.1, y: yPos + 1.5, w: 2.8, fontSize: 9, color: SLIDE_MUTED, fontFace: FONT_BODY,
      });
    });
    addSlideFooter(slide, pptx);
  }

  // Executive Votes
  if (report.votes.length > 0) {
    const voteItems = report.votes.map((v) => {
      const emoji = v.vote === 'approve' ? '✓ APPROVE' : v.vote === 'reject' ? '✗ REJECT' : '⚠ CAUTION';
      return `${v.agent}  [${emoji}]  —  ${v.reasoning}`;
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
    const icon = v.status === 'valid' ? 'VALID' : v.status === 'questionable' ? 'QUESTIONABLE' : 'INVALID';
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

/* ── Deep Dive Export: Markdown ─────────────── */

export function exportDeepDiveMarkdown(record: DeepDiveRecord): string {
  const report = record.report;
  const lines: string[] = [
    `# McKinsey Deep Dive: ${record.target}`,
    '',
    `**Target:** ${record.target}`,
    `**Requested by:** ${record.requested_by}`,
    `**Created:** ${new Date(record.created_at).toLocaleString()}`,
    `**Status:** ${record.status}`,
    '',
  ];

  if (!report) {
    lines.push('*Report not yet generated.*');
    return lines.join('\n');
  }

  lines.push(`**Type:** ${report.targetType}`, `**Analysis Date:** ${report.analysisDate}`, '');

  // Current State
  lines.push('## Current State', '', `**Momentum:** ${report.currentState.momentum}`, '');
  if (report.currentState.keyStrengths.length > 0) {
    lines.push('### Key Strengths');
    for (const s of report.currentState.keyStrengths) lines.push(`- **${s.point}** — ${s.evidence}`);
    lines.push('');
  }
  if (report.currentState.keyChallenges.length > 0) {
    lines.push('### Key Challenges');
    for (const c of report.currentState.keyChallenges) lines.push(`- **${c.point}** — ${c.evidence}`);
    lines.push('');
  }
  const fs = report.currentState.financialSnapshot;
  if (fs.revenue || fs.funding) {
    lines.push('### Financial Snapshot');
    if (fs.revenue) lines.push(`- Revenue: ${fs.revenue}`);
    if (fs.revenueGrowth) lines.push(`- Revenue Growth: ${fs.revenueGrowth}`);
    if (fs.headcount) lines.push(`- Headcount: ${fs.headcount}`);
    if (fs.funding) lines.push(`- Funding: ${fs.funding}`);
    if (fs.valuation) lines.push(`- Valuation: ${fs.valuation}`);
    if (fs.profitability) lines.push(`- Profitability: ${fs.profitability}`);
    lines.push('');
  }

  // Overview
  lines.push('## Company Overview', '', report.overview.description, '');
  if (report.overview.leadership.length > 0) {
    lines.push('### Leadership');
    for (const l of report.overview.leadership) lines.push(`- **${l.name}** — ${l.title}`);
    lines.push('');
  }
  if (report.overview.products.length > 0) {
    lines.push('### Products');
    for (const p of report.overview.products) lines.push(`- **${p.name}**: ${p.description}`);
    lines.push('');
  }
  lines.push(`**Business Model:** ${report.overview.businessModel}`, '');

  // Market Analysis
  lines.push('## Market Analysis', '');
  lines.push(`- TAM: ${report.marketAnalysis.tam.value} (${report.marketAnalysis.tam.methodology})`);
  lines.push(`- SAM: ${report.marketAnalysis.sam.value} (${report.marketAnalysis.sam.methodology})`);
  lines.push(`- SOM: ${report.marketAnalysis.som.value} (${report.marketAnalysis.som.methodology})`);
  lines.push(`- Growth Rate: ${report.marketAnalysis.growthRate}`);
  lines.push('');

  // Competitive Landscape
  lines.push('## Competitive Landscape', '');
  if (report.competitiveLandscape.competitors.length > 0) {
    lines.push('| Competitor | Positioning | Key Differentiator |');
    lines.push('|------------|-------------|-------------------|');
    for (const c of report.competitiveLandscape.competitors) {
      lines.push(`| ${c.name} | ${c.positioning} | ${c.keyDifferentiator} |`);
    }
    lines.push('');
  }

  // Strategic Recommendations
  if (report.strategicRecommendations.length > 0) {
    lines.push('## Strategic Recommendations', '');
    for (const rec of report.strategicRecommendations) {
      lines.push(`### ${rec.title} [${rec.priority.toUpperCase()}]`, '', rec.description);
      lines.push(`- Expected Impact: ${rec.expectedImpact}`);
      lines.push(`- Investment: ${rec.investmentRequired}`);
      lines.push(`- Risk: ${rec.riskLevel}`, '');
    }
  }

  // Risk Assessment
  if (report.riskAssessment.length > 0) {
    lines.push('## Risk Assessment', '');
    lines.push('| Risk | Probability | Impact | Mitigation |');
    lines.push('|------|-------------|--------|------------|');
    for (const r of report.riskAssessment) {
      lines.push(`| ${r.risk} | ${r.probability} | ${r.impact} | ${r.mitigation} |`);
    }
    lines.push('');
  }

  // Sources
  if (record.sources.length > 0) {
    lines.push('## Sources', '');
    for (const s of record.sources.slice(0, 30)) {
      lines.push(`- [${s.title}](${s.url ?? '#'}) (${s.type})`);
    }
  }

  return lines.join('\n');
}

export function exportDeepDiveJSON(record: DeepDiveRecord): string {
  return JSON.stringify({
    id: record.id,
    target: record.target,
    status: record.status,
    requested_by: record.requested_by,
    created_at: record.created_at,
    completed_at: record.completed_at,
    research_areas: record.research_areas,
    sources: record.sources,
    report: record.report,
  }, null, 2);
}

/* ── Deep Dive Export: PPTX ────────────────── */

export async function exportDeepDivePPTX(record: DeepDiveRecord): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = 'Glyphor AI';
  pptx.title = `Deep Dive: ${record.target}`;

  const report = record.report;
  pptxTitleSlide(pptx, `McKinsey Deep Dive`, record.target, `${record.sources.length} sources analyzed  ·  ${new Date(record.created_at).toLocaleDateString()}  ·  Glyphor AI Strategy Lab`);

  if (!report) {
    const slide = pptx.addSlide();
    slide.background = { color: SLIDE_BG };
    slide.addText('Report not yet generated.', { x: 1, y: 2, w: 8, fontSize: 18, color: SLIDE_MUTED, fontFace: FONT_BODY, align: 'center' });
    return (await pptx.write({ outputType: 'nodebuffer' })) as unknown as Buffer;
  }

  // Current State
  {
    const slide = pptx.addSlide();
    slide.background = { color: SLIDE_BG };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: SLIDE_CYAN } });
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.06, h: 5.63, fill: { color: SLIDE_CYAN } });
    slide.addText('Current State', { x: 0.6, y: 0.25, w: 7, fontSize: 22, color: SLIDE_CYAN, fontFace: FONT_HEADING, bold: true });
    const momColor = report.currentState.momentum === 'positive' ? SLIDE_GREEN : report.currentState.momentum === 'negative' ? SLIDE_RED : SLIDE_AMBER;
    slide.addShape(pptx.ShapeType.roundRect, { x: 7.8, y: 0.15, w: 1.8, h: 0.5, fill: { color: SLIDE_BG2 }, line: { color: momColor, width: 2 }, rectRadius: 0.08 });
    slide.addText(report.currentState.momentum.toUpperCase(), { x: 7.8, y: 0.15, w: 1.8, h: 0.5, fontSize: 12, color: momColor, fontFace: FONT_HEADING, bold: true, align: 'center', valign: 'middle' });

    const strengths = report.currentState.keyStrengths.slice(0, 3).map((s) => `✓ ${s.point}`);
    const challenges = report.currentState.keyChallenges.slice(0, 3).map((c) => `✗ ${c.point}`);
    if (strengths.length > 0) {
      slide.addText('Key Strengths', { x: 0.6, y: 0.9, w: 4, fontSize: 14, color: SLIDE_GREEN, fontFace: FONT_HEADING, bold: true });
      strengths.forEach((s, i) => {
        slide.addText(s, { x: 0.6, y: 1.3 + i * 0.5, w: 4.2, fontSize: 11, color: SLIDE_TEXT, fontFace: FONT_BODY });
      });
    }
    if (challenges.length > 0) {
      slide.addText('Key Challenges', { x: 5.2, y: 0.9, w: 4, fontSize: 14, color: SLIDE_RED, fontFace: FONT_HEADING, bold: true });
      challenges.forEach((c, i) => {
        slide.addText(c, { x: 5.2, y: 1.3 + i * 0.5, w: 4.5, fontSize: 11, color: SLIDE_TEXT, fontFace: FONT_BODY });
      });
    }
    addSlideFooter(slide, pptx);
  }

  // Strategic Recommendations
  if (report.strategicRecommendations.length > 0) {
    pptxSectionSlides(
      pptx,
      'Strategic Recommendations',
      report.strategicRecommendations.map((r) => `[${r.priority.toUpperCase()}] ${r.title}: ${r.description}`),
      SLIDE_CYAN,
      { numbered: true },
    );
  }

  // Risk Assessment
  if (report.riskAssessment.length > 0) {
    pptxSectionSlides(
      pptx,
      'Risk Assessment',
      report.riskAssessment.map((r) => `[${r.probability.toUpperCase()} / ${r.impact.toUpperCase()}] ${r.risk}: ${r.mitigation}`),
      SLIDE_RED,
    );
  }

  // Closing
  {
    const slide = pptx.addSlide();
    slide.background = { color: SLIDE_BG };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 2.6, w: 10, h: 0.04, fill: { color: SLIDE_CYAN } });
    slide.addText('G L Y P H O R   A I', { x: 0.6, y: 1.8, w: 8.8, fontSize: 28, color: SLIDE_CYAN, fontFace: FONT_HEADING, bold: true, align: 'center', charSpacing: 6 });
    slide.addText('McKinsey Deep Dive Complete', { x: 0.6, y: 2.9, w: 8.8, fontSize: 14, color: SLIDE_MUTED, fontFace: FONT_BODY, align: 'center' });
    addSlideFooter(slide, pptx);
  }

  return (await pptx.write({ outputType: 'nodebuffer' })) as unknown as Buffer;
}

/* ── Deep Dive Export: DOCX ────────────────── */

export async function exportDeepDiveDOCX(record: DeepDiveRecord): Promise<Buffer> {
  const report = record.report;
  const children: (Paragraph | Table)[] = [];

  // Branded header
  children.push(new Paragraph({
    spacing: { after: 60 },
    children: [new TextRun({ text: 'G L Y P H O R   A I', bold: true, size: 20, color: '00B4D8', font: 'Segoe UI' })],
  }));
  children.push(new Paragraph({
    spacing: { after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '00B4D8', space: 6 } },
    children: [],
  }));

  // Title
  children.push(new Paragraph({
    spacing: { before: 200, after: 80 },
    children: [new TextRun({ text: `McKinsey Deep Dive: ${record.target}`, bold: true, size: 48, font: 'Segoe UI', color: '1A1A2E' })],
  }));
  children.push(new Paragraph({
    spacing: { after: 400 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD', space: 12 } },
    children: [
      new TextRun({ text: `Sources: ${record.sources.length}`, size: 18, color: '888888', font: 'Segoe UI' }),
      new TextRun({ text: `  ·  Date: ${new Date(record.created_at).toLocaleDateString()}`, size: 18, color: '888888', font: 'Segoe UI' }),
      new TextRun({ text: `  ·  Status: ${record.status}`, size: 18, color: '888888', font: 'Segoe UI' }),
    ],
  }));

  if (!report) {
    children.push(new Paragraph({ children: [new TextRun({ text: 'Report not yet generated.', italics: true })] }));
    return Packer.toBuffer(new Document({ sections: [{ children: children as Paragraph[] }] }));
  }

  // Overview
  children.push(...docxSectionHeading('Company Overview', '00B4D8'));
  children.push(new Paragraph({
    spacing: { after: 160 },
    children: [new TextRun({ text: report.overview.description, size: 22, font: 'Segoe UI', color: '2D2D2D' })],
  }));

  // Current State
  children.push(...docxSectionHeading('Current State', '059669'));
  const momLabel = report.currentState.momentum.toUpperCase();
  const momColor = report.currentState.momentum === 'positive' ? '059669' : report.currentState.momentum === 'negative' ? 'DC2626' : 'D97706';
  children.push(new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({ text: `Momentum: ${momLabel}`, bold: true, size: 24, font: 'Segoe UI', color: momColor })],
  }));
  for (const s of report.currentState.keyStrengths) {
    children.push(docxBulletItem(`${s.point} — ${s.evidence}`, '059669'));
  }
  for (const c of report.currentState.keyChallenges) {
    children.push(docxBulletItem(`${c.point} — ${c.evidence}`, 'DC2626'));
  }

  // Strategic Recommendations
  if (report.strategicRecommendations.length > 0) {
    children.push(...docxSectionHeading('Strategic Recommendations', '00B4D8'));
    for (let i = 0; i < report.strategicRecommendations.length; i++) {
      const rec = report.strategicRecommendations[i];
      const priorityColor = rec.priority === 'immediate' ? 'DC2626' : rec.priority === 'short-term' ? 'D97706' : '2563EB';
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
        children: [new TextRun({ text: rec.description, size: 21, color: '444444', font: 'Segoe UI' })],
      }));
    }
  }

  // Risk Assessment
  if (report.riskAssessment.length > 0) {
    children.push(...docxSectionHeading('Risk Assessment', 'DC2626'));
    for (const risk of report.riskAssessment) {
      children.push(docxBulletItem(`[${risk.probability}/${risk.impact}] ${risk.risk} — ${risk.mitigation}`, '555555'));
    }
  }

  // Footer
  children.push(new Paragraph({
    spacing: { before: 600 },
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: '00B4D8', space: 12 } },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: `Glyphor AI  ·  McKinsey Deep Dive  ·  ${new Date().toLocaleDateString()}  ·  Confidential`, size: 16, color: '999999', font: 'Segoe UI' })],
  }));

  return Packer.toBuffer(new Document({
    creator: 'Glyphor AI',
    title: `Deep Dive: ${record.target}`,
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

/* ── Analysis: Visual (Image Infographic) ──── */

export function buildVisualPrompt(record: AnalysisRecord): string {
  const report = record.report;
  if (!report) return '';

  const typeLabel: Record<string, string> = {
    competitive_landscape: 'Competitive Landscape',
    market_opportunity: 'Market Opportunity',
    product_strategy: 'Product Strategy',
    growth_diagnostic: 'Growth Diagnostic',
    risk_assessment: 'Risk Assessment',
  };
  const title = typeLabel[record.type] ?? 'Strategic Analysis';

  const recCount = Math.min(report.recommendations.length, 4);
  const threadCount = report.threads.length;
  const highCount = report.recommendations.filter(r => r.priority === 'high').length;
  const medCount = report.recommendations.filter(r => r.priority === 'medium').length;

  return [
    `Create a polished, magazine-quality corporate infographic in 16:9 landscape format (1536x1024px).`,
    `Style: clean modern flat design, white background, generous whitespace, minimal text. Use large icons, bold color blocks, and data visualizations instead of paragraphs of text. Think McKinsey or Bain presentation slide — NOT a document.`,
    ``,
    `Color palette: primary cyan (#00E0FF), white (#FFFFFF) background, dark charcoal (#1A1A2E) text, emerald (#34D399) for positive, rose (#FB7185) for negative, amber (#FBBF24) for caution. Use soft pastel tinted backgrounds for card sections.`,
    ``,
    `LAYOUT (3 rows):`,
    ``,
    `ROW 1 — Header banner (10% height):`,
    `Full-width cyan gradient banner. Large bold white title: "${title.toUpperCase()}". Smaller subtitle below in light gray: "${record.query}". Keep text SHORT.`,
    ``,
    `ROW 2 — Main content (65% height), split into 2 columns:`,
    ``,
    `LEFT COLUMN (45% width):`,
    `A large "Key Insights" card with a bold number callout: "${threadCount} research threads analyzed". Show 2-3 large circular icons (magnifying glass, lightbulb, target) with ONE-WORD labels beneath each. Below that, a small horizontal bar chart or gauge showing analysis completeness. NO bullet points of text — use icons and shapes only.`,
    ``,
    `RIGHT COLUMN (55% width):`,
    `A 2x2 SWOT grid using 4 large colored rounded-rectangle cards:`,
    `• Top-left: STRENGTHS — green (#34D399) tinted card with a shield icon and the number "${report.swot.strengths.length}"`,
    `• Top-right: WEAKNESSES — rose (#FB7185) tinted card with a warning triangle icon and the number "${report.swot.weaknesses.length}"`,
    `• Bottom-left: OPPORTUNITIES — cyan (#00E0FF) tinted card with an upward arrow icon and the number "${report.swot.opportunities.length}"`,
    `• Bottom-right: THREATS — amber (#FBBF24) tinted card with a lightning bolt icon and the number "${report.swot.threats.length}"`,
    `Each card shows ONLY the category label, icon, and count number in large bold text. NO bullet point text inside the cards.`,
    ``,
    `ROW 3 — Bottom strip (25% height), split into 2 sections:`,
    ``,
    `LEFT: "${recCount} Strategic Actions" — show as ${recCount} large colored pill badges in a row. ${highCount} red pills, ${medCount} amber pills, rest blue. Each pill has only a number inside (1, 2, 3, 4). A small "Priority Matrix" scatter plot beside it with dots plotted on an Impact vs Effort 2x2 grid.`,
    ``,
    `RIGHT: A thin metadata strip in small gray text: "${record.depth} depth · ${record.type.replace(/_/g, ' ')} · ${threadCount} threads · ${record.requested_by}"`,
    ``,
    `CRITICAL RULES:`,
    `- MINIMAL TEXT. Use icons, shapes, numbers, charts, and color instead of words.`,
    `- No paragraphs, no sentences, no bullet-point lists of findings.`,
    `- Maximum 30 total words on the entire infographic (excluding the title/subtitle).`,
    `- All text must be crisp, readable sans-serif typography.`,
    `- Professional, clean, corporate aesthetic with lots of whitespace.`,
    `- Do NOT include any "Powered by" branding or logo — the image should be clean.`,
  ].join('\n');
}

/* ═══════════════════════════════════════════════
   Strategy Lab v2 Exports
   ═══════════════════════════════════════════════ */

/* ── Strategy Lab v2: PPTX ─────────────────── */

export async function exportStrategyLabPPTX(record: StrategyAnalysisRecord): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = 'Glyphor AI';
  const typeLabel = record.analysis_type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  pptx.title = `Strategic Analysis: ${typeLabel}`;

  // 1. Title slide
  pptxTitleSlide(
    pptx, typeLabel, record.query,
    `Depth: ${record.depth}  ·  ${record.total_sources} sources  ·  ${record.total_searches} searches  ·  ${new Date(record.created_at).toLocaleDateString()}`,
  );

  const s = record.synthesis;
  if (!s) {
    const slide = pptx.addSlide();
    slide.background = { color: SLIDE_BG };
    slide.addText('Report not yet generated.', { x: 1, y: 2, w: 8, fontSize: 18, color: SLIDE_MUTED, fontFace: FONT_BODY, align: 'center' });
    return (await pptx.write({ outputType: 'nodebuffer' })) as unknown as Buffer;
  }

  // 2. Executive Summary
  {
    const slide = pptx.addSlide();
    slide.background = { color: SLIDE_BG };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: SLIDE_CYAN } });
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.06, h: 5.63, fill: { color: SLIDE_CYAN } });
    slide.addText('Executive Summary', { x: 0.6, y: 0.25, w: 9, fontSize: 24, color: SLIDE_CYAN, fontFace: FONT_HEADING, bold: true });
    slide.addShape(pptx.ShapeType.rect, { x: 0.6, y: 0.7, w: 1.2, h: 0.035, fill: { color: SLIDE_CYAN } });

    slide.addShape(pptx.ShapeType.roundRect, {
      x: 0.5, y: 0.95, w: 9, h: 3.8,
      fill: { color: SLIDE_BG2 }, line: { color: 'E5E7EB', width: 0.5 }, rectRadius: 0.08,
    });
    const summaryText = s.executiveSummary;
    slide.addText(summaryText, {
      x: 0.8, y: 1.1, w: 8.4, h: 3.5,
      fontSize: 13.5, color: SLIDE_TEXT, fontFace: FONT_BODY, valign: 'top', lineSpacingMultiple: 1.4,
    });

    const statsData = [
      { label: 'Strengths', val: String(s.unifiedSwot.strengths.length), clr: SLIDE_GREEN },
      { label: 'Weaknesses', val: String(s.unifiedSwot.weaknesses.length), clr: SLIDE_RED },
      { label: 'Opportunities', val: String(s.unifiedSwot.opportunities.length), clr: SLIDE_CYAN },
      { label: 'Threats', val: String(s.unifiedSwot.threats.length), clr: SLIDE_AMBER },
      { label: 'Actions', val: String(s.strategicRecommendations.length), clr: SLIDE_ACCENT },
    ];
    statsData.forEach((st, idx) => {
      const xPos = 0.5 + idx * 1.85;
      slide.addShape(pptx.ShapeType.roundRect, {
        x: xPos, y: 4.85, w: 1.7, h: 0.55,
        fill: { color: SLIDE_BG2 }, line: { color: st.clr, width: 1 }, rectRadius: 0.05,
      });
      slide.addText(st.val, { x: xPos, y: 4.82, w: 1.7, fontSize: 18, color: st.clr, fontFace: FONT_HEADING, bold: true, align: 'center' });
      slide.addText(st.label, { x: xPos, y: 5.08, w: 1.7, fontSize: 10, color: SLIDE_MUTED, fontFace: FONT_BODY, align: 'center' });
    });
    addSlideFooter(slide, pptx);
  }

  // 3. Cross-Framework Insights
  if (s.crossFrameworkInsights.length > 0) {
    pptxSectionSlides(pptx, 'Cross-Framework Insights', s.crossFrameworkInsights, SLIDE_CYAN);
  }

  // 4. SWOT Analysis
  {
    const slide = pptx.addSlide();
    slide.background = { color: SLIDE_BG };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: SLIDE_CYAN } });
    slide.addText('SWOT Analysis', { x: 0.5, y: 0.2, w: 9, fontSize: 22, color: SLIDE_TEXT, fontFace: FONT_HEADING, bold: true });
    slide.addShape(pptx.ShapeType.rect, { x: 0.5, y: 0.6, w: 1.0, h: 0.035, fill: { color: SLIDE_CYAN } });

    const quadrants = [
      { label: 'STRENGTHS', items: s.unifiedSwot.strengths, color: SLIDE_GREEN, x: 0.3, y: 0.85 },
      { label: 'WEAKNESSES', items: s.unifiedSwot.weaknesses, color: SLIDE_RED, x: 5.15, y: 0.85 },
      { label: 'OPPORTUNITIES', items: s.unifiedSwot.opportunities, color: SLIDE_CYAN, x: 0.3, y: 2.95 },
      { label: 'THREATS', items: s.unifiedSwot.threats, color: SLIDE_AMBER, x: 5.15, y: 2.95 },
    ];
    for (const q of quadrants) {
      slide.addShape(pptx.ShapeType.roundRect, {
        x: q.x, y: q.y, w: 4.65, h: 1.95,
        fill: { color: SLIDE_BG2 }, line: { color: q.color, width: 1.5 }, rectRadius: 0.08,
      });
      slide.addShape(pptx.ShapeType.rect, { x: q.x, y: q.y, w: 4.65, h: 0.3, fill: { color: q.color } });
      slide.addText(q.label, { x: q.x + 0.15, y: q.y + 0.02, w: 4.3, fontSize: 11, color: SLIDE_WHITE, fontFace: FONT_HEADING, bold: true, charSpacing: 2 });
      const bullets = q.items.slice(0, 7).map((item, i) => `${i + 1}. ${item}`).join('\n');
      slide.addText(bullets || 'None identified', {
        x: q.x + 0.15, y: q.y + 0.38, w: 4.35, h: 1.45,
        fontSize: 11, color: SLIDE_TEXT, fontFace: FONT_BODY, valign: 'top', lineSpacingMultiple: 1.35,
      });
    }
    addSlideFooter(slide, pptx);
  }

  // 5. Strategic Recommendations
  if (s.strategicRecommendations.length > 0) {
    const highImpact = s.strategicRecommendations.filter((r) => r.impact === 'high');
    const otherRecs = s.strategicRecommendations.filter((r) => r.impact !== 'high');

    highImpact.forEach((rec, idx) => {
      const slide = pptx.addSlide();
      slide.background = { color: SLIDE_BG };
      slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: SLIDE_RED } });
      slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.06, h: 5.63, fill: { color: SLIDE_RED } });
      slide.addText(`HIGH IMPACT  ·  Recommendation ${idx + 1}`, {
        x: 0.6, y: 0.3, w: 9, fontSize: 12, color: SLIDE_RED, fontFace: FONT_HEADING, bold: true, charSpacing: 2,
      });
      slide.addText(rec.title, { x: 0.6, y: 0.8, w: 8.5, fontSize: 28, color: SLIDE_TEXT, fontFace: FONT_HEADING, bold: true });
      slide.addShape(pptx.ShapeType.rect, { x: 0.6, y: 1.5, w: 1.0, h: 0.035, fill: { color: SLIDE_RED } });
      slide.addShape(pptx.ShapeType.roundRect, {
        x: 0.5, y: 1.75, w: 9, h: 2.8,
        fill: { color: SLIDE_BG2 }, line: { color: 'E5E7EB', width: 0.5 }, rectRadius: 0.08,
      });
      slide.addText(rec.description, {
        x: 0.8, y: 1.9, w: 8.4, h: 2.5,
        fontSize: 14, color: SLIDE_TEXT, fontFace: FONT_BODY, valign: 'top', lineSpacingMultiple: 1.4,
      });
      // Owner & expected outcome
      slide.addText(`Owner: ${rec.owner}  ·  Expected: ${rec.expectedOutcome}`, {
        x: 0.8, y: 4.6, w: 8.4, fontSize: 10, color: SLIDE_MUTED, fontFace: FONT_BODY,
      });
      addSlideFooter(slide, pptx);
    });

    if (otherRecs.length > 0) {
      pptxSectionSlides(
        pptx,
        'Additional Recommendations',
        otherRecs.map((r) => `[${r.impact.toUpperCase()}] ${r.title}: ${r.description}`),
        SLIDE_CYAN,
        { numbered: true },
      );
    }
  }

  // 6. Risks & Open Questions
  if (s.keyRisks.length > 0) {
    pptxSectionSlides(pptx, 'Key Risks', s.keyRisks, SLIDE_RED);
  }
  if (s.openQuestionsForFounders.length > 0) {
    pptxSectionSlides(pptx, 'Open Questions for Founders', s.openQuestionsForFounders, SLIDE_AMBER);
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

/* ── Strategy Lab v2: DOCX ─────────────────── */

export async function exportStrategyLabDOCX(record: StrategyAnalysisRecord): Promise<Buffer> {
  const s = record.synthesis;
  const typeLabel = record.analysis_type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  const children: (Paragraph | Table)[] = [];

  // Branded header
  children.push(new Paragraph({
    spacing: { after: 60 },
    children: [new TextRun({ text: 'G L Y P H O R   A I', bold: true, size: 20, color: '00B4D8', font: 'Segoe UI' })],
  }));
  children.push(new Paragraph({
    spacing: { after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '00B4D8', space: 6 } },
    children: [],
  }));

  // Title block
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
      new TextRun({ text: `  ·  Sources: ${record.total_sources}`, size: 18, color: '888888', font: 'Segoe UI' }),
      new TextRun({ text: `  ·  Searches: ${record.total_searches}`, size: 18, color: '888888', font: 'Segoe UI' }),
      new TextRun({ text: `  ·  Date: ${new Date(record.created_at).toLocaleDateString()}`, size: 18, color: '888888', font: 'Segoe UI' }),
    ],
  }));

  if (!s) {
    children.push(new Paragraph({ children: [new TextRun({ text: 'Report not yet generated.', italics: true })] }));
    return Packer.toBuffer(new Document({ sections: [{ children }] }));
  }

  // Executive Summary
  children.push(...docxSectionHeading('Executive Summary', '00B4D8'));
  for (const para of s.executiveSummary.split('\n').filter(Boolean)) {
    children.push(new Paragraph({
      spacing: { after: 160 },
      children: [new TextRun({ text: para, size: 22, font: 'Segoe UI', color: '2D2D2D' })],
    }));
  }

  // Cross-Framework Insights
  if (s.crossFrameworkInsights.length > 0) {
    children.push(...docxSectionHeading('Cross-Framework Insights', 'D97706'));
    for (const insight of s.crossFrameworkInsights) {
      children.push(docxBulletItem(insight, '3D3D3D'));
    }
  }

  // SWOT Table
  children.push(...docxSectionHeading('SWOT Analysis', '1A1A2E'));
  const swotData: [string, string[], string][] = [
    ['Strengths', s.unifiedSwot.strengths, '059669'],
    ['Weaknesses', s.unifiedSwot.weaknesses, 'DC2626'],
    ['Opportunities', s.unifiedSwot.opportunities, '0284C7'],
    ['Threats', s.unifiedSwot.threats, 'D97706'],
  ];
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
  children.push(new Table({ rows: swotRows, width: { size: 100, type: WidthType.PERCENTAGE } }));

  // Strategic Recommendations
  if (s.strategicRecommendations.length > 0) {
    children.push(...docxSectionHeading('Strategic Recommendations', '00B4D8'));
    const sorted = [...s.strategicRecommendations].sort((a, b) => {
      const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
      return (order[a.impact] ?? 2) - (order[b.impact] ?? 2);
    });
    for (let i = 0; i < sorted.length; i++) {
      const rec = sorted[i];
      const impactColor = rec.impact === 'high' ? 'DC2626' : rec.impact === 'medium' ? 'D97706' : '2563EB';
      children.push(new Paragraph({
        spacing: { before: 240, after: 80 },
        children: [
          new TextRun({ text: `${i + 1}. `, bold: true, size: 22, color: '00B4D8', font: 'Segoe UI' }),
          new TextRun({ text: rec.title, bold: true, size: 22, font: 'Segoe UI', color: '1A1A2E' }),
          new TextRun({ text: `  [${rec.impact.toUpperCase()} IMPACT]`, bold: true, size: 18, color: impactColor, font: 'Segoe UI' }),
        ],
      }));
      children.push(new Paragraph({
        spacing: { after: 60 },
        indent: { left: convertInchesToTwip(0.3) },
        children: [new TextRun({ text: rec.description, size: 21, color: '444444', font: 'Segoe UI' })],
      }));
      children.push(new Paragraph({
        spacing: { after: 40 },
        indent: { left: convertInchesToTwip(0.3) },
        children: [
          new TextRun({ text: 'Owner: ', bold: true, size: 18, color: '666666', font: 'Segoe UI' }),
          new TextRun({ text: rec.owner, size: 18, color: '333333', font: 'Segoe UI' }),
          new TextRun({ text: '  ·  Expected: ', bold: true, size: 18, color: '666666', font: 'Segoe UI' }),
          new TextRun({ text: rec.expectedOutcome, size: 18, color: '333333', font: 'Segoe UI' }),
        ],
      }));
      children.push(new Paragraph({
        spacing: { after: 120 },
        indent: { left: convertInchesToTwip(0.3) },
        children: [new TextRun({ text: `Risk if not: ${rec.riskIfNot}`, size: 18, color: 'DC2626', font: 'Segoe UI' })],
      }));
    }
  }

  // Key Risks
  if (s.keyRisks.length > 0) {
    children.push(...docxSectionHeading('Key Risks', 'DC2626'));
    for (const risk of s.keyRisks) {
      children.push(docxBulletItem(risk, '555555'));
    }
  }

  // Open Questions
  if (s.openQuestionsForFounders.length > 0) {
    children.push(...docxSectionHeading('Open Questions for Founders', 'D97706'));
    for (const q of s.openQuestionsForFounders) {
      children.push(docxBulletItem(q, '555555'));
    }
  }

  // Footer
  children.push(new Paragraph({
    spacing: { before: 600 },
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: '00B4D8', space: 12 } },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: `Glyphor AI  ·  Strategy Lab  ·  ${new Date().toLocaleDateString()}  ·  Confidential`, size: 16, color: '999999', font: 'Segoe UI' })],
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

/* ── Strategy Lab v2: Visual Prompt ────────── */

export function buildStrategyLabVisualPrompt(record: StrategyAnalysisRecord): string {
  const s = record.synthesis;
  if (!s) return '';

  const typeLabel = record.analysis_type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  // Extract top findings for the infographic
  const topStrengths = s.unifiedSwot.strengths.slice(0, 3).map(t => truncate(t, 60));
  const topThreats = s.unifiedSwot.threats.slice(0, 2).map(t => truncate(t, 60));
  const topRecs = s.strategicRecommendations.slice(0, 4);
  const topInsights = s.crossFrameworkInsights.slice(0, 3).map(t => truncate(t, 70));
  const topRisks = s.keyRisks.slice(0, 3).map(t => truncate(t, 60));
  const summaryShort = truncate(s.executiveSummary, 200);

  const recLines = topRecs.map((r, i) => {
    const impactColor = r.impact === 'high' ? 'red (#FB7185)' : r.impact === 'medium' ? 'amber (#FBBF24)' : 'blue (#60A5FA)';
    return `  ${i + 1}. "${truncate(r.title, 40)}" — ${impactColor} badge, owner: ${r.owner}`;
  }).join('\n');

  const sourceCount = record.total_sources;
  const searchCount = record.total_searches;
  const confidence = record.overall_confidence ?? 'medium';

  return [
    `Create a polished, McKinsey-quality executive strategy infographic in 16:9 landscape format (1536x1024px).`,
    `Style: modern flat design, white background, generous whitespace. Use bold typography, color-coded cards, and data callouts. This should read like a strategy consulting deliverable, not a generic chart.`,
    ``,
    `Color palette: cyan (#00E0FF), charcoal (#1A1A2E), emerald (#34D399), rose (#FB7185), amber (#FBBF24), soft gray (#F3F4F6) for backgrounds.`,
    ``,
    `LAYOUT:`,
    ``,
    `TOP BANNER (8%):`,
    `Full-width dark charcoal banner. Bold white title: "${typeLabel.toUpperCase()}". Subtitle in gray: "${truncate(record.query, 80)}". Right-aligned: "${sourceCount} sources · ${searchCount} searches · ${confidence} confidence".`,
    ``,
    `SECTION 1 — Executive Summary (20%):`,
    `A single wide card with a thin cyan left border. Inside, render this text in clean 14px charcoal type:`,
    `"${summaryShort}"`,
    ``,
    `SECTION 2 — Key Findings (35%), split into 2 columns:`,
    ``,
    `LEFT — "Strategic Advantages" (emerald header bar):`,
    `${topStrengths.map((s, i) => `  • ${s}`).join('\n')}`,
    `Show each as a short line with an emerald dot. Clean and readable.`,
    ``,
    `RIGHT — "Critical Insights" (cyan header bar):`,
    `${topInsights.map((s, i) => `  • ${s}`).join('\n')}`,
    `Show each as a short line with a cyan dot.`,
    ``,
    `SECTION 3 — Recommendations & Risks (30%), split into 2 columns:`,
    ``,
    `LEFT — "Strategic Actions" with color-coded priority badges:`,
    recLines,
    `Each recommendation is a card row with the priority badge, title, and owner.`,
    ``,
    `RIGHT — "Key Risks & Threats" (rose header bar):`,
    `${[...topThreats, ...topRisks].slice(0, 4).map(r => `  - ${r}`).join('\n')}`,
    `Show each as a short line with a rose warning icon.`,
    ``,
    `BOTTOM FOOTER (7%):`,
    `Thin gray strip. Left: "${record.depth} depth · ${record.analysis_type.replace(/_/g, ' ')}". Right: "Glyphor Strategy Lab"`,
    ``,
    `CRITICAL RULES:`,
    `- This infographic MUST contain REAL findings from the analysis — not just counts.`,
    `- Use short phrases (5-12 words each), not sentences or paragraphs.`,
    `- Maximum 120 words on the entire infographic.`,
    `- Professional consulting aesthetic: clean typography, color-coded sections, clear hierarchy.`,
    `- All text must be legible — minimum 11px equivalent, sans-serif.`,
    `- Do NOT include any "Powered by" branding.`,
  ].join('\n');
}

/** Truncate a string to maxLen chars, adding "…" if needed */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}

/* ══════════════════════════════════════════════════════
   Deep Dive Export Functions (McKinsey-Style)
   ══════════════════════════════════════════════════════ */

/* ── Deep Dive: Markdown ──────────────────── */

export function exportDeepDiveMarkdown(record: DeepDiveRecord): string {
  const r = record.report;
  const lines: string[] = [
    `# McKinsey-Style Deep Dive: ${record.target}`,
    '',
    `**Target:** ${record.target}`,
    `**Requested by:** ${record.requested_by}`,
    `**Created:** ${new Date(record.created_at).toLocaleString()}`,
    `**Status:** ${record.status}`,
    '',
  ];

  if (!r) {
    lines.push('*Report not yet generated.*');
    return lines.join('\n');
  }

  lines.push(
    `**Type:** ${r.targetType}`,
    `**Analysis Date:** ${r.analysisDate}`,
    '',
    '## Document Sources',
    `- SEC Filings: ${r.documentCounts.secFilings}`,
    `- News Articles: ${r.documentCounts.newsArticles}`,
    `- Patents: ${r.documentCounts.patents}`,
    `- Research Sources: ${r.documentCounts.researchSources}`,
    '',
  );

  // Current State
  lines.push('## Current State Assessment', '', `**Momentum:** ${r.currentState.momentum.toUpperCase()}`, '', '### Key Strengths');
  for (const s of r.currentState.keyStrengths) lines.push(`- **${s.point}**: ${s.evidence}`);
  lines.push('', '### Key Challenges');
  for (const c of r.currentState.keyChallenges) lines.push(`- **${c.point}**: ${c.evidence}`);

  const fs = r.currentState.financialSnapshot;
  if (fs.revenue || fs.funding) {
    lines.push('', '### Financial Snapshot');
    if (fs.revenue) lines.push(`- Revenue: ${fs.revenue}`);
    if (fs.revenueGrowth) lines.push(`- Revenue Growth: ${fs.revenueGrowth}`);
    if (fs.headcount) lines.push(`- Headcount: ${fs.headcount}`);
    if (fs.funding) lines.push(`- Funding: ${fs.funding}`);
    if (fs.valuation) lines.push(`- Valuation: ${fs.valuation}`);
    if (fs.profitability) lines.push(`- Profitability: ${fs.profitability}`);
  }
  lines.push('');

  // Company Overview
  lines.push('## Company Overview', '', r.overview.description, '', `- **Industry:** ${r.overview.industry}`);
  if (r.overview.founded) lines.push(`- **Founded:** ${r.overview.founded}`);
  if (r.overview.headquarters) lines.push(`- **Headquarters:** ${r.overview.headquarters}`);
  lines.push(`- **Business Model:** ${r.overview.businessModel}`, '', '### Leadership');
  for (const l of r.overview.leadership) lines.push(`- **${l.name}** — ${l.title}`);
  lines.push('', '### Products & Services');
  for (const p of r.overview.products) lines.push(`- **${p.name}**: ${p.description}`);
  lines.push('');

  // Market Analysis
  lines.push(
    '## Market Analysis', '',
    `| Metric | Value | Methodology |`,
    `|--------|-------|-------------|`,
    `| TAM | ${r.marketAnalysis.tam.value} | ${r.marketAnalysis.tam.methodology} |`,
    `| SAM | ${r.marketAnalysis.sam.value} | ${r.marketAnalysis.sam.methodology} |`,
    `| SOM | ${r.marketAnalysis.som.value} | ${r.marketAnalysis.som.methodology} |`,
    '', `**Growth Rate:** ${r.marketAnalysis.growthRate}`, '', '### Key Drivers',
  );
  for (const d of r.marketAnalysis.keyDrivers) lines.push(`- ${d}`);
  lines.push('', '### Key Trends');
  for (const t of r.marketAnalysis.keyTrends) lines.push(`- ${t}`);
  if (r.marketAnalysis.regulatoryFactors.length > 0) {
    lines.push('', '### Regulatory Factors');
    for (const f of r.marketAnalysis.regulatoryFactors) lines.push(`- ${f}`);
  }
  lines.push('');

  // Competitive Landscape
  lines.push('## Competitive Landscape', '', "### Porter's Five Forces", '');
  const pf = r.competitiveLandscape.portersFiveForces;
  lines.push(
    `| Force | Score | Assessment |`,
    `|-------|-------|-----------|`,
    `| Threat of New Entrants | ${pf.threatOfNewEntrants.score}/5 | ${pf.threatOfNewEntrants.reasoning} |`,
    `| Buyer Power | ${pf.bargainingPowerBuyers.score}/5 | ${pf.bargainingPowerBuyers.reasoning} |`,
    `| Supplier Power | ${pf.bargainingPowerSuppliers.score}/5 | ${pf.bargainingPowerSuppliers.reasoning} |`,
    `| Substitutes | ${pf.threatOfSubstitutes.score}/5 | ${pf.threatOfSubstitutes.reasoning} |`,
    `| Rivalry | ${pf.competitiveRivalry.score}/5 | ${pf.competitiveRivalry.reasoning} |`,
    '', `**Competitive Advantage:** ${r.competitiveLandscape.competitiveAdvantage}`, '', '### Competitors',
  );
  for (const c of r.competitiveLandscape.competitors) {
    lines.push(`#### ${c.name}`, `- Positioning: ${c.positioning}`, `- Key Differentiator: ${c.keyDifferentiator}`);
    if (c.estimatedRevenue) lines.push(`- Est. Revenue: ${c.estimatedRevenue}`);
    lines.push(`- Strengths: ${c.strengths.join(', ')}`, `- Weaknesses: ${c.weaknesses.join(', ')}`, '');
  }

  // Strategic Recommendations
  lines.push('## Strategic Recommendations', '');
  for (const rec of r.strategicRecommendations) {
    lines.push(`### ${rec.title} [${rec.priority.toUpperCase()}]`, '', rec.description);
    lines.push(`- **Expected Impact:** ${rec.expectedImpact}`, `- **Investment:** ${rec.investmentRequired}`, `- **Risk Level:** ${rec.riskLevel}`, '', '**Steps:**');
    for (const step of rec.implementationSteps) lines.push(`1. ${step}`);
    lines.push('');
  }

  // Implementation Roadmap
  lines.push('## Implementation Roadmap', '');
  for (const phase of r.implementationRoadmap) {
    lines.push(`### ${phase.phase} (${phase.timeline})`, `- Resources: ${phase.resources}`, `- Cost: ${phase.cost}`, '', '**Milestones:**');
    for (const m of phase.milestones) lines.push(`- [ ] ${m}`);
    lines.push('');
  }

  // ROI Analysis
  lines.push('## ROI Analysis', '');
  for (const scenario of r.roiAnalysis) {
    lines.push(`### ${scenario.scenario.charAt(0).toUpperCase() + scenario.scenario.slice(1)} Case`);
    if (scenario.paybackPeriod) lines.push(`- Payback Period: ${scenario.paybackPeriod}`);
    if (scenario.irr) lines.push(`- IRR: ${scenario.irr}`);
    if (scenario.npv) lines.push(`- NPV: ${scenario.npv}`);
    lines.push('', '| Year | Revenue | Cost | Net Benefit |', '|------|---------|------|-------------|');
    for (const p of scenario.projections) lines.push(`| Year ${p.year} | ${p.revenue} | ${p.cost} | ${p.netBenefit} |`);
    lines.push('');
  }

  // Risk Assessment
  lines.push('## Risk Assessment', '', '| Risk | Probability | Impact | Mitigation | Owner |', '|------|-------------|--------|------------|-------|');
  for (const risk of r.riskAssessment) lines.push(`| ${risk.risk} | ${risk.probability} | ${risk.impact} | ${risk.mitigation} | ${risk.owner} |`);

  // Sources
  if (record.sources.length > 0) {
    lines.push('', '## Sources', '');
    for (const src of record.sources) lines.push(`- [${src.title}](${src.url}) — ${src.researchArea} (${new Date(src.retrievedAt).toLocaleDateString()})`);
  }

  return lines.join('\n');
}

/* ── Deep Dive: JSON ─────────────────────── */

export function exportDeepDiveJSON(record: DeepDiveRecord): string {
  return JSON.stringify({
    id: record.id,
    target: record.target,
    context: record.context,
    status: record.status,
    requested_by: record.requested_by,
    created_at: record.created_at,
    completed_at: record.completed_at,
    sources: record.sources,
    report: record.report,
  }, null, 2);
}

/* ── Deep Dive: PPTX ────────────────────── */

export async function exportDeepDivePPTX(record: DeepDiveRecord): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = 'Glyphor AI';
  pptx.title = `Deep Dive: ${record.target}`;

  const r = record.report;

  pptxTitleSlide(
    pptx, record.target,
    r ? `${r.targetType}  ·  McKinsey-Style Strategic Deep Dive` : 'Strategic Deep Dive',
    r ? `${r.analysisDate}  ·  ${r.documentCounts.researchSources} sources analyzed  ·  Glyphor AI` : `Glyphor AI`,
  );

  if (!r) {
    return (await pptx.write({ outputType: 'nodebuffer' })) as unknown as Buffer;
  }

  // Research Coverage slide
  {
    const slide = pptx.addSlide();
    slide.background = { color: SLIDE_BG };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: SLIDE_CYAN } });
    slide.addText('Research Coverage', { x: 0.6, y: 0.25, w: 9, fontSize: 24, color: SLIDE_CYAN, fontFace: FONT_HEADING, bold: true });
    slide.addShape(pptx.ShapeType.rect, { x: 0.6, y: 0.7, w: 1.2, h: 0.035, fill: { color: SLIDE_CYAN } });

    const counts = [
      { label: 'SEC Filings', val: String(r.documentCounts.secFilings), clr: SLIDE_CYAN },
      { label: 'News Articles', val: String(r.documentCounts.newsArticles), clr: SLIDE_GREEN },
      { label: 'Patents', val: String(r.documentCounts.patents), clr: SLIDE_AMBER },
      { label: 'Research Sources', val: String(r.documentCounts.researchSources), clr: SLIDE_ACCENT },
    ];
    counts.forEach((c, idx) => {
      const xPos = 0.5 + idx * 2.35;
      slide.addShape(pptx.ShapeType.roundRect, { x: xPos, y: 1.4, w: 2.1, h: 1.8, fill: { color: SLIDE_BG2 }, line: { color: c.clr, width: 2 }, rectRadius: 0.1 });
      slide.addText(c.val, { x: xPos, y: 1.5, w: 2.1, fontSize: 48, color: c.clr, fontFace: FONT_HEADING, bold: true, align: 'center' });
      slide.addText(c.label, { x: xPos, y: 2.5, w: 2.1, fontSize: 11, color: SLIDE_MUTED, fontFace: FONT_BODY, align: 'center' });
    });

    const momColor = r.currentState.momentum === 'positive' ? SLIDE_GREEN : r.currentState.momentum === 'negative' ? SLIDE_RED : SLIDE_AMBER;
    slide.addShape(pptx.ShapeType.roundRect, { x: 3.5, y: 3.8, w: 3.0, h: 0.6, fill: { color: SLIDE_BG2 }, line: { color: momColor, width: 1.5 }, rectRadius: 0.05 });
    slide.addText(`MOMENTUM: ${r.currentState.momentum.toUpperCase()}`, { x: 3.5, y: 3.8, w: 3.0, h: 0.6, fontSize: 14, color: momColor, fontFace: FONT_HEADING, bold: true, align: 'center', valign: 'middle' });
    addSlideFooter(slide, pptx);
  }

  // Current State slide
  {
    const slide = pptx.addSlide();
    slide.background = { color: SLIDE_BG };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: SLIDE_GREEN } });
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.06, h: 5.63, fill: { color: SLIDE_GREEN } });
    slide.addText('Current State Assessment', { x: 0.6, y: 0.25, w: 9, fontSize: 22, color: SLIDE_GREEN, fontFace: FONT_HEADING, bold: true });

    slide.addText('KEY STRENGTHS', { x: 0.5, y: 0.7, w: 4.5, fontSize: 10, color: SLIDE_GREEN, fontFace: FONT_HEADING, bold: true, charSpacing: 2 });
    r.currentState.keyStrengths.slice(0, 4).forEach((s, idx) => {
      const yPos = 1.0 + idx * 0.95;
      slide.addShape(pptx.ShapeType.roundRect, { x: 0.5, y: yPos, w: 4.5, h: 0.85, fill: { color: SLIDE_BG2 }, line: { color: '30363D', width: 0.5 }, rectRadius: 0.05 });
      slide.addText(s.point, { x: 0.7, y: yPos + 0.05, w: 4.1, fontSize: 11, color: SLIDE_WHITE, fontFace: FONT_HEADING, bold: true });
      slide.addText(truncate(s.evidence, 100), { x: 0.7, y: yPos + 0.35, w: 4.1, fontSize: 9, color: SLIDE_MUTED, fontFace: FONT_BODY, lineSpacingMultiple: 1.2 });
    });

    slide.addText('KEY CHALLENGES', { x: 5.2, y: 0.7, w: 4.5, fontSize: 10, color: SLIDE_RED, fontFace: FONT_HEADING, bold: true, charSpacing: 2 });
    r.currentState.keyChallenges.slice(0, 4).forEach((c, idx) => {
      const yPos = 1.0 + idx * 0.95;
      slide.addShape(pptx.ShapeType.roundRect, { x: 5.2, y: yPos, w: 4.5, h: 0.85, fill: { color: SLIDE_BG2 }, line: { color: '30363D', width: 0.5 }, rectRadius: 0.05 });
      slide.addText(c.point, { x: 5.4, y: yPos + 0.05, w: 4.1, fontSize: 11, color: SLIDE_WHITE, fontFace: FONT_HEADING, bold: true });
      slide.addText(truncate(c.evidence, 100), { x: 5.4, y: yPos + 0.35, w: 4.1, fontSize: 9, color: SLIDE_MUTED, fontFace: FONT_BODY, lineSpacingMultiple: 1.2 });
    });
    addSlideFooter(slide, pptx);
  }

  // Market Analysis slide
  {
    const slide = pptx.addSlide();
    slide.background = { color: SLIDE_BG };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: SLIDE_CYAN } });
    slide.addText('Market Analysis', { x: 0.6, y: 0.25, w: 9, fontSize: 22, color: SLIDE_CYAN, fontFace: FONT_HEADING, bold: true });
    slide.addShape(pptx.ShapeType.rect, { x: 0.6, y: 0.65, w: 1.0, h: 0.035, fill: { color: SLIDE_CYAN } });

    const sizing = [
      { label: 'TAM', val: r.marketAnalysis.tam.value, desc: r.marketAnalysis.tam.methodology },
      { label: 'SAM', val: r.marketAnalysis.sam.value, desc: r.marketAnalysis.sam.methodology },
      { label: 'SOM', val: r.marketAnalysis.som.value, desc: r.marketAnalysis.som.methodology },
    ];
    sizing.forEach((s, idx) => {
      const xPos = 0.3 + idx * 3.2;
      slide.addShape(pptx.ShapeType.roundRect, { x: xPos, y: 0.9, w: 3.0, h: 1.5, fill: { color: SLIDE_BG2 }, line: { color: SLIDE_CYAN, width: 1 }, rectRadius: 0.08 });
      slide.addText(s.label, { x: xPos, y: 0.95, w: 3.0, fontSize: 12, color: SLIDE_MUTED, fontFace: FONT_HEADING, bold: true, align: 'center', charSpacing: 3 });
      slide.addText(s.val, { x: xPos, y: 1.25, w: 3.0, fontSize: 24, color: SLIDE_CYAN, fontFace: FONT_HEADING, bold: true, align: 'center' });
      slide.addText(truncate(s.desc, 80), { x: xPos + 0.15, y: 1.75, w: 2.7, fontSize: 8, color: SLIDE_MUTED, fontFace: FONT_BODY, align: 'center', lineSpacingMultiple: 1.2 });
    });

    slide.addText(`Growth Rate: ${r.marketAnalysis.growthRate}`, { x: 0.6, y: 2.6, w: 9, fontSize: 14, color: SLIDE_GREEN, fontFace: FONT_HEADING, bold: true });

    const drivers = r.marketAnalysis.keyDrivers.slice(0, 3).map((d) => `● ${d}`).join('\n');
    slide.addShape(pptx.ShapeType.roundRect, { x: 0.3, y: 3.0, w: 4.6, h: 1.6, fill: { color: SLIDE_BG2 }, line: { color: '30363D', width: 0.5 }, rectRadius: 0.05 });
    slide.addText('KEY DRIVERS', { x: 0.5, y: 3.05, w: 4.2, fontSize: 9, color: SLIDE_AMBER, fontFace: FONT_HEADING, bold: true, charSpacing: 2 });
    slide.addText(drivers, { x: 0.5, y: 3.35, w: 4.2, fontSize: 10, color: SLIDE_TEXT, fontFace: FONT_BODY, lineSpacingMultiple: 1.4 });

    const trends = r.marketAnalysis.keyTrends.slice(0, 3).map((t) => `● ${t}`).join('\n');
    slide.addShape(pptx.ShapeType.roundRect, { x: 5.1, y: 3.0, w: 4.6, h: 1.6, fill: { color: SLIDE_BG2 }, line: { color: '30363D', width: 0.5 }, rectRadius: 0.05 });
    slide.addText('KEY TRENDS', { x: 5.3, y: 3.05, w: 4.2, fontSize: 9, color: SLIDE_CYAN, fontFace: FONT_HEADING, bold: true, charSpacing: 2 });
    slide.addText(trends, { x: 5.3, y: 3.35, w: 4.2, fontSize: 10, color: SLIDE_TEXT, fontFace: FONT_BODY, lineSpacingMultiple: 1.4 });
    addSlideFooter(slide, pptx);
  }

  // Porter's Five Forces slide
  {
    const slide = pptx.addSlide();
    slide.background = { color: SLIDE_BG };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: SLIDE_AMBER } });
    slide.addText("Competitive Landscape: Porter's Five Forces", { x: 0.6, y: 0.25, w: 9, fontSize: 20, color: SLIDE_AMBER, fontFace: FONT_HEADING, bold: true });

    const forces = [
      { label: 'New Entrants', ...r.competitiveLandscape.portersFiveForces.threatOfNewEntrants },
      { label: 'Buyer Power', ...r.competitiveLandscape.portersFiveForces.bargainingPowerBuyers },
      { label: 'Supplier Power', ...r.competitiveLandscape.portersFiveForces.bargainingPowerSuppliers },
      { label: 'Substitutes', ...r.competitiveLandscape.portersFiveForces.threatOfSubstitutes },
      { label: 'Rivalry', ...r.competitiveLandscape.portersFiveForces.competitiveRivalry },
    ];
    forces.forEach((f, idx) => {
      const yPos = 0.8 + idx * 0.85;
      const forceColor = f.score >= 4 ? SLIDE_RED : f.score >= 3 ? SLIDE_AMBER : SLIDE_GREEN;
      slide.addShape(pptx.ShapeType.roundRect, { x: 0.5, y: yPos, w: 9.0, h: 0.75, fill: { color: SLIDE_BG2 }, line: { color: '30363D', width: 0.5 }, rectRadius: 0.05 });
      slide.addText(f.label, { x: 0.7, y: yPos + 0.05, w: 2.0, fontSize: 12, color: SLIDE_WHITE, fontFace: FONT_HEADING, bold: true });
      const barWidth = (f.score / 5) * 3.0;
      slide.addShape(pptx.ShapeType.rect, { x: 2.8, y: yPos + 0.2, w: 3.0, h: 0.35, fill: { color: '21262D' } });
      slide.addShape(pptx.ShapeType.rect, { x: 2.8, y: yPos + 0.2, w: barWidth, h: 0.35, fill: { color: forceColor } });
      slide.addText(`${f.score}/5`, { x: 6.0, y: yPos + 0.15, w: 0.8, fontSize: 14, color: forceColor, fontFace: FONT_HEADING, bold: true });
      slide.addText(truncate(f.reasoning, 80), { x: 6.8, y: yPos + 0.15, w: 2.5, fontSize: 8.5, color: SLIDE_MUTED, fontFace: FONT_BODY, lineSpacingMultiple: 1.2 });
    });
    addSlideFooter(slide, pptx);
  }

  // Competitors
  if (r.competitiveLandscape.competitors.length > 0) {
    const compItems = r.competitiveLandscape.competitors.map((c) =>
      `${c.name}  —  ${c.positioning}  ·  Differentiator: ${c.keyDifferentiator}`
    );
    pptxSectionSlides(pptx, 'Key Competitors', compItems, SLIDE_AMBER);
  }

  // Strategic Recommendations
  for (const rec of r.strategicRecommendations) {
    const slide = pptx.addSlide();
    slide.background = { color: SLIDE_BG };
    const priColor = rec.priority === 'immediate' ? SLIDE_RED : rec.priority === 'short-term' ? SLIDE_AMBER : SLIDE_CYAN;
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: priColor } });
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.06, h: 5.63, fill: { color: priColor } });
    slide.addText(`RECOMMENDATION  ·  ${rec.priority.toUpperCase()}`, { x: 0.6, y: 0.2, w: 9, fontSize: 10, color: priColor, fontFace: FONT_HEADING, bold: true, charSpacing: 2 });
    slide.addText(rec.title, { x: 0.6, y: 0.5, w: 8.5, fontSize: 24, color: SLIDE_WHITE, fontFace: FONT_HEADING, bold: true });
    slide.addShape(pptx.ShapeType.rect, { x: 0.6, y: 1.05, w: 1.0, h: 0.035, fill: { color: priColor } });

    slide.addShape(pptx.ShapeType.roundRect, { x: 0.5, y: 1.3, w: 9.0, h: 1.8, fill: { color: SLIDE_BG2 }, line: { color: '30363D', width: 0.5 }, rectRadius: 0.06 });
    slide.addText(truncate(rec.description, 400), { x: 0.7, y: 1.4, w: 8.6, h: 1.6, fontSize: 12, color: SLIDE_TEXT, fontFace: FONT_BODY, valign: 'top', lineSpacingMultiple: 1.3 });

    const kpis = [
      { label: 'Impact', val: truncate(rec.expectedImpact, 30), clr: SLIDE_GREEN },
      { label: 'Investment', val: truncate(rec.investmentRequired, 30), clr: SLIDE_CYAN },
      { label: 'Risk', val: rec.riskLevel.toUpperCase(), clr: rec.riskLevel === 'high' ? SLIDE_RED : rec.riskLevel === 'medium' ? SLIDE_AMBER : SLIDE_GREEN },
    ];
    kpis.forEach((k, kIdx) => {
      const xPos = 0.5 + kIdx * 3.1;
      slide.addShape(pptx.ShapeType.roundRect, { x: xPos, y: 3.3, w: 2.9, h: 0.6, fill: { color: SLIDE_BG2 }, line: { color: k.clr, width: 1 }, rectRadius: 0.05 });
      slide.addText(k.label, { x: xPos, y: 3.3, w: 2.9, h: 0.25, fontSize: 8, color: SLIDE_MUTED, fontFace: FONT_HEADING, align: 'center', charSpacing: 2 });
      slide.addText(k.val, { x: xPos, y: 3.55, w: 2.9, h: 0.3, fontSize: 11, color: k.clr, fontFace: FONT_HEADING, bold: true, align: 'center' });
    });

    if (rec.implementationSteps.length > 0) {
      const steps = rec.implementationSteps.slice(0, 4).map((s, i) => `${i + 1}. ${s}`).join('\n');
      slide.addText('Implementation Steps', { x: 0.6, y: 4.1, w: 4, fontSize: 9, color: SLIDE_MUTED, fontFace: FONT_HEADING, charSpacing: 2 });
      slide.addText(steps, { x: 0.7, y: 4.35, w: 8.6, fontSize: 10, color: SLIDE_TEXT, fontFace: FONT_BODY, lineSpacingMultiple: 1.3 });
    }
    addSlideFooter(slide, pptx);
  }

  // Implementation Roadmap
  if (r.implementationRoadmap.length > 0) {
    const items = r.implementationRoadmap.map((p) => `${p.phase} (${p.timeline})  —  Cost: ${p.cost}  ·  ${p.milestones.length} milestones`);
    pptxSectionSlides(pptx, 'Implementation Roadmap', items, SLIDE_CYAN, { numbered: true });
  }

  // Risk Assessment
  if (r.riskAssessment.length > 0) {
    const items = r.riskAssessment.map((risk) => `[${risk.probability.toUpperCase()} / ${risk.impact.toUpperCase()}] ${risk.risk}  —  ${truncate(risk.mitigation, 80)}`);
    pptxSectionSlides(pptx, 'Risk Assessment', items, SLIDE_RED);
  }

  // Closing
  {
    const slide = pptx.addSlide();
    slide.background = { color: SLIDE_BG };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 2.6, w: 10, h: 0.04, fill: { color: SLIDE_CYAN } });
    slide.addText('G L Y P H O R   A I', { x: 0.6, y: 1.8, w: 8.8, fontSize: 28, color: SLIDE_CYAN, fontFace: FONT_HEADING, bold: true, align: 'center', charSpacing: 6 });
    slide.addText('Strategic Deep Dive Complete', { x: 0.6, y: 2.9, w: 8.8, fontSize: 14, color: SLIDE_MUTED, fontFace: FONT_BODY, align: 'center' });
    slide.addText(`${r.documentCounts.researchSources} sources analyzed  ·  ${new Date().toLocaleDateString()}  ·  Confidential`, { x: 0.6, y: 3.5, w: 8.8, fontSize: 10, color: SLIDE_MUTED, fontFace: FONT_BODY, align: 'center' });
    addSlideFooter(slide, pptx);
  }

  return (await pptx.write({ outputType: 'nodebuffer' })) as unknown as Buffer;
}

/* ── Deep Dive: DOCX ────────────────────── */

export async function exportDeepDiveDOCX(record: DeepDiveRecord): Promise<Buffer> {
  const r = record.report;
  const children: (Paragraph | Table)[] = [];

  // Branded header
  children.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: 'G L Y P H O R   A I', bold: true, size: 20, color: '00B4D8', font: 'Segoe UI' })] }));
  children.push(new Paragraph({ spacing: { after: 120 }, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '00B4D8', space: 6 } }, children: [] }));

  // Title
  children.push(new Paragraph({ spacing: { before: 200, after: 40 }, children: [new TextRun({ text: 'McKinsey-Style Strategic Deep Dive', size: 20, color: '00B4D8', font: 'Segoe UI', bold: true })] }));
  children.push(new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: record.target, bold: true, size: 52, font: 'Segoe UI', color: '1A1A2E' })] }));
  children.push(new Paragraph({
    spacing: { after: 400 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD', space: 12 } },
    children: [
      new TextRun({ text: r ? `${r.targetType}  ·  ` : '', size: 18, color: '888888', font: 'Segoe UI' }),
      new TextRun({ text: `Date: ${new Date(record.created_at).toLocaleDateString()}`, size: 18, color: '888888', font: 'Segoe UI' }),
      new TextRun({ text: r ? `  ·  ${r.documentCounts.researchSources} sources analyzed` : '', size: 18, color: '888888', font: 'Segoe UI' }),
    ],
  }));

  if (!r) {
    children.push(new Paragraph({ children: [new TextRun({ text: 'Report not yet generated.', italics: true })] }));
    return Packer.toBuffer(new Document({ sections: [{ children: children as Paragraph[] }] }));
  }

  // Current State Assessment
  children.push(...docxSectionHeading('Current State Assessment', '059669'));
  const momColor = r.currentState.momentum === 'positive' ? '059669' : r.currentState.momentum === 'negative' ? 'DC2626' : 'D97706';
  children.push(new Paragraph({
    spacing: { after: 200 },
    children: [
      new TextRun({ text: 'Momentum: ', bold: true, size: 22, font: 'Segoe UI', color: '333333' }),
      new TextRun({ text: r.currentState.momentum.toUpperCase(), bold: true, size: 24, font: 'Segoe UI', color: momColor }),
    ],
  }));

  children.push(new Paragraph({ spacing: { before: 160, after: 80 }, children: [new TextRun({ text: 'Key Strengths', bold: true, size: 22, color: '059669', font: 'Segoe UI' })] }));
  for (const s of r.currentState.keyStrengths) {
    children.push(new Paragraph({
      bullet: { level: 0 }, spacing: { after: 60 },
      children: [
        new TextRun({ text: `${s.point}: `, bold: true, size: 20, font: 'Segoe UI', color: '333333' }),
        new TextRun({ text: s.evidence, size: 20, font: 'Segoe UI', color: '555555' }),
      ],
    }));
  }

  children.push(new Paragraph({ spacing: { before: 160, after: 80 }, children: [new TextRun({ text: 'Key Challenges', bold: true, size: 22, color: 'DC2626', font: 'Segoe UI' })] }));
  for (const c of r.currentState.keyChallenges) {
    children.push(new Paragraph({
      bullet: { level: 0 }, spacing: { after: 60 },
      children: [
        new TextRun({ text: `${c.point}: `, bold: true, size: 20, font: 'Segoe UI', color: '333333' }),
        new TextRun({ text: c.evidence, size: 20, font: 'Segoe UI', color: '555555' }),
      ],
    }));
  }

  // Company Overview
  children.push(...docxSectionHeading('Company Overview', '00B4D8'));
  children.push(new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: r.overview.description, size: 22, font: 'Segoe UI', color: '2D2D2D' })] }));
  const facts = [`Industry: ${r.overview.industry}`, r.overview.founded ? `Founded: ${r.overview.founded}` : '', r.overview.headquarters ? `Headquarters: ${r.overview.headquarters}` : '', `Business Model: ${r.overview.businessModel}`].filter(Boolean);
  for (const fact of facts) children.push(docxBulletItem(fact));

  // Market Analysis TAM/SAM/SOM table
  children.push(...docxSectionHeading('Market Analysis', '00B4D8'));
  const mktHeader = ['Metric', 'Value', 'Methodology'].map((label) =>
    new TableCell({ shading: { fill: '1A1A2E', type: ShadingType.CLEAR, color: 'FFFFFF' }, margins: { top: 60, bottom: 60, left: 80, right: 80 }, children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 18, color: 'FFFFFF', font: 'Segoe UI' })] })] })
  );
  const mktRows = [
    { m: 'TAM', ...r.marketAnalysis.tam },
    { m: 'SAM', ...r.marketAnalysis.sam },
    { m: 'SOM', ...r.marketAnalysis.som },
  ].map((row) => new TableRow({
    children: [
      new TableCell({ margins: { top: 50, bottom: 50, left: 80, right: 80 }, children: [new Paragraph({ children: [new TextRun({ text: row.m, bold: true, size: 20, font: 'Segoe UI', color: '00B4D8' })] })] }),
      new TableCell({ margins: { top: 50, bottom: 50, left: 80, right: 80 }, children: [new Paragraph({ children: [new TextRun({ text: row.value, bold: true, size: 20, font: 'Segoe UI', color: '333333' })] })] }),
      new TableCell({ margins: { top: 50, bottom: 50, left: 80, right: 80 }, children: [new Paragraph({ children: [new TextRun({ text: row.methodology, size: 18, font: 'Segoe UI', color: '666666' })] })] }),
    ],
  }));
  children.push(new Table({ rows: [new TableRow({ children: mktHeader }), ...mktRows], width: { size: 100, type: WidthType.PERCENTAGE } }));

  children.push(new Paragraph({
    spacing: { before: 200, after: 120 },
    children: [
      new TextRun({ text: 'Growth Rate: ', bold: true, size: 22, font: 'Segoe UI', color: '333333' }),
      new TextRun({ text: r.marketAnalysis.growthRate, size: 22, font: 'Segoe UI', color: '059669' }),
    ],
  }));

  // Strategic Recommendations
  if (r.strategicRecommendations.length > 0) {
    children.push(...docxSectionHeading('Strategic Recommendations', '00B4D8'));
    r.strategicRecommendations.forEach((rec, i) => {
      const priColor = rec.priority === 'immediate' ? 'DC2626' : rec.priority === 'short-term' ? 'D97706' : '2563EB';
      children.push(new Paragraph({
        spacing: { before: 240, after: 80 },
        children: [
          new TextRun({ text: `${i + 1}. `, bold: true, size: 22, color: '00B4D8', font: 'Segoe UI' }),
          new TextRun({ text: rec.title, bold: true, size: 22, font: 'Segoe UI', color: '1A1A2E' }),
          new TextRun({ text: `  [${rec.priority.toUpperCase()}]`, bold: true, size: 18, color: priColor, font: 'Segoe UI' }),
        ],
      }));
      children.push(new Paragraph({ spacing: { after: 80 }, indent: { left: convertInchesToTwip(0.3) }, children: [new TextRun({ text: rec.description, size: 20, color: '444444', font: 'Segoe UI' })] }));
      children.push(new Paragraph({
        spacing: { after: 60 }, indent: { left: convertInchesToTwip(0.3) },
        children: [
          new TextRun({ text: `Impact: ${rec.expectedImpact}`, size: 18, color: '059669', font: 'Segoe UI' }),
          new TextRun({ text: `  ·  Investment: ${rec.investmentRequired}`, size: 18, color: '666666', font: 'Segoe UI' }),
          new TextRun({ text: `  ·  Risk: ${rec.riskLevel}`, size: 18, color: priColor, font: 'Segoe UI' }),
        ],
      }));
    });
  }

  // Risk Assessment as table
  if (r.riskAssessment.length > 0) {
    children.push(...docxSectionHeading('Risk Assessment', 'DC2626'));
    const riskHeader = ['Risk', 'Probability', 'Impact', 'Mitigation', 'Owner'].map((label) =>
      new TableCell({ shading: { fill: '1A1A2E', type: ShadingType.CLEAR, color: 'FFFFFF' }, margins: { top: 60, bottom: 60, left: 80, right: 80 }, children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 16, color: 'FFFFFF', font: 'Segoe UI' })] })] })
    );
    const riskRows = r.riskAssessment.map((risk) => {
      const probColor = risk.probability === 'high' ? 'DC2626' : risk.probability === 'medium' ? 'D97706' : '059669';
      return new TableRow({
        children: [
          new TableCell({ margins: { top: 50, bottom: 50, left: 80, right: 80 }, children: [new Paragraph({ children: [new TextRun({ text: risk.risk, size: 18, font: 'Segoe UI', color: '333333' })] })] }),
          new TableCell({ margins: { top: 50, bottom: 50, left: 80, right: 80 }, children: [new Paragraph({ children: [new TextRun({ text: risk.probability.toUpperCase(), bold: true, size: 16, font: 'Segoe UI', color: probColor })] })] }),
          new TableCell({ margins: { top: 50, bottom: 50, left: 80, right: 80 }, children: [new Paragraph({ children: [new TextRun({ text: risk.impact.toUpperCase(), bold: true, size: 16, font: 'Segoe UI', color: probColor })] })] }),
          new TableCell({ margins: { top: 50, bottom: 50, left: 80, right: 80 }, children: [new Paragraph({ children: [new TextRun({ text: risk.mitigation, size: 17, font: 'Segoe UI', color: '555555' })] })] }),
          new TableCell({ margins: { top: 50, bottom: 50, left: 80, right: 80 }, children: [new Paragraph({ children: [new TextRun({ text: risk.owner, size: 17, font: 'Segoe UI', color: '666666' })] })] }),
        ],
      });
    });
    children.push(new Table({ rows: [new TableRow({ children: riskHeader }), ...riskRows], width: { size: 100, type: WidthType.PERCENTAGE } }));
  }

  // Footer
  children.push(new Paragraph({
    spacing: { before: 600 },
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: '00B4D8', space: 12 } },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: `Glyphor AI  ·  Strategic Deep Dive  ·  ${new Date().toLocaleDateString()}  ·  Confidential`, size: 16, color: '999999', font: 'Segoe UI' })],
  }));

  return Packer.toBuffer(new Document({
    creator: 'Glyphor AI',
    title: `Deep Dive: ${record.target}`,
    sections: [{
      properties: { page: { margin: { top: convertInchesToTwip(0.8), bottom: convertInchesToTwip(0.8), left: convertInchesToTwip(1.0), right: convertInchesToTwip(1.0) } } },
      children: children as Paragraph[],
    }],
  }));
}
