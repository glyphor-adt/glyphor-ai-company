---
name: ip-management
slug: ip-management
category: legal
description: Manage Glyphor's intellectual property portfolio — patents, trademarks, trade secrets, and copyrights. Use when identifying patentable innovations in the agent platform, filing or tracking trademark applications, assessing trade secret protection for proprietary systems, monitoring for IP infringement by competitors, evaluating IP risks in partnerships or customer agreements, or producing IP portfolio status reports. For an AI company, intellectual property is the moat — this skill protects it.
holders: clo
tools_granted: get_ip_portfolio, create_ip_filing, monitor_ip_infringement, web_search, web_fetch, read_file, create_or_update_file, get_file_contents, save_memory, send_agent_message, file_decision, propose_directive
version: 2
---

# IP Management

Glyphor's value lives in its intellectual property. The agent runtime architecture, the self-improvement pipeline, the model routing system, the skill framework, the multi-wave research workflow, the constitutional governance model — these are the systems that make Glyphor different from every other AI company that wraps an API call in a prompt. If a competitor replicates these systems, Glyphor's advantage disappears. IP protection is not a legal formality — it is business survival.

The IP portfolio is tracked in the `ip_portfolio` table in Cloud SQL, with fields for type (patent/trademark/trade_secret/copyright), title, status, filing_date, and inventor. Use `get_ip_portfolio` for the current state.

## The Four Pillars of IP

### Patents

Patents protect novel, non-obvious inventions. In software and AI, patents are contentious — but for defensible innovations with clear technical novelty, they remain the strongest form of protection.

**What might be patentable at Glyphor:**

*Agent orchestration architecture:*
- The OrchestratorRunner → TaskRunner hierarchy with OBSERVE→PLAN→DELEGATE→MONITOR→EVALUATE cycles
- The multi-wave research workflow (decomposition → parallel execution → QC synthesis)
- Sarah Chen's routing logic — how a Chief of Staff agent decomposes directives into cross-departmental assignments

*Self-improvement systems:*
- The closed-loop policy tuning pipeline (proposal collection from 6 sources → replay evaluation → canary deployment → auto-promote/rollback)
- The trust scoring system with behavioral fingerprinting and anomaly-triggered demotion
- Skill learning from successful tool sequences — extracting reusable capabilities from agent runs

*Constitutional governance:*
- The three-tier authority model (Green/Yellow/Red) with automated escalation
- Constitutional pre-checks on tool execution with deterministic + LLM verification
- The verification policy tier system (none → self-critique → cross-model → conditional escalation)

*Model routing:*
- Capability-based routing across providers (OpenAI, Anthropic, Google) matching task complexity to model tier
- The compaction system for long-running agent sessions

**The patent assessment process:**
1. Identify the invention — what specifically is novel? Not "we built an AI agent" but "we built a system where agent prompts are automatically tuned by a pipeline that collects proposals from 6 signal sources, evaluates them via replay, deploys winners to canary, and auto-promotes or rollbacks based on quality delta"
2. Prior art search — `web_search` for academic papers, existing patents, open-source implementations that describe similar systems. If someone published this approach before us, it's not patentable.
3. Novelty assessment — is this genuinely new, or is it a combination of known techniques applied to a new domain? The latter CAN be patentable but faces a higher bar.
4. Non-obviousness assessment — would a person skilled in the art (an experienced AI/ML engineer) find this solution obvious given the existing state of knowledge?
5. If assessment is positive, file via `create_ip_filing` and recommend engaging patent counsel. File a Yellow decision — patent filings are expensive ($10-20K+ per patent) and require founder approval on the investment.

**Provisional vs. non-provisional:**
For early-stage protection, provisional patent applications are cheaper (~$1-3K), establish a priority date, and give 12 months to decide whether to pursue a full non-provisional filing. This is often the right first step for a startup with limited legal budget.

### Trademarks

Trademarks protect brand identity — names, logos, and distinctive elements that identify Glyphor in the marketplace.

**What should be trademarked:**
- **Glyphor** — the company name (if not already filed)
- **Prism** — the design system name (if used externally)
- **Pulse** — the creative production product
- **Fuse** — the development product
- **The Glyphor logo mark** — the visual identifier

**Trademark process:**
1. Search for conflicts — `web_search` for existing trademarks in software/AI classes. Check USPTO TESS database.
2. Assess strength — "Glyphor" is a coined term (strong, highly protectable). "Pulse" and "Fuse" are common words (weaker, but protectable in the AI software context). Generic terms cannot be trademarked.
3. File via `create_ip_filing` — record the application with status, filing date, and class.
4. Monitor status — trademark prosecution takes 8-18 months. Track deadlines for responses to office actions.
5. Renewal — trademarks require periodic renewal and continued use. Set calendar reminders.

**Common law rights vs. registration:**
Even without registration, using a trademark in commerce creates common law rights in the geographic area of use. But registration provides national protection, legal presumption of ownership, and the ability to use ® symbol. Registration is worth the investment for core brand elements.

### Trade Secrets

Trade secrets protect confidential business information through secrecy rather than registration. Unlike patents, trade secrets last indefinitely as long as secrecy is maintained. Unlike patents, they provide no protection against independent discovery or reverse engineering.

**What qualifies as a Glyphor trade secret:**
- Agent system prompts and persona definitions (the specific wording and structure)
- The complete prompt assembly pipeline in `companyAgentRunner.ts` (how context is built per-agent)
- The model routing decision logic and thresholds in capability routing
- Customer-specific configurations and usage patterns
- Financial models and unit economics detail
- The complete tool registry mapping (which tools each agent has access to)
- The skill methodology content (the playbooks that make agents effective)
- Internal competitive intelligence and strategic analyses

**Protecting trade secrets requires:**
1. **Identification** — you must know what your trade secrets are to protect them
2. **Reasonable measures** — the company must take active steps to maintain secrecy:
   - Access controls (Morgan Blake's `access-management` skill — role-based tool access)
   - Confidentiality agreements (NDAs with anyone who accesses proprietary systems)
   - Technical safeguards (GCP Secret Manager for credentials, audit logging for access)
   - Employee/contractor agreements with IP assignment and non-disclosure clauses
3. **Documentation** — maintain a trade secret register via `get_ip_portfolio` with type='trade_secret'

**The tension with open-source:**
If Glyphor ever open-sources part of the platform, anything that becomes public ceases to be a trade secret. Before any open-source decision, assess what trade secret protection would be lost. File a Red decision for any proposed open-sourcing of core systems.

### Copyrights

Copyright protects original works of authorship — code, documentation, design assets, marketing content, and creative output.

**What Glyphor owns by copyright:**
- All source code in the monorepo (automatic protection upon creation)
- Documentation, blog posts, marketing copy
- Design assets (logos, illustrations, brand guide)
- Agent persona definitions and briefings

**AI-generated content and copyright:**
This is evolving law. The US Copyright Office has stated that AI-generated content without human authorship is not copyrightable. However, content where a human exercises creative control over AI output (selecting, arranging, and editing) may qualify. Glyphor's position should be:
- Content created by agents with significant founder/team creative direction = claim copyright
- Purely autonomous agent output without human creative involvement = copyright protection is uncertain
- Track developments in this area via `track_regulations` and `web_search` for copyright office guidance

## Infringement Monitoring

Use `monitor_ip_infringement` to watch for:

- **Patent infringement** — competitors implementing systems that match our patent claims (if we have patents)
- **Trademark infringement** — use of "Glyphor," "Pulse," "Fuse," or confusingly similar marks by others
- **Trade secret misappropriation** — former contractors, employees of partners, or competitors who may have accessed our proprietary systems appearing to implement suspiciously similar approaches
- **Copyright infringement** — our code, content, or design assets used without authorization

When potential infringement is detected:
1. Document the evidence (screenshots, URLs, timestamps) — save as memory
2. Assess severity (minor/moderate/material)
3. For material infringement, file a Yellow decision with evidence and recommended response
4. Response options range from cease-and-desist letter (low cost, often effective) to litigation (high cost, last resort)

## IP in Agreements

Every contract review (see `legal-review` skill) should include IP assessment:

- **Vendor contracts:** Do they claim any rights to our data or the output of their tools when used by our agents? Some AI service providers have terms that allow training on customer inputs — review carefully.
- **Customer contracts:** Are IP ownership and license terms clear? Does the customer have a license to use the platform, or are they acquiring ownership of any component?
- **Partnership agreements:** Are IP contributions from each party clearly delineated? What happens to jointly developed IP?
- **Contributor/contractor agreements:** Include IP assignment clauses so any work created for Glyphor is owned by Glyphor.

## Portfolio Management

**Quarterly IP review:**
1. `get_ip_portfolio` — pull the complete portfolio
2. Review status of all pending filings (patent applications, trademark prosecutions)
3. Check maintenance deadlines (patent maintenance fees, trademark renewals)
4. Identify new IP from recent development work (coordinate with Marcus/CTO)
5. Assess whether the portfolio adequately protects Glyphor's competitive advantages
6. Update the portfolio register
7. Produce a portfolio status report for founders

**Cost management:**
IP protection has real costs. Patent prosecution can run $10-20K per patent. Trademark registration $1-3K per mark per class. International protection multiplies these costs by each jurisdiction. Recommend a prioritized IP budget based on what provides the most strategic protection per dollar.

Save all IP decisions, assessments, and portfolio states as memories. The IP portfolio is a long-term asset — its value compounds over years, and the history of development decisions matters for future filings and litigation defense.
