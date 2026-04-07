CREATE OR REPLACE VIEW microsoft_write_audit_view AS
SELECT
  id,
  timestamp,
  agent_role,
  action,
  resource,
  request_payload->>'identityType' AS identity_type,
  COALESCE((request_payload->>'fallbackUsed')::boolean, false) AS fallback_used,
  request_payload->>'tenantId' AS tenant_id,
  request_payload->>'workspaceKey' AS workspace_key,
  request_payload->>'approvalId' AS approval_id,
  request_payload->>'approvalReference' AS approval_reference,
  request_payload->>'outcome' AS outcome,
  request_payload->>'toolName' AS tool_name,
  request_payload->>'targetType' AS target_type,
  request_payload->>'targetId' AS target_id,
  request_payload->>'limitation' AS limitation,
  response_code,
  response_summary
FROM platform_audit_log
WHERE platform = 'microsoft';
