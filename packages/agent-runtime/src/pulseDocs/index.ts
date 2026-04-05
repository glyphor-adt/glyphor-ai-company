/**
 * PulseDocs — Self-Maintaining Documentation for Glyphor
 *
 * Any markdown file with a `# PULSE DOC: [title]` header becomes a
 * living document. When an agent reads such a file during its run,
 * a lightweight model call fires after the run completes to update
 * the document with new learnings from the conversation.
 *
 * Inspired by Claude Code's MagicDocs, adapted for Glyphor's
 * multi-agent architecture.
 *
 * Usage:
 *   1. Create a markdown file with `# PULSE DOC: My Title` as the first line
 *   2. Optionally add italicized instructions on the next line:
 *      `*Focus on API patterns and auth flows*`
 *   3. Any agent that reads the file will trigger an update after its run
 *
 * Integration:
 *   - Call `registerPulseDocFromContent(path, content)` after any file read
 *   - Call `runPulseDocUpdates(modelClient, history, agentRole)` after agent run
 */

import { writeFileSync, readFileSync } from 'fs';
import type { ModelClient } from '../modelClient.js';
import type { ConversationTurn } from '../types.js';
import { buildPulseDocPrompt } from './prompts.js';

// ═══════════════════════════════════════════════════════════════════
// DETECTION
// ═══════════════════════════════════════════════════════════════════

const PULSE_DOC_HEADER = /^#\s*PULSE\s+DOC:\s*(.+)$/im;
const ITALICS_PATTERN = /^[_*](.+?)[_*]\s*$/m;

export interface PulseDocInfo {
  path: string;
  title: string;
  instructions?: string;
}

/**
 * Detect if file content contains a Pulse Doc header.
 * Returns title and optional instructions, or null.
 */
export function detectPulseDocHeader(
  content: string,
): { title: string; instructions?: string } | null {
  const match = content.match(PULSE_DOC_HEADER);
  if (!match?.[1]) return null;

  const title = match[1].trim();

  // Check for italicized instructions on the line after the header
  const afterHeader = content.slice(match.index! + match[0].length);
  const nextLineMatch = afterHeader.match(/^\s*\n(?:\s*\n)?(.+?)(?:\n|$)/);
  if (nextLineMatch?.[1]) {
    const italicsMatch = nextLineMatch[1].match(ITALICS_PATTERN);
    if (italicsMatch?.[1]) {
      return { title, instructions: italicsMatch[1].trim() };
    }
  }

  return { title };
}

// ═══════════════════════════════════════════════════════════════════
// TRACKING
// ═══════════════════════════════════════════════════════════════════

const trackedPulseDocs = new Map<string, PulseDocInfo>();

/** Register a file as a Pulse Doc if it has the header. Idempotent. */
export function registerPulseDocFromContent(filePath: string, content: string): boolean {
  const detected = detectPulseDocHeader(content);
  if (!detected) return false;

  if (!trackedPulseDocs.has(filePath)) {
    trackedPulseDocs.set(filePath, {
      path: filePath,
      title: detected.title,
      instructions: detected.instructions,
    });
    console.log(`[PulseDocs] Registered: "${detected.title}" at ${filePath}`);
  }
  return true;
}

/** Clear all tracked docs (for testing or reset). */
export function clearTrackedPulseDocs(): void {
  trackedPulseDocs.clear();
}

/** Get count of tracked docs. */
export function getTrackedPulseDocCount(): number {
  return trackedPulseDocs.size;
}

/** Get all tracked docs (for diagnostics). */
export function getTrackedPulseDocs(): PulseDocInfo[] {
  return Array.from(trackedPulseDocs.values());
}

// ═══════════════════════════════════════════════════════════════════
// UPDATE ENGINE
// ═══════════════════════════════════════════════════════════════════

/** Max conversation chars to include in the update prompt. */
const MAX_CONVERSATION_SUMMARY_CHARS = 8_000;
/** Max doc size we'll attempt to update (skip huge files). */
const MAX_DOC_SIZE_CHARS = 50_000;
/** Model to use for updates — fast and cheap. */
const PULSE_DOC_UPDATE_MODEL = 'gemini-2.0-flash';

/**
 * Build a conversation summary from history for the update prompt.
 * Keeps recent turns, skipping tool_call/tool_result noise.
 */
function buildConversationSummary(history: ConversationTurn[]): string {
  const relevant = history.filter(
    (t) => t.role === 'user' || t.role === 'assistant',
  );
  // Take recent turns, working backwards
  const lines: string[] = [];
  let charCount = 0;
  for (let i = relevant.length - 1; i >= 0 && charCount < MAX_CONVERSATION_SUMMARY_CHARS; i--) {
    const turn = relevant[i];
    const prefix = turn.role === 'user' ? 'User' : 'Agent';
    const content = turn.content.slice(0, 2000); // Cap per-turn
    lines.unshift(`${prefix}: ${content}`);
    charCount += content.length;
  }
  return lines.join('\n\n');
}

/**
 * Update a single Pulse Doc using a lightweight model call.
 * Returns true if the doc was updated, false if skipped.
 */
async function updateSinglePulseDoc(
  doc: PulseDocInfo,
  modelClient: ModelClient,
  history: ConversationTurn[],
  agentRole: string,
): Promise<boolean> {
  // Re-read the file to get latest content
  let currentContent: string;
  try {
    currentContent = readFileSync(doc.path, 'utf8');
  } catch {
    // File deleted or inaccessible — remove from tracking
    trackedPulseDocs.delete(doc.path);
    console.log(`[PulseDocs] Removed "${doc.title}" — file no longer accessible`);
    return false;
  }

  // Re-verify header still present
  const detected = detectPulseDocHeader(currentContent);
  if (!detected) {
    trackedPulseDocs.delete(doc.path);
    console.log(`[PulseDocs] Removed "${doc.title}" — header no longer present`);
    return false;
  }

  // Skip huge documents
  if (currentContent.length > MAX_DOC_SIZE_CHARS) {
    console.warn(`[PulseDocs] Skipping "${doc.title}" — too large (${currentContent.length} chars)`);
    return false;
  }

  const conversationSummary = buildConversationSummary(history);
  if (conversationSummary.length < 50) {
    // Not enough conversation context to warrant an update
    return false;
  }

  const prompt = buildPulseDocPrompt({
    docContents: currentContent,
    docPath: doc.path,
    docTitle: detected.title,
    customInstructions: detected.instructions,
    conversationSummary,
  });

  try {
    const response = await modelClient.generate({
      model: PULSE_DOC_UPDATE_MODEL,
      systemInstruction: `You are a documentation updater for Glyphor (AI-run company platform). Update living documents with new learnings. Agent role: ${agentRole}.`,
      contents: [{ role: 'user', content: prompt, timestamp: Date.now() }],
      callTimeoutMs: 30_000,
    });

    const output = response.text?.trim();
    if (!output || output === 'NO_UPDATE' || output.length < 20) {
      return false;
    }

    // Verify the output still has the pulse doc header
    if (!PULSE_DOC_HEADER.test(output)) {
      console.warn(`[PulseDocs] Update for "${doc.title}" dropped header — skipping write`);
      return false;
    }

    // Write the updated content
    writeFileSync(doc.path, output, 'utf8');
    console.log(`[PulseDocs] Updated "${doc.title}" (${agentRole})`);
    return true;
  } catch (err) {
    console.warn(`[PulseDocs] Update failed for "${doc.title}": ${(err as Error).message}`);
    return false;
  }
}

/**
 * Run updates for all tracked Pulse Docs.
 * Called after an agent run completes. Fire-and-forget safe.
 *
 * @returns Number of docs actually updated
 */
export async function runPulseDocUpdates(
  modelClient: ModelClient,
  history: ConversationTurn[],
  agentRole: string,
): Promise<number> {
  const docs = Array.from(trackedPulseDocs.values());
  if (docs.length === 0) return 0;

  console.log(`[PulseDocs] Running updates for ${docs.length} tracked doc(s) after ${agentRole} run`);

  let updated = 0;
  for (const doc of docs) {
    try {
      const didUpdate = await updateSinglePulseDoc(doc, modelClient, history, agentRole);
      if (didUpdate) updated++;
    } catch (err) {
      console.warn(`[PulseDocs] Error updating "${doc.title}": ${(err as Error).message}`);
    }
  }

  if (updated > 0) {
    console.log(`[PulseDocs] Updated ${updated}/${docs.length} doc(s)`);
  }
  return updated;
}
