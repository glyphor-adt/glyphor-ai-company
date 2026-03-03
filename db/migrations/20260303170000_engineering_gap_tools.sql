-- Wave 5: Engineering gap tool grants

INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  -- Quality Engineer (Sam): testing + quality tools
  ('quality-engineer', 'run_test_suite', 'system'),
  ('quality-engineer', 'get_code_coverage', 'system'),
  ('quality-engineer', 'get_quality_metrics', 'system'),
  ('quality-engineer', 'create_test_plan', 'system'),

  -- DevOps Engineer (Jordan): container + deployment tools
  ('devops-engineer', 'get_container_logs', 'system'),
  ('devops-engineer', 'scale_service', 'system'),
  ('devops-engineer', 'get_build_queue', 'system'),
  ('devops-engineer', 'get_deployment_history', 'system'),

  -- Platform Engineer (Alex): infrastructure tools
  ('platform-engineer', 'get_infrastructure_inventory', 'system'),
  ('platform-engineer', 'get_service_dependencies', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;
