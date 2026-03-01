import type { ToolDefinition } from '@glyphor/agent-runtime';
import { createResearchTools } from '../shared/researchTools.js';

export function createTechnicalResearchAnalystTools(): ToolDefinition[] {
  return createResearchTools();
}
