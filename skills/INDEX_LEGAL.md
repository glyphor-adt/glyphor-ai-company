# Legal Team Skills — Implementation Index

## Agent → Skill Mapping

| Agent | Role | Reports To | Runner Type | Skills |
|-------|------|------------|-------------|--------|
| Victoria Chase | CLO | Both founders (directly) | OrchestratorRunner | `legal-review` (NEW), `compliance-monitoring` (NEW), `ip-management` (NEW) |

> **Note:** Victoria is an **OrchestratorRunner** (OBSERVE→PLAN→DELEGATE→MONITOR→EVALUATE), same tier as CTO, CoS, VP Research, and Ops. She reports directly to both founders, NOT through Sarah Chen. This reporting structure is intentional — legal decisions carry company-level risk that must not be filtered.

> **Note:** Bob Finley (CPA) reports to Victoria for compliance purposes but his primary skills (`budget-monitoring`, `tax-strategy`) are in the Finance skill set. Victoria oversees his tax positions for legal risk.

## Architecture References

**MCP Legal Server:**
- `mcp-legal-server` (Cloud Run) — 19 tools (12 reads + 7 writes)
- Covers: compliance checklists, contracts, IP portfolio, tax, data privacy/retention
- `legalTools.ts` is **deprecated** — all tools migrated to MCP server

**DocuSign integration:**
- `packages/scheduler/src/integrations/docusign/client.ts`
- Tools: `create_signing_envelope`, `send_template_envelope`, `check_envelope_status`, `list_envelopes`, `resend_envelope`, `void_envelope`
- Handles envelope creation, signer management, and signing tab placement

**Cloud SQL tables:**
| Table | Purpose | Key columns |
|-------|---------|-------------|
| `compliance_checklists` | Regulatory compliance tracking | framework (GDPR/CCPA/SOC2/EU_AI_Act), item, status, evidence, last_audit_date |
| `contracts` | Contract management | type, counterparty, status, key_terms (JSONB), value, start_date, end_date, renewal_date |
| `ip_portfolio` | IP asset tracking | type (patent/trademark/trade_secret/copyright), title, status, filing_date, inventor |

**Model routing:**
Legal reasoning routes to **Claude Sonnet 4.6** (Anthropic's strongest model for legal/evaluation work). This means Victoria's runs are more expensive but produce higher-quality analysis.

**Constitutional governance:**
Victoria's work intersects with the constitutional governance system in `companyAgentRunner.ts` — the three-tier authority model (Green/Yellow/Red) and constitutional pre-checks are both legal architecture that she oversees.

## Size Comparison

| Skill | Old | New |
|-------|-----|-----|
| legal-review | (didn't exist) | ~165 lines, 19 tools |
| compliance-monitoring | (didn't exist) | ~170 lines, 18 tools |
| ip-management | (didn't exist) | ~160 lines, 12 tools |

Victoria previously had **zero skills**. She was one of the highest-priority gaps in the original audit — a CLO operating without methodology.

## Key Design Decisions

**1. All three skills are CLO-only.** Unlike Engineering (4 holders for incident-response) or Marketing (CMO + specialist for each skill), Legal has a single practitioner — Victoria. No delegation, no shared holders. Every legal judgment flows through one agent. This is appropriate for the risk profile — legal decisions should not be distributed across agents without legal training.

**2. Legal-review includes contract execution.** The skill covers the full lifecycle: analysis → risk rating → recommended changes → DocuSign envelope creation → signing → tracking. Victoria doesn't just review contracts — she manages them from draft to execution to renewal.

**3. Compliance-monitoring maps the full regulatory universe.** The skill explicitly defines which regulations apply (EU AI Act, GDPR, CCPA, FTC, SOC 2, state laws) with specific Glyphor implications for each. It doesn't say "comply with regulations" — it says "the EU AI Act requires transparency for AI systems; Glyphor's agent interaction via Teams must include AI disclosure; implementation deadline is [phase]."

**4. SOC 2 is framed as a multi-quarter initiative.** The compliance-monitoring skill lays out the SOC 2 readiness path (gap assessment → remediation → observation → audit → report) and explicitly notes it requires a Yellow decision because of the resource investment. It maps Glyphor's existing systems to SOC 2 criteria so the gap assessment has a head start.

**5. IP management identifies specific patentable innovations.** The skill doesn't say "look for patentable things." It lists concrete candidates: the OrchestratorRunner hierarchy, the policy tuning pipeline (6 sources → replay → canary → promote/rollback), trust scoring with behavioral fingerprinting, capability-based model routing. This specificity gives Victoria actionable items, not a vague mandate.

**6. AI-generated content copyright is treated as evolving law.** The skill acknowledges the US Copyright Office position and recommends a nuanced stance: claim copyright when human creative direction exists, acknowledge uncertainty for purely autonomous output, and track developments via `track_regulations`. No false certainty.

**7. Trade secret protection is connected to access management.** The skill identifies what constitutes Glyphor's trade secrets (system prompts, routing logic, skill methodologies, financial models) and connects protection to Morgan Blake's `access-management` skill — role-based tool access IS trade secret protection. The skills reinforce each other.

## File Inventory

```
skills/legal/
├── legal-review.md           # NEW — Victoria Chase (CLO)
├── compliance-monitoring.md  # NEW — Victoria Chase (CLO)
├── ip-management.md          # NEW — Victoria Chase (CLO)
└── INDEX.md                  # This file
```

## Cross-Team Notes

- **Bob Finley** reports to Victoria but his skills are in `skills/finance/`. Victoria reviews his tax positions for legal risk (R&D credit claims, Section 174 positions).
- **Marcus Reeves (CTO)** is critical for: technical compliance questions, architecture details for DPAs, R&D credit documentation, and identifying patentable innovations.
- **Morgan Blake (Global Admin)** is the enforcement arm of Victoria's compliance requirements — access controls that Victoria mandates are implemented by Morgan.
- **Sarah Chen (CoS)** coordinates cross-team compliance briefings when a regulatory change affects multiple departments, but Victoria's decisions go directly to founders, not through Sarah.
- **Nadia Okafor (CFO)** coordinates on contract financial exposure and the cost implications of compliance investments (SOC 2 audit fees, patent prosecution costs, legal counsel retainers).
