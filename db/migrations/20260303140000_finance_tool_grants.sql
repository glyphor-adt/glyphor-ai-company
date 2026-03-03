-- Wave 2: Finance tool grants
-- CFO (Nadia) gets all finance tools, revenue-analyst and cost-analyst get their domain tools + cash flow

INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  -- CFO: all revenue tools
  ('cfo', 'get_mrr_breakdown', 'system'),
  ('cfo', 'get_subscription_details', 'system'),
  ('cfo', 'get_churn_analysis', 'system'),
  ('cfo', 'get_revenue_forecast', 'system'),
  ('cfo', 'get_stripe_invoices', 'system'),
  ('cfo', 'get_customer_ltv', 'system'),
  -- CFO: all cost management tools
  ('cfo', 'get_gcp_costs', 'system'),
  ('cfo', 'get_ai_model_costs', 'system'),
  ('cfo', 'get_vendor_costs', 'system'),
  ('cfo', 'get_cost_anomalies', 'system'),
  ('cfo', 'get_burn_rate', 'system'),
  ('cfo', 'create_budget', 'system'),
  ('cfo', 'check_budget_status', 'system'),
  ('cfo', 'get_unit_economics', 'system'),
  -- CFO: all cash flow tools
  ('cfo', 'get_cash_balance', 'system'),
  ('cfo', 'get_cash_flow', 'system'),
  ('cfo', 'get_pending_transactions', 'system'),
  ('cfo', 'generate_financial_report', 'system'),
  ('cfo', 'get_margin_analysis', 'system'),

  -- Revenue Analyst (Anna): revenue + cash flow tools
  ('revenue-analyst', 'get_mrr_breakdown', 'system'),
  ('revenue-analyst', 'get_subscription_details', 'system'),
  ('revenue-analyst', 'get_churn_analysis', 'system'),
  ('revenue-analyst', 'get_revenue_forecast', 'system'),
  ('revenue-analyst', 'get_stripe_invoices', 'system'),
  ('revenue-analyst', 'get_customer_ltv', 'system'),
  ('revenue-analyst', 'get_cash_balance', 'system'),
  ('revenue-analyst', 'get_cash_flow', 'system'),
  ('revenue-analyst', 'get_pending_transactions', 'system'),
  ('revenue-analyst', 'generate_financial_report', 'system'),
  ('revenue-analyst', 'get_margin_analysis', 'system'),

  -- Cost Analyst (Omar): cost management + cash flow tools
  ('cost-analyst', 'get_gcp_costs', 'system'),
  ('cost-analyst', 'get_ai_model_costs', 'system'),
  ('cost-analyst', 'get_vendor_costs', 'system'),
  ('cost-analyst', 'get_cost_anomalies', 'system'),
  ('cost-analyst', 'get_burn_rate', 'system'),
  ('cost-analyst', 'create_budget', 'system'),
  ('cost-analyst', 'check_budget_status', 'system'),
  ('cost-analyst', 'get_unit_economics', 'system'),
  ('cost-analyst', 'get_cash_balance', 'system'),
  ('cost-analyst', 'get_cash_flow', 'system'),
  ('cost-analyst', 'get_pending_transactions', 'system'),
  ('cost-analyst', 'generate_financial_report', 'system'),
  ('cost-analyst', 'get_margin_analysis', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;
