/**
 * PulseDocs Update Prompt
 *
 * Template for the lightweight model call that updates a Pulse Doc
 * after an agent run. Variables use {{mustache}} syntax.
 */

export function getPulseDocUpdatePrompt(): string {
  return `You are updating a living document that automatically stays current with the Glyphor codebase and company operations.

The file {{docPath}} has this content:
<current_doc>
{{docContents}}
</current_doc>

Document title: {{docTitle}}
{{customInstructions}}

Based on the agent conversation below, update the Pulse Doc to incorporate any NEW learnings. Only edit if there is substantial new information.

<agent_conversation>
{{conversationSummary}}
</agent_conversation>

RULES:
- Preserve the header exactly: # PULSE DOC: {{docTitle}}
- If there is an italicized line after the header, preserve it exactly
- Keep the document CURRENT — update in-place, do NOT append history or changelogs
- Remove outdated information rather than adding "Previously..." notes
- BE TERSE. High signal only. No filler.
- Focus on: WHY things exist, HOW components connect, WHERE to start, WHAT patterns are used
- Skip: detailed implementations, exhaustive API docs, step-by-step narratives
- Fix obvious errors: typos, broken formatting, stale information

Return ONLY the updated document content (full file). If nothing substantial changed, return exactly "NO_UPDATE".`;
}

/**
 * Build the final prompt with variable substitution.
 */
export function buildPulseDocPrompt(vars: {
  docContents: string;
  docPath: string;
  docTitle: string;
  customInstructions?: string;
  conversationSummary: string;
}): string {
  const template = getPulseDocUpdatePrompt();
  const instructionsBlock = vars.customInstructions
    ? `\nDOCUMENT-SPECIFIC INSTRUCTIONS (take priority over general rules):\n"${vars.customInstructions}"\n`
    : '';

  return template
    .replace(/\{\{docContents\}\}/g, vars.docContents)
    .replace(/\{\{docPath\}\}/g, vars.docPath)
    .replace(/\{\{docTitle\}\}/g, vars.docTitle)
    .replace(/\{\{customInstructions\}\}/g, instructionsBlock)
    .replace(/\{\{conversationSummary\}\}/g, vars.conversationSummary);
}
