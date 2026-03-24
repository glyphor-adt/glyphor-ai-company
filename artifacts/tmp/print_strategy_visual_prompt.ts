import { Client } from 'pg';

type StrategyRow = {
  id: string;
  query: string;
  analysis_type: string;
  depth: string;
  total_sources: number;
  total_searches: number;
  overall_confidence: string | null;
  synthesis: unknown;
};

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}

function buildStrategyLabVisualPrompt(record: any): string {
  const s = record.synthesis;
  if (!s) return '';

  const typeLabel = String(record.analysis_type)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  const topStrengths = (s.unifiedSwot?.strengths ?? []).slice(0, 3).map((t: string) => truncate(t, 60));
  const topThreats = (s.unifiedSwot?.threats ?? []).slice(0, 2).map((t: string) => truncate(t, 60));
  const topRecs = (s.strategicRecommendations ?? []).slice(0, 4);
  const topInsights = (s.crossFrameworkInsights ?? []).slice(0, 3).map((t: string) => truncate(t, 70));
  const topRisks = (s.keyRisks ?? []).slice(0, 3).map((t: string) => truncate(t, 60));
  const summaryShort = truncate(String(s.executiveSummary ?? ''), 200);

  const recLines = topRecs
    .map((r: any, i: number) => {
      const impactColor =
        r.impact === 'high' ? 'red (#FB7185)' : r.impact === 'medium' ? 'amber (#FBBF24)' : 'blue (#60A5FA)';
      return `  ${i + 1}. "${truncate(String(r.title ?? ''), 40)}" — ${impactColor} badge, owner: ${String(r.owner ?? '')}`;
    })
    .join('\n');

  const sourceCount = Number(record.total_sources ?? 0);
  const searchCount = Number(record.total_searches ?? 0);
  const confidence = String(record.overall_confidence ?? 'medium');

  return [
    'Create a polished, executive-quality strategy infographic in 16:9 landscape format (1536x1024px).',
    'Style: modern flat design, dark charcoal (#0F1117) background, generous whitespace. Use bold typography, color-coded cards, and data callouts. This should read like a strategy consulting deliverable, not a generic chart.',
    '',
    'Color palette: cyan (#00E0FF), charcoal (#1A1A2E), emerald (#34D399), rose (#FB7185), amber (#FBBF24), soft gray (#F3F4F6) for backgrounds.',
    '',
    'LAYOUT:',
    '',
    'TOP BANNER (8%):',
    `Full-width dark charcoal banner. Bold white title: "${typeLabel.toUpperCase()}". Subtitle in gray: "${truncate(String(record.query ?? ''), 80)}". Right-aligned: "${sourceCount} sources · ${searchCount} searches · ${confidence} confidence".`,
    '',
    'SECTION 1 — Executive Summary (20%):',
    'A single wide card with a thin cyan left border. Inside, render this text in clean 14px charcoal type:',
    `"${summaryShort}"`,
    '',
    'SECTION 2 — Key Findings (35%), split into 2 columns:',
    '',
    'LEFT — "Strategic Advantages" (emerald header bar):',
    ...topStrengths.map((x: string) => `  • ${x}`),
    'Show each as a short line with an emerald dot. Clean and readable.',
    '',
    'RIGHT — "Critical Insights" (cyan header bar):',
    ...topInsights.map((x: string) => `  • ${x}`),
    'Show each as a short line with a cyan dot.',
    '',
    'SECTION 3 — Recommendations & Risks (30%), split into 2 columns:',
    '',
    'LEFT — "Strategic Actions" with color-coded priority badges:',
    recLines,
    'Each recommendation is a card row with the priority badge, title, and owner.',
    '',
    'RIGHT — "Key Risks & Threats" (rose header bar):',
    ...[...topThreats, ...topRisks].slice(0, 4).map((r: string) => `  - ${r}`),
    'Show each as a short line with a rose warning icon.',
    '',
    'BOTTOM FOOTER (7%):',
    `Thin gray strip. Left: "${String(record.depth ?? 'standard')} depth · ${String(record.analysis_type ?? '').replace(/_/g, ' ')}". Right: "Glyphor Strategy Lab"`,
    '',
    'CRITICAL RULES:',
    '- This infographic MUST contain REAL findings from the analysis — not just counts.',
    '- Use short phrases (5-12 words each), not sentences or paragraphs.',
    '- Maximum 120 words on the entire infographic.',
    '- Professional consulting aesthetic: clean typography, color-coded sections, clear hierarchy.',
    '- All text must be legible — minimum 11px equivalent, sans-serif.',
    '- Do NOT include any "Powered by" branding.',
  ].join('\n');
}

async function main() {
  const client = new Client({
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? '15432'),
    database: process.env.DB_NAME ?? 'glyphor',
    user: process.env.DB_USER ?? 'glyphor_app',
    password: process.env.DB_PASSWORD,
  });

  await client.connect();
  try {
    const result = await client.query<StrategyRow>(
      `SELECT id, query, analysis_type, depth, total_sources, total_searches, overall_confidence, synthesis
       FROM strategy_analyses
       WHERE synthesis IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 1`,
    );

    const row = result.rows[0];
    if (!row) {
      console.log('No strategy_analyses row with synthesis found.');
      return;
    }

    const record = {
      id: row.id,
      query: row.query,
      analysis_type: row.analysis_type,
      depth: row.depth,
      total_sources: row.total_sources,
      total_searches: row.total_searches,
      overall_confidence: row.overall_confidence,
      synthesis: row.synthesis,
    } as any;

    const prompt = buildStrategyLabVisualPrompt(record);

    console.log(`Analysis ID: ${row.id}`);
    console.log('---BEGIN EXPANDED VISUAL PROMPT---');
    console.log(prompt);
    console.log('---END EXPANDED VISUAL PROMPT---');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Failed to print strategy visual prompt:', err?.message ?? err);
  process.exit(1);
});
