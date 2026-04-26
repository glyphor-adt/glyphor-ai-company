/**
 * @glyphor/design-system
 *
 * Shared design tokens, components, and anti-AI-smell enforcement for
 * glyphor-site and the internal dashboard.
 *
 * Exports:
 *   Button, buttonVariants — shared Button component (all 7 site patterns)
 *   typographyTokens       — type-scale reference (incl. display tokens)
 *   spacingTokens          — 4 px grid
 *   colorTokens            — single-accent palette
 *   componentTokens        — per-component canonical token map
 *   validateStyle          — anti-AI-smell lint helper
 */

export { Button, buttonVariants } from './components/ui/button.js';
export type { ButtonProps } from './components/ui/button.js';

export {
  typographyTokens,
  spacingTokens,
  colorTokens,
  componentTokens,
  validateStyle,
} from './anti-ai-smell-registry/tokens.js';
