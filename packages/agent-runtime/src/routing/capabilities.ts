export type Capability =
  | 'code_generation'
  | 'creative_writing'
  | 'legal_reasoning'
  | 'financial_computation'
  | 'web_research'
  | 'visual_analysis'
  | 'nuanced_evaluation'
  | 'structured_extraction'
  | 'simple_tool_calling'
  | 'orchestration'
  | 'high_complexity'
  | 'low_complexity'
  | 'batch_eligible'
  | 'needs_citations'
  | 'needs_code_execution'
  | 'needs_apply_patch'
  | 'needs_tool_search'
  | 'needs_computer_use'
  | 'needs_compaction'
  | 'needs_mcp_direct'
  | 'many_tools'
  | 'deterministic_possible';

export const HIGH_COMPLEXITY_CAPABILITIES: ReadonlySet<Capability> = new Set([
  'code_generation',
  'legal_reasoning',
  'financial_computation',
  'orchestration',
  'visual_analysis',
]);
