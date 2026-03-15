# Marketing Team Skills — Implementation Index

## Agent → Skill Mapping

| Agent | Role | Reports To | Skills |
|-------|------|------------|--------|
| Maya Brooks | CMO | Sarah Chen | `content-creation` (v2), `seo-optimization` (v2), `social-media-management` (v2), `brand-management` (shared w/ Design), `advanced-web-creation` (shared) |
| Tyler Reed | Content Creator | Maya Brooks | `content-creation` (v2) |
| Lisa Chen | SEO Analyst | Maya Brooks | `seo-optimization` (v2) |
| Kai Johnson | Social Media Manager | Maya Brooks | `social-media-management` (v2) |
| Zara Petrov | Marketing Intelligence Analyst | Maya Brooks | `competitive-intelligence` (NEW), `content-analytics` (NEW) |

## Architecture References

These skills reference the correct infrastructure:

**Tool files:**
- `contentTools.ts` — 7 tools: draft lifecycle, publish, content calendar, DALL-E image gen
- `seoTools.ts` — 8 tools: Google Search Console, keyword tracking, page audits, indexing, backlinks
- `socialMediaTools.ts` — 7 tools: schedule posts, metrics, audience analytics, trending topics
- `marketingIntelTools.ts` — 9 tools: A/B experiments, competitor monitoring, lead pipeline, marketing dashboard

**MCP Servers:**
- `mcp-marketing-server` (Cloud Run) — 7 tools: social media, Search Console, web analytics
- `mcp-email-marketing-server` (Cloud Run) — 15 tools: Mailchimp (10) + Mandrill transactional email (5)
- Note: `emailMarketingTools.ts` is deprecated — all 15 tools migrated to the MCP server

**Integrations:**
- Canva (OAuth, design creation, brand autofill, export)
- PostHog (product analytics — events, funnels, sessions)
- Pulse (49 `pulse_*` tools for AI creative production)
- Google Search Console (via seoTools + MCP marketing server)

**Content workflow:**
```
draft → submit_content_for_review → CMO approve/reject → schedule_social_post
```
All social publishing is approval-gated with audit records.

**Agent schedules:**
- Maya: content calendar (9 AM CT), afternoon publishing (2 PM CT)
- Tyler: content drafting (10 AM CT)
- Lisa: SEO performance (8:30 AM CT)
- Kai: morning plan & scheduling (9 AM CT), afternoon engagement (4 PM CT)

## Size Comparison

| Skill | Old | New |
|-------|-----|-----|
| content-creation | 7 lines, 2 tools | ~155 lines, 26 tools |
| seo-optimization | 6 lines, 1 tool | ~150 lines, 21 tools |
| social-media-management | 6 lines, 2 tools | ~145 lines, 19 tools |
| competitive-intelligence | (didn't exist) | ~140 lines, 27 tools |
| content-analytics | (didn't exist) | ~140 lines, 18 tools |

## Key Design Decisions

**1. Content-SEO feedback loop is explicit.** The content-creation skill tells Tyler to get target keywords from Lisa before drafting. The seo-optimization skill tells Lisa to monitor post-publish ranking and send revision recommendations back to Tyler. This loop is described in both skills so both agents understand their half of it.

**2. Social is approval-gated.** The social-media-management skill references the actual approval flow (`submit_content_for_review → approve/reject → schedule_social_post`). Kai drafts, Maya approves. This matches the architecture doc which confirms all social publishing is approval-gated.

**3. Competitive intelligence is shared.** The skill is held by both Zara (marketing focus) and Lena Park (research focus). The skill explicitly defines the Zara vs. Lena distinction: Zara goes wide on marketing signals for Maya. Lena goes deep on strategic profiles for Sophia. Both save to `save_research`/`search_research` to avoid duplicate work.

**4. Content analytics closes the loop.** Zara's `content-analytics` skill is positioned as the measurement function that tells every other marketing agent whether their work is producing results. Every analysis ends with a recommendation routed to the right person.

**5. Voice is deeply specified.** The content-creation skill spends significant space defining what the Glyphor voice is AND what it's not — authoritative not academic, direct not aggressive, autonomous not assisted. It includes the "AI-smell test for writing" (read aloud — does it sound like ChatGPT?) and the "competitor test" (could this paragraph appear on a competitor's blog?). This is the kind of judgment framework a checklist can't provide.

**6. Pulse creative tools for content.** Both content-creation (Tyler) and the CMO (Maya) have Pulse tools for image generation. The skill specifies that all generated images must feel Prism-native and undergo brand review.

## File Inventory

```
skills/marketing/
├── content-creation.md         # v2 — Tyler, Maya
├── seo-optimization.md         # v2 — Lisa, Maya
├── social-media-management.md  # v2 — Kai, Maya
├── competitive-intelligence.md # NEW — Zara, Lena (shared w/ Research)
├── content-analytics.md        # NEW — Zara
└── INDEX.md                    # This file
```

## Cross-Team Notes

- `brand-management` is in the Design skill set (shared with VP Design). Maya holds it as the marketing-facing brand guardian.
- `competitive-intelligence` is categorized as `research` because Lena Park (Research team) also holds it. Both skills directories should reference it.
- Zara Petrov needs department reassignment from `(unassigned)` to `Marketing`.
