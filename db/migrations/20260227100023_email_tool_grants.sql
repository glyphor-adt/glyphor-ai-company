-- Grant email tools (send_email, read_inbox, reply_to_email) to executives + ops
-- These tools use per-agent M365 shared mailboxes (e.g. sarah@glyphor.ai)

INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  -- Chief of Staff (send_email already granted, add new tools)
  ('chief-of-staff', 'read_inbox', 'system'),
  ('chief-of-staff', 'reply_to_email', 'system'),

  -- CTO
  ('cto', 'send_email', 'system'),
  ('cto', 'read_inbox', 'system'),
  ('cto', 'reply_to_email', 'system'),

  -- CPO
  ('cpo', 'send_email', 'system'),
  ('cpo', 'read_inbox', 'system'),
  ('cpo', 'reply_to_email', 'system'),

  -- CMO
  ('cmo', 'send_email', 'system'),
  ('cmo', 'read_inbox', 'system'),
  ('cmo', 'reply_to_email', 'system'),

  -- CFO
  ('cfo', 'send_email', 'system'),
  ('cfo', 'read_inbox', 'system'),
  ('cfo', 'reply_to_email', 'system'),

  -- VP Customer Success
  ('vp-customer-success', 'send_email', 'system'),
  ('vp-customer-success', 'read_inbox', 'system'),
  ('vp-customer-success', 'reply_to_email', 'system'),

  -- VP Sales
  ('vp-sales', 'send_email', 'system'),
  ('vp-sales', 'read_inbox', 'system'),
  ('vp-sales', 'reply_to_email', 'system'),

  -- VP Design
  ('vp-design', 'send_email', 'system'),
  ('vp-design', 'read_inbox', 'system'),
  ('vp-design', 'reply_to_email', 'system'),

  -- Ops (Atlas)
  ('ops', 'send_email', 'system'),
  ('ops', 'read_inbox', 'system'),
  ('ops', 'reply_to_email', 'system'),

  -- M365 Admin (Riley — send_email already granted, add new tools)
  ('m365-admin', 'read_inbox', 'system'),
  ('m365-admin', 'reply_to_email', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;
