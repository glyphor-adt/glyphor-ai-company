/**
 * scripts/audit/analyze-briefs.ts
 *
 * Reads every agent brief and produces a token efficiency report.
 * Classifies each section as identity, skill, knowledge, anti-pattern, or mixed.
 * Usage:  npx tsx scripts/audit/analyze-briefs.ts
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { systemQuery } from '@glyphor/shared/db';

// ── Types ──────────────────────────────────────────────────

interface SectionAnalysis {
  heading: string;
  tokens: number;
  classification: 'identity' | 'skill' | 'knowledge' | 'anti-pattern' | 'mixed';
  recommendation: string;
}

interface BriefAnalysis {
  role: string;
  displayName: string;
  path: string;
  totalTokens: number;
  sections: SectionAnalysis[];
  identityTokens: number;
  nonIdentityTokens: number;
  efficiency: number;
}

// ── Constants ──────────────────────────────────────────────

const ROOT = path.resolve(process.cwd());
const BRIEFS_DIR = path.join(ROOT, 'packages', 'company-knowledge', 'briefs');

// ── Token estimation ───────────────────────────────────────

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ── Classification patterns ────────────────────────────────

const SKILL_PATTERNS = [
  /step \d+[.:]/i,
  /when .{3,40} then .{3,}/i,
  /use (?:the )?[`"]?[\w-]+[`"]? tool/i,
  /call .{3,30} with/i,
  /format:\s*\n/i,
  /template:/i,
  /```[\s\S]{50,}```/m,
  /procedure|workflow as follows/i,
];

const KNOWLEDGE_PATTERNS = [
  /\$[\d,]+/,
  /\d{2,}%/,
  /https?:\/\//i,
  /as of \w+ \d{4}/i,
  /current(?:ly)? .{3,30} is/i,
  /\d+\.\d+\.\d+/,   // version numbers
];

const IDENTITY_PATTERNS = [
  /your (?:identity|personality|voice|role|name|title)/i,
  /you are/i,
  /reports? to/i,
  /communicat(?:ion|e) style/i,
  /authority/i,
  /sign(?:s)? off with/i,
  /relationship/i,
  /personality/i,
  /backstory/i,
  /voice example/i,
  /core mission/i,
  /who you are/i,
];

function classifySection(heading: string, content: string): {
  classification: SectionAnalysis['classification'];
  recommendation: string;
} {
  const lower = heading.toLowerCase();

  // Anti-pattern sections
  if (/anti.?pattern|failure.?mode|never\sdo|avoid/i.test(lower)) {
    return { classification: 'anti-pattern', recommendation: 'Keep — anti-patterns belong in briefs.' };
  }

  const skillHits = SKILL_PATTERNS.filter(p => p.test(content)).length;
  const knowledgeHits = KNOWLEDGE_PATTERNS.filter(p => p.test(content)).length;
  const identityHits = IDENTITY_PATTERNS.filter(p => p.test(content)).length;

  if (skillHits > knowledgeHits && skillHits > identityHits) {
    return {
      classification: 'skill',
      recommendation: 'EXTRACT — Move procedural content to a skill .md file.',
    };
  }
  if (knowledgeHits > skillHits && knowledgeHits > identityHits) {
    return {
      classification: 'knowledge',
      recommendation: 'EXTRACT — Move facts/data to knowledge base.',
    };
  }
  if (identityHits > 0 || (skillHits === 0 && knowledgeHits === 0)) {
    return {
      classification: 'identity',
      recommendation: 'Keep — identity content belongs in briefs.',
    };
  }

  return {
    classification: 'mixed',
    recommendation: 'REVIEW — Split identity portions from procedural/knowledge content.',
  };
}

// ── Brief analysis ─────────────────────────────────────────

function analyzeBrief(filePath: string, role: string, displayName: string): BriefAnalysis {
  const text = readFileSync(filePath, 'utf-8');
  const totalTokens = estimateTokens(text);

  // Split into sections by markdown headings
  const headingRegex = /^#{1,3}\s+(.+)/gm;
  const headings: { heading: string; start: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(text)) !== null) {
    headings.push({ heading: match[1].trim(), start: match.index });
  }

  const sections: SectionAnalysis[] = [];
  for (let i = 0; i < headings.length; i++) {
    const end = i + 1 < headings.length ? headings[i + 1].start : text.length;
    const content = text.slice(headings[i].start, end);
    const tokens = estimateTokens(content);
    const { classification, recommendation } = classifySection(headings[i].heading, content);

    sections.push({ heading: headings[i].heading, tokens, classification, recommendation });
  }

  const identityTokens = sections
    .filter(s => s.classification === 'identity' || s.classification === 'anti-pattern')
    .reduce((sum, s) => sum + s.tokens, 0);
  const nonIdentityTokens = totalTokens - identityTokens;
  const efficiency = totalTokens > 0 ? identityTokens / totalTokens : 1;

  return {
    role,
    displayName,
    path: filePath,
    totalTokens,
    sections,
    identityTokens,
    nonIdentityTokens,
    efficiency,
  };
}

// ── Main ───────────────────────────────────────────────────

async function main() {
  // Map brief filenames to agent roles
  const agents = await systemQuery<{ role: string; display_name: string }>(
    `SELECT role, display_name FROM company_agents WHERE status = 'active' ORDER BY role`,
  );

  const roleBySlug = new Map<string, { role: string; displayName: string }>();
  for (const a of agents) {
    const nameSlug = a.display_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    roleBySlug.set(nameSlug, { role: a.role, displayName: a.display_name });
  }

  const briefFiles = readdirSync(BRIEFS_DIR).filter(f => f.endsWith('.md')).sort();
  const analyses: BriefAnalysis[] = [];

  console.log(`\n📄 Analyzing ${briefFiles.length} briefs...\n`);

  for (const file of briefFiles) {
    const nameSlug = file.replace('.md', '');
    const agentInfo = roleBySlug.get(nameSlug);
    const role = agentInfo?.role ?? nameSlug;
    const displayName = agentInfo?.displayName ?? nameSlug;
    const filePath = path.join(BRIEFS_DIR, file);

    const analysis = analyzeBrief(filePath, role, displayName);
    analyses.push(analysis);

    const status = analysis.totalTokens > 1200 ? '🔴' : analysis.totalTokens > 800 ? '🟡' : '🟢';
    console.log(`  ${status} ${role.padEnd(30)} ${String(analysis.totalTokens).padStart(5)} tokens  (${Math.round(analysis.efficiency * 100)}% identity)`);
  }

  // Sort by tokens descending
  analyses.sort((a, b) => b.totalTokens - a.totalTokens);

  // Fleet summary
  const totalTokens = analyses.reduce((s, a) => s + a.totalTokens, 0);
  const totalIdentity = analyses.reduce((s, a) => s + a.identityTokens, 0);
  const bloated = analyses.filter(a => a.totalTokens > 1200);
  const withSkillContent = analyses.filter(a => a.sections.some(s => s.classification === 'skill'));
  const withKnowledgeContent = analyses.filter(a => a.sections.some(s => s.classification === 'knowledge'));

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  BRIEF ANALYSIS SUMMARY`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Total briefs:          ${analyses.length}`);
  console.log(`  Total tokens:          ${totalTokens.toLocaleString()}`);
  console.log(`  Identity tokens:       ${totalIdentity.toLocaleString()} (${Math.round(totalIdentity / totalTokens * 100)}%)`);
  console.log(`  Non-identity tokens:   ${(totalTokens - totalIdentity).toLocaleString()} (${Math.round((totalTokens - totalIdentity) / totalTokens * 100)}%)`);
  console.log(`  Fleet efficiency:      ${Math.round(totalIdentity / totalTokens * 100)}%`);
  console.log(`\n  🔴 Briefs > 1200 tokens:         ${bloated.length}`);
  for (const b of bloated) {
    console.log(`     ${b.role}: ${b.totalTokens} tokens (${Math.round(b.efficiency * 100)}% identity)`);
  }
  console.log(`  ⚙️  Briefs with skill content:     ${withSkillContent.length}`);
  console.log(`  📊 Briefs with knowledge content:  ${withKnowledgeContent.length}`);

  // Top extraction candidates (most non-identity tokens)
  console.log(`\n  📋 Top extraction candidates:`);
  const sorted = [...analyses].sort((a, b) => b.nonIdentityTokens - a.nonIdentityTokens);
  for (const a of sorted.slice(0, 10)) {
    console.log(`     ${a.role.padEnd(30)} ${a.nonIdentityTokens} extractable tokens`);
    for (const s of a.sections.filter(s => s.classification !== 'identity' && s.classification !== 'anti-pattern')) {
      console.log(`       └─ [${s.classification}] "${s.heading}" (${s.tokens} tok) — ${s.recommendation}`);
    }
  }

  // Write output
  const outputDir = path.join(ROOT, 'audit-reports');
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    path.join(outputDir, 'brief-analysis.json'),
    JSON.stringify({ summary: { totalBriefs: analyses.length, totalTokens, totalIdentity, efficiency: totalIdentity / totalTokens, bloatedCount: bloated.length }, analyses }, null, 2),
  );

  console.log(`\n  Report saved to: audit-reports/brief-analysis.json`);
}

main().catch(err => { console.error(err); process.exit(1); });
