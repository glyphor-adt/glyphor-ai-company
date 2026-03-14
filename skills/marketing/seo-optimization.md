---
name: seo-optimization
slug: seo-optimization
category: marketing
description: Own Glyphor's search engine visibility — keyword strategy, ranking tracking, technical SEO audits, content optimization, backlink analysis, and Google Search Console management. Use when identifying target keywords, auditing page SEO health, optimizing existing content for ranking, monitoring competitor search positions, managing sitemaps and indexing, or producing SEO performance reports. This skill turns organic search from a hope into a system.
holders: cmo, seo-analyst
tools_granted: web_search, web_fetch, save_memory, send_agent_message, discover_keywords, track_keyword_rankings, query_keyword_data, query_seo_rankings, get_seo_data, update_seo_data, get_search_performance, query_search_console, get_indexing_status, submit_sitemap, analyze_page_seo, analyze_content_seo, get_backlink_profile, query_backlinks, query_competitor_rankings, get_content_metrics, query_content_performance
version: 2
---

# SEO Optimization

You own Glyphor's organic search presence. Your job is to ensure that when someone searches for "autonomous AI agents," "AI agent platform," "AI marketing department," or any adjacent term, Glyphor appears on page one and the listing compels a click.

SEO for an AI startup is a specific game. The keyword space is young, volatile, and contested by well-funded competitors. New terms emerge monthly ("agentic AI," "AI workforce," "AI company OS"). The winners will be whoever establishes topical authority first — not whoever writes the most content, but whoever writes the most useful, comprehensive, specific content that search engines learn to trust as the source of truth for this category.

## The SEO Operating Model

### Keyword Strategy

Keywords are the foundation. Everything else — content topics, page structure, technical optimizations — serves the keyword strategy.

**Finding keywords:**

Use `discover_keywords` and `web_search` to build keyword clusters. Think in clusters, not individual keywords:

```
Primary cluster: "AI agent platform"
├── Head term: "AI agent platform" (high volume, high competition)
├── Long-tail: "autonomous AI agent platform for businesses"
├── Question: "how do AI agents work in production"
├── Comparison: "AI agent platform vs AI assistant"
├── Use case: "AI agents for marketing automation"
└── Brand: "Glyphor AI" (navigational, should rank #1)
```

**Prioritizing keywords:**

Not every keyword is worth pursuing. Evaluate on three dimensions:

1. **Relevance** — does this keyword match what Glyphor actually does? "AI chatbot builder" is high volume but wrong positioning. We don't build chatbots — we build autonomous workforces.
2. **Intent** — is the searcher looking to learn, compare, or buy? Target a mix, but commercial-intent keywords ("best AI agent platform," "AI agent platform pricing") drive pipeline. Informational keywords ("what are AI agents") build authority.
3. **Difficulty** — can we realistically rank in 6 months? A keyword where the top 10 results are all from companies with 10x our domain authority is not a near-term target. Find keywords where the current results are weak — thin content, outdated, or off-topic.

Use `query_keyword_data` to pull ranking data and `query_competitor_rankings` to see where competitors rank for the same terms.

### On-Page Optimization

Every page that should rank needs on-page optimization. Use `analyze_page_seo` for a full audit of any URL. The audit checks:

**Title tag** — the single most important on-page factor. It must:
- Include the primary keyword near the beginning
- Be under 60 characters (what Google displays)
- Be compelling enough to earn the click (don't just stuff keywords — write a title a human wants to click)

**Meta description** — doesn't directly affect ranking but affects click-through rate.
- Include the primary keyword
- Under 155 characters
- Include a clear value proposition or answer to the searcher's question
- End with a call to action when appropriate

**Heading structure** — H1 through H4 should form a logical outline of the page:
- One H1 per page (the page title)
- H2s for major sections (these should include secondary keywords naturally)
- H3s/H4s for subsections
- Never skip levels (H1 → H3 with no H2 is a structural error)

**Content quality signals:**
- Word count appropriate to the topic (comprehensive guides: 2000-4000 words; product pages: 500-1000; blog posts: 1200-2500)
- The primary keyword appears in the first 100 words
- Related keywords and synonyms appear naturally throughout (not forced)
- Internal links to related Glyphor pages (minimum 2-3 per page)
- External links to high-authority sources where they support claims
- No keyword stuffing — if a keyword density check flags anything above 2-3%, it's probably over-optimized

Use `analyze_content_seo` to check existing content against these criteria.

### Technical SEO

Technical SEO ensures search engines can crawl, understand, and index our pages correctly.

**Indexing:**
- `get_indexing_status` — check which pages are indexed and which aren't
- `submit_sitemap` — ensure the sitemap is current and submitted to Google
- Watch for accidental noindex tags, blocked resources in robots.txt, or canonical tag errors

**Page speed:**
- Core Web Vitals matter for ranking. LCP (Largest Contentful Paint) under 2.5s, CLS (Cumulative Layout Shift) under 0.1, FID/INP under 200ms.
- The dashboard runs on Cloud Run with nginx — static assets should be fast. If they're not, flag to the engineering team.

**Mobile:**
- Google uses mobile-first indexing. If the mobile experience is degraded, rankings suffer.
- All marketing pages must be responsive.

**Structured data:**
- Blog posts should have Article schema
- Product pages should have Product or SoftwareApplication schema
- FAQ sections should have FAQPage schema
- Structured data helps rich snippet generation in search results

### Backlink Analysis

Backlinks remain a critical ranking factor. Use `get_backlink_profile` and `query_backlinks` to monitor:

- **Total backlinks and referring domains** — trend over time. Growing = healthy. Declining = investigate.
- **Link quality** — a single link from TechCrunch is worth more than 100 links from random directories. Evaluate referring domain authority.
- **Anchor text distribution** — should be natural. Too many exact-match keyword anchors is a spam signal.
- **Toxic links** — links from spam sites, link farms, or irrelevant directories can harm rankings. Flag for disavow if needed.
- **Competitor backlinks** — `query_competitor_rankings` to see where competitors get linked from. These are potential outreach targets for Glyphor.

### Google Search Console

Search Console is the ground truth for how Google sees Glyphor's site. Use `query_search_console` and `get_search_performance` regularly.

**Key metrics:**
- **Impressions** — how often Glyphor appears in search results
- **Clicks** — how often those impressions result in visits
- **CTR** — clicks / impressions. Low CTR on a high-impression keyword means the title/description isn't compelling enough.
- **Average position** — the average ranking position. Track trends, not snapshots.

**Weekly Search Console review:**
1. Top queries by impressions — are we showing up for the right terms?
2. Top queries by clicks — which terms actually drive traffic?
3. Pages with high impressions but low CTR — title/description optimization opportunities
4. Pages with dropping position — investigate and remediate
5. New queries appearing — early signals of emerging search demand

## Reporting

Produce a weekly SEO report for the CMO:

**Structure:**
- **Headline metric:** organic traffic change vs. previous week
- **Keyword movements:** top 5 gains and top 5 losses in ranking position
- **Content performance:** which pieces are ranking, which are struggling
- **Technical issues:** any indexing problems, crawl errors, or speed regressions
- **Competitor changes:** notable ranking changes from competitors
- **Recommendations:** 3-5 specific, prioritized actions for the coming week

Save reports as memories — the trend over weeks and months is more valuable than any single snapshot.

## The Content-SEO Feedback Loop

SEO and content creation are not separate functions. They are a feedback loop:

1. **Lisa identifies keyword opportunities** → sends target keywords to Tyler via `send_agent_message`
2. **Tyler writes content optimized for those keywords** (see content-creation skill)
3. **Lisa monitors ranking performance** after publication via `query_seo_rankings`
4. **If content isn't ranking within 30 days:** Lisa audits the page (`analyze_page_seo`), identifies gaps, and sends specific revision recommendations to Tyler
5. **Tyler revises** based on SEO feedback
6. **Lisa re-monitors**

This loop should run continuously. Content that was written 6 months ago and never revisited is decaying in rankings. Refresh old content with updated data, new internal links, and improved keyword targeting.
