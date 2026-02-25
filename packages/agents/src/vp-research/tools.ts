import type { ToolDefinition } from '@glyphor/agent-runtime';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createResearchTools } from '../shared/researchTools.js';

/**
 * VP Research (Sophia Lin) tools.
 *
 * Sophia gets the same research tools as her analysts (she can fill gaps herself),
 * plus she inherits graph/memory tools via the runner.
 */
export function createVPResearchTools(supabase: SupabaseClient): ToolDefinition[] {
  return createResearchTools(supabase);
}
