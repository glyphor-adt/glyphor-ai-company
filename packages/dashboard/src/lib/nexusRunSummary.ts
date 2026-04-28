/**
 * Parse legacy Nexus daily_analysis output: optional markdown lead + JSON block,
 * or JSON-only — produce a human-readable markdown summary for the Activity UI.
 */

export type NexusReportJson = {
  gtm_status?: string;
  agents_analyzed?: number;
  autonomous_actions?: Array<{ action?: string; target?: string; outcome?: string }>;
  tool_diagnoses?: Array<{ tool?: string; root_cause?: string; fix_action?: string }>;
  fix_proposals_created?: Array<{ tool?: string; severity?: string; proposal_id?: string }>;
  approval_requests?: Array<{ title?: string; urgency?: string; target?: string }>;
  blocking_issues?: string[];
  fleet_summary?: { healthy?: number; degraded?: number; unhealthy?: number };
  next_focus?: string;
};

function tryParseJsonObject(raw: string): NexusReportJson | null {
  try {
    const o = JSON.parse(raw) as unknown;
    if (o && typeof o === 'object' && 'gtm_status' in (o as Record<string, unknown>)) {
      return o as NexusReportJson;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Extract ```json ... ``` body if present. */
function extractJsonFence(output: string): { before: string; jsonBody: string | null } {
  const m = output.match(/```json\s*([\s\S]*?)```/i);
  if (!m) return { before: output.trim(), jsonBody: null };
  const idx = m.index ?? 0;
  const before = output.slice(0, idx).trim();
  return { before, jsonBody: m[1].trim() };
}

/** Heuristic: loose JSON object containing gtm_status (no fence). */
function extractLooseJson(output: string): NexusReportJson | null {
  const start = output.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < output.length; i++) {
    const c = output[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        const slice = output.slice(start, i + 1);
        return tryParseJsonObject(slice);
      }
    }
  }
  return null;
}

function synthesizeMarkdownFromJson(j: NexusReportJson): string {
  const lines: string[] = [];

  if (j.gtm_status) {
    lines.push(`- **GTM:** ${String(j.gtm_status).replace(/\|/g, '·')}`);
  }
  if (j.agents_analyzed != null) {
    lines.push(`- **Fleet analyzed:** ${j.agents_analyzed} agents`);
  }
  const fs = j.fleet_summary;
  if (fs && (fs.healthy != null || fs.degraded != null || fs.unhealthy != null)) {
    lines.push(
      `- **Fleet shape:** ${fs.healthy ?? '—'} healthy · ${fs.degraded ?? '—'} degraded · ${fs.unhealthy ?? '—'} unhealthy`,
    );
  }

  const actions = j.autonomous_actions?.filter((a) => a && (a.action || a.outcome));
  if (actions?.length) {
    lines.push('');
    lines.push('**Autonomous actions**');
    for (const a of actions.slice(0, 8)) {
      const who = a.target ? ` **${a.target}**` : '';
      const act = a.action ?? 'action';
      const out = a.outcome ? ` — ${a.outcome}` : '';
      lines.push(`- *${act}*${who}:${out}`);
    }
    if (actions.length > 8) {
      lines.push(`- _…and ${actions.length - 8} more_`);
    }
  }

  const diagnoses = j.tool_diagnoses?.filter((d) => d?.tool);
  if (diagnoses?.length) {
    lines.push('');
    lines.push('**Tool diagnoses**');
    for (const d of diagnoses.slice(0, 5)) {
      lines.push(`- **${d.tool}:** ${d.root_cause ?? d.fix_action ?? 'see report'}`);
    }
  }

  const approvals = j.approval_requests?.filter((r) => r?.title);
  if (approvals?.length) {
    lines.push('');
    lines.push('**Approval requests**');
    for (const r of approvals.slice(0, 5)) {
      lines.push(`- [${r.urgency ?? 'normal'}] ${r.title}${r.target ? ` → ${r.target}` : ''}`);
    }
  }

  const blockers = j.blocking_issues?.filter(Boolean);
  if (blockers?.length) {
    lines.push('');
    lines.push('**Blocking issues**');
    for (const b of blockers.slice(0, 6)) {
      lines.push(`- ${b}`);
    }
  }

  if (j.next_focus) {
    lines.push('');
    lines.push(`**Next focus:** ${j.next_focus}`);
  }

  return lines.join('\n').trim();
}

/**
 * Markdown to show above raw output for Nexus runs.
 * - Uses prose before ```json if the model followed the new prompt.
 * - Otherwise parses JSON and builds bullets (works for older JSON-only runs).
 */
export function buildNexusHumanSummaryMarkdown(output: string): string | null {
  if (!output.trim()) return null;

  const { before, jsonBody } = extractJsonFence(output);
  const parsedFromFence = jsonBody ? tryParseJsonObject(jsonBody) : null;
  const parsedLoose = parsedFromFence ?? extractLooseJson(output);

  // Explicit human section headings (new prompt)
  const humanHeading = /^(#[^\n]+|##\s*Human summary\b)/im;
  if (before.length > 40 && (humanHeading.test(before) || !before.trimStart().startsWith('{'))) {
    return before;
  }

  if (parsedLoose) {
    const synth = synthesizeMarkdownFromJson(parsedLoose);
    return synth.length > 0 ? synth : null;
  }

  return null;
}

export function isLikelyNexusStructuredOutput(output: string): boolean {
  return /```json\s*[\s\S]*"gtm_status"/i.test(output) || /"gtm_status"\s*:/.test(output);
}
