export const SCOPE_TABLE_MAP: Record<string, string[]> = {
  'Glyphor.Marketing.Read': ['content_drafts', 'content_metrics', 'seo_data', 'social_metrics', 'email_metrics'],
  'Glyphor.Finance.Read': ['financials', 'company_pulse'],
  'Glyphor.Product.Read': ['analytics_events'],
  'Glyphor.Support.Read': ['support_tickets', 'knowledge_base'],
  'Glyphor.Research.Read': ['company_research', 'contact_research'],
  'Glyphor.Engineering.Read': ['agent_runs', 'incidents', 'data_sync_status'],
  'Glyphor.Ops.Read': ['agent_runs', 'agent_trust_scores', 'data_sync_status', 'incidents', 'company_pulse'],
  'Glyphor.Admin.Read': ['*'],
};
