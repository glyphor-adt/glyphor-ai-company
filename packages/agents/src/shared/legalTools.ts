/**
 * Legal Tools — All tools migrated to mcp-legal-server
 *
 * Tools now served via MCP:
 *   track_regulations, get_compliance_status, update_compliance_item,
 *   create_compliance_alert, get_contracts, create_contract_review,
 *   flag_contract_issue, get_contract_renewals, get_ip_portfolio,
 *   create_ip_filing, monitor_ip_infringement, get_tax_calendar,
 *   calculate_tax_estimate, get_tax_research, review_tax_strategy,
 *   audit_data_flows, check_data_retention, get_privacy_requests,
 *   audit_access_permissions
 */

import type { ToolDefinition } from '@glyphor/agent-runtime';

/** @deprecated All legal tools are now on mcp-legal-server. */
export function createLegalTools(): ToolDefinition[] {
  return [];
}
