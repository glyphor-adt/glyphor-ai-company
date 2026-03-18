/**
 * normalizeText — Shared text normalization for dashboard rendering.
 *
 * Converts literal escape sequences (e.g. "\n", "\t") stored in DB or
 * returned by APIs into real characters so markdown renderers and
 * whitespace-pre-wrap elements display them correctly.
 */
export function normalizeText(text: string): string {
  return text
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '');
}
