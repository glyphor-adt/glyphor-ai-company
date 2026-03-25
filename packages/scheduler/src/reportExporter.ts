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
import type { StrategyAnalysisRecord, SynthesisOutput } from './strategyLabEngine.js';
import PptxGenJS from 'pptxgenjs';
import JSZip from 'jszip';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, PageNumber, Header, Footer, Tab, TabStopPosition, TabStopType, convertInchesToTwip } from 'docx';
import { Storage } from '@google-cloud/storage';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { BRAND, TYPOGRAPHY, IDENTITY, DOC_LABELS, SLIDE, VISUAL_PALETTE_PROMPT, VISUAL_STYLE_PROMPT } from './brandTheme.js';
import { LOGO_DATA_URI } from './logoAsset.js';

/* â”€â”€ Shared PPTX theme â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

const SLIDE_BG    = '0F1117';
const SLIDE_BG2   = '1A1D27';  // dark card/panel bg
const SLIDE_TEXT  = 'E5E7EB';
const SLIDE_MUTED = '8B95A5';
const SLIDE_CYAN  = '00E0FF';
const SLIDE_AMBER = 'FBBF24';
const SLIDE_GREEN = '34D399';
const SLIDE_RED   = 'FB7185';
const SLIDE_PURPLE = '623CEA';
const SLIDE_WHITE = 'FFFFFF';
const FONT_HEADING = 'Segoe UI';
const FONT_BODY    = 'Segoe UI';

type TemplateFormat = 'docx' | 'pptx';

const storageClient = new Storage();
const secretClient = new SecretManagerServiceClient();
const templateUriCache = new Map<TemplateFormat, string | null>();
const templateBytesCache = new Map<TemplateFormat, Buffer | null>();
const templateWarnedMessages = new Set<string>();

function cleanMojibakeText(value: string): string {
  return value
    .replace(/Â·/g, '·')
    .replace(/Â /g, ' ')
    .replace(/â€”/g, '—')
    .replace(/â€“/g, '–')
    .replace(/â†’/g, '→')
    .replace(/â—/g, '•')
    .replace(/â€¢/g, '•')
    .replace(/âœ“/g, '✓')
    .replace(/âœ—/g, '✗')
    .replace(/âš /g, '⚠')
    .replace(/2Ã—2/g, '2×2')
    .replace(/Ã—/g, '×');
}

function warnTemplateOnce(message: string): void {
  if (templateWarnedMessages.has(message)) return;
  templateWarnedMessages.add(message);
  console.warn(`[ReportTemplate] ${message}`);
}

function parseGsUri(uri: string): { bucket: string; objectPath: string } | null {
  if (!uri.startsWith('gs://')) return null;
  const withoutScheme = uri.slice('gs://'.length);
  const slashIdx = withoutScheme.indexOf('/');
  if (slashIdx <= 0 || slashIdx === withoutScheme.length - 1) return null;
  const bucket = withoutScheme.slice(0, slashIdx).trim();
  const objectPath = withoutScheme.slice(slashIdx + 1).trim();
  if (!bucket || !objectPath) return null;
  return { bucket, objectPath };
}

function getTemplateEnvVar(format: TemplateFormat): string {
  return format === 'docx' ? 'REPORT_TEMPLATE_DOCX_URI' : 'REPORT_TEMPLATE_PPTX_URI';
}

function getTemplateSecretName(format: TemplateFormat): string {
  const secretNameEnv = format === 'docx'
    ? process.env.REPORT_TEMPLATE_DOCX_SECRET_NAME
    : process.env.REPORT_TEMPLATE_PPTX_SECRET_NAME;
  const defaultSecret = format === 'docx' ? 'report-template-docx' : 'report-template-pptx';
  return (secretNameEnv ?? defaultSecret).trim();
}

async function resolveTemplateUri(format: TemplateFormat): Promise<string | null> {
  if (templateUriCache.has(format)) {
    return templateUriCache.get(format) ?? null;
  }

  const envVar = getTemplateEnvVar(format);
  const fromEnv = process.env[envVar]?.trim();
  if (fromEnv) {
    templateUriCache.set(format, fromEnv);
    return fromEnv;
  }

  const projectId = process.env.GCP_PROJECT_ID?.trim() || process.env.GCP_PROJECT?.trim();
  if (!projectId) {
    templateUriCache.set(format, null);
    return null;
  }

  const secretName = getTemplateSecretName(format);
  try {
    const [version] = await secretClient.accessSecretVersion({
      name: `projects/${projectId}/secrets/${secretName}/versions/latest`,
    });
    const value = version.payload?.data?.toString().trim() ?? '';
    templateUriCache.set(format, value || null);
    return value || null;
  } catch (error) {
    warnTemplateOnce(`Unable to read ${format.toUpperCase()} template secret "${secretName}" in project "${projectId}"; falling back to in-code builders.`);
    templateUriCache.set(format, null);
    return null;
  }
}

async function downloadTemplateFromGcs(format: TemplateFormat): Promise<Buffer | null> {
  if (templateBytesCache.has(format)) {
    return templateBytesCache.get(format) ?? null;
  }

  const uri = await resolveTemplateUri(format);
  if (!uri) {
    templateBytesCache.set(format, null);
    return null;
  }

  const parsed = parseGsUri(uri);
  if (!parsed) {
    warnTemplateOnce(`Template URI for ${format.toUpperCase()} is not a valid gs:// path: ${uri}`);
    templateBytesCache.set(format, null);
    return null;
  }

  try {
    const [bytes] = await storageClient.bucket(parsed.bucket).file(parsed.objectPath).download();
    templateBytesCache.set(format, bytes);
    return bytes;
  } catch (error) {
    warnTemplateOnce(`Failed to download ${format.toUpperCase()} template from ${uri}; falling back to in-code builders.`);
    templateBytesCache.set(format, null);
    return null;
  }
}

async function writePptxBuffer(pptx: PptxGenJS): Promise<Buffer> {
  const templateBytes = await downloadTemplateFromGcs('pptx');
  if (templateBytes) {
    // PptxGenJS cannot directly merge external templates; keep generation path stable while
    // enforcing template retrieval at generation time.
    void templateBytes;
  }
  return (await pptx.write({ outputType: 'nodebuffer' })) as unknown as Buffer;
}

async function writeDocxBuffer(doc: Document): Promise<Buffer> {
  const templateBytes = await downloadTemplateFromGcs('docx');
  if (templateBytes) {
    // docx package does not support loading an existing .docx template directly; keep
    // fallback generation path while template retrieval is wired in.
    void templateBytes;
  }
  return Packer.toBuffer(doc);
}

function escapeXmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/\n/g, '&#10;');
}

function applyPlaceholderReplacements(xml: string, vars: Record<string, string>): { xml: string; replacements: number } {
  let next = xml;
  let replacements = 0;

  for (const [rawKey, rawValue] of Object.entries(vars)) {
    const key = rawKey.trim();
    if (!key) continue;

    const escapedValue = escapeXmlText(rawValue ?? '');
    const patterns = [
      `{{${key}}}`,
      `[[${key}]]`,
      `<<${key}>>`,
      `\${${key}}`,
      `{{${key.toUpperCase()}}}`,
      `[[${key.toUpperCase()}]]`,
      `<<${key.toUpperCase()}>>`,
      `\${${key.toUpperCase()}}`,
    ];

    for (const pattern of patterns) {
      if (!next.includes(pattern)) continue;
      const parts = next.split(pattern);
      replacements += parts.length - 1;
      next = parts.join(escapedValue);
    }
  }

  return { xml: next, replacements };
}

function applyLiteralReplacements(xml: string, vars: Record<string, string>): { xml: string; replacements: number } {
  let next = xml;
  let replacements = 0;

  for (const [fromText, toText] of Object.entries(vars)) {
    if (!fromText || !next.includes(fromText)) continue;
    const escapedTo = escapeXmlText(toText ?? '');
    const parts = next.split(fromText);
    const count = parts.length - 1;
    if (count > 0) {
      replacements += count;
      next = parts.join(escapedTo);
    }
  }

  return { xml: next, replacements };
}

function buildStrategyTemplateLiteralVars(record: StrategyAnalysisRecord): Record<string, string> {
  const synthesis = record.synthesis;
  const title = `Strategic Analysis: ${cleanMojibakeText(record.analysis_type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()))}`;
  const subtitle = cleanMojibakeText(record.query);
  const summary = cleanMojibakeText(normalizePhrase(synthesis?.executiveSummary, 'Executive summary unavailable.'));
  const insights = (synthesis?.crossFrameworkInsights ?? []).slice(0, 3).map(cleanMojibakeText);
  const recommendations = (synthesis?.strategicRecommendations ?? []).slice(0, 3).map((r) => cleanMojibakeText(r.title || r.description));
  const keyFinding = cleanMojibakeText((synthesis?.keyRisks?.[0] || synthesis?.openQuestionsForFounders?.[0] || 'No key finding available.'));

  return {
    'Report Title': title,
    'Subtitle': subtitle,
    'Section Heading': 'Executive Summary',
    'Section Title': cleanMojibakeText(record.analysis_type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())),
    'Slide Title': title,
    'Brief description of this section.': clampWords(summary, 20),
    'Body text. Clear, direct, architectural. Present tense, active voice. Numbers beat adjectives. Lead with the outcome, not the method.': clampWords(summary, 40),
    'Second paragraph. Continue the narrative with additional context, evidence, or analysis.': clampWords(insights[0] ?? summary, 28),
    'Subsection': 'Cross-Framework Insight',
    'Subsection body text. Specific, evidenced, grounded.': clampWords(insights[1] ?? summary, 24),
    'Cross-Framework Insight body text. Specific, evidenced, grounded.': clampWords(insights[1] ?? summary, 24),
    'KEY FINDING  Critical information or decision point. One clear, direct statement.': `KEY FINDING  ${clampWords(keyFinding, 18)}`,
    'Critical information or decision point. One clear, direct statement.': clampWords(keyFinding, 16),
    'First key point.': clampWords(insights[0] ?? summary, 12),
    'Second key point.': clampWords(insights[1] ?? summary, 12),
    'Third key point.': clampWords(insights[2] ?? summary, 12),
    'Lead with the outcome, not the process. Numbers beat adjectives every time.': clampWords(insights[0] ?? summary, 16),
    'Confident, clear, architectural tone. Present tense, active voice throughout.': clampWords(insights[1] ?? summary, 16),
    'Scope discipline — define what we produce and what we explicitly do not.': clampWords(insights[2] ?? recommendations[0] ?? summary, 16),
    'The default architecture uses semantic tags, strict spacing, and accessible contrast.': clampWords(recommendations[0] ?? summary, 16),
    'Decision-ready and deployment-safe.': clampWords(recommendations[1] ?? insights[0] ?? summary, 12),
  };
}

async function renderTemplateDocument(format: TemplateFormat, vars: Record<string, string>): Promise<Buffer | null> {
  const templateBytes = await downloadTemplateFromGcs(format);
  if (!templateBytes) return null;

  try {
    const zip = await JSZip.loadAsync(templateBytes);
    const filePattern = format === 'docx'
      ? /^word\/.+\.xml$/
      : /^ppt\/(slides\/slide\d+|slideLayouts\/slideLayout\d+|slideMasters\/slideMaster\d+|notesSlides\/notesSlide\d+)\.xml$/;

    const files = Object.keys(zip.files).filter((name) => filePattern.test(name));
    let totalReplacements = 0;
    const literalVars = vars.__literal_replacements_json__
      ? JSON.parse(vars.__literal_replacements_json__)
      : null;

    for (const fileName of files) {
      const file = zip.file(fileName);
      if (!file) continue;

      const xml = await file.async('string');
      const { xml: withPlaceholders, replacements: placeholderReplacements } = applyPlaceholderReplacements(xml, vars);
      let updatedXml = withPlaceholders;
      let fileReplacements = placeholderReplacements;

      if (literalVars && typeof literalVars === 'object') {
        const { xml: withLiterals, replacements: literalReplacements } = applyLiteralReplacements(updatedXml, literalVars as Record<string, string>);
        updatedXml = withLiterals;
        fileReplacements += literalReplacements;
      }

      if (fileReplacements > 0) {
        zip.file(fileName, updatedXml);
        totalReplacements += fileReplacements;
      }
    }

    if (totalReplacements === 0) {
      warnTemplateOnce(`Loaded ${format.toUpperCase()} template but no placeholders matched. Expected tokens like {{report_title}} or [[report_title]].`);
    }

    return (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;
  } catch (error) {
    warnTemplateOnce(`Failed to apply ${format.toUpperCase()} template placeholders; falling back to in-code builders.`);
    return null;
  }
}

function buildStrategyTemplateVars(record: StrategyAnalysisRecord): Record<string, string> {
  const synthesis = record.synthesis;
  const recs = synthesis?.strategicRecommendations ?? [];
  const topRec = recs[0];
  const swot = synthesis?.unifiedSwot;

  const vars: Record<string, string> = {
    report_title: `Strategic Analysis: ${cleanMojibakeText(record.analysis_type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()))}`,
    report_subtitle: cleanMojibakeText(record.query),
    analysis_type: cleanMojibakeText(record.analysis_type),
    depth: cleanMojibakeText(record.depth),
    report_date: new Date(record.created_at).toLocaleDateString(),
    total_sources: String(record.total_sources ?? 0),
    total_searches: String(record.total_searches ?? 0),
    overall_confidence: cleanMojibakeText(record.overall_confidence ?? 'unknown'),
    executive_summary: cleanMojibakeText(synthesis?.executiveSummary ?? ''),
    cross_framework_insights: cleanMojibakeText((synthesis?.crossFrameworkInsights ?? []).join(' | ')),
    strengths_count: String(swot?.strengths?.length ?? 0),
    weaknesses_count: String(swot?.weaknesses?.length ?? 0),
    opportunities_count: String(swot?.opportunities?.length ?? 0),
    threats_count: String(swot?.threats?.length ?? 0),
    strengths_list: cleanMojibakeText((swot?.strengths ?? []).join(' | ')),
    weaknesses_list: cleanMojibakeText((swot?.weaknesses ?? []).join(' | ')),
    opportunities_list: cleanMojibakeText((swot?.opportunities ?? []).join(' | ')),
    threats_list: cleanMojibakeText((swot?.threats ?? []).join(' | ')),
    recommendations_count: String(recs.length),
    top_recommendation_title: cleanMojibakeText(topRec?.title ?? ''),
    top_recommendation_owner: cleanMojibakeText(topRec?.owner ?? ''),
    top_recommendation_expected_outcome: cleanMojibakeText(topRec?.expectedOutcome ?? ''),
    key_risks: cleanMojibakeText((synthesis?.keyRisks ?? []).join(' | ')),
    open_questions: cleanMojibakeText((synthesis?.openQuestionsForFounders ?? []).join(' | ')),
    generated_on: new Date().toLocaleDateString(),
  };

  vars.__literal_replacements_json__ = JSON.stringify(buildStrategyTemplateLiteralVars(record));
  return vars;
}

/** Branded footer bar on every slide */
function addSlideFooter(slide: PptxGenJS.Slide, pptx: PptxGenJS): void {
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 5.1, w: 10, h: 0.15, fill: { color: SLIDE_CYAN } });
  slide.addText('GLYPHOR AI · Confidential', { x: 0.3, y: 4.85, w: 5, fontSize: 9, color: SLIDE_MUTED, fontFace: FONT_BODY });
}

function pptxTitleSlide(pptx: PptxGenJS, title: string, subtitle: string, meta: string): void {
  const slide = pptx.addSlide();
  slide.background = { color: SLIDE_BG };
  // Top accent bar
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: SLIDE_CYAN } });
  // Logo
  if (LOGO_DATA_URI) slide.addImage({ data: LOGO_DATA_URI, x: 0.4, y: 0.2, w: 0.45, h: 0.5 });
  // Brand mark (next to logo)
  slide.addText('GLYPHOR', { x: 0.9, y: 0.3, w: 9, fontSize: 13, color: SLIDE_CYAN, fontFace: FONT_HEADING, bold: true, charSpacing: 5 });
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

/** Paginated section slide â€” splits items across multiple slides if needed */
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
      const prefix = opts?.numbered ? `${globalIdx + 1}.` : '•';
      const yPos = 1.0 + idx * 0.65;
      // Item card with subtle bg
      slide.addShape(pptx.ShapeType.roundRect, {
        x: 0.5, y: yPos - 0.05, w: 9, h: 0.55,
        fill: { color: SLIDE_BG2 }, line: { color: '2D3348', width: 0.5 }, rectRadius: 0.05,
      });
      slide.addText(`${prefix}  ${item}`, {
        x: 0.7, y: yPos, w: 8.6, h: 0.45,
        fontSize: 13, color: SLIDE_TEXT, fontFace: FONT_BODY, valign: 'middle', lineSpacingMultiple: 1.15,
      });
    });

    addSlideFooter(slide, pptx);
  });
}

/* â”€â”€ Analysis Export: Markdown â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

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

/* â”€â”€ Simulation Export â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

export function exportSimulationMarkdown(record: SimulationRecord): string {
  const report = record.report;
  const lines: string[] = [
    `# Cascade Analysis Report`,
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

/* â”€â”€ Analysis Export: PPTX â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

export async function exportAnalysisPPTX(record: AnalysisRecord): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = 'Glyphor AI';
  pptx.title = `Strategic Analysis: ${record.type.replace(/_/g, ' ')}`;

  const report = record.report;
  const typeLabel = record.type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  // 1. Title slide
  pptxTitleSlide(pptx, typeLabel, record.query, `Depth: ${record.depth}  Â·  ${new Date(record.created_at).toLocaleDateString()}  Â·  Glyphor AI Strategy Lab`);

  if (!report) {
    const slide = pptx.addSlide();
    slide.background = { color: SLIDE_BG };
    slide.addText('Report not yet generated.', { x: 1, y: 2, w: 8, fontSize: 18, color: SLIDE_MUTED, fontFace: FONT_BODY, align: 'center' });
    return writePptxBuffer(pptx);
  }

  // 2. Executive Summary â€” multi-paragraph with key stat callout
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
      fill: { color: SLIDE_BG2 }, line: { color: '2D3348', width: 0.5 }, rectRadius: 0.08,
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
      { label: 'Recommendations', val: String(report.recommendations.length), clr: SLIDE_PURPLE },
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

  // 4. SWOT Analysis â€” polished 2Ã—2 matrix
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

  // 5. Strategic Recommendations â€” one per slide for high-priority, grouped for others
  if (report.recommendations.length > 0) {
    const highPriority = report.recommendations.filter((r) => r.priority === 'high');
    const otherRecs = report.recommendations.filter((r) => r.priority !== 'high');

    // High-priority: individual slides for emphasis
    highPriority.forEach((rec, idx) => {
      const slide = pptx.addSlide();
      slide.background = { color: SLIDE_BG };
      slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: SLIDE_RED } });
      slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.06, h: 5.63, fill: { color: SLIDE_RED } });
      slide.addText(`HIGH PRIORITY  Â·  Recommendation ${idx + 1}`, {
        x: 0.6, y: 0.3, w: 9, fontSize: 12, color: SLIDE_RED, fontFace: FONT_HEADING, bold: true, charSpacing: 2,
      });
      slide.addText(rec.title, { x: 0.6, y: 0.8, w: 8.5, fontSize: 28, color: SLIDE_TEXT, fontFace: FONT_HEADING, bold: true });
      slide.addShape(pptx.ShapeType.rect, { x: 0.6, y: 1.5, w: 1.0, h: 0.035, fill: { color: SLIDE_RED } });
      slide.addShape(pptx.ShapeType.roundRect, {
        x: 0.5, y: 1.75, w: 9, h: 2.8,
        fill: { color: SLIDE_BG2 }, line: { color: '2D3348', width: 0.5 }, rectRadius: 0.08,
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
    slide.addText('GLYPHOR', { x: 0.6, y: 1.8, w: 8.8, fontSize: 28, color: SLIDE_CYAN, fontFace: FONT_HEADING, bold: true, align: 'center', charSpacing: 6 });
    slide.addText('Strategic Intelligence Platform', { x: 0.6, y: 2.9, w: 8.8, fontSize: 14, color: SLIDE_MUTED, fontFace: FONT_BODY, align: 'center' });
    slide.addText(`Generated ${new Date().toLocaleDateString()}  Â·  Confidential`, { x: 0.6, y: 3.5, w: 8.8, fontSize: 10, color: SLIDE_MUTED, fontFace: FONT_BODY, align: 'center' });
    addSlideFooter(slide, pptx);
  }

  return writePptxBuffer(pptx);
}

/* â”€â”€ Analysis Export: DOCX â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

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
    children: [new TextRun({ text, size: 21, color: color ?? 'D1D5DB', font: 'Segoe UI' })],
  });
}

export async function exportAnalysisDOCX(record: AnalysisRecord): Promise<Buffer> {
  const report = record.report;
  const typeLabel = record.type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  const children: (Paragraph | Table)[] = [];

  // â”€â”€ Branded header â”€â”€
  children.push(new Paragraph({
    spacing: { after: 60 },
    children: [new TextRun({ text: 'GLYPHOR', bold: true, size: 20, color: '00E0FF', font: 'Segoe UI' })],
  }));
  children.push(new Paragraph({
    spacing: { after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '00E0FF', space: 6 } },
    children: [],
  }));

  // â”€â”€ Title block â”€â”€
  children.push(new Paragraph({
    spacing: { before: 200, after: 80 },
    children: [new TextRun({ text: `Strategic Analysis: ${typeLabel}`, bold: true, size: 48, font: 'Segoe UI', color: 'E5E7EB' })],
  }));
  children.push(new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({ text: record.query, italics: true, size: 24, color: 'B0B8C4', font: 'Segoe UI' })],
  }));
  children.push(new Paragraph({
    spacing: { after: 400 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: '2D3348', space: 12 } },
    children: [
      new TextRun({ text: `Depth: ${record.depth}`, size: 18, color: '8B95A5', font: 'Segoe UI' }),
      new TextRun({ text: `  Â·  Date: ${new Date(record.created_at).toLocaleDateString()}`, size: 18, color: '8B95A5', font: 'Segoe UI' }),
      new TextRun({ text: `  Â·  Status: ${record.status}`, size: 18, color: '8B95A5', font: 'Segoe UI' }),
    ],
  }));

  if (!report) {
    children.push(new Paragraph({ children: [new TextRun({ text: 'Report not yet generated.', italics: true })] }));
    return writeDocxBuffer(new Document({ sections: [{ children }] }));
  }

  // â”€â”€ Executive Summary â”€â”€
  children.push(...docxSectionHeading('Executive Summary', '00E0FF'));
  for (const para of report.summary.split('\n').filter(Boolean)) {
    children.push(new Paragraph({
      spacing: { after: 160 },
      children: [new TextRun({ text: para, size: 22, font: 'Segoe UI', color: 'E5E7EB' })],
    }));
  }

  // â”€â”€ Key Findings â”€â”€
  const keyFindings = [...report.swot.strengths, ...report.swot.opportunities];
  if (keyFindings.length > 0) {
    children.push(...docxSectionHeading('Key Findings', 'D97706'));
    for (const finding of keyFindings) {
      children.push(docxBulletItem(finding, '3D3D3D'));
    }
  }

  // â”€â”€ SWOT Analysis as a proper table â”€â”€
  children.push(...docxSectionHeading('SWOT Analysis', '1A1A2E'));

  const swotData: [string, string[], string][] = [
    ['Strengths', report.swot.strengths, '059669'],
    ['Weaknesses', report.swot.weaknesses, 'DC2626'],
    ['Opportunities', report.swot.opportunities, '0284C7'],
    ['Threats', report.swot.threats, 'D97706'],
  ];

  // 2Ã—2 SWOT table
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
        cellChildren.push(new Paragraph({ children: [new TextRun({ text: 'None identified', italics: true, size: 18, color: '6B7280', font: 'Segoe UI' })] }));
      } else {
        for (const item of items) {
          cellChildren.push(new Paragraph({
            bullet: { level: 0 },
            spacing: { after: 60 },
            children: [new TextRun({ text: item, size: 19, color: 'C4C9D4', font: 'Segoe UI' })],
          }));
        }
      }
      cells.push(new TableCell({
        width: { size: 50, type: WidthType.PERCENTAGE },
        borders: {
          top: { style: BorderStyle.SINGLE, size: 3, color },
          bottom: { style: BorderStyle.SINGLE, size: 1, color: '2D3348' },
          left: { style: BorderStyle.SINGLE, size: 1, color: '2D3348' },
          right: { style: BorderStyle.SINGLE, size: 1, color: '2D3348' },
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

  // â”€â”€ Strategic Recommendations â”€â”€
  if (report.recommendations.length > 0) {
    children.push(...docxSectionHeading('Strategic Recommendations', '00E0FF'));
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
          new TextRun({ text: `${i + 1}. `, bold: true, size: 22, color: '00E0FF', font: 'Segoe UI' }),
          new TextRun({ text: rec.title, bold: true, size: 22, font: 'Segoe UI', color: 'E5E7EB' }),
          new TextRun({ text: `  [${rec.priority.toUpperCase()}]`, bold: true, size: 18, color: priorityColor, font: 'Segoe UI' }),
        ],
      }));
      children.push(new Paragraph({
        spacing: { after: 120 },
        indent: { left: convertInchesToTwip(0.3) },
        children: [new TextRun({ text: rec.detail, size: 21, color: 'C4C9D4', font: 'Segoe UI' })],
      }));
    }
  }

  // â”€â”€ Risk Considerations â”€â”€
  const risks = [...report.swot.weaknesses, ...report.swot.threats];
  if (risks.length > 0) {
    children.push(...docxSectionHeading('Risk Considerations', 'DC2626'));
    for (const risk of risks) {
      children.push(docxBulletItem(risk, '555555'));
    }
  }

  // â”€â”€ Appendix: Research Threads â”€â”€
  if (report.threads.length > 0) {
    children.push(...docxSectionHeading('Appendix: Research Threads', '888888'));
    for (const thread of report.threads) {
      children.push(new Paragraph({
        spacing: { before: 240, after: 60 },
        children: [
          new TextRun({ text: `${thread.label}`, bold: true, size: 20, font: 'Segoe UI', color: 'D1D5DB' }),
          new TextRun({ text: ` (${thread.perspective})`, size: 18, color: '8B95A5', font: 'Segoe UI' }),
          new TextRun({ text: `  â€”  ${thread.status}`, size: 18, color: thread.status === 'completed' ? '059669' : '888888', font: 'Segoe UI' }),
        ],
      }));
      if (thread.result) {
        for (const line of thread.result.split('\n').filter(Boolean).slice(0, 30)) {
          children.push(new Paragraph({
            spacing: { after: 40 },
            indent: { left: convertInchesToTwip(0.2) },
            children: [new TextRun({ text: line, size: 18, color: '9CA3AF', font: 'Segoe UI' })],
          }));
        }
      }
    }
  }

  // â”€â”€ Footer line â”€â”€
  children.push(new Paragraph({
    spacing: { before: 600 },
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: '00E0FF', space: 12 } },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: `Glyphor AI  Â·  Strategic Analysis  Â·  ${new Date().toLocaleDateString()}  Â·  Confidential`, size: 16, color: '6B7280', font: 'Segoe UI' })],
  }));

  return writeDocxBuffer(new Document({
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

/* â”€â”€ Simulation Export: PPTX â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

export async function exportSimulationPPTX(record: SimulationRecord): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = 'Glyphor AI';
  pptx.title = `Cascade Analysis: ${record.action.slice(0, 60)}`;

  pptxTitleSlide(pptx, 'Cascade Analysis', record.action, `Perspective: ${record.perspective}  Â·  ${new Date(record.created_at).toLocaleDateString()}  Â·  Glyphor AI Strategy Lab`);

  const report = record.report;
  if (!report) {
    return writePptxBuffer(pptx);
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
      fill: { color: SLIDE_BG2 }, line: { color: '2D3348', width: 0.5 }, rectRadius: 0.08,
    });
    const summaryText = report.summary;
    slide.addText(summaryText, {
      x: 0.7, y: 1.15, w: 6.6, h: 3.3,
      fontSize: 13, color: SLIDE_TEXT, fontFace: FONT_BODY, valign: 'top', lineSpacingMultiple: 1.4,
    });
    addSlideFooter(slide, pptx);
  }

  // Impact by Department â€” individual cards with color coding
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
      const emoji = v.vote === 'approve' ? 'âœ“ APPROVE' : v.vote === 'reject' ? 'âœ— REJECT' : 'âš  CAUTION';
      return `${v.agent}  [${emoji}]  â€”  ${v.reasoning}`;
    });
    pptxSectionSlides(pptx, 'Executive Votes', voteItems, SLIDE_PURPLE);
  }

  // Closing slide
  {
    const slide = pptx.addSlide();
    slide.background = { color: SLIDE_BG };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 2.6, w: 10, h: 0.04, fill: { color: SLIDE_CYAN } });
    slide.addText('GLYPHOR', { x: 0.6, y: 1.8, w: 8.8, fontSize: 28, color: SLIDE_CYAN, fontFace: FONT_HEADING, bold: true, align: 'center', charSpacing: 6 });
    slide.addText('Cascade Analysis Complete', { x: 0.6, y: 2.9, w: 8.8, fontSize: 14, color: SLIDE_MUTED, fontFace: FONT_BODY, align: 'center' });
    addSlideFooter(slide, pptx);
  }

  return writePptxBuffer(pptx);
}

/* â”€â”€ Simulation Export: DOCX â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

export async function exportSimulationDOCX(record: SimulationRecord): Promise<Buffer> {
  const report = record.report;
  const children: (Paragraph | Table)[] = [];

  // â”€â”€ Branded header â”€â”€
  children.push(new Paragraph({
    spacing: { after: 60 },
    children: [new TextRun({ text: 'GLYPHOR', bold: true, size: 20, color: '00E0FF', font: 'Segoe UI' })],
  }));
  children.push(new Paragraph({
    spacing: { after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '00E0FF', space: 6 } },
    children: [],
  }));

  // â”€â”€ Title â”€â”€
  children.push(new Paragraph({
    spacing: { before: 200, after: 80 },
    children: [new TextRun({ text: 'Cascade Analysis', bold: true, size: 48, font: 'Segoe UI', color: 'E5E7EB' })],
  }));
  children.push(new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({ text: record.action, italics: true, size: 24, color: 'B0B8C4', font: 'Segoe UI' })],
  }));
  children.push(new Paragraph({
    spacing: { after: 400 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: '2D3348', space: 12 } },
    children: [
      new TextRun({ text: `Perspective: ${record.perspective}`, size: 18, color: '8B95A5', font: 'Segoe UI' }),
      new TextRun({ text: `  Â·  Date: ${new Date(record.created_at).toLocaleDateString()}`, size: 18, color: '8B95A5', font: 'Segoe UI' }),
    ],
  }));

  if (!report) {
    children.push(new Paragraph({ children: [new TextRun({ text: 'Report not yet generated.', italics: true })] }));
    return writeDocxBuffer(new Document({ sections: [{ children: children as Paragraph[] }] }));
  }

  // â”€â”€ Executive Summary with Score â”€â”€
  children.push(...docxSectionHeading('Executive Summary', '00E0FF'));
  const scoreColor = report.overallScore >= 3 ? '059669' : report.overallScore >= 0 ? 'D97706' : 'DC2626';
  children.push(new Paragraph({
    spacing: { after: 160 },
    children: [
      new TextRun({ text: 'Overall Impact Score: ', bold: true, size: 24, font: 'Segoe UI', color: 'D1D5DB' }),
      new TextRun({ text: `${report.overallScore > 0 ? '+' : ''}${report.overallScore}/10`, bold: true, size: 28, font: 'Segoe UI', color: scoreColor }),
      new TextRun({ text: `    Recommendation: ${report.recommendation.replace(/_/g, ' ').toUpperCase()}`, bold: true, size: 20, font: 'Segoe UI', color: scoreColor }),
    ],
  }));
  children.push(new Paragraph({
    spacing: { after: 200 },
    children: [new TextRun({ text: report.summary, size: 22, font: 'Segoe UI', color: 'E5E7EB' })],
  }));

  // â”€â”€ Impact by Department as table â”€â”€
  if (report.dimensions.length > 0) {
    children.push(...docxSectionHeading('Impact by Department', '00E0FF'));

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
          new TableCell({ margins: { top: 50, bottom: 50, left: 80, right: 80 }, children: [new Paragraph({ children: [new TextRun({ text: dim.area, bold: true, size: 19, font: 'Segoe UI', color: 'D1D5DB' })] })] }),
          new TableCell({ margins: { top: 50, bottom: 50, left: 80, right: 80 }, children: [new Paragraph({ children: [new TextRun({ text: dim.impact.toUpperCase(), bold: true, size: 17, font: 'Segoe UI', color: impactColor })] })] }),
          new TableCell({ margins: { top: 50, bottom: 50, left: 80, right: 80 }, children: [new Paragraph({ children: [new TextRun({ text: `${dim.magnitude > 0 ? '+' : ''}${dim.magnitude}`, bold: true, size: 20, font: 'Segoe UI', color: impactColor })] })] }),
          new TableCell({ margins: { top: 50, bottom: 50, left: 80, right: 80 }, children: [new Paragraph({ children: [new TextRun({ text: `${Math.round(dim.confidence * 100)}%`, size: 18, font: 'Segoe UI', color: '9CA3AF' })] })] }),
          new TableCell({
            width: { size: 45, type: WidthType.PERCENTAGE },
            margins: { top: 50, bottom: 50, left: 80, right: 80 },
            children: [new Paragraph({ children: [new TextRun({ text: dim.reasoning, size: 18, font: 'Segoe UI', color: 'B0B8C4' })] })],
          }),
        ],
      });
    });

    children.push(new Table({
      rows: [new TableRow({ children: headerCells }), ...dataRows],
      width: { size: 100, type: WidthType.PERCENTAGE },
    }));
  }

  // â”€â”€ Cascade Chain â”€â”€
  if (report.cascadeChain.length > 0) {
    children.push(...docxSectionHeading('Cascade Effects', 'D97706'));
    for (const link of report.cascadeChain) {
      children.push(new Paragraph({
        spacing: { after: 80 },
        children: [
          new TextRun({ text: `${link.from}`, bold: true, size: 20, color: '00E0FF', font: 'Segoe UI' }),
          new TextRun({ text: '  â†’  ', size: 20, color: '8B95A5', font: 'Segoe UI' }),
          new TextRun({ text: `${link.to}`, bold: true, size: 20, color: 'D1D5DB', font: 'Segoe UI' }),
          new TextRun({ text: `: ${link.effect}`, size: 20, color: 'B0B8C4', font: 'Segoe UI' }),
          new TextRun({ text: `  (${link.delay})`, italics: true, size: 18, color: '8B95A5', font: 'Segoe UI' }),
        ],
      }));
    }
  }

  // â”€â”€ Executive Votes â”€â”€
  if (report.votes.length > 0) {
    children.push(...docxSectionHeading('Executive Votes', '623CEA'));
    for (const v of report.votes) {
      const icon = v.vote === 'approve' ? 'âœ“' : v.vote === 'reject' ? 'âœ—' : 'âš ';
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
        children: [new TextRun({ text: v.reasoning, size: 20, color: 'B0B8C4', font: 'Segoe UI' })],
      }));
    }
  }

  // â”€â”€ Footer â”€â”€
  children.push(new Paragraph({
    spacing: { before: 600 },
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: '00E0FF', space: 12 } },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: `Glyphor AI  Â·  Cascade Analysis  Â·  ${new Date().toLocaleDateString()}  Â·  Confidential`, size: 16, color: '6B7280', font: 'Segoe UI' })],
  }));

  return writeDocxBuffer(new Document({
    creator: 'Glyphor AI',
    title: `Cascade Analysis: ${record.action.slice(0, 60)}`,
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

/* â”€â”€ CoT Export: Markdown â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

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

/* â”€â”€ Deep Dive Export: Markdown â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

export function exportDeepDiveMarkdown(record: DeepDiveRecord): string {
  const report = record.report;
  const lines: string[] = [
    `# Strategic Deep Dive: ${record.target}`,
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
    for (const s of report.currentState.keyStrengths) lines.push(`- **${s.point}** â€” ${s.evidence}`);
    lines.push('');
  }
  if (report.currentState.keyChallenges.length > 0) {
    lines.push('### Key Challenges');
    for (const c of report.currentState.keyChallenges) lines.push(`- **${c.point}** â€” ${c.evidence}`);
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
    for (const l of report.overview.leadership) lines.push(`- **${l.name}** â€” ${l.title}`);
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
    lines.push('## Sources & References', '');
    if (report.sourceCitations && report.sourceCitations.length > 0) {
      for (const src of report.sourceCitations.slice(0, 40)) {
        lines.push(`${src.id}. [${src.title}](${src.url ?? '#'}) (${src.type})`);
      }
    } else {
      for (const s of record.sources.slice(0, 30)) {
        lines.push(`- [${s.title}](${s.url ?? '#'}) (${s.type})`);
      }
    }
    lines.push('');
  }

  // Cross-Model Verification
  if (report.verificationSummary) {
    const vs = report.verificationSummary;
    lines.push('## Cross-Model Verification', '');
    lines.push(`**Overall Confidence:** ${Math.round(vs.overallConfidence * 100)}%`);
    lines.push(`**Areas Verified:** ${vs.areasVerified}`);
    lines.push(`**Models Used:** ${vs.modelsUsed.join(', ')}`);
    if (vs.flaggedClaims.length > 0) {
      lines.push('', '### Flagged Claims');
      for (const claim of vs.flaggedClaims) {
        lines.push(`- ${claim}`);
      }
    }
    lines.push('');
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

/* â”€â”€ Deep Dive Export: PPTX â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

export async function exportDeepDivePPTX(record: DeepDiveRecord): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = 'Glyphor AI';
  pptx.title = `Deep Dive: ${record.target}`;

  const report = record.report;
  pptxTitleSlide(pptx, `Strategic Deep Dive`, record.target, `${record.sources.length} sources analyzed  ·  Cross-model verified  ·  ${new Date(record.created_at).toLocaleDateString()}  ·  Glyphor AI Strategy Lab`);

  if (!report) {
    const slide = pptx.addSlide();
    slide.background = { color: SLIDE_BG };
    slide.addText('Report not yet generated.', { x: 1, y: 2, w: 8, fontSize: 18, color: SLIDE_MUTED, fontFace: FONT_BODY, align: 'center' });
    return writePptxBuffer(pptx);
  }

  // Verification Summary slide
  if (report.verificationSummary) {
    const vs = report.verificationSummary;
    const slide = pptx.addSlide();
    slide.background = { color: SLIDE_BG };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: SLIDE_CYAN } });
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.06, h: 5.63, fill: { color: SLIDE_CYAN } });
    slide.addText('Cross-Model Verification', { x: 0.6, y: 0.25, w: 7, fontSize: 22, color: SLIDE_CYAN, fontFace: FONT_HEADING, bold: true });
    const confColor = vs.overallConfidence >= 0.8 ? SLIDE_GREEN : vs.overallConfidence >= 0.6 ? SLIDE_AMBER : SLIDE_RED;
    slide.addShape(pptx.ShapeType.roundRect, { x: 7.2, y: 0.15, w: 2.5, h: 0.5, fill: { color: SLIDE_BG2 }, line: { color: confColor, width: 2 }, rectRadius: 0.08 });
    slide.addText(`${Math.round(vs.overallConfidence * 100)}% Confidence`, { x: 7.2, y: 0.15, w: 2.5, h: 0.5, fontSize: 12, color: confColor, fontFace: FONT_HEADING, bold: true, align: 'center', valign: 'middle' });
    slide.addText(`${vs.areasVerified} research areas verified across ${vs.modelsUsed.length} AI models`, { x: 0.6, y: 0.9, w: 9, fontSize: 13, color: SLIDE_TEXT, fontFace: FONT_BODY });
    slide.addText(`Models used: ${vs.modelsUsed.join(', ')}`, { x: 0.6, y: 1.3, w: 9, fontSize: 11, color: SLIDE_MUTED, fontFace: FONT_BODY });
    if (vs.flaggedClaims.length > 0) {
      slide.addText('Flagged Claims', { x: 0.6, y: 1.9, w: 4, fontSize: 14, color: SLIDE_AMBER, fontFace: FONT_HEADING, bold: true });
      vs.flaggedClaims.slice(0, 4).forEach((c, i) => {
        slide.addText(`⚠ ${c}`, { x: 0.6, y: 2.3 + i * 0.45, w: 4.2, fontSize: 10, color: SLIDE_TEXT, fontFace: FONT_BODY });
      });
    }
    if (vs.correctionsMade.length > 0) {
      slide.addText('Corrections Applied', { x: 5.2, y: 1.9, w: 4, fontSize: 14, color: SLIDE_GREEN, fontFace: FONT_HEADING, bold: true });
      vs.correctionsMade.slice(0, 4).forEach((c, i) => {
        slide.addText(`✓ ${c}`, { x: 5.2, y: 2.3 + i * 0.45, w: 4.5, fontSize: 10, color: SLIDE_TEXT, fontFace: FONT_BODY });
      });
    }
    addSlideFooter(slide, pptx);
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

    const strengths = report.currentState.keyStrengths.slice(0, 3).map((s) => `âœ“ ${s.point}`);
    const challenges = report.currentState.keyChallenges.slice(0, 3).map((c) => `âœ— ${c.point}`);
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

  // Source Citations
  if (report.sourceCitations && report.sourceCitations.length > 0) {
    const SOURCES_PER_SLIDE = 10;
    const sourceChunks: typeof report.sourceCitations[] = [];
    for (let i = 0; i < report.sourceCitations.length; i += SOURCES_PER_SLIDE) {
      sourceChunks.push(report.sourceCitations.slice(i, i + SOURCES_PER_SLIDE));
    }
    sourceChunks.forEach((chunk, pageIdx) => {
      const slide = pptx.addSlide();
      slide.background = { color: SLIDE_BG };
      slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.06, fill: { color: SLIDE_CYAN } });
      slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.06, h: 5.63, fill: { color: SLIDE_CYAN } });
      slide.addText(`Sources & References${sourceChunks.length > 1 ? ` (${pageIdx + 1}/${sourceChunks.length})` : ''}`, {
        x: 0.6, y: 0.25, w: 9, fontSize: 22, color: SLIDE_CYAN, fontFace: FONT_HEADING, bold: true,
      });
      chunk.forEach((src, i) => {
        const yPos = 0.9 + i * 0.4;
        const label = `[${src.id}] ${src.title}${src.url ? ` — ${src.url}` : ''} (${src.type})`;
        slide.addText(label, { x: 0.6, y: yPos, w: 9, fontSize: 9, color: SLIDE_TEXT, fontFace: FONT_BODY });
      });
      addSlideFooter(slide, pptx);
    });
  }

  // Closing
  {
    const slide = pptx.addSlide();
    slide.background = { color: SLIDE_BG };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 2.6, w: 10, h: 0.04, fill: { color: SLIDE_CYAN } });
    // Logo on closing slide
    if (LOGO_DATA_URI) slide.addImage({ data: LOGO_DATA_URI, x: 4.3, y: 1.0, w: 1.0, h: 1.1 });
    slide.addText('GLYPHOR', { x: 0.6, y: 2.1, w: 8.8, fontSize: 28, color: SLIDE_CYAN, fontFace: FONT_HEADING, bold: true, align: 'center', charSpacing: 6 });
    slide.addText('Strategic Deep Dive Complete', { x: 0.6, y: 2.9, w: 8.8, fontSize: 14, color: SLIDE_MUTED, fontFace: FONT_BODY, align: 'center' });
    if (report.verificationSummary) {
      slide.addText(`Cross-model verified (${Math.round(report.verificationSummary.overallConfidence * 100)}% confidence)  ·  ${record.sources.length} sources cited`, {
        x: 0.6, y: 3.4, w: 8.8, fontSize: 11, color: SLIDE_MUTED, fontFace: FONT_BODY, align: 'center',
      });
    }
    addSlideFooter(slide, pptx);
  }

  return writePptxBuffer(pptx);
}

/* â”€â”€ Deep Dive Export: DOCX â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

export async function exportDeepDiveDOCX(record: DeepDiveRecord): Promise<Buffer> {
  const report = record.report;
  const children: (Paragraph | Table)[] = [];

  // Branded header
  children.push(new Paragraph({
    spacing: { after: 60 },
    children: [new TextRun({ text: 'GLYPHOR', bold: true, size: 20, color: '00E0FF', font: 'Segoe UI' })],
  }));
  children.push(new Paragraph({
    spacing: { after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '00E0FF', space: 6 } },
    children: [],
  }));

  // Title
  children.push(new Paragraph({
    spacing: { before: 200, after: 80 },
    children: [new TextRun({ text: `Strategic Deep Dive: ${record.target}`, bold: true, size: 48, font: 'Segoe UI', color: 'E5E7EB' })],
  }));
  children.push(new Paragraph({
    spacing: { after: 400 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: '2D3348', space: 12 } },
    children: [
      new TextRun({ text: `Sources: ${record.sources.length}`, size: 18, color: '8B95A5', font: 'Segoe UI' }),
      new TextRun({ text: `  Â·  Date: ${new Date(record.created_at).toLocaleDateString()}`, size: 18, color: '8B95A5', font: 'Segoe UI' }),
      new TextRun({ text: `  Â·  Status: ${record.status}`, size: 18, color: '8B95A5', font: 'Segoe UI' }),
    ],
  }));

  if (!report) {
    children.push(new Paragraph({ children: [new TextRun({ text: 'Report not yet generated.', italics: true })] }));
    return writeDocxBuffer(new Document({ background: { color: '0F1117' }, sections: [{ children: children as Paragraph[] }] }));
  }

  // Overview
  children.push(...docxSectionHeading('Company Overview', '00E0FF'));
  children.push(new Paragraph({
    spacing: { after: 160 },
    children: [new TextRun({ text: report.overview.description, size: 22, font: 'Segoe UI', color: 'E5E7EB' })],
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
    children.push(docxBulletItem(`${s.point} â€” ${s.evidence}`, '059669'));
  }
  for (const c of report.currentState.keyChallenges) {
    children.push(docxBulletItem(`${c.point} â€” ${c.evidence}`, 'DC2626'));
  }

  // Strategic Recommendations
  if (report.strategicRecommendations.length > 0) {
    children.push(...docxSectionHeading('Strategic Recommendations', '00E0FF'));
    for (let i = 0; i < report.strategicRecommendations.length; i++) {
      const rec = report.strategicRecommendations[i];
      const priorityColor = rec.priority === 'immediate' ? 'DC2626' : rec.priority === 'short-term' ? 'D97706' : '2563EB';
      children.push(new Paragraph({
        spacing: { before: 240, after: 80 },
        children: [
          new TextRun({ text: `${i + 1}. `, bold: true, size: 22, color: '00E0FF', font: 'Segoe UI' }),
          new TextRun({ text: rec.title, bold: true, size: 22, font: 'Segoe UI', color: 'E5E7EB' }),
          new TextRun({ text: `  [${rec.priority.toUpperCase()}]`, bold: true, size: 18, color: priorityColor, font: 'Segoe UI' }),
        ],
      }));
      children.push(new Paragraph({
        spacing: { after: 120 },
        indent: { left: convertInchesToTwip(0.3) },
        children: [new TextRun({ text: rec.description, size: 21, color: 'C4C9D4', font: 'Segoe UI' })],
      }));
    }
  }

  // Risk Assessment
  if (report.riskAssessment.length > 0) {
    children.push(...docxSectionHeading('Risk Assessment', 'DC2626'));
    for (const risk of report.riskAssessment) {
      children.push(docxBulletItem(`[${risk.probability}/${risk.impact}] ${risk.risk} â€” ${risk.mitigation}`, '555555'));
    }
  }


  // Cross-Model Verification Summary
  if (report.verificationSummary) {
    const vs = report.verificationSummary;
    children.push(...docxSectionHeading('Cross-Model Verification', '00E0FF'));
    children.push(new Paragraph({
      spacing: { after: 120 },
      children: [
        new TextRun({ text: `Overall Confidence: ${Math.round(vs.overallConfidence * 100)}%`, bold: true, size: 24, font: 'Segoe UI', color: vs.overallConfidence >= 0.8 ? '059669' : vs.overallConfidence >= 0.6 ? 'D97706' : 'DC2626' }),
        new TextRun({ text: `  ·  ${vs.areasVerified} areas verified  ·  Models: ${vs.modelsUsed.join(', ')}`, size: 20, font: 'Segoe UI', color: '8B95A5' }),
      ],
    }));
    if (vs.flaggedClaims.length > 0) {
      children.push(new Paragraph({
        spacing: { before: 120, after: 60 },
        children: [new TextRun({ text: 'Flagged Claims:', bold: true, size: 20, font: 'Segoe UI', color: 'D97706' })],
      }));
      for (const claim of vs.flaggedClaims.slice(0, 6)) {
        children.push(docxBulletItem(claim, 'D97706'));
      }
    }
  }

  // Source Citations
  if (report.sourceCitations && report.sourceCitations.length > 0) {
    children.push(...docxSectionHeading('Sources & References', '00E0FF'));
    for (const src of report.sourceCitations.slice(0, 40)) {
      children.push(new Paragraph({
        spacing: { after: 60 },
        indent: { left: convertInchesToTwip(0.2) },
        children: [
          new TextRun({ text: `[${src.id}] `, bold: true, size: 18, font: 'Segoe UI', color: '00E0FF' }),
          new TextRun({ text: src.title, size: 18, font: 'Segoe UI', color: 'E5E7EB' }),
          new TextRun({ text: src.url ? ` — ${src.url}` : '', size: 16, font: 'Segoe UI', color: '8B95A5' }),
          new TextRun({ text: ` (${src.type})`, size: 16, font: 'Segoe UI', color: '8B95A5' }),
        ],
      }));
    }
  }

  // Footer
  children.push(new Paragraph({
    spacing: { before: 600 },
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: '00E0FF', space: 12 } },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: `Glyphor AI  ·  Strategic Deep Dive  ·  ${new Date().toLocaleDateString()}  ·  Confidential`, size: 16, color: '6B7280', font: 'Segoe UI' })],
  }));

  return writeDocxBuffer(new Document({
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

/* â”€â”€ Analysis: Visual (Image Infographic) â”€â”€â”€â”€ */

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
    `Style: clean modern flat design, white background, generous whitespace, minimal text. Use large icons, bold color blocks, and data visualizations instead of paragraphs of text. Think executive strategy consulting slide â€” NOT a document.`,
    ``,
    `Color palette: primary cyan (#00E0FF), white (#FFFFFF) background, dark charcoal (#1A1A2E) text, emerald (#34D399) for positive, rose (#FB7185) for negative, amber (#FBBF24) for caution. Use soft pastel tinted backgrounds for card sections.`,
    ``,
    `LAYOUT (3 rows):`,
    ``,
    `ROW 1 â€” Header banner (10% height):`,
    `Full-width cyan gradient banner. Large bold white title: "${title.toUpperCase()}". Smaller subtitle below in light gray: "${record.query}". Keep text SHORT.`,
    ``,
    `ROW 2 â€” Main content (65% height), split into 2 columns:`,
    ``,
    `LEFT COLUMN (45% width):`,
    `A large "Key Insights" card with a bold number callout: "${threadCount} research threads analyzed". Show 2-3 large circular icons (magnifying glass, lightbulb, target) with ONE-WORD labels beneath each. Below that, a small horizontal bar chart or gauge showing analysis completeness. NO bullet points of text â€” use icons and shapes only.`,
    ``,
    `RIGHT COLUMN (55% width):`,
    `A 2x2 SWOT grid using 4 large colored rounded-rectangle cards:`,
    `â€¢ Top-left: STRENGTHS â€” green (#34D399) tinted card with a shield icon and the number "${report.swot.strengths.length}"`,
    `â€¢ Top-right: WEAKNESSES â€” rose (#FB7185) tinted card with a warning triangle icon and the number "${report.swot.weaknesses.length}"`,
    `â€¢ Bottom-left: OPPORTUNITIES â€” cyan (#00E0FF) tinted card with an upward arrow icon and the number "${report.swot.opportunities.length}"`,
    `â€¢ Bottom-right: THREATS â€” amber (#FBBF24) tinted card with a lightning bolt icon and the number "${report.swot.threats.length}"`,
    `Each card shows ONLY the category label, icon, and count number in large bold text. NO bullet point text inside the cards.`,
    ``,
    `ROW 3 â€” Bottom strip (25% height), split into 2 sections:`,
    ``,
    `LEFT: "${recCount} Strategic Actions" â€” show as ${recCount} large colored pill badges in a row. ${highCount} red pills, ${medCount} amber pills, rest blue. Each pill has only a number inside (1, 2, 3, 4). A small "Priority Matrix" scatter plot beside it with dots plotted on an Impact vs Effort 2x2 grid.`,
    ``,
    `RIGHT: A thin metadata strip in small gray text: "${record.depth} depth Â· ${record.type.replace(/_/g, ' ')} Â· ${threadCount} threads Â· ${record.requested_by}"`,
    ``,
    `CRITICAL RULES:`,
    `- MINIMAL TEXT. Use icons, shapes, numbers, charts, and color instead of words.`,
    `- No paragraphs, no sentences, no bullet-point lists of findings.`,
    `- Maximum 30 total words on the entire infographic (excluding the title/subtitle).`,
    `- All text must be crisp, readable sans-serif typography.`,
    `- Professional, clean, corporate aesthetic with lots of whitespace.`,
    `- Do NOT include any "Powered by" branding or logo â€” the image should be clean.`,
  ].join('\n');
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   Strategy Lab v2 Exports
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

/* â”€â”€ Strategy Lab v2: PPTX â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

export async function exportStrategyLabPPTX(record: StrategyAnalysisRecord): Promise<Buffer> {
  const templated = await renderTemplateDocument('pptx', buildStrategyTemplateVars(record));
  if (templated) return templated;

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = 'Glyphor AI';
  const typeLabel = cleanMojibakeText(record.analysis_type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));
  const queryText = cleanMojibakeText(record.query);
  pptx.title = `Strategic Analysis: ${typeLabel}`;

  // 1. Title slide
  pptxTitleSlide(
    pptx, typeLabel, queryText,
    cleanMojibakeText(`Depth: ${record.depth} · ${record.total_sources} sources · ${record.total_searches} searches · ${new Date(record.created_at).toLocaleDateString()}`),
  );

  const s = record.synthesis;
  if (!s) {
    const slide = pptx.addSlide();
    slide.background = { color: SLIDE_BG };
    slide.addText('Report not yet generated.', { x: 1, y: 2, w: 8, fontSize: 18, color: SLIDE_MUTED, fontFace: FONT_BODY, align: 'center' });
    return writePptxBuffer(pptx);
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
      fill: { color: SLIDE_BG2 }, line: { color: '2D3348', width: 0.5 }, rectRadius: 0.08,
    });
    const summaryText = cleanMojibakeText(s.executiveSummary);
    slide.addText(summaryText, {
      x: 0.8, y: 1.1, w: 8.4, h: 3.5,
      fontSize: 13.5, color: SLIDE_TEXT, fontFace: FONT_BODY, valign: 'top', lineSpacingMultiple: 1.4,
    });

    const statsData = [
      { label: 'Strengths', val: String(s.unifiedSwot.strengths.length), clr: SLIDE_GREEN },
      { label: 'Weaknesses', val: String(s.unifiedSwot.weaknesses.length), clr: SLIDE_RED },
      { label: 'Opportunities', val: String(s.unifiedSwot.opportunities.length), clr: SLIDE_CYAN },
      { label: 'Threats', val: String(s.unifiedSwot.threats.length), clr: SLIDE_AMBER },
      { label: 'Actions', val: String(s.strategicRecommendations.length), clr: SLIDE_PURPLE },
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
    pptxSectionSlides(pptx, 'Cross-Framework Insights', s.crossFrameworkInsights.map(cleanMojibakeText), SLIDE_CYAN);
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
      const bullets = q.items.slice(0, 7).map((item, i) => `${i + 1}. ${cleanMojibakeText(item)}`).join('\n');
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
      slide.addText(`HIGH IMPACT · Recommendation ${idx + 1}`, {
        x: 0.6, y: 0.3, w: 9, fontSize: 12, color: SLIDE_RED, fontFace: FONT_HEADING, bold: true, charSpacing: 2,
      });
      slide.addText(cleanMojibakeText(rec.title), { x: 0.6, y: 0.8, w: 8.5, fontSize: 28, color: SLIDE_TEXT, fontFace: FONT_HEADING, bold: true });
      slide.addShape(pptx.ShapeType.rect, { x: 0.6, y: 1.5, w: 1.0, h: 0.035, fill: { color: SLIDE_RED } });
      slide.addShape(pptx.ShapeType.roundRect, {
        x: 0.5, y: 1.75, w: 9, h: 2.8,
        fill: { color: SLIDE_BG2 }, line: { color: '2D3348', width: 0.5 }, rectRadius: 0.08,
      });
      slide.addText(cleanMojibakeText(rec.description), {
        x: 0.8, y: 1.9, w: 8.4, h: 2.5,
        fontSize: 14, color: SLIDE_TEXT, fontFace: FONT_BODY, valign: 'top', lineSpacingMultiple: 1.4,
      });
      // Owner & expected outcome
      slide.addText(cleanMojibakeText(`Owner: ${rec.owner} · Expected: ${rec.expectedOutcome}`), {
        x: 0.8, y: 4.6, w: 8.4, fontSize: 10, color: SLIDE_MUTED, fontFace: FONT_BODY,
      });
      addSlideFooter(slide, pptx);
    });

    if (otherRecs.length > 0) {
      pptxSectionSlides(
        pptx,
        'Additional Recommendations',
        otherRecs.map((r) => cleanMojibakeText(`[${r.impact.toUpperCase()}] ${r.title}: ${r.description}`)),
        SLIDE_CYAN,
        { numbered: true },
      );
    }
  }

  // 6. Risks & Open Questions
  if (s.keyRisks.length > 0) {
    pptxSectionSlides(pptx, 'Key Risks', s.keyRisks.map(cleanMojibakeText), SLIDE_RED);
  }
  if (s.openQuestionsForFounders.length > 0) {
    pptxSectionSlides(pptx, 'Open Questions for Founders', s.openQuestionsForFounders.map(cleanMojibakeText), SLIDE_AMBER);
  }

  // 7. Closing slide
  {
    const slide = pptx.addSlide();
    slide.background = { color: SLIDE_BG };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 2.6, w: 10, h: 0.04, fill: { color: SLIDE_CYAN } });
    slide.addText('GLYPHOR', { x: 0.6, y: 1.8, w: 8.8, fontSize: 28, color: SLIDE_CYAN, fontFace: FONT_HEADING, bold: true, align: 'center', charSpacing: 6 });
    slide.addText('Strategic Intelligence Platform', { x: 0.6, y: 2.9, w: 8.8, fontSize: 14, color: SLIDE_MUTED, fontFace: FONT_BODY, align: 'center' });
    slide.addText(`Generated ${new Date().toLocaleDateString()} · Confidential`, { x: 0.6, y: 3.5, w: 8.8, fontSize: 10, color: SLIDE_MUTED, fontFace: FONT_BODY, align: 'center' });
    addSlideFooter(slide, pptx);
  }

  return writePptxBuffer(pptx);
}

/* â”€â”€ Strategy Lab v2: DOCX â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

export async function exportStrategyLabDOCX(record: StrategyAnalysisRecord): Promise<Buffer> {
  const templated = await renderTemplateDocument('docx', buildStrategyTemplateVars(record));
  if (templated) return templated;

  const s = record.synthesis;
  const typeLabel = cleanMojibakeText(record.analysis_type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));

  const children: (Paragraph | Table)[] = [];

  // Branded header
  children.push(new Paragraph({
    spacing: { after: 60 },
    children: [new TextRun({ text: 'GLYPHOR', bold: true, size: 20, color: '00E0FF', font: 'Segoe UI' })],
  }));
  children.push(new Paragraph({
    spacing: { after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '00E0FF', space: 6 } },
    children: [],
  }));

  // Title block
  children.push(new Paragraph({
    spacing: { before: 200, after: 80 },
    children: [new TextRun({ text: `Strategic Analysis: ${typeLabel}`, bold: true, size: 48, font: 'Segoe UI', color: 'E5E7EB' })],
  }));
  children.push(new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({ text: cleanMojibakeText(record.query), italics: true, size: 24, color: 'B0B8C4', font: 'Segoe UI' })],
  }));
  children.push(new Paragraph({
    spacing: { after: 400 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: '2D3348', space: 12 } },
    children: [
      new TextRun({ text: `Depth: ${record.depth}`, size: 18, color: '8B95A5', font: 'Segoe UI' }),
      new TextRun({ text: `  ·  Sources: ${record.total_sources}`, size: 18, color: '8B95A5', font: 'Segoe UI' }),
      new TextRun({ text: `  ·  Searches: ${record.total_searches}`, size: 18, color: '8B95A5', font: 'Segoe UI' }),
      new TextRun({ text: `  ·  Date: ${new Date(record.created_at).toLocaleDateString()}`, size: 18, color: '8B95A5', font: 'Segoe UI' }),
    ],
  }));

  if (!s) {
    children.push(new Paragraph({ children: [new TextRun({ text: 'Report not yet generated.', italics: true })] }));
    return writeDocxBuffer(new Document({ background: { color: '0F1117' }, sections: [{ children }] }));
  }

  // Executive Summary
  children.push(...docxSectionHeading('Executive Summary', '00E0FF'));
  for (const para of cleanMojibakeText(s.executiveSummary).split('\n').filter(Boolean)) {
    children.push(new Paragraph({
      spacing: { after: 160 },
      children: [new TextRun({ text: para, size: 22, font: 'Segoe UI', color: 'E5E7EB' })],
    }));
  }

  // Cross-Framework Insights
  if (s.crossFrameworkInsights.length > 0) {
    children.push(...docxSectionHeading('Cross-Framework Insights', 'D97706'));
    for (const insight of s.crossFrameworkInsights) {
      children.push(docxBulletItem(cleanMojibakeText(insight), '3D3D3D'));
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
        cellChildren.push(new Paragraph({ children: [new TextRun({ text: 'None identified', italics: true, size: 18, color: '6B7280', font: 'Segoe UI' })] }));
      } else {
        for (const item of items) {
          cellChildren.push(new Paragraph({
            bullet: { level: 0 },
            spacing: { after: 60 },
            children: [new TextRun({ text: item, size: 19, color: 'C4C9D4', font: 'Segoe UI' })],
          }));
        }
      }
      cells.push(new TableCell({
        width: { size: 50, type: WidthType.PERCENTAGE },
        borders: {
          top: { style: BorderStyle.SINGLE, size: 3, color },
          bottom: { style: BorderStyle.SINGLE, size: 1, color: '2D3348' },
          left: { style: BorderStyle.SINGLE, size: 1, color: '2D3348' },
          right: { style: BorderStyle.SINGLE, size: 1, color: '2D3348' },
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
    children.push(...docxSectionHeading('Strategic Recommendations', '00E0FF'));
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
          new TextRun({ text: `${i + 1}. `, bold: true, size: 22, color: '00E0FF', font: 'Segoe UI' }),
          new TextRun({ text: rec.title, bold: true, size: 22, font: 'Segoe UI', color: 'E5E7EB' }),
          new TextRun({ text: `  [${rec.impact.toUpperCase()} IMPACT]`, bold: true, size: 18, color: impactColor, font: 'Segoe UI' }),
        ],
      }));
      children.push(new Paragraph({
        spacing: { after: 60 },
        indent: { left: convertInchesToTwip(0.3) },
        children: [new TextRun({ text: rec.description, size: 21, color: 'C4C9D4', font: 'Segoe UI' })],
      }));
      children.push(new Paragraph({
        spacing: { after: 40 },
        indent: { left: convertInchesToTwip(0.3) },
        children: [
          new TextRun({ text: 'Owner: ', bold: true, size: 18, color: '9CA3AF', font: 'Segoe UI' }),
          new TextRun({ text: rec.owner, size: 18, color: 'D1D5DB', font: 'Segoe UI' }),
          new TextRun({ text: '  ·  Expected: ', bold: true, size: 18, color: '9CA3AF', font: 'Segoe UI' }),
          new TextRun({ text: rec.expectedOutcome, size: 18, color: 'D1D5DB', font: 'Segoe UI' }),
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
      children.push(docxBulletItem(cleanMojibakeText(risk), '555555'));
    }
  }

  // Open Questions
  if (s.openQuestionsForFounders.length > 0) {
    children.push(...docxSectionHeading('Open Questions for Founders', 'D97706'));
    for (const q of s.openQuestionsForFounders) {
      children.push(docxBulletItem(cleanMojibakeText(q), '555555'));
    }
  }

  // Footer
  children.push(new Paragraph({
    spacing: { before: 600 },
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: '00E0FF', space: 12 } },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: `Glyphor AI · Strategy Lab · ${new Date().toLocaleDateString()} · Confidential`, size: 16, color: '6B7280', font: 'Segoe UI' })],
  }));

  return writeDocxBuffer(new Document({
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

/* â”€â”€ Strategy Lab v2: Visual Prompt â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

type InfographicReportType = 'competitive_landscape' | 'market_analysis' | 'company_deep_dive' | 'strategy_brief';
type ChartType = 'bar' | 'radar' | 'area' | 'donut';

interface InfographicCenterTile {
  title: string;
  icon_hint: string;
  callouts: string[];
  caption: string;
}

interface InfographicChartItem {
  label: string;
  rating: string;
}

interface StrategyInfographicVariables {
  report_title: string;
  report_subtitle: string;
  subject_company: string;
  subject_color: string;
  report_date: string;
  report_type: InfographicReportType;

  left_section_title: string;
  left_primary_metric: string;
  left_primary_detail: string;
  left_secondary_metrics: string[];

  center_section_title: string;
  center_tiles: InfographicCenterTile[];

  right_section_title: string;
  right_chart_title: string;
  right_chart_items: InfographicChartItem[];
  right_context_box: string;
  right_bullets_title: string;
  right_bullets: string[];

  custom_motifs: string;
  chart_type: ChartType;
}

interface InfographicPreset {
  left_section_title: string;
  center_section_title: string;
  right_section_title: string;
  right_bullets_title: string;
  chart_type: ChartType;
  custom_motifs: string;
  center_tile_defaults: Array<{ title: string; icon_hint: string }>;
}

const INFOGRAPHIC_BRAND = {
  company: 'Glyphor, Inc.',
  primary_color: '#00E0FF',
  secondary_color: '#00A3FF',
  accent_color: '#6E77DF',
  tertiary_color: '#1171ED',
  background_base: '#0A0E17',
  background_surface: '#111827',
  text_primary: '#E5E7EB',
  text_secondary: '#9CA3AF',
  text_muted: '#6B7280',
  footer: '© Glyphor, Inc. All rights reserved. | Powered by Glyphor Intelligence',
} as const;

const INFOGRAPHIC_PRESETS: Record<InfographicReportType, InfographicPreset> = {
  competitive_landscape: {
    left_section_title: 'Market Snapshot',
    center_section_title: 'Competitive Dynamics',
    right_section_title: 'Strategic Outlook',
    right_bullets_title: 'Strategic Recommendations',
    chart_type: 'bar',
    custom_motifs: 'radar sweeps, competitive grid overlays',
    center_tile_defaults: [
      { title: 'Market Leaders', icon_hint: 'crown or podium icon' },
      { title: 'Emerging Threats', icon_hint: 'radar or rising arrow icon' },
      { title: 'Whitespace Opportunities', icon_hint: 'target or gap-in-grid icon' },
    ],
  },
  market_analysis: {
    left_section_title: 'Market Size & Growth',
    center_section_title: 'Key Market Dynamics',
    right_section_title: 'Forecast & Implications',
    right_bullets_title: 'Market Implications',
    chart_type: 'area',
    custom_motifs: 'trend lines, growth curves',
    center_tile_defaults: [
      { title: 'Demand Drivers', icon_hint: 'upward trend or fuel icon' },
      { title: 'Supply Landscape', icon_hint: 'factory or network icon' },
      { title: 'Regulatory & Risk', icon_hint: 'shield or balance scale icon' },
    ],
  },
  company_deep_dive: {
    left_section_title: 'Financial Highlights',
    center_section_title: 'Strategic Portfolio',
    right_section_title: 'Outlook & Positioning',
    right_bullets_title: 'Key Takeaways',
    chart_type: 'bar',
    custom_motifs: 'organizational charts, building blocks',
    center_tile_defaults: [
      { title: 'Core Business', icon_hint: 'building or foundation icon' },
      { title: 'Growth Bets', icon_hint: 'rocket or expansion icon' },
      { title: 'Risk Factors', icon_hint: 'warning triangle or fault-line icon' },
    ],
  },
  strategy_brief: {
    left_section_title: 'Situation Assessment',
    center_section_title: 'Strategic Options',
    right_section_title: 'Recommended Path',
    right_bullets_title: 'Next Steps',
    chart_type: 'radar',
    custom_motifs: 'chess pieces, decision trees',
    center_tile_defaults: [
      { title: 'Option A', icon_hint: 'path-fork or door icon' },
      { title: 'Option B', icon_hint: 'alternate path or pivot icon' },
      { title: 'Option C', icon_hint: 'third route or bridge icon' },
    ],
  },
};

function toWords(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

function clampWords(text: string, maxWords: number, addEllipsis = true): string {
  const words = toWords(text);
  if (words.length <= maxWords) return text.trim();
  const trimmed = words.slice(0, maxWords).join(' ');
  return addEllipsis ? `${trimmed}...` : trimmed;
}

function normalizePhrase(value: string | undefined, fallback = 'N/A'): string {
  const text = (value || '').replace(/\s+/g, ' ').trim();
  return text.length > 0 ? text : fallback;
}

function ensureCount<T>(items: T[], count: number, filler: T): T[] {
  const next = [...items];
  while (next.length < count) next.push(filler);
  return next.slice(0, count);
}

function formatTypeLabel(raw: string): string {
  return raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function hasComparableRatingScale(items: InfographicChartItem[]): boolean {
  const allowed = new Set(['LOW', 'MODERATE', 'HIGH', 'CRITICAL']);
  return items.every((item) => allowed.has(item.rating));
}

function startsWithActionVerb(value: string): boolean {
  const first = value.trim().split(/\s+/)[0]?.toLowerCase() || '';
  const verbs = new Set([
    'own', 'target', 'build', 'launch', 'optimize', 'prioritize', 'reduce', 'increase', 'expand', 'focus',
    'define', 'secure', 'improve', 'accelerate', 'invest', 'execute', 'deploy', 'lead', 'strengthen', 'establish',
  ]);
  return verbs.has(first);
}

function validateInfographicVariables(vars: StrategyInfographicVariables): string[] {
  const issues: string[] = [];

  if (vars.report_title.length > 80) issues.push('Title exceeds 80 characters.');
  if (vars.report_subtitle.length > 120) issues.push('Subtitle exceeds 120 characters.');

  if (!/\d/.test(vars.left_primary_metric)) {
    issues.push('Primary metric must include a number.');
  }
  if (toWords(vars.left_primary_metric).length < 4) {
    issues.push('Primary metric must include context, not just a short value token.');
  }

  if (vars.center_tiles.length !== 3) {
    issues.push('Center section must have exactly 3 tiles.');
  }
  vars.center_tiles.forEach((tile, idx) => {
    if (tile.callouts.length !== 3) {
      issues.push(`Center tile ${idx + 1} must have exactly 3 callouts.`);
    }
    tile.callouts.forEach((callout, calloutIdx) => {
      if (toWords(callout).length > 15) {
        issues.push(`Center tile ${idx + 1} callout ${calloutIdx + 1} exceeds 15 words.`);
      }
    });
  });

  if (!hasComparableRatingScale(vars.right_chart_items)) {
    issues.push('Chart items must use comparable rating scale values (LOW|MODERATE|HIGH|CRITICAL).');
  }

  vars.right_bullets.forEach((bullet, idx) => {
    if (!startsWithActionVerb(bullet)) {
      issues.push(`Right-section bullet ${idx + 1} is not action-oriented.`);
    }
  });

  const placeholderPattern = /\b(?:N\/A|placeholder|tbd|todo)\b/i;
  const fieldsToCheck = [
    vars.report_title,
    vars.report_subtitle,
    vars.subject_company,
    vars.left_primary_metric,
    vars.left_primary_detail,
    vars.right_context_box,
    ...vars.left_secondary_metrics,
    ...vars.right_bullets,
    ...vars.right_chart_items.map((x) => `${x.label} ${x.rating}`),
    ...vars.center_tiles.flatMap((t) => [t.title, t.caption, ...t.callouts]),
  ];
  if (fieldsToCheck.some((value) => placeholderPattern.test(value))) {
    issues.push('Template contains placeholder text (N/A / TBD / TODO / placeholder).');
  }

  if (/glyphor/i.test(vars.subject_company)) {
    issues.push('subject_company must be analyzed entity/market, not Glyphor.');
  }
  if (!/^#[0-9A-Fa-f]{6}$/.test(vars.subject_color)) {
    issues.push('subject_color must be a valid hex color (e.g. #00E0FF).');
  }

  if (INFOGRAPHIC_BRAND.footer.trim().length === 0) {
    issues.push('Footer text is missing.');
  }

  return issues;
}

function inferInfographicReportType(record: StrategyAnalysisRecord): InfographicReportType {
  switch (record.analysis_type) {
    case 'competitive_landscape':
      return 'competitive_landscape';
    case 'market_opportunity':
      return 'market_analysis';
    case 'due_diligence':
      return 'company_deep_dive';
    case 'product_strategy':
    case 'growth_diagnostic':
    case 'risk_assessment':
    case 'market_entry':
    default:
      return 'strategy_brief';
  }
}

function inferSubjectCompany(query: string): string {
  const quoted = query.match(/["'“”]([^"'“”]{2,80})["'“”]/);
  if (quoted?.[1]) return quoted[1].trim();

  const forMatch = query.match(/\bfor\s+([^,.!?]{2,80})/i);
  if (forMatch?.[1]) return forMatch[1].trim();

  const words = toWords(query);
  if (words.length <= 6) return query.trim();
  return 'Analyzed Market';
}

function deriveTemplateVariables(record: StrategyAnalysisRecord): StrategyInfographicVariables {
  const synthesis = record.synthesis;
  const reportType = inferInfographicReportType(record);
  const preset = INFOGRAPHIC_PRESETS[reportType];
  const typeLabel = formatTypeLabel(record.analysis_type);
  const summary = normalizePhrase(synthesis?.executiveSummary, 'N/A');
  const strengths = synthesis?.unifiedSwot?.strengths ?? [];
  const weaknesses = synthesis?.unifiedSwot?.weaknesses ?? [];
  const opportunities = synthesis?.unifiedSwot?.opportunities ?? [];
  const threats = synthesis?.unifiedSwot?.threats ?? [];
  const insights = synthesis?.crossFrameworkInsights ?? [];
  const recommendations = synthesis?.strategicRecommendations ?? [];
  const risks = synthesis?.keyRisks ?? [];
  const questions = synthesis?.openQuestionsForFounders ?? [];

  const leftSecondaryRaw = [
    `${record.total_sources} sources triangulated across market evidence`,
    `${record.total_searches} search runs completed during research`,
    `Confidence: ${normalizePhrase(record.overall_confidence ?? undefined, 'medium').toUpperCase()}`,
    `SWOT coverage: S${strengths.length}/W${weaknesses.length}/O${opportunities.length}/T${threats.length}`,
  ];

  const calloutSource = ensureCount(
    [...insights.slice(0, 3), ...recommendations.map((r) => r.title), ...risks],
    9,
    'N/A',
  );

  const centerTiles: InfographicCenterTile[] = [0, 1, 2].map((idx) => {
    const defaults = preset.center_tile_defaults[idx];
    const callouts = calloutSource.slice(idx * 3, idx * 3 + 3).map((x) => clampWords(normalizePhrase(x), 15));
    const caption = idx === 0
      ? clampWords(normalizePhrase(insights[0], 'Market structure favors focused execution.'), 18)
      : idx === 1
        ? clampWords(normalizePhrase(risks[0], 'Execution risk rises without clear differentiation.'), 18)
        : clampWords(normalizePhrase(recommendations[0]?.expectedOutcome, 'Category ownership remains open for first movers.'), 18);
    return {
      title: defaults.title,
      icon_hint: defaults.icon_hint,
      callouts,
      caption,
    };
  });

  const chartItems = ensureCount(
    [...threats, ...risks].slice(0, 5).map((item) => ({
      label: clampWords(normalizePhrase(item), 6),
      rating: /critical|severe|existential/i.test(item)
        ? 'CRITICAL'
        : /high|major|intense/i.test(item)
          ? 'HIGH'
          : 'MODERATE',
    })),
    4,
    { label: 'N/A', rating: 'MODERATE' },
  );

  const rightBullets = ensureCount(
    recommendations.slice(0, 4).map((rec) => {
      const verb = normalizePhrase(rec.title || rec.description, 'Act on strategic priority');
      return clampWords(verb, 15);
    }),
    3,
    'N/A',
  );

  const subjectCompany = inferSubjectCompany(record.query);

  const reportTitle = clampWords(`${formatTypeLabel(record.analysis_type)} - ${subjectCompany}`, 14);
  const reportSubtitle = clampWords(record.query, 18);

  return {
    report_title: truncate(reportTitle, 80),
    report_subtitle: truncate(reportSubtitle, 120),
    subject_company: subjectCompany,
    subject_color: INFOGRAPHIC_BRAND.primary_color,
    report_date: new Date(record.created_at).toLocaleDateString(),
    report_type: reportType,

    left_section_title: preset.left_section_title,
    left_primary_metric: normalizePhrase(
      recommendations[0]?.title
        ? `Top Priority: ${recommendations[0].title}`
        : `${typeLabel} Snapshot`,
      'Top Priority: N/A',
    ),
    left_primary_detail: normalizePhrase(
      recommendations[0]?.expectedOutcome || summary,
      'N/A',
    ),
    left_secondary_metrics: leftSecondaryRaw.map((x) => clampWords(normalizePhrase(x), 15)).slice(0, 4),

    center_section_title: preset.center_section_title,
    center_tiles: centerTiles,

    right_section_title: preset.right_section_title,
    right_chart_title: 'Threat Level by Segment',
    right_chart_items: chartItems,
    right_context_box: clampWords(normalizePhrase(summary), 28),
    right_bullets_title: preset.right_bullets_title,
    right_bullets: rightBullets,

    custom_motifs: preset.custom_motifs,
    chart_type: preset.chart_type,
  };
}

export function buildStrategyLabVisualPrompt(record: StrategyAnalysisRecord): string {
  if (!record.synthesis) return '';
  const vars = deriveTemplateVariables(record);
  const validationIssues = validateInfographicVariables(vars);
  if (validationIssues.length > 0) {
    console.warn(
      `[ReportTemplate] Infographic template validation issues detected; continuing with sanitized prompt variables:\n- ${validationIssues.join('\n- ')}`,
    );
  }

  const summaryText = normalizePhrase(record.synthesis.executiveSummary, 'No summary provided.');
  const summaryPoints = summaryText
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 5)
    .map((s) => clampWords(sanitizePromptSentence(s), 24, false));

  const topActions = (record.synthesis.strategicRecommendations ?? [])
    .slice(0, 3)
    .map((rec) => clampWords(sanitizePromptSentence(normalizePhrase(rec.title || rec.description, 'Action item')), 16, false));

  const keyRisks = (record.synthesis.keyRisks ?? [])
    .slice(0, 2)
    .map((r) => clampWords(sanitizePromptSentence(normalizePhrase(r)), 18, false));
  const openQuestions = (record.synthesis.openQuestionsForFounders ?? [])
    .slice(0, 2)
    .map((q) => clampWords(sanitizePromptSentence(normalizePhrase(q)), 18, false));

  const swot = record.synthesis.unifiedSwot;
  const swotCounts = `S${swot.strengths.length} / W${swot.weaknesses.length} / O${swot.opportunities.length} / T${swot.threats.length}`;

  const compactSummary = (summaryPoints.length > 0 ? summaryPoints : ['No summary points available'])
    .slice(0, 4);

  const pointsBlock = compactSummary
    .map((pt, i) => `${i + 1}. ${pt}`)
    .join('\n');

  const actionsBlock = (topActions.length > 0 ? topActions : ['No action provided'])
    .map((a, i) => `${i + 1}. ${a}`)
    .join('\n');

  return [
    `A professional corporate infographic in 16:9 landscape format titled "${vars.report_title}".`,
    `Subtitle: "${vars.report_subtitle}".`,
    '',
    'VISUAL DIRECTION (TARGET QUALITY):',
    '- White background, modern flat corporate design, clean sans-serif typography',
    `- Primary accent color: ${INFOGRAPHIC_BRAND.primary_color}; secondary accents: #E8EEF5 and #D7E9F7`,
    '- Clear section headings, subtle shadows, rounded cards, strong grid alignment, generous whitespace',
    '- Executive-ready PowerPoint-slide aesthetic, highly legible text',
    '',
    'HEADER STRIP:',
    `- Left: simple wordmark text "${vars.subject_company}" (do NOT draw a custom logo mark)` ,
    '- Center: report title',
    `- Right: date badge "${vars.report_date}"`,
    '',
    'TOP METRIC BAND (3 CARDS):',
    `1) "Confidence: ${normalizePhrase(record.overall_confidence ?? undefined, 'medium').toUpperCase()}"`,
    `2) "Research Coverage: ${record.total_sources} sources / ${record.total_searches} searches"`,
    `3) "SWOT Balance: ${swotCounts}"`,
    'Each card has a small business icon, soft drop shadow, and bold key number.',
    '',
    'LEFT MIDDLE PANEL — EXECUTIVE SUMMARY SNAPSHOT:',
    '- Use 3 concise insight tiles based ONLY on the summary points below:',
    pointsBlock,
    '',
    'RIGHT MIDDLE PANEL — PRIORITY ACTIONS:',
    '- Show as a compact list with icon bullets:',
    actionsBlock,
    '',
    'BOTTOM LEFT PANEL — RISKS:',
    ...(keyRisks.length > 0
      ? keyRisks.map((r, i) => `${i + 1}) ${r}`)
      : ['1) No high-severity risks captured']),
    '',
    'BOTTOM RIGHT PANEL — OPEN QUESTIONS:',
    ...(openQuestions.length > 0
      ? openQuestions.map((q, i) => `${i + 1}) ${q}`)
      : ['1) No open questions captured']),
    '',
    'FOOTER:',
    '- Thin light-gray footer bar with centered small text: "Confidential strategic briefing"',
    '',
    'STRICT OUTPUT RULES:',
    '- Use only the provided text content; do not invent company names, labels, or random words',
    '- Use correct English spelling only; absolutely no gibberish or pseudo-text',
    '- Keep every text block readable with normal line-wrapping (do not shrink text excessively)',
    '- Prefer sentence compression over truncation; do NOT append new ellipses unless source text already contains them verbatim',
    '- Keep icon style consistent across all panels',
  ].join('\n');
}

function sanitizePromptSentence(text: string): string {
  const cleaned = text
    .replace(/[\u2026]/g, '...')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.replace(/\.\.\.$/, '').trim();
}

/** Truncate a string to maxLen chars, adding "â€¦" if needed */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}
