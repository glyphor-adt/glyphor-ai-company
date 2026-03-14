# Knowledge System Overhaul V2 SQL Summary

## Source
- File: db/migrations/20260313113000_knowledge_system_overhaul_v2.sql
- Purpose: Refresh doctrine content, reset active founder directives, and remove retired-agent leftovers from key runtime tables.

## What The Migration Does

### 1) Replaces Core Company Knowledge Sections
The migration deletes existing rows in company_knowledge_base for a fixed list of sections, then reinserts updated content.

Sections replaced:
- mission
- operating_doctrine
- current_priorities
- products
- founders
- team_structure
- authority_model
- metrics
- infrastructure
- pricing
- competitive_landscape
- culture
- standing_orders

Net effect:
- Company doctrine is overwritten for the above sections.
- Audience is set to all for inserted rows.
- last_edited_by is set to system.

### 2) Resets And Recreates Five Founder Directives
The migration deletes existing founder-sourced directives (for the default tenant) matching five titles, then inserts fresh active directives.

Directives inserted:
- Dashboard & Platform Health Stabilization
- Establish Brand Voice & Identity System
- Competitive Landscape Research
- Slack AI Marketing Department Landing Page
- Still You Marketing Campaign Launch

Directive characteristics:
- created_by = kristina
- status = active
- due dates set relative to execution time (NOW + 5, 7, 10, 10, 14 days)
- target_agents arrays are explicitly set per directive

### 3) Cleans Retired Agent Records
The migration removes stale records tied to retired role slugs from:
- agent_briefs
- company_agents

Retired role slugs removed:
- revenue-analyst
- cost-analyst
- support-triage
- onboarding-specialist
- lead-gen-specialist
- enterprise-account-researcher
- account-research
- data-integrity-auditor
- technical-research-analyst
- industry-research-analyst
- tax-strategy-specialist
- vp-customer-success
- ai-impact-analyst
- org-analyst

## Data/Behavior Notes
- This is a data migration, not a schema migration.
- It is destructive for the replaced doctrine sections (delete then insert).
- It does not touch tables outside company_knowledge_base, founder_directives, agent_briefs, and company_agents.
- Because due dates use NOW(), inserted directive deadlines depend on when the migration is run.

## Practical Verification Checklist
After applying, verify:
- company_knowledge_base contains updated rows for the 13 sections listed above.
- founder_directives has active rows for the five directive titles.
- agent_briefs has no rows for the 14 retired slugs.
- company_agents has no rows for the 14 retired slugs.

## Important Content Delta To Be Aware Of
This migration reflects a 30 active AI agent framing in content (for example team_structure and metrics), not the 28-agent framing from the separate founder directive document draft.
