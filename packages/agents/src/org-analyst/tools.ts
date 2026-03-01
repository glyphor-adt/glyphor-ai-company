import type { ToolDefinition } from '@glyphor/agent-runtime';
import { createResearchTools } from '../shared/researchTools.js';

export function createOrgAnalystTools(): ToolDefinition[] {
  return createResearchTools();
}
