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
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType } from 'docx';

/* ── Shared PPTX theme ──────────────────────── */

const SLIDE_BG = '0D1117';
const SLIDE_TEXT = 'E6EDF3';
const SLIDE_MUTED = '8B949E';
const SLIDE_CYAN = '00E0FF';
const SLIDE_AMBER = 'FBBF24';
const SLIDE_GREEN = '34D399';
const SLIDE_RED = 'FB7185';
const SLIDE_ACCENT = '623CEA';

function pptxTitleSlide(pptx: PptxGenJS, title: string, subtitle: string, meta: string): void {
  const slide = pptx.addSlide();
  slide.background = { color: SLIDE_BG };
  slide.addText('GLYPHOR AI', { x: 0.5, y: 0.3, w: 9, fontSize: 11, color: SLIDE_CYAN, fontFace: 'Arial', bold: true, charSpacing: 4 });
  slide.addShape(pptx.ShapeType.rect, { x: 0.5, y: 0.6, w: 1.2, h: 0.03, fill: { color: SLIDE_CYAN } });
  slide.addText(title, { x: 0.5, y: 1.5, w: 9, fontSize: 32, color: SLIDE_TEXT, fontFace: 'Arial', bold: true });
  slide.addText(subtitle, { x: 0.5, y: 2.6, w: 9, fontSize: 16, color: SLIDE_MUTED, fontFace: 'Arial' });
  slide.addText(meta, { x: 0.5, y: 4.5, w: 9, fontSize: 10, color: SLIDE_MUTED, fontFace: 'Arial' });
}

function pptxSectionSlide(pptx: PptxGenJS, heading: string, items: string[], color: string): void {
  const slide = pptx.addSlide();
  slide.background = { color: SLIDE_BG };
  slide.addText(heading, { x: 0.5, y: 0.3, w: 9, fontSize: 20, color, fontFace: 'Arial', bold: true });
  slide.addShape(pptx.ShapeType.rect, { x: 0.5, y: 0.7, w: 0.8, h: 0.03, fill: { color } });
  const body = items.map((item) => ({ text: `• ${item}`, options: { fontSize: 13, color: SLIDE_TEXT, breakLine: true, paraSpaceBefore: 6, paraSpaceAfter: 2, fontFace: 'Arial' } as PptxGenJS.TextPropsOptions }));
  if (body.length > 0) slide.addText(body, { x: 0.5, y: 1.0, w: 9, h: 4.5, valign: 'top' });
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

  // Title slide
  pptxTitleSlide(pptx, typeLabel, record.query, `Depth: ${record.depth} · ${new Date(record.created_at).toLocaleDateString()}`);

  if (!report) {
    const slide = pptx.addSlide();
    slide.background = { color: SLIDE_BG };
    slide.addText('Report not yet generated.', { x: 1, y: 2, w: 8, fontSize: 18, color: SLIDE_MUTED, fontFace: 'Arial', align: 'center' });
    return (await pptx.write({ outputType: 'nodebuffer' })) as unknown as Buffer;
  }

  // Executive Summary
  const sumSlide = pptx.addSlide();
  sumSlide.background = { color: SLIDE_BG };
  sumSlide.addText('Executive Summary', { x: 0.5, y: 0.3, w: 9, fontSize: 20, color: SLIDE_CYAN, fontFace: 'Arial', bold: true });
  sumSlide.addShape(pptx.ShapeType.rect, { x: 0.5, y: 0.7, w: 0.8, h: 0.03, fill: { color: SLIDE_CYAN } });
  sumSlide.addText(report.summary, { x: 0.5, y: 1.0, w: 9, h: 4.5, fontSize: 14, color: SLIDE_TEXT, fontFace: 'Arial', valign: 'top' });

  // Key Findings (strengths + opportunities)
  const keyFindings = [...report.swot.strengths, ...report.swot.opportunities];
  if (keyFindings.length > 0) pptxSectionSlide(pptx, 'Key Findings', keyFindings, SLIDE_AMBER);

  // SWOT Matrix (2x2 layout)
  const swotSlide = pptx.addSlide();
  swotSlide.background = { color: SLIDE_BG };
  swotSlide.addText('SWOT Analysis', { x: 0.5, y: 0.3, w: 9, fontSize: 20, color: SLIDE_TEXT, fontFace: 'Arial', bold: true });
  const quadrants = [
    { label: 'Strengths', items: report.swot.strengths, color: SLIDE_GREEN, x: 0.3, y: 0.8 },
    { label: 'Weaknesses', items: report.swot.weaknesses, color: SLIDE_RED, x: 5.15, y: 0.8 },
    { label: 'Opportunities', items: report.swot.opportunities, color: SLIDE_CYAN, x: 0.3, y: 3.0 },
    { label: 'Threats', items: report.swot.threats, color: SLIDE_AMBER, x: 5.15, y: 3.0 },
  ];
  for (const q of quadrants) {
    swotSlide.addShape(pptx.ShapeType.roundRect, { x: q.x, y: q.y, w: 4.7, h: 2.0, fill: { color: SLIDE_BG }, line: { color: q.color, width: 1 }, rectRadius: 0.1 });
    swotSlide.addText(q.label, { x: q.x + 0.2, y: q.y + 0.1, w: 4.3, fontSize: 12, color: q.color, fontFace: 'Arial', bold: true });
    const bullets = q.items.slice(0, 4).map((item) => `• ${item}`).join('\n');
    swotSlide.addText(bullets || '—', { x: q.x + 0.2, y: q.y + 0.4, w: 4.3, h: 1.4, fontSize: 10, color: SLIDE_TEXT, fontFace: 'Arial', valign: 'top' });
  }

  // Recommendations
  if (report.recommendations.length > 0) {
    pptxSectionSlide(
      pptx,
      'Strategic Recommendations',
      report.recommendations.map((r) => `[${r.priority.toUpperCase()}] ${r.title}: ${r.detail}`),
      SLIDE_CYAN,
    );
  }

  // Risk Considerations
  const risks = [...report.swot.weaknesses, ...report.swot.threats];
  if (risks.length > 0) pptxSectionSlide(pptx, 'Risk Considerations', risks, SLIDE_RED);

  return (await pptx.write({ outputType: 'nodebuffer' })) as unknown as Buffer;
}

/* ── Analysis Export: DOCX ─────────────────── */

export async function exportAnalysisDOCX(record: AnalysisRecord): Promise<Buffer> {
  const report = record.report;
  const typeLabel = record.type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  const children: Paragraph[] = [];

  // Title
  children.push(new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, children: [new TextRun({ text: `Strategic Analysis: ${typeLabel}`, bold: true, size: 48 })] }));
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: record.query, italics: true, size: 24, color: '666666' })] }));
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 600 }, children: [
    new TextRun({ text: `Depth: ${record.depth} · Date: ${new Date(record.created_at).toLocaleDateString()} · Status: ${record.status}`, size: 20, color: '888888' }),
  ] }));

  if (!report) {
    children.push(new Paragraph({ children: [new TextRun({ text: 'Report not yet generated.', italics: true })] }));
    return Packer.toBuffer(new Document({ sections: [{ children }] }));
  }

  // Executive Summary
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 }, children: [new TextRun({ text: 'Executive Summary', bold: true })] }));
  for (const para of report.summary.split('\n').filter(Boolean)) {
    children.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: para, size: 22 })] }));
  }

  // Key Findings
  const keyFindings = [...report.swot.strengths, ...report.swot.opportunities];
  if (keyFindings.length > 0) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 }, children: [new TextRun({ text: 'Key Findings', bold: true })] }));
    for (const finding of keyFindings) {
      children.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 80 }, children: [new TextRun({ text: finding, size: 22 })] }));
    }
  }

  // SWOT Analysis
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 }, children: [new TextRun({ text: 'SWOT Analysis', bold: true })] }));
  const swotSections: [string, string[]][] = [
    ['Strengths', report.swot.strengths],
    ['Weaknesses', report.swot.weaknesses],
    ['Opportunities', report.swot.opportunities],
    ['Threats', report.swot.threats],
  ];
  for (const [label, items] of swotSections) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 }, children: [new TextRun({ text: label, bold: true })] }));
    if (items.length === 0) {
      children.push(new Paragraph({ children: [new TextRun({ text: 'None identified.', italics: true, color: '888888' })] }));
    } else {
      for (const item of items) {
        children.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 60 }, children: [new TextRun({ text: item, size: 22 })] }));
      }
    }
  }

  // Recommendations
  if (report.recommendations.length > 0) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 }, children: [new TextRun({ text: 'Strategic Recommendations', bold: true })] }));
    const sorted = [...report.recommendations].sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return (order[a.priority] ?? 2) - (order[b.priority] ?? 2);
    });
    for (const rec of sorted) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_3, spacing: { before: 160, after: 80 }, children: [
        new TextRun({ text: `[${rec.priority.toUpperCase()}] `, bold: true, color: rec.priority === 'high' ? 'CC3333' : rec.priority === 'medium' ? 'CC8800' : '3366CC' }),
        new TextRun({ text: rec.title, bold: true }),
      ] }));
      children.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: rec.detail, size: 22 })] }));
    }
  }

  // Risk Considerations
  const risks = [...report.swot.weaknesses, ...report.swot.threats];
  if (risks.length > 0) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 }, children: [new TextRun({ text: 'Risk Considerations', bold: true })] }));
    for (const risk of risks) {
      children.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 80 }, children: [new TextRun({ text: risk, size: 22 })] }));
    }
  }

  // Appendix: Research Threads
  if (report.threads.length > 0) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 600, after: 200 }, children: [new TextRun({ text: 'Appendix: Research Threads', bold: true })] }));
    for (const thread of report.threads) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 80 }, children: [
        new TextRun({ text: `${thread.label} (${thread.perspective})`, bold: true }),
        new TextRun({ text: ` — ${thread.status}`, color: '888888' }),
      ] }));
      if (thread.result) {
        for (const line of thread.result.split('\n').filter(Boolean)) {
          children.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: line, size: 20, color: '444444' })] }));
        }
      }
    }
  }

  return Packer.toBuffer(new Document({
    creator: 'Glyphor AI',
    title: `Strategic Analysis: ${typeLabel}`,
    sections: [{ children }],
  }));
}

/* ── Simulation Export: PPTX ───────────────── */

export async function exportSimulationPPTX(record: SimulationRecord): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = 'Glyphor AI';
  pptx.title = `T+1 Simulation: ${record.action.slice(0, 60)}`;

  pptxTitleSlide(pptx, 'T+1 Impact Simulation', record.action, `Perspective: ${record.perspective} · ${new Date(record.created_at).toLocaleDateString()}`);

  const report = record.report;
  if (!report) {
    return (await pptx.write({ outputType: 'nodebuffer' })) as unknown as Buffer;
  }

  // Summary + Score
  const sumSlide = pptx.addSlide();
  sumSlide.background = { color: SLIDE_BG };
  sumSlide.addText('Executive Summary', { x: 0.5, y: 0.3, w: 7, fontSize: 20, color: SLIDE_CYAN, fontFace: 'Arial', bold: true });
  sumSlide.addText(`${report.overallScore > 0 ? '+' : ''}${report.overallScore}`, { x: 8, y: 0.2, w: 1.5, fontSize: 36, color: report.overallScore >= 3 ? SLIDE_GREEN : report.overallScore >= 0 ? SLIDE_AMBER : SLIDE_RED, fontFace: 'Arial', bold: true, align: 'right' });
  sumSlide.addText(report.summary, { x: 0.5, y: 1.0, w: 9, h: 4, fontSize: 13, color: SLIDE_TEXT, fontFace: 'Arial', valign: 'top' });

  // Impact by Department
  if (report.dimensions.length > 0) {
    pptxSectionSlide(
      pptx,
      'Impact by Department',
      report.dimensions.map((d) => `${d.area}: ${d.magnitude > 0 ? '+' : ''}${d.magnitude} (${d.impact}) — ${d.reasoning.slice(0, 80)}`),
      SLIDE_CYAN,
    );
  }

  // Votes
  if (report.votes.length > 0) {
    pptxSectionSlide(
      pptx,
      'Executive Votes',
      report.votes.map((v) => `${v.agent}: ${v.vote.toUpperCase()} — ${v.reasoning.slice(0, 80)}`),
      SLIDE_ACCENT,
    );
  }

  return (await pptx.write({ outputType: 'nodebuffer' })) as unknown as Buffer;
}

/* ── Simulation Export: DOCX ───────────────── */

export async function exportSimulationDOCX(record: SimulationRecord): Promise<Buffer> {
  const report = record.report;
  const children: Paragraph[] = [];

  children.push(new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'T+1 Impact Simulation', bold: true, size: 48 })] }));
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: record.action, italics: true, size: 24, color: '666666' })] }));
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 600 }, children: [
    new TextRun({ text: `Perspective: ${record.perspective} · Date: ${new Date(record.created_at).toLocaleDateString()}`, size: 20, color: '888888' }),
  ] }));

  if (!report) {
    children.push(new Paragraph({ children: [new TextRun({ text: 'Report not yet generated.', italics: true })] }));
    return Packer.toBuffer(new Document({ sections: [{ children }] }));
  }

  children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 }, children: [new TextRun({ text: 'Executive Summary', bold: true })] }));
  children.push(new Paragraph({ spacing: { after: 120 }, children: [
    new TextRun({ text: `Overall Score: ${report.overallScore > 0 ? '+' : ''}${report.overallScore}/10`, bold: true, size: 24 }),
    new TextRun({ text: ` · Recommendation: ${report.recommendation.replace(/_/g, ' ')}`, size: 22 }),
  ] }));
  children.push(new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: report.summary, size: 22 })] }));

  if (report.dimensions.length > 0) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 }, children: [new TextRun({ text: 'Impact by Department', bold: true })] }));
    for (const dim of report.dimensions) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_3, spacing: { before: 160, after: 80 }, children: [
        new TextRun({ text: `${dim.area} `, bold: true }),
        new TextRun({ text: `(${dim.impact}, ${dim.magnitude > 0 ? '+' : ''}${dim.magnitude})`, color: dim.impact === 'positive' ? '339933' : dim.impact === 'negative' ? 'CC3333' : '888888' }),
      ] }));
      children.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: dim.reasoning, size: 22 })] }));
    }
  }

  if (report.votes.length > 0) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 }, children: [new TextRun({ text: 'Executive Votes', bold: true })] }));
    for (const v of report.votes) {
      const icon = v.vote === 'approve' ? '✅' : v.vote === 'reject' ? '❌' : '⚠️';
      children.push(new Paragraph({ spacing: { after: 100 }, children: [
        new TextRun({ text: `${icon} ${v.agent}: ${v.vote} `, bold: true, size: 22 }),
        new TextRun({ text: `— ${v.reasoning}`, size: 22, color: '444444' }),
      ] }));
    }
  }

  return Packer.toBuffer(new Document({
    creator: 'Glyphor AI',
    title: `T+1 Simulation: ${record.action.slice(0, 60)}`,
    sections: [{ children }],
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
