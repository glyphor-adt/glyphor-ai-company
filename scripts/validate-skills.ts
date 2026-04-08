/**
 * Validate skill markdown: frontmatter, tools_granted vs static tool registry, basic holder syntax.
 *
 *   npx tsx scripts/validate-skills.ts
 *   npm run validate:skills
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { hasStaticToolName } from '@glyphor/agent-runtime';

const SKILLS_ROOT = path.resolve(process.cwd(), 'skills');

interface ParsedFrontmatter {
  raw: Record<string, string>;
  toolsGranted: string[];
  holders: string[];
  slug: string;
  name: string;
}

function normalizeNewlines(s: string): string {
  return s.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

function parseFrontmatter(content: string): ParsedFrontmatter | null {
  const text = normalizeNewlines(content);
  if (!text.startsWith('---\n')) return null;
  const end = text.indexOf('\n---\n', 4);
  if (end === -1) return null;
  const block = text.slice(4, end);
  const raw: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    raw[key] = val;
  }
  const toolsGranted = (raw.tools_granted ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const holders = (raw.holders ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const slug = (raw.slug ?? raw.name ?? '').trim();
  const name = (raw.name ?? '').trim();
  return { raw, toolsGranted, holders, slug, name };
}

function walkMarkdownFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkMarkdownFiles(p));
    else if (ent.isFile() && ent.name.endsWith('.md')) out.push(p);
  }
  return out;
}

function main(): void {
  const files = walkMarkdownFiles(SKILLS_ROOT).filter((f) => {
    const base = path.basename(f);
    if (base.startsWith('INDEX_')) return false;
    return true;
  });

  const errors: string[] = [];
  const rolePattern = /^[a-z0-9-]+$/;

  for (const file of files) {
    const rel = path.relative(process.cwd(), file);
    const content = normalizeNewlines(readFileSync(file, 'utf8'));
    const fm = parseFrontmatter(content);
    if (!fm) {
      // Legacy / index-style docs without machine contract — skip.
      continue;
    }
    if (!fm.name) errors.push(`${rel}: frontmatter missing name`);
    if (!fm.slug) errors.push(`${rel}: frontmatter missing slug (or name for slug)`);
    for (const h of fm.holders) {
      if (!rolePattern.test(h)) errors.push(`${rel}: invalid holder "${h}"`);
    }
    for (const tool of fm.toolsGranted) {
      const prefixBacked =
        tool.startsWith('pulse_') || tool.startsWith('spo_') || tool.startsWith('mcp_');
      if (!hasStaticToolName(tool) && !prefixBacked) {
        errors.push(`${rel}: tools_granted unknown static tool "${tool}" (not in toolRegistry KNOWN_TOOLS)`);
      }
    }
  }

  if (errors.length > 0) {
    console.error(`Skill validation FAILED (${errors.length} issue(s)):\n${errors.join('\n')}`);
    process.exit(1);
  }

  console.log(`Skill validation OK (${files.length} skill file(s)).`);
}

main();
