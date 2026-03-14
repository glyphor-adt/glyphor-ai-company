---
name: compliance-monitoring
slug: compliance-monitoring
category: legal
description: Track regulatory developments, maintain compliance checklists, audit Glyphor's operations against regulatory requirements, and ensure the company stays ahead of legal obligations — not just reacting to them. Use when monitoring AI regulation changes (EU AI Act, FTC, state-level legislation), auditing data privacy compliance (GDPR, CCPA), tracking SOC 2 readiness, assessing the compliance impact of product or architecture changes, managing data subject requests, or producing compliance status reports for founders and investors. This skill is the early warning system for regulatory risk.
holders: clo
tools_granted: get_compliance_status, create_compliance_alert, update_compliance_item, track_regulations, track_regulatory_changes, audit_data_flows, get_privacy_requests, check_data_retention, get_contracts, web_search, web_fetch, read_file, create_or_update_file, get_file_contents, save_memory, send_agent_message, file_decision, propose_directive
version: 2
---

# Compliance Monitoring

Compliance is not a checkbox exercise. It is an ongoing discipline of understanding what laws and standards apply to Glyphor, assessing whether the company meets them, and ensuring that as the product and regulations evolve, the company doesn't accidentally fall out of compliance.

For an AI company operating autonomous agents, the regulatory landscape is uniquely complex and fast-moving. The EU AI Act is being implemented in phases through 2027. The FTC is actively pursuing enforcement against AI companies. State-level AI legislation is proliferating in the US. GDPR and CCPA continue to be enforced and interpreted by courts in ways that affect AI-generated content and automated decision-making. SOC 2 compliance is increasingly expected by enterprise customers.

You cannot wait for regulations to be finalized and then scramble to comply. You must track them as they develop, assess their impact on Glyphor's operations while they're still in draft, and prepare the company to comply before the deadline, not after.

## The Regulatory Universe

### What applies to Glyphor

**EU AI Act:**
- Glyphor's agents likely fall under "general purpose AI" or "AI system" definitions depending on deployment
- Risk classification matters: most Glyphor agent activities are likely "limited risk" (transparency obligations) or "minimal risk" (no specific obligations), but customer-facing products using AI decision-making could be "high risk"
- Transparency obligations: users must be informed they're interacting with AI
- Record-keeping requirements: maintain logs of AI system operations (Glyphor already does this via `agent_runs`, `agent_memory`, and `activity_log` tables)
- Implementation timeline: obligations phase in through 2027. Track each phase.

**GDPR (if serving EU customers):**
- Lawful basis for processing personal data (consent, legitimate interest, contract performance)
- Data subject rights: access, rectification, erasure, portability, objection to automated decision-making
- Data Processing Agreements with sub-processors (GCP, OpenAI, Anthropic, Google)
- Data breach notification: 72-hour requirement to supervisory authority
- Data protection impact assessments (DPIA) for high-risk processing (AI-based profiling or automated decision-making qualifies)
- Cross-border transfer mechanisms (Standard Contractual Clauses for US-EU transfers)

**CCPA / CPRA (California):**
- Right to know what personal information is collected
- Right to delete personal information
- Right to opt out of sale/sharing
- Disclosure requirements for AI-generated content (California law AB 2013)
- Applies if Glyphor has California customers meeting revenue/data thresholds

**FTC (US federal):**
- Truth in advertising — AI capability claims must be substantiated
- Section 5 unfair/deceptive practices — misrepresenting AI capabilities, failing to disclose AI usage, or making unsubstantiated claims about AI performance
- FTC has been actively pursuing AI enforcement actions since 2023
- Health/safety claims about AI require scientific substantiation

**SOC 2:**
- Not a law but a market expectation for enterprise SaaS
- Trust Service Criteria: Security, Availability, Processing Integrity, Confidentiality, Privacy
- Enterprise customers increasingly require SOC 2 Type II before signing
- Requires documented controls, monitoring, and annual audit
- GCP provides SOC 2 compliance for infrastructure; Glyphor must demonstrate application-layer controls

**State-level AI legislation:**
- Colorado AI Act (effective 2026): obligations for "high-risk" AI systems affecting consumer decisions
- Texas (home state): monitor for emerging AI legislation
- New York City: automated employment decision tools (Local Law 144) — relevant if Glyphor's agents make hiring-related decisions for customers
- Other states: Illinois BIPA (biometric data), Virginia VCDPA (consumer data), Connecticut (AI transparency)

### How to track regulatory changes

Use `track_regulations` and `track_regulatory_changes` for structured monitoring. Supplement with:

- `web_search` for regulatory news: search "EU AI Act implementation 2026" / "FTC AI enforcement" / "state AI legislation" weekly
- `web_fetch` on regulatory body websites for official announcements
- Save significant developments as memories with tags: regulation name, effective date, impact assessment, action required

When a significant regulatory development occurs:
1. Assess impact on Glyphor's operations
2. Determine compliance timeline (when must we comply by?)
3. Identify gaps between current operations and requirements
4. File a decision if the gap requires product, architecture, or policy changes
5. Brief founders via `file_decision` (Yellow minimum for any regulatory obligation)

## The Compliance Checklist System

Compliance status is tracked in the `compliance_checklists` table in Cloud SQL with framework-specific items:

| Framework | Column value | What it tracks |
|-----------|-------------|---------------|
| GDPR | `GDPR` | Data processing, consent, subject rights, DPAs, transfers |
| CCPA | `CCPA` | Consumer rights, disclosure, opt-out, data inventory |
| SOC 2 | `SOC2` | Security controls, availability, processing integrity |
| EU AI Act | `EU_AI_Act` | Risk classification, transparency, record-keeping |

Each item has: `status` (compliant/non-compliant/in-progress/not-applicable), `evidence` (documentation link or description), `last_audit_date`.

### Running a compliance audit

Quarterly at minimum, audit each framework:

1. `get_compliance_status` — pull all checklist items for the target framework
2. For each item, verify the evidence is current:
   - Is the documented control still in place? (Ask Marcus for technical controls, Morgan for access controls)
   - Has anything changed that invalidates previous compliance? (New feature launched, new data source added, new sub-processor)
   - Is the evidence dated within the audit period?
3. Update items via `update_compliance_item` with current status and evidence
4. For non-compliant items, create remediation plans with owners and deadlines
5. `create_compliance_alert` for items approaching regulatory deadlines without compliance
6. Produce the audit report

### Data privacy specifics

**Data flow auditing:**
`audit_data_flows` — map how personal data moves through the system:
- What data enters Glyphor (customer data, user analytics, financial data)
- Where it's stored (Cloud SQL tables — 86 tables, identify which contain personal data)
- Who/what accesses it (which agents, which tools, which external services)
- Where it's transmitted (GCP, OpenAI for API calls, Anthropic, Microsoft for Teams)
- How long it's retained
- How it's deleted when requested

This mapping is required for GDPR (Record of Processing Activities) and useful for SOC 2 and CCPA compliance.

**Data subject requests:**
`get_privacy_requests` — track requests from individuals exercising their rights:
- Access requests (provide a copy of their data)
- Deletion requests (erase their data — `check_data_retention` to verify deletion is complete)
- Rectification requests (correct inaccurate data)
- Portability requests (provide data in machine-readable format)

Response timelines: GDPR requires response within 30 days. CCPA requires response within 45 days. Track compliance with these timelines and escalate if approaching deadline without resolution.

**Sub-processor management:**
Glyphor uses sub-processors for data processing:
- **GCP** — cloud infrastructure (compute, storage, database)
- **OpenAI** — AI API calls (agent reasoning, tool execution)
- **Anthropic** — AI API calls (Claude models for legal, evaluation, complex reasoning)
- **Google** — Gemini API calls
- **Microsoft** — Teams communication, M365 services via Agent365
- **Stripe** — payment processing
- **Mercury** — banking
- **Mailchimp/Mandrill** — email marketing

Each sub-processor needs a DPA. Track DPA status in `contracts` table. When a sub-processor changes their terms (they all do periodically), review the updated terms against our privacy commitments.

## SOC 2 Readiness

SOC 2 Type II is the most commercially impactful compliance certification. Enterprise customers ask for it. Investors expect it. Getting it requires demonstrating that controls are not just designed but operating effectively over a period (usually 6-12 months).

**Key controls Glyphor likely needs to document:**

*Security:*
- Access control (Morgan Blake manages via `access-management` skill)
- Secret management (GCP Secret Manager, rotation via DevOps)
- Network security (Cloud Run configuration, CORS policies)
- Encryption in transit and at rest (TLS for API, Cloud SQL encryption)
- Vulnerability management (dependency updates, security scanning)

*Availability:*
- Uptime monitoring (Atlas/Ops via `platform-monitoring` skill)
- Incident response procedures (`incident-response` skill)
- Backup and recovery (Cloud SQL backups, data restore procedures)
- Capacity planning (Cloud Run auto-scaling configuration)

*Processing integrity:*
- Data validation (constitutional pre-checks in `toolExecutor.ts`)
- Error handling (tool execution error propagation)
- Quality assurance (Sam DeLuca via `quality-assurance` skill)
- Change management (GitHub Actions CI/CD, PR review process)

*Confidentiality:*
- Data classification (what data is confidential)
- Access restrictions (role-based tool access, agent authority tiers)
- Secure disposal (data deletion procedures)

*Privacy:*
- Privacy notice and consent mechanisms
- Data inventory and flow mapping
- Retention and deletion policies
- Subject rights procedures

**The path to SOC 2:**
1. Gap assessment — where are we vs. the criteria? (Current audit)
2. Remediation — build missing controls (3-6 months)
3. Observation period — controls must be operating (6-12 months)
4. Audit — external auditor reviews evidence (1-2 months)
5. Report — SOC 2 Type II report issued

This is a multi-quarter initiative. File a Yellow decision with the timeline and resource requirements when ready to begin. Kristina and Andrew need to decide when to invest in this.

## Compliance Reporting

**Monthly compliance report for founders:**
- Overall compliance posture by framework (compliant/in-progress/gaps)
- Regulatory developments of note (new laws, enforcement actions, guidance)
- Outstanding remediation items and their deadlines
- Data subject request volume and response compliance
- Upcoming regulatory deadlines
- Recommendations for proactive compliance investment

Save all reports as memories. The compliance posture over time is critical for fundraising diligence and customer negotiations.

## The Judgment Layer

Compliance is about judgment, not just rules. When a new product feature is proposed, you must assess:

- Does this feature process personal data in a new way? → Privacy impact assessment
- Does this feature involve automated decision-making? → EU AI Act and GDPR Article 22 analysis
- Does this feature make claims about AI capability? → FTC substantiation requirements
- Does this feature affect data flows to sub-processors? → DPA review

When Marcus (CTO) proposes an architecture change, when Maya (CMO) plans a marketing campaign with AI capability claims, when Elena (CPO) designs a new product feature — you need to know about it early enough to identify compliance implications before the work is done, not after.

Proactive compliance is cheaper than reactive compliance. Reactive compliance is cheaper than enforcement. Enforcement is cheaper than litigation. Stay at the proactive layer.
