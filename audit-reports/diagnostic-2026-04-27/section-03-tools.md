# Section 3: Tools Diagnostic Report

**Generated**: 2026-04-27 17:00:24
**Scope**: All tool definitions in packages/agents/src/shared/*Tools.ts and agent-runtime tooling

## Executive Summary

- **Total tool definitions**: 377
- **Never granted to any role**: 335
- **Provider bypass cases identified**: 100
- **Files scanned**: 70 *Tools.ts files



## 1. Tool Inventory Table

Tools grouped by file. Columns: tool name, definition line, roles granting it, production invoked, last call site, eval coverage.

### packages/agents/src/shared/accessAuditTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `view_access_matrix` | 14 | 0 | no | (declaration only) | no |
| `view_pending_grant_requests` | 77 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/agent365Tools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `reply_email_with_attachments` | 301 | 0 | no | (declaration only) | no |
| `reply_email_with_attachments` | 445 | 0 | no | (declaration only) | no |
| `reply_email_with_attachments` | 464 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/agentCreationTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `create_specialist_agent` | 53 | 0 | no | (declaration only) | no |
| `list_my_created_agents` | 291 | 0 | no | (declaration only) | no |
| `retire_created_agent` | 323 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/agentDirectoryTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `get_agent_directory` | 15 | 0 | no | (declaration only) | no |
| `who_handles` | 158 | 0 | no | (declaration only) | no |
| `Nexus` | 185 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/agentManagementTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `update_agent_name` | 15 | 0 | no | (declaration only) | no |
| `set_reports_to` | 53 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/assetTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `generate_image` | 504 | 0 | no | (declaration only) | no |
| `generate_and_publish_asset` | 538 | 0 | no | (declaration only) | no |
| `publish_asset_deliverable` | 682 | 0 | no | (declaration only) | no |
| `upload_asset` | 763 | 0 | no | (declaration only) | no |
| `list_assets` | 793 | 0 | no | (declaration only) | no |
| `optimize_image` | 885 | 0 | no | (declaration only) | no |
| `generate_favicon_set` | 949 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/assignmentTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `read_my_assignments` | 88 | 1+ | yes | (baseline/grant) | yes |
| `submit_assignment_output` | 158 | 1+ | yes | (baseline/grant) | yes |
| `flag_assignment_blocker` | 340 | 1+ | yes | (baseline/grant) | yes |

### packages/agents/src/shared/auditTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `run_lighthouse_audit` | 56 | 0 | no | (declaration only) | no |
| `run_accessibility_audit` | 137 | 1+ | no | (baseline/grant) | no |
| `check_ai_smell` | 229 | 1+ | no | (baseline/grant) | no |
| `validate_brand_compliance` | 343 | 0 | no | (declaration only) | no |
| `check_bundle_size` | 430 | 0 | no | (declaration only) | no |
| `check_build_errors` | 532 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/canvaTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `create_canva_design` | 70 | 0 | no | (declaration only) | no |
| `get_canva_design` | 105 | 0 | no | (declaration only) | no |
| `search_canva_designs` | 126 | 0 | no | (declaration only) | no |
| `list_canva_brand_templates` | 150 | 0 | no | (declaration only) | no |
| `get_canva_template_fields` | 169 | 0 | no | (declaration only) | no |
| `generate_canva_design` | 189 | 0 | no | (declaration only) | no |
| `export_canva_design` | 254 | 0 | no | (declaration only) | no |
| `upload_canva_asset` | 290 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/cashFlowTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `get_cash_balance` | 28 | 0 | no | (declaration only) | no |
| `primary` | 82 | 0 | no | (declaration only) | no |
| `get_cash_flow` | 101 | 0 | no | (declaration only) | no |
| `get_pending_transactions` | 159 | 0 | no | (declaration only) | no |
| `generate_financial_report` | 260 | 0 | no | (declaration only) | no |
| `get_margin_analysis` | 360 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/channelNotifyTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `post_to_briefings` | 64 | 0 | no | (declaration only) | no |
| `post_to_deliverables` | 191 | 1+ | no | (baseline/grant) | no |

### packages/agents/src/shared/claudeParityTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `run_todo_write` | 36 | 0 | no | (declaration only) | no |
| `delegate_codebase_explore` | 101 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/codexTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `codex` | 23 | 0 | no | (declaration only) | no |
| `codex` | 102 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/collectiveIntelligenceTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `get_company_vitals` | 73 | 0 | no | (declaration only) | no |
| `update_company_vitals` | 83 | 0 | no | (declaration only) | no |
| `update_vitals_highlights` | 103 | 0 | no | (declaration only) | no |
| `promote_to_org_knowledge` | 142 | 0 | no | (declaration only) | no |
| `get_org_knowledge` | 201 | 0 | no | (declaration only) | no |
| `read_company_doctrine` | 231 | 0 | no | (declaration only) | no |
| `create_knowledge_route` | 330 | 0 | no | (declaration only) | no |
| `get_knowledge_routes` | 375 | 0 | no | (declaration only) | no |
| `detect_contradictions` | 387 | 0 | no | (declaration only) | no |
| `record_process_pattern` | 399 | 0 | no | (declaration only) | no |
| `get_process_patterns` | 472 | 0 | no | (declaration only) | no |
| `propose_authority_change` | 498 | 0 | no | (declaration only) | no |
| `get_authority_proposals` | 566 | 0 | no | (declaration only) | no |
| `update_doctrine_section` | 585 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/communicationTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `send_agent_message` | 127 | 1+ | yes | (baseline/grant) | yes |
| `create_peer_work_request` | 266 | 0 | no | (declaration only) | no |
| `check_messages` | 420 | 1+ | yes | (baseline/grant) | yes |
| `call_meeting` | 486 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/competitiveIntelTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `track_competitor` | 22 | 0 | no | (declaration only) | no |
| `get_competitor_profile` | 93 | 1+ | no | (baseline/grant) | no |
| `update_competitor_profile` | 154 | 0 | no | (declaration only) | no |
| `compare_features` | 222 | 0 | no | (declaration only) | no |
| `track_competitor_pricing` | 291 | 0 | no | (declaration only) | no |
| `monitor_competitor_launches` | 349 | 0 | no | (declaration only) | no |
| `get_market_landscape` | 430 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/contentTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `create_content_draft` | 93 | 0 | no | (declaration only) | no |
| `update_content_draft` | 201 | 0 | no | (declaration only) | no |
| `get_content_drafts` | 309 | 0 | no | (declaration only) | no |
| `submit_content_for_review` | 382 | 0 | no | (declaration only) | no |
| `approve_content_draft` | 465 | 0 | no | (declaration only) | no |
| `reject_content_draft` | 557 | 0 | no | (declaration only) | no |
| `publish_content` | 644 | 0 | no | (declaration only) | no |
| `get_content_metrics` | 720 | 0 | no | (declaration only) | no |
| `get_content_calendar` | 772 | 0 | no | (declaration only) | no |
| `generate_content_image` | 839 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/costManagementTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `get_gcp_costs` | 22 | 0 | no | (declaration only) | no |
| `get_ai_model_costs` | 90 | 0 | no | (declaration only) | no |
| `get_vendor_costs` | 164 | 0 | no | (declaration only) | no |
| `get_cost_anomalies` | 211 | 0 | no | (declaration only) | no |
| `get_burn_rate` | 282 | 0 | no | (declaration only) | no |
| `create_budget` | 358 | 0 | no | (declaration only) | no |
| `check_budget_status` | 415 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/deliverableTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `publish_deliverable` | 54 | 0 | no | (declaration only) | no |
| `get_deliverables` | 222 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/deployPreviewTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `deploy_preview` | 42 | 1+ | no | (baseline/grant) | no |
| `get_deployment_status` | 138 | 0 | no | (declaration only) | no |
| `list_deployments` | 233 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/designBriefTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `hero` | 81 | 0 | no | (declaration only) | no |
| `value_proposition` | 87 | 0 | no | (declaration only) | no |
| `cta_section` | 93 | 0 | no | (declaration only) | no |
| `footer` | 99 | 0 | no | (declaration only) | no |
| `app_shell` | 109 | 0 | no | (declaration only) | no |
| `primary_feature_surface` | 115 | 0 | no | (declaration only) | no |
| `supporting_controls` | 121 | 0 | no | (declaration only) | no |
| `normalize_design_brief` | 357 | 1+ | no | (baseline/grant) | no |

### packages/agents/src/shared/designSystemTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `get_design_tokens` | 113 | 0 | no | (declaration only) | no |
| `update_design_token` | 183 | 0 | no | (declaration only) | no |
| `validate_tokens_vs_implementation` | 291 | 0 | no | (declaration only) | no |
| `get_color_palette` | 386 | 0 | no | (declaration only) | no |
| `get_typography_scale` | 463 | 0 | no | (declaration only) | no |
| `list_components` | 513 | 0 | no | (declaration only) | no |
| `get_component_usage` | 585 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/diagnosticTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `check_table_schema` | 19 | 0 | no | (declaration only) | no |
| `diagnose_column_error` | 83 | 0 | no | (declaration only) | no |
| `list_tables` | 172 | 0 | no | (declaration only) | no |
| `check_tool_health` | 215 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/dmTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `send_teams_dm` | 214 | 0 | no | (declaration only) | no |
| `read_teams_dm` | 349 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/documentTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `generate_pdf` | 345 | 0 | no | (declaration only) | no |
| `generate_word_doc` | 465 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/docusignTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `create_signing_envelope` | 47 | 0 | no | (declaration only) | no |
| `send_template_envelope` | 202 | 0 | no | (declaration only) | no |
| `check_envelope_status` | 291 | 0 | no | (declaration only) | no |
| `list_envelopes` | 341 | 0 | no | (declaration only) | no |
| `void_envelope` | 398 | 0 | no | (declaration only) | no |
| `resend_envelope` | 442 | 0 | no | (declaration only) | no |
| `send_draft_envelope` | 476 | 0 | no | (declaration only) | no |
| `get_envelope_documents` | 513 | 0 | no | (declaration only) | no |
| `get_envelope_form_data` | 554 | 0 | no | (declaration only) | no |
| `get_envelope_audit_trail` | 594 | 0 | no | (declaration only) | no |
| `add_envelope_recipients` | 637 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/emailMarketingTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `get_mailchimp_lists` | 77 | 0 | no | (declaration only) | no |
| `get_mailchimp_members` | 112 | 0 | no | (declaration only) | no |
| `get_mailchimp_segments` | 157 | 0 | no | (declaration only) | no |
| `create_mailchimp_campaign` | 188 | 0 | no | (declaration only) | no |
| `set_campaign_content` | 226 | 0 | no | (declaration only) | no |
| `send_test_campaign` | 251 | 0 | no | (declaration only) | no |
| `send_campaign` | 281 | 0 | no | (declaration only) | no |
| `get_campaign_report` | 324 | 0 | no | (declaration only) | no |
| `get_campaign_list` | 356 | 0 | no | (declaration only) | no |
| `manage_mailchimp_tags` | 402 | 0 | no | (declaration only) | no |
| `send_transactional_email` | 450 | 0 | no | (declaration only) | no |
| `get_mandrill_stats` | 492 | 0 | no | (declaration only) | no |
| `search_mandrill_messages` | 529 | 0 | no | (declaration only) | no |
| `get_mandrill_templates` | 571 | 0 | no | (declaration only) | no |
| `render_mandrill_template` | 599 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/engineeringGapTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `run_test_suite` | 28 | 0 | no | (declaration only) | no |
| `get_code_coverage` | 80 | 0 | no | (declaration only) | no |
| `get_quality_metrics` | 161 | 0 | no | (declaration only) | no |
| `create_test_plan` | 262 | 0 | no | (declaration only) | no |
| `get_container_logs` | 320 | 0 | no | (declaration only) | no |
| `scale_service` | 402 | 0 | no | (declaration only) | no |
| `get_build_queue` | 464 | 0 | no | (declaration only) | no |
| `get_deployment_history` | 518 | 0 | no | (declaration only) | no |
| `get_infrastructure_inventory` | 602 | 0 | no | (declaration only) | no |
| `get_service_dependencies` | 699 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/entraHRTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `entra_get_user_profile` | 70 | 0 | no | (declaration only) | no |
| `entra_update_user_profile` | 127 | 0 | no | (declaration only) | no |
| `entra_upload_user_photo` | 190 | 0 | no | (declaration only) | no |
| `entra_set_manager` | 259 | 0 | no | (declaration only) | no |
| `entra_hr_assign_license` | 319 | 0 | no | (declaration only) | no |
| `entra_audit_profiles` | 378 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/eventTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `emit_insight` | 20 | 0 | yes | (declaration only) | yes |
| `emit_alert` | 76 | 0 | yes | (declaration only) | yes |

### packages/agents/src/shared/executiveOrchestrationTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `create_team_assignments` | 109 | 0 | no | (declaration only) | no |
| `evaluate_team_output` | 436 | 0 | no | (declaration only) | no |
| `check_team_status` | 601 | 0 | no | (declaration only) | no |
| `synthesize_team_deliverable` | 681 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/externalA2aTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `discover_external_agents` | 15 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/facebookTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `publish_facebook_post` | 28 | 0 | no | (declaration only) | no |
| `schedule_facebook_post` | 64 | 0 | no | (declaration only) | no |
| `get_facebook_posts` | 117 | 0 | no | (declaration only) | no |
| `get_facebook_insights` | 138 | 0 | no | (declaration only) | no |
| `get_facebook_post_performance` | 168 | 0 | no | (declaration only) | no |
| `get_facebook_audience` | 188 | 0 | no | (declaration only) | no |
| `check_facebook_status` | 202 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/figmaTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `get_figma_file` | 17 | 0 | no | (declaration only) | no |
| `export_figma_images` | 43 | 0 | no | (declaration only) | no |
| `get_figma_image_fills` | 71 | 0 | no | (declaration only) | no |
| `get_figma_components` | 94 | 0 | no | (declaration only) | no |
| `get_figma_team_components` | 115 | 0 | no | (declaration only) | no |
| `get_figma_styles` | 136 | 0 | no | (declaration only) | no |
| `get_figma_team_styles` | 157 | 0 | no | (declaration only) | no |
| `get_figma_comments` | 180 | 0 | no | (declaration only) | no |
| `post_figma_comment` | 201 | 0 | no | (declaration only) | no |
| `resolve_figma_comment` | 243 | 0 | no | (declaration only) | no |
| `get_figma_file_metadata` | 269 | 0 | no | (declaration only) | no |
| `get_figma_version_history` | 290 | 0 | no | (declaration only) | no |
| `get_figma_team_projects` | 313 | 0 | no | (declaration only) | no |
| `get_figma_project_files` | 334 | 0 | no | (declaration only) | no |
| `get_figma_dev_resources` | 357 | 0 | no | (declaration only) | no |
| `create_figma_dev_resource` | 378 | 0 | no | (declaration only) | no |
| `manage_figma_webhooks` | 412 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/frontendCodeTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `read_frontend_file` | 67 | 0 | no | (declaration only) | no |
| `search_frontend_code` | 109 | 0 | no | (declaration only) | no |
| `list_frontend_files` | 158 | 0 | no | (declaration only) | no |
| `write_frontend_file` | 203 | 0 | no | (declaration only) | no |
| `create_design_branch` | 264 | 0 | no | (declaration only) | no |
| `create_git_branch` | 299 | 1+ | no | (baseline/grant) | no |
| `create_frontend_pr` | 335 | 0 | no | (declaration only) | no |
| `check_pr_status` | 384 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/graphTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `trace_causes` | 50 | 0 | no | (declaration only) | no |
| `trace_impact` | 68 | 0 | no | (declaration only) | no |
| `query_knowledge_graph` | 86 | 0 | no | (declaration only) | no |
| `add_knowledge` | 120 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/initiativeTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `propose_initiative` | 151 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/knowledgeRetrievalTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `read_company_knowledge` | 21 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/legalDocumentTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `draft_legal_document` | 20 | 0 | no | (declaration only) | no |
| `prepare_signing_envelope` | 145 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/linkedinTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `publish_linkedin_post` | 28 | 0 | no | (declaration only) | no |
| `get_linkedin_posts` | 65 | 0 | no | (declaration only) | no |
| `get_linkedin_post_analytics` | 86 | 0 | no | (declaration only) | no |
| `get_linkedin_followers` | 106 | 0 | no | (declaration only) | no |
| `get_linkedin_page_stats` | 120 | 0 | no | (declaration only) | no |
| `get_linkedin_demographics` | 134 | 0 | no | (declaration only) | no |
| `check_linkedin_status` | 148 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/logoTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `GLYPHOR` | 15 | 0 | no | (declaration only) | no |
| `create_logo_variation` | 205 | 0 | no | (declaration only) | no |
| `restyle_logo` | 280 | 0 | no | (declaration only) | no |
| `create_social_avatar` | 376 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/marketingIntelTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `create_experiment` | 23 | 0 | no | (declaration only) | no |
| `get_experiment_results` | 91 | 0 | no | (declaration only) | no |
| `monitor_competitor_marketing` | 166 | 0 | no | (declaration only) | no |
| `analyze_market_trends` | 225 | 0 | no | (declaration only) | no |
| `get_attribution_data` | 296 | 0 | no | (declaration only) | no |
| `capture_lead` | 371 | 0 | no | (declaration only) | no |
| `get_lead_pipeline` | 453 | 0 | no | (declaration only) | no |
| `score_lead` | 549 | 0 | no | (declaration only) | no |
| `get_marketing_dashboard` | 648 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/memoryTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `save_memory` | 45 | 1+ | yes | (baseline/grant) | yes |
| `recall_memories` | 103 | 0 | yes | (declaration only) | yes |
| `search_memories` | 131 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/opsExtensionTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `get_agent_health_dashboard` | 34 | 0 | no | (declaration only) | no |
| `get_event_bus_health` | 108 | 0 | no | (declaration only) | no |
| `get_data_freshness` | 162 | 0 | no | (declaration only) | no |
| `get_system_costs_realtime` | 221 | 0 | no | (declaration only) | no |
| `create_status_report` | 269 | 0 | no | (declaration only) | no |
| `predict_capacity` | 355 | 0 | no | (declaration only) | no |
| `get_access_matrix` | 455 | 0 | no | (declaration only) | no |
| `provision_access` | 541 | 0 | no | (declaration only) | no |
| `revoke_access` | 603 | 0 | no | (declaration only) | no |
| `audit_access` | 658 | 0 | no | (declaration only) | no |
| `rotate_secrets` | 728 | 0 | no | (declaration only) | no |
| `get_platform_audit_log` | 792 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/peerCoordinationTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `request_peer_work` | 31 | 0 | no | (declaration only) | no |
| `create_handoff` | 175 | 0 | no | (declaration only) | no |
| `peer_data_request` | 253 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/productAnalyticsTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `get_usage_metrics` | 20 | 1+ | no | (baseline/grant) | no |
| `get_funnel_analysis` | 138 | 0 | no | (declaration only) | no |
| `get_cohort_retention` | 217 | 0 | no | (declaration only) | no |
| `get_feature_usage` | 316 | 0 | no | (declaration only) | no |
| `segment_users` | 387 | 1+ | no | (baseline/grant) | no |

### packages/agents/src/shared/quickDemoAppTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `quick_demo_web_app` | 50 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/researchMonitoringTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `create_monitor` | 41 | 1+ | no | (baseline/grant) | no |
| `check_monitors` | 107 | 1+ | no | (baseline/grant) | no |
| `get_monitor_history` | 163 | 1+ | no | (baseline/grant) | no |
| `track_competitor_product` | 220 | 0 | no | (declaration only) | no |
| `search_academic_papers` | 295 | 0 | no | (declaration only) | no |
| `track_open_source` | 400 | 0 | no | (declaration only) | no |
| `track_industry_events` | 470 | 0 | no | (declaration only) | no |
| `track_regulatory_changes` | 568 | 0 | no | (declaration only) | no |
| `analyze_ai_adoption` | 640 | 0 | no | (declaration only) | no |
| `track_ai_benchmarks` | 711 | 0 | no | (declaration only) | no |
| `analyze_org_structure` | 783 | 0 | no | (declaration only) | no |
| `compile_research_digest` | 867 | 1+ | no | (baseline/grant) | no |
| `identify_research_gaps` | 951 | 1+ | no | (baseline/grant) | no |
| `cross_reference_findings` | 1030 | 1+ | no | (baseline/grant) | no |

### packages/agents/src/shared/researchRepoTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `save_research` | 19 | 1+ | no | (baseline/grant) | no |
| `search_research` | 92 | 1+ | no | (baseline/grant) | no |
| `get_research_timeline` | 209 | 1+ | no | (baseline/grant) | no |
| `create_research_brief` | 309 | 1+ | no | (baseline/grant) | no |

### packages/agents/src/shared/researchTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `web_search` | 24 | 1+ | yes | (baseline/grant) | yes |
| `web_fetch` | 77 | 1+ | yes | (baseline/grant) | yes |
| `search_news` | 172 | 1+ | no | (baseline/grant) | no |
| `submit_research_packet` | 219 | 1+ | no | (baseline/grant) | no |

### packages/agents/src/shared/revenueTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `get_mrr_breakdown` | 35 | 0 | no | (declaration only) | no |
| `get_subscription_details` | 96 | 0 | no | (declaration only) | no |
| `get_churn_analysis` | 154 | 0 | no | (declaration only) | no |
| `get_revenue_forecast` | 220 | 0 | no | (declaration only) | no |
| `get_stripe_invoices` | 311 | 0 | no | (declaration only) | no |
| `get_customer_ltv` | 373 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/roadmapTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `create_roadmap_item` | 20 | 0 | no | (declaration only) | no |
| `score_feature_rice` | 108 | 0 | no | (declaration only) | no |
| `get_roadmap` | 172 | 1+ | no | (baseline/grant) | no |
| `update_roadmap_item` | 265 | 0 | no | (declaration only) | no |
| `get_feature_requests` | 354 | 0 | no | (declaration only) | no |
| `manage_feature_flags` | 420 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/sandboxDevTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `sandbox_shell` | 213 | 0 | no | (declaration only) | no |
| `sandbox_file_read` | 294 | 0 | no | (declaration only) | no |
| `sandbox_file_write` | 346 | 0 | no | (declaration only) | no |
| `sandbox_file_edit` | 403 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/scaffoldTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `Alice` | 72 | 0 | no | (declaration only) | no |
| `Alice` | 73 | 0 | no | (declaration only) | no |
| `scaffold_component` | 123 | 0 | no | (declaration only) | no |
| `scaffold_page` | 205 | 0 | no | (declaration only) | no |
| `list_templates` | 319 | 0 | no | (declaration only) | no |
| `clone_and_modify` | 347 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/screenshotTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `screenshot_page` | 34 | 1+ | no | (baseline/grant) | no |
| `screenshot_component` | 87 | 0 | no | (declaration only) | no |
| `compare_screenshots` | 166 | 0 | no | (declaration only) | no |
| `check_responsive` | 206 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/seoTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `get_search_performance` | 44 | 1+ | no | (baseline/grant) | no |
| `track_keyword_rankings` | 139 | 0 | no | (declaration only) | no |
| `analyze_page_seo` | 251 | 0 | no | (declaration only) | no |
| `get_indexing_status` | 369 | 0 | no | (declaration only) | no |
| `submit_sitemap` | 446 | 0 | no | (declaration only) | no |
| `update_seo_data` | 509 | 0 | no | (declaration only) | no |
| `get_backlink_profile` | 569 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/sharepointTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `upload_to_sharepoint` | 21 | 0 | no | (declaration only) | no |
| `search_sharepoint` | 92 | 0 | no | (declaration only) | no |
| `read_sharepoint_document` | 148 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/slackOutputTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `post_to_slack` | 189 | 0 | no | (declaration only) | no |
| `request_slack_approval` | 291 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/socialMediaTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `schedule_social_post` | 326 | 1+ | no | (baseline/grant) | no |
| `get_scheduled_posts` | 628 | 0 | no | (declaration only) | no |
| `get_social_metrics` | 696 | 0 | no | (declaration only) | no |
| `get_post_performance` | 750 | 0 | no | (declaration only) | no |
| `get_social_audience` | 804 | 0 | no | (declaration only) | no |
| `reply_to_social` | 871 | 0 | no | (declaration only) | no |
| `get_trending_topics` | 942 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/storybookTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `storybook_list_stories` | 58 | 0 | no | (declaration only) | no |
| `storybook_screenshot` | 78 | 0 | no | (declaration only) | no |
| `storybook_screenshot_all` | 137 | 0 | no | (declaration only) | no |
| `storybook_visual_diff` | 208 | 0 | no | (declaration only) | no |
| `storybook_save_baseline` | 269 | 0 | no | (declaration only) | no |
| `storybook_check_coverage` | 362 | 0 | no | (declaration only) | no |
| `storybook_get_story_source` | 431 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/teamOrchestrationTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `assign_team_task` | 150 | 0 | no | (declaration only) | no |
| `create_sub_team_assignment` | 310 | 0 | no | (declaration only) | no |
| `review_team_output` | 490 | 0 | no | (declaration only) | no |
| `notify_founders` | 671 | 0 | no | (declaration only) | no |
| `check_team_status` | 759 | 0 | no | (declaration only) | no |
| `check_team_assignments` | 788 | 0 | no | (declaration only) | no |
| `escalate_to_sarah` | 816 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/teamsOutputTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `post_to_customer_teams` | 283 | 0 | no | (declaration only) | no |
| `request_teams_approval` | 365 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/toolGrantTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `grant_tool_access` | 28 | 1+ | no | (baseline/grant) | no |
| `revoke_tool_access` | 182 | 1+ | no | (baseline/grant) | no |

### packages/agents/src/shared/toolRegistryTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `list_tool_requests` | 44 | 0 | no | (declaration only) | no |
| `review_tool_request` | 88 | 0 | no | (declaration only) | no |
| `register_tool` | 180 | 0 | no | (declaration only) | no |
| `deactivate_tool` | 339 | 0 | no | (declaration only) | no |
| `list_registered_tools` | 384 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/toolRequestTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `list_my_tools` | 207 | 1+ | no | (baseline/grant) | no |
| `tool_search` | 279 | 1+ | no | (baseline/grant) | no |
| `check_tool_access` | 336 | 0 | no | (declaration only) | no |
| `request_new_tool` | 440 | 0 | no | (declaration only) | no |
| `check_tool_request_status` | 705 | 0 | no | (declaration only) | no |
| `request_tool_access` | 738 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/userResearchTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `create_survey` | 33 | 0 | no | (declaration only) | no |
| `get_survey_results` | 100 | 0 | no | (declaration only) | no |
| `analyze_support_tickets` | 159 | 0 | no | (declaration only) | no |
| `get_user_feedback` | 256 | 0 | no | (declaration only) | no |
| `create_user_persona` | 351 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/videoCreationTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `generate_image` | 129 | 0 | no | (declaration only) | no |
| `generate_video` | 205 | 0 | no | (declaration only) | no |
| `poll_video_status` | 297 | 0 | no | (declaration only) | no |
| `generate_voiceover` | 359 | 0 | no | (declaration only) | no |
| `generate_sfx` | 429 | 0 | no | (declaration only) | no |
| `generate_music` | 490 | 0 | no | (declaration only) | no |
| `enhance_video_prompt` | 551 | 0 | no | (declaration only) | no |

### packages/agents/src/shared/webBuildPlannerTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `plan_website_build` | 225 | 1+ | no | (baseline/grant) | no |

### packages/agents/src/shared/webBuildTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `invoke_web_build` | 1787 | 1+ | no | (baseline/grant) | no |
| `invoke_web_iterate` | 1885 | 1+ | no | (baseline/grant) | no |
| `invoke_web_coding_loop` | 1937 | 1+ | no | (baseline/grant) | no |
| `invoke_web_upgrade` | 2101 | 0 | no | (declaration only) | no |
| `search_components` | 2460 | 0 | no | (declaration only) | no |
| `get_component_info` | 2471 | 0 | no | (declaration only) | no |
| `get_installation_info` | 2482 | 0 | no | (declaration only) | no |
| `install_item_from_registry` | 2498 | 0 | no | (declaration only) | no |
| `button` | 2534 | 0 | no | (declaration only) | no |
| `card` | 2535 | 0 | no | (declaration only) | no |
| `tabs` | 2536 | 0 | no | (declaration only) | no |
| `dialog` | 2537 | 0 | no | (declaration only) | no |
| `particles` | 2540 | 0 | no | (declaration only) | no |
| `spotlight` | 2541 | 0 | no | (declaration only) | no |
| `build_website_foundation` | 3165 | 1+ | no | (baseline/grant) | no |

### packages/agents/src/shared/websiteIngestionTools.ts

| Tool name | Line | # roles | Production? | Last call | Eval? |
|-----------|------|---------|-------------|-----------|-------|
| `scrape_website` | 153 | 0 | no | (declaration only) | no |



## 2. Tools That Exist But Are Never Granted

Tools defined but not granted to any role via baseline or migrations.

**Count**: 335 tools

### packages/agents/src/shared/accessAuditTools.ts

- `view_access_matrix` — packages/agents/src/shared/accessAuditTools.ts:14
- `view_pending_grant_requests` — packages/agents/src/shared/accessAuditTools.ts:77

### packages/agents/src/shared/agent365Tools.ts

- `reply_email_with_attachments` — packages/agents/src/shared/agent365Tools.ts:301
- `reply_email_with_attachments` — packages/agents/src/shared/agent365Tools.ts:445
- `reply_email_with_attachments` — packages/agents/src/shared/agent365Tools.ts:464

### packages/agents/src/shared/agentCreationTools.ts

- `list_my_created_agents` — packages/agents/src/shared/agentCreationTools.ts:291
- `retire_created_agent` — packages/agents/src/shared/agentCreationTools.ts:323
- `create_specialist_agent` — packages/agents/src/shared/agentCreationTools.ts:53

### packages/agents/src/shared/agentDirectoryTools.ts

- `get_agent_directory` — packages/agents/src/shared/agentDirectoryTools.ts:15
- `who_handles` — packages/agents/src/shared/agentDirectoryTools.ts:158
- `Nexus` — packages/agents/src/shared/agentDirectoryTools.ts:185

### packages/agents/src/shared/agentManagementTools.ts

- `update_agent_name` — packages/agents/src/shared/agentManagementTools.ts:15
- `set_reports_to` — packages/agents/src/shared/agentManagementTools.ts:53

### packages/agents/src/shared/assetTools.ts

- `generate_image` — packages/agents/src/shared/assetTools.ts:504
- `generate_and_publish_asset` — packages/agents/src/shared/assetTools.ts:538
- `publish_asset_deliverable` — packages/agents/src/shared/assetTools.ts:682
- `upload_asset` — packages/agents/src/shared/assetTools.ts:763
- `list_assets` — packages/agents/src/shared/assetTools.ts:793
- `optimize_image` — packages/agents/src/shared/assetTools.ts:885
- `generate_favicon_set` — packages/agents/src/shared/assetTools.ts:949

### packages/agents/src/shared/auditTools.ts

- `validate_brand_compliance` — packages/agents/src/shared/auditTools.ts:343
- `check_bundle_size` — packages/agents/src/shared/auditTools.ts:430
- `check_build_errors` — packages/agents/src/shared/auditTools.ts:532
- `run_lighthouse_audit` — packages/agents/src/shared/auditTools.ts:56

### packages/agents/src/shared/canvaTools.ts

- `get_canva_design` — packages/agents/src/shared/canvaTools.ts:105
- `search_canva_designs` — packages/agents/src/shared/canvaTools.ts:126
- `list_canva_brand_templates` — packages/agents/src/shared/canvaTools.ts:150
- `get_canva_template_fields` — packages/agents/src/shared/canvaTools.ts:169
- `generate_canva_design` — packages/agents/src/shared/canvaTools.ts:189
- `export_canva_design` — packages/agents/src/shared/canvaTools.ts:254
- `upload_canva_asset` — packages/agents/src/shared/canvaTools.ts:290
- `create_canva_design` — packages/agents/src/shared/canvaTools.ts:70

### packages/agents/src/shared/cashFlowTools.ts

- `get_cash_flow` — packages/agents/src/shared/cashFlowTools.ts:101
- `get_pending_transactions` — packages/agents/src/shared/cashFlowTools.ts:159
- `generate_financial_report` — packages/agents/src/shared/cashFlowTools.ts:260
- `get_cash_balance` — packages/agents/src/shared/cashFlowTools.ts:28
- `get_margin_analysis` — packages/agents/src/shared/cashFlowTools.ts:360
- `primary` — packages/agents/src/shared/cashFlowTools.ts:82

### packages/agents/src/shared/channelNotifyTools.ts

- `post_to_briefings` — packages/agents/src/shared/channelNotifyTools.ts:64

### packages/agents/src/shared/claudeParityTools.ts

- `delegate_codebase_explore` — packages/agents/src/shared/claudeParityTools.ts:101
- `run_todo_write` — packages/agents/src/shared/claudeParityTools.ts:36

### packages/agents/src/shared/codexTools.ts

- `codex` — packages/agents/src/shared/codexTools.ts:102
- `codex` — packages/agents/src/shared/codexTools.ts:23

### packages/agents/src/shared/collectiveIntelligenceTools.ts

- `update_vitals_highlights` — packages/agents/src/shared/collectiveIntelligenceTools.ts:103
- `promote_to_org_knowledge` — packages/agents/src/shared/collectiveIntelligenceTools.ts:142
- `get_org_knowledge` — packages/agents/src/shared/collectiveIntelligenceTools.ts:201
- `read_company_doctrine` — packages/agents/src/shared/collectiveIntelligenceTools.ts:231
- `create_knowledge_route` — packages/agents/src/shared/collectiveIntelligenceTools.ts:330
- `get_knowledge_routes` — packages/agents/src/shared/collectiveIntelligenceTools.ts:375
- `detect_contradictions` — packages/agents/src/shared/collectiveIntelligenceTools.ts:387
- `record_process_pattern` — packages/agents/src/shared/collectiveIntelligenceTools.ts:399
- `get_process_patterns` — packages/agents/src/shared/collectiveIntelligenceTools.ts:472
- `propose_authority_change` — packages/agents/src/shared/collectiveIntelligenceTools.ts:498
- `get_authority_proposals` — packages/agents/src/shared/collectiveIntelligenceTools.ts:566
- `update_doctrine_section` — packages/agents/src/shared/collectiveIntelligenceTools.ts:585
- `get_company_vitals` — packages/agents/src/shared/collectiveIntelligenceTools.ts:73
- `update_company_vitals` — packages/agents/src/shared/collectiveIntelligenceTools.ts:83

### packages/agents/src/shared/communicationTools.ts

- `create_peer_work_request` — packages/agents/src/shared/communicationTools.ts:266
- `call_meeting` — packages/agents/src/shared/communicationTools.ts:486

### packages/agents/src/shared/competitiveIntelTools.ts

- `update_competitor_profile` — packages/agents/src/shared/competitiveIntelTools.ts:154
- `track_competitor` — packages/agents/src/shared/competitiveIntelTools.ts:22
- `compare_features` — packages/agents/src/shared/competitiveIntelTools.ts:222
- `track_competitor_pricing` — packages/agents/src/shared/competitiveIntelTools.ts:291
- `monitor_competitor_launches` — packages/agents/src/shared/competitiveIntelTools.ts:349
- `get_market_landscape` — packages/agents/src/shared/competitiveIntelTools.ts:430

### packages/agents/src/shared/contentTools.ts

- `update_content_draft` — packages/agents/src/shared/contentTools.ts:201
- `get_content_drafts` — packages/agents/src/shared/contentTools.ts:309
- `submit_content_for_review` — packages/agents/src/shared/contentTools.ts:382
- `approve_content_draft` — packages/agents/src/shared/contentTools.ts:465
- `reject_content_draft` — packages/agents/src/shared/contentTools.ts:557
- `publish_content` — packages/agents/src/shared/contentTools.ts:644
- `get_content_metrics` — packages/agents/src/shared/contentTools.ts:720
- `get_content_calendar` — packages/agents/src/shared/contentTools.ts:772
- `generate_content_image` — packages/agents/src/shared/contentTools.ts:839
- `create_content_draft` — packages/agents/src/shared/contentTools.ts:93

### packages/agents/src/shared/costManagementTools.ts

- `get_vendor_costs` — packages/agents/src/shared/costManagementTools.ts:164
- `get_cost_anomalies` — packages/agents/src/shared/costManagementTools.ts:211
- `get_gcp_costs` — packages/agents/src/shared/costManagementTools.ts:22
- `get_burn_rate` — packages/agents/src/shared/costManagementTools.ts:282
- `create_budget` — packages/agents/src/shared/costManagementTools.ts:358
- `check_budget_status` — packages/agents/src/shared/costManagementTools.ts:415
- `get_ai_model_costs` — packages/agents/src/shared/costManagementTools.ts:90

### packages/agents/src/shared/deliverableTools.ts

- `get_deliverables` — packages/agents/src/shared/deliverableTools.ts:222
- `publish_deliverable` — packages/agents/src/shared/deliverableTools.ts:54

### packages/agents/src/shared/deployPreviewTools.ts

- `get_deployment_status` — packages/agents/src/shared/deployPreviewTools.ts:138
- `list_deployments` — packages/agents/src/shared/deployPreviewTools.ts:233

### packages/agents/src/shared/designBriefTools.ts

- `app_shell` — packages/agents/src/shared/designBriefTools.ts:109
- `primary_feature_surface` — packages/agents/src/shared/designBriefTools.ts:115
- `supporting_controls` — packages/agents/src/shared/designBriefTools.ts:121
- `hero` — packages/agents/src/shared/designBriefTools.ts:81
- `value_proposition` — packages/agents/src/shared/designBriefTools.ts:87
- `cta_section` — packages/agents/src/shared/designBriefTools.ts:93
- `footer` — packages/agents/src/shared/designBriefTools.ts:99

### packages/agents/src/shared/designSystemTools.ts

- `get_design_tokens` — packages/agents/src/shared/designSystemTools.ts:113
- `update_design_token` — packages/agents/src/shared/designSystemTools.ts:183
- `validate_tokens_vs_implementation` — packages/agents/src/shared/designSystemTools.ts:291
- `get_color_palette` — packages/agents/src/shared/designSystemTools.ts:386
- `get_typography_scale` — packages/agents/src/shared/designSystemTools.ts:463
- `list_components` — packages/agents/src/shared/designSystemTools.ts:513
- `get_component_usage` — packages/agents/src/shared/designSystemTools.ts:585

### packages/agents/src/shared/diagnosticTools.ts

- `list_tables` — packages/agents/src/shared/diagnosticTools.ts:172
- `check_table_schema` — packages/agents/src/shared/diagnosticTools.ts:19
- `check_tool_health` — packages/agents/src/shared/diagnosticTools.ts:215
- `diagnose_column_error` — packages/agents/src/shared/diagnosticTools.ts:83

### packages/agents/src/shared/dmTools.ts

- `send_teams_dm` — packages/agents/src/shared/dmTools.ts:214
- `read_teams_dm` — packages/agents/src/shared/dmTools.ts:349

### packages/agents/src/shared/documentTools.ts

- `generate_pdf` — packages/agents/src/shared/documentTools.ts:345
- `generate_word_doc` — packages/agents/src/shared/documentTools.ts:465

### packages/agents/src/shared/docusignTools.ts

- `send_template_envelope` — packages/agents/src/shared/docusignTools.ts:202
- `check_envelope_status` — packages/agents/src/shared/docusignTools.ts:291
- `list_envelopes` — packages/agents/src/shared/docusignTools.ts:341
- `void_envelope` — packages/agents/src/shared/docusignTools.ts:398
- `resend_envelope` — packages/agents/src/shared/docusignTools.ts:442
- `create_signing_envelope` — packages/agents/src/shared/docusignTools.ts:47
- `send_draft_envelope` — packages/agents/src/shared/docusignTools.ts:476
- `get_envelope_documents` — packages/agents/src/shared/docusignTools.ts:513
- `get_envelope_form_data` — packages/agents/src/shared/docusignTools.ts:554
- `get_envelope_audit_trail` — packages/agents/src/shared/docusignTools.ts:594
- `add_envelope_recipients` — packages/agents/src/shared/docusignTools.ts:637

### packages/agents/src/shared/emailMarketingTools.ts

- `get_mailchimp_members` — packages/agents/src/shared/emailMarketingTools.ts:112
- `get_mailchimp_segments` — packages/agents/src/shared/emailMarketingTools.ts:157
- `create_mailchimp_campaign` — packages/agents/src/shared/emailMarketingTools.ts:188
- `set_campaign_content` — packages/agents/src/shared/emailMarketingTools.ts:226
- `send_test_campaign` — packages/agents/src/shared/emailMarketingTools.ts:251
- `send_campaign` — packages/agents/src/shared/emailMarketingTools.ts:281
- `get_campaign_report` — packages/agents/src/shared/emailMarketingTools.ts:324
- `get_campaign_list` — packages/agents/src/shared/emailMarketingTools.ts:356
- `manage_mailchimp_tags` — packages/agents/src/shared/emailMarketingTools.ts:402
- `send_transactional_email` — packages/agents/src/shared/emailMarketingTools.ts:450
- `get_mandrill_stats` — packages/agents/src/shared/emailMarketingTools.ts:492
- `search_mandrill_messages` — packages/agents/src/shared/emailMarketingTools.ts:529
- `get_mandrill_templates` — packages/agents/src/shared/emailMarketingTools.ts:571
- `render_mandrill_template` — packages/agents/src/shared/emailMarketingTools.ts:599
- `get_mailchimp_lists` — packages/agents/src/shared/emailMarketingTools.ts:77

### packages/agents/src/shared/engineeringGapTools.ts

- `get_quality_metrics` — packages/agents/src/shared/engineeringGapTools.ts:161
- `create_test_plan` — packages/agents/src/shared/engineeringGapTools.ts:262
- `run_test_suite` — packages/agents/src/shared/engineeringGapTools.ts:28
- `get_container_logs` — packages/agents/src/shared/engineeringGapTools.ts:320
- `scale_service` — packages/agents/src/shared/engineeringGapTools.ts:402
- `get_build_queue` — packages/agents/src/shared/engineeringGapTools.ts:464
- `get_deployment_history` — packages/agents/src/shared/engineeringGapTools.ts:518
- `get_infrastructure_inventory` — packages/agents/src/shared/engineeringGapTools.ts:602
- `get_service_dependencies` — packages/agents/src/shared/engineeringGapTools.ts:699
- `get_code_coverage` — packages/agents/src/shared/engineeringGapTools.ts:80

### packages/agents/src/shared/entraHRTools.ts

- `entra_update_user_profile` — packages/agents/src/shared/entraHRTools.ts:127
- `entra_upload_user_photo` — packages/agents/src/shared/entraHRTools.ts:190
- `entra_set_manager` — packages/agents/src/shared/entraHRTools.ts:259
- `entra_hr_assign_license` — packages/agents/src/shared/entraHRTools.ts:319
- `entra_audit_profiles` — packages/agents/src/shared/entraHRTools.ts:378
- `entra_get_user_profile` — packages/agents/src/shared/entraHRTools.ts:70

### packages/agents/src/shared/eventTools.ts

- `emit_insight` — packages/agents/src/shared/eventTools.ts:20
- `emit_alert` — packages/agents/src/shared/eventTools.ts:76

### packages/agents/src/shared/executiveOrchestrationTools.ts

- `create_team_assignments` — packages/agents/src/shared/executiveOrchestrationTools.ts:109
- `evaluate_team_output` — packages/agents/src/shared/executiveOrchestrationTools.ts:436
- `check_team_status` — packages/agents/src/shared/executiveOrchestrationTools.ts:601
- `synthesize_team_deliverable` — packages/agents/src/shared/executiveOrchestrationTools.ts:681

### packages/agents/src/shared/externalA2aTools.ts

- `discover_external_agents` — packages/agents/src/shared/externalA2aTools.ts:15

### packages/agents/src/shared/facebookTools.ts

- `get_facebook_posts` — packages/agents/src/shared/facebookTools.ts:117
- `get_facebook_insights` — packages/agents/src/shared/facebookTools.ts:138
- `get_facebook_post_performance` — packages/agents/src/shared/facebookTools.ts:168
- `get_facebook_audience` — packages/agents/src/shared/facebookTools.ts:188
- `check_facebook_status` — packages/agents/src/shared/facebookTools.ts:202
- `publish_facebook_post` — packages/agents/src/shared/facebookTools.ts:28
- `schedule_facebook_post` — packages/agents/src/shared/facebookTools.ts:64

### packages/agents/src/shared/figmaTools.ts

- `get_figma_team_components` — packages/agents/src/shared/figmaTools.ts:115
- `get_figma_styles` — packages/agents/src/shared/figmaTools.ts:136
- `get_figma_team_styles` — packages/agents/src/shared/figmaTools.ts:157
- `get_figma_file` — packages/agents/src/shared/figmaTools.ts:17
- `get_figma_comments` — packages/agents/src/shared/figmaTools.ts:180
- `post_figma_comment` — packages/agents/src/shared/figmaTools.ts:201
- `resolve_figma_comment` — packages/agents/src/shared/figmaTools.ts:243
- `get_figma_file_metadata` — packages/agents/src/shared/figmaTools.ts:269
- `get_figma_version_history` — packages/agents/src/shared/figmaTools.ts:290
- `get_figma_team_projects` — packages/agents/src/shared/figmaTools.ts:313
- `get_figma_project_files` — packages/agents/src/shared/figmaTools.ts:334
- `get_figma_dev_resources` — packages/agents/src/shared/figmaTools.ts:357
- `create_figma_dev_resource` — packages/agents/src/shared/figmaTools.ts:378
- `manage_figma_webhooks` — packages/agents/src/shared/figmaTools.ts:412
- `export_figma_images` — packages/agents/src/shared/figmaTools.ts:43
- `get_figma_image_fills` — packages/agents/src/shared/figmaTools.ts:71
- `get_figma_components` — packages/agents/src/shared/figmaTools.ts:94

### packages/agents/src/shared/frontendCodeTools.ts

- `search_frontend_code` — packages/agents/src/shared/frontendCodeTools.ts:109
- `list_frontend_files` — packages/agents/src/shared/frontendCodeTools.ts:158
- `write_frontend_file` — packages/agents/src/shared/frontendCodeTools.ts:203
- `create_design_branch` — packages/agents/src/shared/frontendCodeTools.ts:264
- `create_frontend_pr` — packages/agents/src/shared/frontendCodeTools.ts:335
- `check_pr_status` — packages/agents/src/shared/frontendCodeTools.ts:384
- `read_frontend_file` — packages/agents/src/shared/frontendCodeTools.ts:67

### packages/agents/src/shared/graphTools.ts

- `add_knowledge` — packages/agents/src/shared/graphTools.ts:120
- `trace_causes` — packages/agents/src/shared/graphTools.ts:50
- `trace_impact` — packages/agents/src/shared/graphTools.ts:68
- `query_knowledge_graph` — packages/agents/src/shared/graphTools.ts:86

### packages/agents/src/shared/initiativeTools.ts

- `propose_initiative` — packages/agents/src/shared/initiativeTools.ts:151

### packages/agents/src/shared/knowledgeRetrievalTools.ts

- `read_company_knowledge` — packages/agents/src/shared/knowledgeRetrievalTools.ts:21

### packages/agents/src/shared/legalDocumentTools.ts

- `prepare_signing_envelope` — packages/agents/src/shared/legalDocumentTools.ts:145
- `draft_legal_document` — packages/agents/src/shared/legalDocumentTools.ts:20

### packages/agents/src/shared/linkedinTools.ts

- `get_linkedin_followers` — packages/agents/src/shared/linkedinTools.ts:106
- `get_linkedin_page_stats` — packages/agents/src/shared/linkedinTools.ts:120
- `get_linkedin_demographics` — packages/agents/src/shared/linkedinTools.ts:134
- `check_linkedin_status` — packages/agents/src/shared/linkedinTools.ts:148
- `publish_linkedin_post` — packages/agents/src/shared/linkedinTools.ts:28
- `get_linkedin_posts` — packages/agents/src/shared/linkedinTools.ts:65
- `get_linkedin_post_analytics` — packages/agents/src/shared/linkedinTools.ts:86

### packages/agents/src/shared/logoTools.ts

- `GLYPHOR` — packages/agents/src/shared/logoTools.ts:15
- `create_logo_variation` — packages/agents/src/shared/logoTools.ts:205
- `restyle_logo` — packages/agents/src/shared/logoTools.ts:280
- `create_social_avatar` — packages/agents/src/shared/logoTools.ts:376

### packages/agents/src/shared/marketingIntelTools.ts

- `monitor_competitor_marketing` — packages/agents/src/shared/marketingIntelTools.ts:166
- `analyze_market_trends` — packages/agents/src/shared/marketingIntelTools.ts:225
- `create_experiment` — packages/agents/src/shared/marketingIntelTools.ts:23
- `get_attribution_data` — packages/agents/src/shared/marketingIntelTools.ts:296
- `capture_lead` — packages/agents/src/shared/marketingIntelTools.ts:371
- `get_lead_pipeline` — packages/agents/src/shared/marketingIntelTools.ts:453
- `score_lead` — packages/agents/src/shared/marketingIntelTools.ts:549
- `get_marketing_dashboard` — packages/agents/src/shared/marketingIntelTools.ts:648
- `get_experiment_results` — packages/agents/src/shared/marketingIntelTools.ts:91

### packages/agents/src/shared/memoryTools.ts

- `recall_memories` — packages/agents/src/shared/memoryTools.ts:103
- `search_memories` — packages/agents/src/shared/memoryTools.ts:131

### packages/agents/src/shared/opsExtensionTools.ts

- `get_event_bus_health` — packages/agents/src/shared/opsExtensionTools.ts:108
- `get_data_freshness` — packages/agents/src/shared/opsExtensionTools.ts:162
- `get_system_costs_realtime` — packages/agents/src/shared/opsExtensionTools.ts:221
- `create_status_report` — packages/agents/src/shared/opsExtensionTools.ts:269
- `get_agent_health_dashboard` — packages/agents/src/shared/opsExtensionTools.ts:34
- `predict_capacity` — packages/agents/src/shared/opsExtensionTools.ts:355
- `get_access_matrix` — packages/agents/src/shared/opsExtensionTools.ts:455
- `provision_access` — packages/agents/src/shared/opsExtensionTools.ts:541
- `revoke_access` — packages/agents/src/shared/opsExtensionTools.ts:603
- `audit_access` — packages/agents/src/shared/opsExtensionTools.ts:658
- `rotate_secrets` — packages/agents/src/shared/opsExtensionTools.ts:728
- `get_platform_audit_log` — packages/agents/src/shared/opsExtensionTools.ts:792

### packages/agents/src/shared/peerCoordinationTools.ts

- `create_handoff` — packages/agents/src/shared/peerCoordinationTools.ts:175
- `peer_data_request` — packages/agents/src/shared/peerCoordinationTools.ts:253
- `request_peer_work` — packages/agents/src/shared/peerCoordinationTools.ts:31

### packages/agents/src/shared/productAnalyticsTools.ts

- `get_funnel_analysis` — packages/agents/src/shared/productAnalyticsTools.ts:138
- `get_cohort_retention` — packages/agents/src/shared/productAnalyticsTools.ts:217
- `get_feature_usage` — packages/agents/src/shared/productAnalyticsTools.ts:316

### packages/agents/src/shared/quickDemoAppTools.ts

- `quick_demo_web_app` — packages/agents/src/shared/quickDemoAppTools.ts:50

### packages/agents/src/shared/researchMonitoringTools.ts

- `track_competitor_product` — packages/agents/src/shared/researchMonitoringTools.ts:220
- `search_academic_papers` — packages/agents/src/shared/researchMonitoringTools.ts:295
- `track_open_source` — packages/agents/src/shared/researchMonitoringTools.ts:400
- `track_industry_events` — packages/agents/src/shared/researchMonitoringTools.ts:470
- `track_regulatory_changes` — packages/agents/src/shared/researchMonitoringTools.ts:568
- `analyze_ai_adoption` — packages/agents/src/shared/researchMonitoringTools.ts:640
- `track_ai_benchmarks` — packages/agents/src/shared/researchMonitoringTools.ts:711
- `analyze_org_structure` — packages/agents/src/shared/researchMonitoringTools.ts:783

### packages/agents/src/shared/revenueTools.ts

- `get_churn_analysis` — packages/agents/src/shared/revenueTools.ts:154
- `get_revenue_forecast` — packages/agents/src/shared/revenueTools.ts:220
- `get_stripe_invoices` — packages/agents/src/shared/revenueTools.ts:311
- `get_mrr_breakdown` — packages/agents/src/shared/revenueTools.ts:35
- `get_customer_ltv` — packages/agents/src/shared/revenueTools.ts:373
- `get_subscription_details` — packages/agents/src/shared/revenueTools.ts:96

### packages/agents/src/shared/roadmapTools.ts

- `score_feature_rice` — packages/agents/src/shared/roadmapTools.ts:108
- `create_roadmap_item` — packages/agents/src/shared/roadmapTools.ts:20
- `update_roadmap_item` — packages/agents/src/shared/roadmapTools.ts:265
- `get_feature_requests` — packages/agents/src/shared/roadmapTools.ts:354
- `manage_feature_flags` — packages/agents/src/shared/roadmapTools.ts:420

### packages/agents/src/shared/sandboxDevTools.ts

- `sandbox_shell` — packages/agents/src/shared/sandboxDevTools.ts:213
- `sandbox_file_read` — packages/agents/src/shared/sandboxDevTools.ts:294
- `sandbox_file_write` — packages/agents/src/shared/sandboxDevTools.ts:346
- `sandbox_file_edit` — packages/agents/src/shared/sandboxDevTools.ts:403

### packages/agents/src/shared/scaffoldTools.ts

- `scaffold_component` — packages/agents/src/shared/scaffoldTools.ts:123
- `scaffold_page` — packages/agents/src/shared/scaffoldTools.ts:205
- `list_templates` — packages/agents/src/shared/scaffoldTools.ts:319
- `clone_and_modify` — packages/agents/src/shared/scaffoldTools.ts:347
- `Alice` — packages/agents/src/shared/scaffoldTools.ts:72
- `Alice` — packages/agents/src/shared/scaffoldTools.ts:73

### packages/agents/src/shared/screenshotTools.ts

- `compare_screenshots` — packages/agents/src/shared/screenshotTools.ts:166
- `check_responsive` — packages/agents/src/shared/screenshotTools.ts:206
- `screenshot_component` — packages/agents/src/shared/screenshotTools.ts:87

### packages/agents/src/shared/seoTools.ts

- `track_keyword_rankings` — packages/agents/src/shared/seoTools.ts:139
- `analyze_page_seo` — packages/agents/src/shared/seoTools.ts:251
- `get_indexing_status` — packages/agents/src/shared/seoTools.ts:369
- `submit_sitemap` — packages/agents/src/shared/seoTools.ts:446
- `update_seo_data` — packages/agents/src/shared/seoTools.ts:509
- `get_backlink_profile` — packages/agents/src/shared/seoTools.ts:569

### packages/agents/src/shared/sharepointTools.ts

- `read_sharepoint_document` — packages/agents/src/shared/sharepointTools.ts:148
- `upload_to_sharepoint` — packages/agents/src/shared/sharepointTools.ts:21
- `search_sharepoint` — packages/agents/src/shared/sharepointTools.ts:92

### packages/agents/src/shared/slackOutputTools.ts

- `post_to_slack` — packages/agents/src/shared/slackOutputTools.ts:189
- `request_slack_approval` — packages/agents/src/shared/slackOutputTools.ts:291

### packages/agents/src/shared/socialMediaTools.ts

- `get_scheduled_posts` — packages/agents/src/shared/socialMediaTools.ts:628
- `get_social_metrics` — packages/agents/src/shared/socialMediaTools.ts:696
- `get_post_performance` — packages/agents/src/shared/socialMediaTools.ts:750
- `get_social_audience` — packages/agents/src/shared/socialMediaTools.ts:804
- `reply_to_social` — packages/agents/src/shared/socialMediaTools.ts:871
- `get_trending_topics` — packages/agents/src/shared/socialMediaTools.ts:942

### packages/agents/src/shared/storybookTools.ts

- `storybook_screenshot_all` — packages/agents/src/shared/storybookTools.ts:137
- `storybook_visual_diff` — packages/agents/src/shared/storybookTools.ts:208
- `storybook_save_baseline` — packages/agents/src/shared/storybookTools.ts:269
- `storybook_check_coverage` — packages/agents/src/shared/storybookTools.ts:362
- `storybook_get_story_source` — packages/agents/src/shared/storybookTools.ts:431
- `storybook_list_stories` — packages/agents/src/shared/storybookTools.ts:58
- `storybook_screenshot` — packages/agents/src/shared/storybookTools.ts:78

### packages/agents/src/shared/teamOrchestrationTools.ts

- `assign_team_task` — packages/agents/src/shared/teamOrchestrationTools.ts:150
- `create_sub_team_assignment` — packages/agents/src/shared/teamOrchestrationTools.ts:310
- `review_team_output` — packages/agents/src/shared/teamOrchestrationTools.ts:490
- `notify_founders` — packages/agents/src/shared/teamOrchestrationTools.ts:671
- `check_team_status` — packages/agents/src/shared/teamOrchestrationTools.ts:759
- `check_team_assignments` — packages/agents/src/shared/teamOrchestrationTools.ts:788
- `escalate_to_sarah` — packages/agents/src/shared/teamOrchestrationTools.ts:816

### packages/agents/src/shared/teamsOutputTools.ts

- `post_to_customer_teams` — packages/agents/src/shared/teamsOutputTools.ts:283
- `request_teams_approval` — packages/agents/src/shared/teamsOutputTools.ts:365

### packages/agents/src/shared/toolRegistryTools.ts

- `register_tool` — packages/agents/src/shared/toolRegistryTools.ts:180
- `deactivate_tool` — packages/agents/src/shared/toolRegistryTools.ts:339
- `list_registered_tools` — packages/agents/src/shared/toolRegistryTools.ts:384
- `list_tool_requests` — packages/agents/src/shared/toolRegistryTools.ts:44
- `review_tool_request` — packages/agents/src/shared/toolRegistryTools.ts:88

### packages/agents/src/shared/toolRequestTools.ts

- `check_tool_access` — packages/agents/src/shared/toolRequestTools.ts:336
- `request_new_tool` — packages/agents/src/shared/toolRequestTools.ts:440
- `check_tool_request_status` — packages/agents/src/shared/toolRequestTools.ts:705
- `request_tool_access` — packages/agents/src/shared/toolRequestTools.ts:738

### packages/agents/src/shared/userResearchTools.ts

- `get_survey_results` — packages/agents/src/shared/userResearchTools.ts:100
- `analyze_support_tickets` — packages/agents/src/shared/userResearchTools.ts:159
- `get_user_feedback` — packages/agents/src/shared/userResearchTools.ts:256
- `create_survey` — packages/agents/src/shared/userResearchTools.ts:33
- `create_user_persona` — packages/agents/src/shared/userResearchTools.ts:351

### packages/agents/src/shared/videoCreationTools.ts

- `generate_image` — packages/agents/src/shared/videoCreationTools.ts:129
- `generate_video` — packages/agents/src/shared/videoCreationTools.ts:205
- `poll_video_status` — packages/agents/src/shared/videoCreationTools.ts:297
- `generate_voiceover` — packages/agents/src/shared/videoCreationTools.ts:359
- `generate_sfx` — packages/agents/src/shared/videoCreationTools.ts:429
- `generate_music` — packages/agents/src/shared/videoCreationTools.ts:490
- `enhance_video_prompt` — packages/agents/src/shared/videoCreationTools.ts:551

### packages/agents/src/shared/webBuildTools.ts

- `invoke_web_upgrade` — packages/agents/src/shared/webBuildTools.ts:2101
- `search_components` — packages/agents/src/shared/webBuildTools.ts:2460
- `get_component_info` — packages/agents/src/shared/webBuildTools.ts:2471
- `get_installation_info` — packages/agents/src/shared/webBuildTools.ts:2482
- `install_item_from_registry` — packages/agents/src/shared/webBuildTools.ts:2498
- `button` — packages/agents/src/shared/webBuildTools.ts:2534
- `card` — packages/agents/src/shared/webBuildTools.ts:2535
- `tabs` — packages/agents/src/shared/webBuildTools.ts:2536
- `dialog` — packages/agents/src/shared/webBuildTools.ts:2537
- `particles` — packages/agents/src/shared/webBuildTools.ts:2540
- `spotlight` — packages/agents/src/shared/webBuildTools.ts:2541

### packages/agents/src/shared/websiteIngestionTools.ts

- `scrape_website` — packages/agents/src/shared/websiteIngestionTools.ts:153



## 3. Tools Granted to Roles But Never Actually Called

Tools that appear in baseline/grant migrations but have minimal evidence of production usage.
This section requires deep call-site analysis; below are candidates based on absence from
agent-runtime production paths and test files.

**Suspected count**: 81 tools

Sample (first 50):

- `plan_website_build` — granted via baseline, declared at packages/agents/src/shared/webBuildPlannerTools.ts:225
- `invoke_web_iterate` — granted via baseline, declared at packages/agents/src/shared/webBuildTools.ts:1885
- `github_create_from_template` — granted via baseline (definition not found in scanned files)
- `github_list_branches` — granted via baseline (definition not found in scanned files)
- `vercel_get_preview_url` — granted via baseline (definition not found in scanned files)
- `list_my_tools` — granted via baseline, declared at packages/agents/src/shared/toolRequestTools.ts:207
- `tool_search` — granted via baseline, declared at packages/agents/src/shared/toolRequestTools.ts:279
- `invoke_web_coding_loop` — granted via baseline, declared at packages/agents/src/shared/webBuildTools.ts:1937
- `github_merge_pull_request` — granted via baseline (definition not found in scanned files)
- `github_get_pull_request_status` — granted via baseline (definition not found in scanned files)
- `github_wait_for_pull_request_checks` — granted via baseline (definition not found in scanned files)
- `vercel_wait_for_preview_ready` — granted via baseline (definition not found in scanned files)
- `vercel_get_production_url` — granted via baseline (definition not found in scanned files)
- `vercel_get_deployment_logs` — granted via baseline (definition not found in scanned files)
- `get_file_contents` — granted via baseline (definition not found in scanned files)
- `list_open_prs` — granted via baseline (definition not found in scanned files)
- `comment_on_pr` — granted via baseline (definition not found in scanned files)
- `screenshot_page` — granted via baseline, declared at packages/agents/src/shared/screenshotTools.ts:34
- `run_accessibility_audit` — granted via baseline, declared at packages/agents/src/shared/auditTools.ts:137
- `check_ai_smell` — granted via baseline, declared at packages/agents/src/shared/auditTools.ts:229
- `read_inbox` — granted via baseline (definition not found in scanned files)
- `reply_to_email` — granted via baseline (definition not found in scanned files)
- `create_git_branch` — granted via baseline, declared at packages/agents/src/shared/frontendCodeTools.ts:299
- `get_pending_decisions` — granted via baseline (definition not found in scanned files)
- `get_infrastructure_costs` — granted via baseline (definition not found in scanned files)
- `create_github_issue` — granted via baseline (definition not found in scanned files)
- `get_ci_health` — granted via baseline (definition not found in scanned files)
- `get_github_pr_status` — granted via baseline (definition not found in scanned files)
- `send_email` — granted via baseline (definition not found in scanned files)
- `retry_failed_run` — granted via baseline (definition not found in scanned files)
- `query_agent_runs` — granted via baseline (definition not found in scanned files)
- `query_cost_trends` — granted via baseline (definition not found in scanned files)
- `query_events_backlog` — granted via baseline (definition not found in scanned files)
- `get_financials` — granted via baseline (definition not found in scanned files)
- `query_stripe_mrr` — granted via baseline (definition not found in scanned files)
- `query_stripe_subscriptions` — granted via baseline (definition not found in scanned files)
- `write_financial_report` — granted via baseline (definition not found in scanned files)
- `calculate_unit_economics` — granted via baseline (definition not found in scanned files)
- `get_product_metrics` — granted via baseline (definition not found in scanned files)
- `write_product_analysis` — granted via baseline (definition not found in scanned files)
- `query_analytics_events` — granted via baseline (definition not found in scanned files)
- `get_usage_metrics` — granted via baseline, declared at packages/agents/src/shared/productAnalyticsTools.ts:20
- `get_roadmap` — granted via baseline, declared at packages/agents/src/shared/roadmapTools.ts:172
- `segment_users` — granted via baseline, declared at packages/agents/src/shared/productAnalyticsTools.ts:387
- `get_competitor_profile` — granted via baseline, declared at packages/agents/src/shared/competitiveIntelTools.ts:93
- `write_content` — granted via baseline (definition not found in scanned files)
- `write_company_memory` — granted via baseline (definition not found in scanned files)
- `save_research` — granted via baseline, declared at packages/agents/src/shared/researchRepoTools.ts:19
- `search_research` — granted via baseline, declared at packages/agents/src/shared/researchRepoTools.ts:92
- `deep_research` — granted via baseline (definition not found in scanned files)

**Note**: Full call-site analysis would require tracing each tool name through all TypeScript
files in packages/scheduler, packages/worker, services/*, and packages/agent-runtime.



## 4. Schema vs Implementation Drift

Cases where tool parameter declarations don't match what execute() actually uses.
Analysis limited to clear-cut examples to avoid false positives.

**Count**: 5 clear-cut cases identified

### 1. send_agent_message

- **File**: packages/agents/src/shared/communicationTools.ts
- **Parameters declaration**: line 153
- **Execute function**: line 159
- **Issue**: Parameters declare 'thread_id' (line 153-156) but execute() never reads it; only used for deduplication check (line 191-200)

### 2. web_fetch

- **File**: packages/agents/src/shared/researchTools.ts
- **Parameters declaration**: line 88
- **Execute function**: line 93
- **Issue**: Parameter 'max_length' declared (line 88-90) but execute uses hard-coded slice(0, maxLength) with default 8000 (line 150)

### 3. deploy_preview

- **File**: packages/agents/src/shared/deployPreviewTools.ts
- **Parameters declaration**: line 52
- **Execute function**: line 58
- **Issue**: Parameter 'project' has default 'dashboard' in execute (line 72-73) but not declared as optional in parameters schema (line 52, required: false)

### 4. read_my_assignments

- **File**: packages/agents/src/shared/assignmentTools.ts
- **Parameters declaration**: line 92
- **Execute function**: line 99
- **Issue**: Parameter 'status' declared as enum (line 96) but execute() destructures and checks with statusFilter logic (line 100-110) that treats missing status differently than explicit null

### 5. save_memory

- **File**: packages/agents/src/shared/memoryTools.ts
- **Parameters declaration**: line 64
- **Execute function**: line 71
- **Issue**: Parameters declare 'tags' as array (line 64-68) but execute reads as (params.tags as string[]) ?? undefined (line 96), treating undefined distinctly from empty array

**Recommendation**: Comprehensive schema-drift detection requires AST parsing of each tool's
parameters block and execute() body to compare declared vs. used parameters. The above cases
were manually identified from code review.



## 5. Tools That Bypass ToolExecutor

Tool execute() functions that make direct provider calls rather than routing through
centralized clients. ToolExecutor (packages/agent-runtime/src/toolExecutor.ts) wraps
all tool.execute() calls with authorization, rate limiting, and telemetry. However, some
tools make outbound provider calls (HTTP, SDK clients, child processes) from within their
execute() body, bypassing centralized client infrastructure.

**Total cases found**: 100

### Breakdown by Pattern

- **fetch\(**: 98 occurrences
- **@google-cloud/**: 1 occurrences
- **googleapis**: 1 occurrences

### Sample Cases (first 50)

| Tool File | Line | Pattern | Context |
|-----------|------|---------|---------|
| packages/agents/src/shared/agent365Tools.ts | 239 | `fetch\(` | const driveRes = await fetch(... |
| packages/agents/src/shared/agent365Tools.ts | 249 | `fetch\(` | const metaRes = await fetch(... |
| packages/agents/src/shared/agent365Tools.ts | 257 | `fetch\(` | const searchRes = await fetch(... |
| packages/agents/src/shared/agent365Tools.ts | 268 | `fetch\(` | const contentRes = await fetch(... |
| packages/agents/src/shared/agent365Tools.ts | 282 | `fetch\(` | const contentRes = await fetch(... |
| packages/agents/src/shared/agent365Tools.ts | 424 | `fetch\(` | const response = await fetch(... |
| packages/agents/src/shared/assetTools.ts | 107 | `fetch\(` | const res = await fetch(imageUrl, { signal: AbortSignal.time... |
| packages/agents/src/shared/assetTools.ts | 323 | `fetch\(` | const res = await fetch(`${serviceUrl.replace(/\/+$/, '')}/u... |
| packages/agents/src/shared/assetTools.ts | 850 | `fetch\(` | const res = await fetch(`${serviceUrl.replace(/\/+$/, '')}/l... |
| packages/agents/src/shared/assetTools.ts | 919 | `fetch\(` | const res = await fetch(`${screenshotUrl}/optimize`, {... |
| packages/agents/src/shared/assetTools.ts | 964 | `fetch\(` | const res = await fetch(`${screenshotUrl}/favicon-set`, {... |
| packages/agents/src/shared/assignmentTools.ts | 62 | `fetch\(` | fetch(`${schedulerUrl}/run`, {... |
| packages/agents/src/shared/auditTools.ts | 87 | `fetch\(` | const res = await fetch(apiUrl, { signal: AbortSignal.timeou... |
| packages/agents/src/shared/auditTools.ts | 153 | `fetch\(` | const res = await fetch(`${serviceUrl}/audit`, {... |
| packages/agents/src/shared/auditTools.ts | 250 | `fetch\(` | const res = await fetch(`${serviceUrl}/screenshot`, {... |
| packages/agents/src/shared/auditTools.ts | 267 | `fetch\(` | const res = await fetch(url, {... |
| packages/agents/src/shared/auditTools.ts | 360 | `fetch\(` | const res = await fetch(`${serviceUrl}/screenshot`, {... |
| packages/agents/src/shared/auditTools.ts | 85 | `googleapis` | const apiUrl = `https://www.googleapis.com/pagespeedonline/v... |
| packages/agents/src/shared/canvaTools.ts | 39 | `fetch\(` | const res = await fetch(CANVA_TOKEN_URL, {... |
| packages/agents/src/shared/canvaTools.ts | 54 | `fetch\(` | async function canvaFetch(path: string, options: RequestInit... |
| packages/agents/src/shared/canvaTools.ts | 56 | `fetch\(` | return fetch(`${CANVA_API}${path}`, {... |
| packages/agents/src/shared/canvaTools.ts | 91 | `fetch\(` | const res = await canvaFetch('/designs', { method: 'POST', b... |
| packages/agents/src/shared/canvaTools.ts | 112 | `fetch\(` | const res = await canvaFetch(`/designs/${encodeURIComponent(... |
| packages/agents/src/shared/canvaTools.ts | 134 | `fetch\(` | const res = await canvaFetch(`/designs${qs}`);... |
| packages/agents/src/shared/canvaTools.ts | 155 | `fetch\(` | const res = await canvaFetch('/brand-templates');... |
| packages/agents/src/shared/canvaTools.ts | 176 | `fetch\(` | const res = await canvaFetch(`/brand-templates/${encodeURICo... |
| packages/agents/src/shared/canvaTools.ts | 208 | `fetch\(` | const dsRes = await canvaFetch(`/brand-templates/${encodeURI... |
| packages/agents/src/shared/canvaTools.ts | 224 | `fetch\(` | const res = await canvaFetch('/autofills', { method: 'POST',... |
| packages/agents/src/shared/canvaTools.ts | 232 | `fetch\(` | const pollRes = await canvaFetch(`/autofills/${encodeURIComp... |
| packages/agents/src/shared/canvaTools.ts | 263 | `fetch\(` | const res = await canvaFetch('/exports', {... |
| packages/agents/src/shared/canvaTools.ts | 273 | `fetch\(` | const pollRes = await canvaFetch(`/exports/${encodeURICompon... |
| packages/agents/src/shared/canvaTools.ts | 306 | `fetch\(` | const imgRes = await fetch(imageUrl, { signal: AbortSignal.t... |
| packages/agents/src/shared/canvaTools.ts | 316 | `fetch\(` | const uploadRes = await fetch(`${CANVA_API}/asset-uploads`, ... |
| packages/agents/src/shared/canvaTools.ts | 328 | `fetch\(` | const pollRes = await canvaFetch(`/asset-uploads/${encodeURI... |
| packages/agents/src/shared/cashFlowTools.ts | 15 | `fetch\(` | async function mercuryFetch(path: string): Promise<Record<st... |
| packages/agents/src/shared/cashFlowTools.ts | 18 | `fetch\(` | const res = await fetch(`https://api.mercury.com/api/v1${pat... |
| packages/agents/src/shared/cashFlowTools.ts | 35 | `fetch\(` | const data = await mercuryFetch('/accounts');... |
| packages/agents/src/shared/cashFlowTools.ts | 53 | `fetch\(` | const pending = await mercuryFetch('/transactions?status=pen... |
| packages/agents/src/shared/cashFlowTools.ts | 182 | `fetch\(` | const data = await mercuryFetch('/transactions?status=pendin... |
| packages/agents/src/shared/codexTools.ts | 28 | `fetch\(` | const response = await fetch(getCodexMcpUrl(), {... |
| packages/agents/src/shared/communicationTools.ts | 559 | `fetch\(` | const response = await fetch(`${url}/meetings/call`, {... |
| packages/agents/src/shared/deployPreviewTools.ts | 105 | `fetch\(` | const res = await fetch(`${hookUrl}?ref=${encodeURIComponent... |
| packages/agents/src/shared/dmTools.ts | 116 | `fetch\(` | const res = await fetch(... |
| packages/agents/src/shared/documentTools.ts | 380 | `fetch\(` | const res = await fetch(`${serviceUrl}/pdf`, {... |
| packages/agents/src/shared/emailMarketingTools.ts | 36 | `fetch\(` | async function mailchimpFetch(path: string, options: Request... |
| packages/agents/src/shared/emailMarketingTools.ts | 38 | `fetch\(` | const res = await fetch(`https://${server}.api.mailchimp.com... |
| packages/agents/src/shared/emailMarketingTools.ts | 57 | `fetch\(` | async function mandrillFetch(endpoint: string, body: Record<... |
| packages/agents/src/shared/emailMarketingTools.ts | 59 | `fetch\(` | const res = await fetch(`https://mandrillapp.com/api/1.0${en... |
| packages/agents/src/shared/emailMarketingTools.ts | 89 | `fetch\(` | const data = await mailchimpFetch(`/lists?count=${count}`);... |
| packages/agents/src/shared/emailMarketingTools.ts | 135 | `fetch\(` | const data = await mailchimpFetch(`/lists/${listId}/members?... |

### Analysis

Common patterns:
- **fetch()**: Direct HTTP calls to external APIs (Vercel, GitHub, web scraping)
- **.query()**: Direct database queries (systemQuery calls)
- **axios**: HTTP client for provider APIs
- **SDK clients**: Direct instantiation of provider SDKs

**Recommendation**: Consider routing provider calls through centralized clients that
implement connection pooling, retry logic, circuit breaking, and telemetry. Direct calls
in tool execute() bodies work but miss these benefits.



## Appendix: Methodology

### Tool Enumeration
- Scanned all 70 *Tools.ts files in packages/agents/src/shared/
- Extracted 377 tool definitions via regex pattern: `name:\s*['"][a-z_][a-z_0-9]*['"]`
- Identified 371 unique tool names

### Grant Sources
- **criticalRoleToolBaseline.ts**: BASELINE_BY_ROLE map with 93 tools across 4 critical roles
- **live-role-tool-requirements.json**: JSON config with 114 total granted tools (critical + warn_only roles)
- **Database migrations**: 32 migration files containing INSERT INTO agent_tool_grants statements
- **Total granted**: 114 unique tools (union of all sources)

### Production Invocation Detection
Searched for tool name string literals in:
- packages/scheduler/src/*.ts
- packages/worker/src/*.ts
- packages/agent-runtime/src/baseAgentRunner.ts, companyAgentRunner.ts, toolExecutor.ts
- services/*/src/*.ts

### Eval Coverage Detection
Searched for tool names in:
- packages/**/*.test.ts (96 test files found)
- db/migrations/*eval*.sql, *tool_test*.sql
- scripts/eval*.ts

### Schema Drift Detection
Manual code review of tool parameters blocks vs. execute() function bodies.
Automated detection would require AST parsing.

### Provider Bypass Detection
Regex patterns: `fetch\(`, `axios\.`, `new OpenAI\(`, `new Anthropic\(`,
`@google-cloud/`, `googleapis`, `@slack/web-api`, `child_process`, `\.query\(`

---

**Report generated on**: 2026-04-27 17:02:49
