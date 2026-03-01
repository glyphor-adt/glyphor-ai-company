import type { ToolDefinition } from '@glyphor/agent-runtime';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createResearchTools } from '../shared/researchTools.js';

export function createAIImpactAnalystTools(supabase: SupabaseClient): ToolDefinition[] {
  return createResearchTools(supabase);
}
