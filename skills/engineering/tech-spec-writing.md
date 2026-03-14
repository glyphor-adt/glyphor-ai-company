---
name: tech-spec-writing
slug: tech-spec-writing
category: engineering
description: Produce detailed technical specifications that a competent engineer could implement without asking questions. Use when proposing new features, architectural changes, system migrations, or any work that touches multiple components and needs alignment before code is written. A good spec prevents a week of wasted implementation by spending a day thinking clearly.
holders: cto, quality-engineer
tools_granted: read_file, get_file_contents, create_or_update_file, web_search, get_service_dependencies, get_infrastructure_inventory, query_db_health, check_table_schema, list_tables, save_memory, send_agent_message
version: 2
---

# Technical Spec Writing

You write technical specifications that sit between "the product wants X" and "the engineer writes code for X." A spec is not a requirements document (that's the CPO's job) and it's not a design doc (that's broader). A spec is a precise blueprint: what changes, where, how, and what can go wrong.

The reason specs exist is economic. An hour of thinking in a spec saves 10 hours of building the wrong thing, and 100 hours of unwinding the wrong thing from production. On a 27-agent platform where a bad architectural decision cascades across the entire system, the leverage of a good spec is enormous.

## The Standard of a Good Spec

A spec is good when an engineer who didn't write it can implement the feature correctly from the spec alone. If they have to ask "but what about...?" more than once, the spec has gaps.

A spec is great when it also explains what was *not* chosen and why, so future engineers don't re-propose the same rejected alternatives.

## Spec Structure

Every spec follows this structure. Sections can be short for simple changes, but every section must be present.

### 1. Context and Problem Statement

What exists today, why it's insufficient, and what we need. Write this for someone who is technically competent but not familiar with the specific subsystem. Include:
- Current behavior with enough detail to understand the problem
- What triggered this work (user feedback, incident, strategic decision, technical debt)
- What "done" looks like in one sentence

### 2. Proposed Solution

The detailed technical design. This is the meat of the spec.

**System architecture changes:** Which components are modified? Which are new? Include a component diagram if the change touches 3+ systems. Use text-based diagrams (mermaid or ascii) — they live in version control better than images.

**API changes:** Every new or modified endpoint, fully specified:
- HTTP method and path
- Request body schema
- Response body schema
- Error responses and status codes
- Authentication and authorization requirements

**Database changes:** Every new or modified table/column:
- Schema definition with types, constraints, defaults
- Migration strategy (additive-only vs breaking)
- Index requirements based on expected query patterns
- Data backfill plan if modifying existing columns

**Agent behavior changes:** If this affects agent prompts, routing, tool availability, or execution flow:
- Which agents are affected
- What changes in their system prompt, tool set, or skill set
- How this interacts with the existing self-improvement loop (will existing memories/reflections still be valid?)
- What happens to in-flight runs during deployment

**Configuration changes:** Environment variables, feature flags, Cloud Run service settings, Cloud SQL configuration, Cloud Tasks queue settings — anything that needs to change outside of code.

### 3. Implementation Plan

How to build this in an order that minimizes risk:
- Step-by-step implementation sequence
- Which steps can be done independently (parallelizable) vs. which depend on previous steps
- Where to introduce feature flags for incremental rollout
- Estimated effort per step (T-shirt sizing: S/M/L/XL)

### 4. Risks and Mitigations

Every non-trivial change has risks. A spec that says "no risks" is a spec that hasn't been thought through.

For each risk:
- What could go wrong
- Probability (low/medium/high)
- Impact (low/medium/high)
- Mitigation strategy
- Rollback plan if the mitigation fails

Common risk categories for this platform:
- **Data migration risk** — will the migration work on production data volumes? Have you tested with realistic data?
- **Agent behavior risk** — will existing agents break or behave differently after this change?
- **Cost risk** — will this increase LLM API costs, infrastructure costs, or agent run duration?
- **Backward compatibility** — can this be deployed without coordinating with other changes?

### 5. Alternatives Considered

At least two alternatives, with a clear explanation of why they were rejected. This prevents the "why didn't you just..." conversation later and documents the decision-making for future reference.

### 6. Open Questions

Anything that needs input from other team members before implementation can proceed. Be specific about who needs to answer each question and what the implementation impact is.

## Writing Quality

### Be precise, not verbose

"The system will send a message" is imprecise. "The `dispatch_assignment` tool creates a row in `work_assignments` with status='pending' and sends an `agent_message` to the target agent's channel" is precise. Precision prevents misinterpretation. Verbosity prevents reading.

### Use concrete examples

Don't just describe the schema. Show a realistic example of the data that will flow through it:

```json
{
  "directive_id": "dir_abc123",
  "category": "engineering",
  "priority": "high",
  "assigned_to": "cto",
  "assignments": [
    { "agent": "platform-engineer", "task": "Audit Cloud Run cold start config" },
    { "agent": "devops-engineer", "task": "Implement minimum instance warm-up" }
  ]
}
```

This is worth a thousand words of schema description.

### Call out what doesn't change

In a complex system, knowing what isn't affected is as important as knowing what is. "This change does not modify the tool execution path, the prompt assembly logic, or the trust scoring system" gives the reader confidence about blast radius.

## After the Spec

A spec is a living document until implementation begins. After the spec is reviewed and approved:
- Save a memory linking the spec to the feature/initiative
- File a decision if the spec involves yellow/red-tier choices
- The spec becomes the reference during code review — the reviewer checks the code against the spec

During implementation, if the engineer discovers something the spec didn't account for, **update the spec.** Don't let the spec and the implementation diverge — the spec is the documentation of record.
