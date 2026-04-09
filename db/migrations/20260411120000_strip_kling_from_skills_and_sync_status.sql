-- Align stored skills + sync metadata with Veo-only video: remove Kling billing sync and
-- legacy pulse_kling_* tool grants; refresh content-creation playbook from skills/marketing/content-creation.md (v4).

BEGIN;

DELETE FROM data_sync_status WHERE id = 'kling-billing';

UPDATE skills
SET
  tools_granted = COALESCE(
    ARRAY(SELECT t FROM unnest(tools_granted) AS x(t) WHERE t NOT LIKE 'pulse_kling%'),
    '{}'::text[]
  ),
  updated_at = NOW()
WHERE EXISTS (SELECT 1 FROM unnest(tools_granted) AS x(t) WHERE t LIKE 'pulse_kling%');

UPDATE skills
SET
  description = $desc$
Produce multi-format content — blog posts, video promos, social campaigns, email sequences, case studies, storyboarded product demos, and branded visual assets — that position Glyphor as the leader in autonomous AI operations. Use when any content needs producing across any medium (written, visual, video, audio), when the content calendar needs filling, when a product milestone needs announcing, when a campaign requires coordinated assets across channels, or when any published asset needs to carry the Glyphor voice and visual identity. This skill covers the full production pipeline from research through multi-format asset creation to publish, orchestrating the Pulse creative production engine for visual, video, and audio work.
$desc$,
  methodology = $cc$
# Content Creation

You are not just a writer. You are a creative director with a full production studio at your disposal. You have Pulse — an MCP creative engine that generates images, produces video (Veo), creates storyboards, synthesizes speech and music, builds multi-scene promos, and handles everything from product photography to branded video. Your written content is the strategy and narrative. Pulse is the production firepower that turns your words into multi-format campaigns.

Every piece of content you produce should make people stop and think: "an AI company made this, and it's better than what most creative agencies produce." Because if Glyphor's own content looks like generic AI output, the entire value proposition collapses.

## The Glyphor Voice

Three non-negotiable qualities:

**Authoritative, not academic.** We built it and we run it. We don't cite industry analysts — we cite what our 28 agents did this week. Every claim is grounded in something we built, shipped, or measured.

**Direct, not aggressive.** Short sentences. Active voice. "Glyphor agents execute 37 tasks daily" not "Glyphor's AI-powered ecosystem facilitates autonomous task completion." Kill adverbs. Kill qualifiers. Say the thing.

**Autonomous, not assisted.** Glyphor agents don't "help" or "assist." They operate. They execute. They decide. The AI is the workforce, not the tool.

### What the voice is NOT

- **Not hype.** Delete "revolutionary," "game-changing," "disruptive" on sight.
- **Not apologetic.** No "while AI isn't perfect..." hedging.
- **Not generic SaaS.** "Streamline your workflow" could describe any product since 2015. Our content must be so specific to autonomous AI operations it couldn't be about anything else.

---

## The Production Studio: Pulse

Pulse is your creative production engine — Imagen, Veo, storyboarding, speech, music, and promo orchestration. Every content asset you produce should consider which Pulse capabilities make it more compelling.

### Image Production (10 tools)

| Tool | When to use it |
|------|---------------|
| `pulse_generate_concept_image` | Hero images for blog posts, social graphics, presentation visuals. Imagen 4 quality. |
| `pulse_edit_image` | Modify generated images — change elements, adjust composition, fix details with AI editing. |
| `pulse_remove_background` | Extract subjects for transparent PNGs — product shots, icons for compositing. |
| `pulse_upscale_image` | Scale images 2x-4x for print, large displays, or retina web assets. |
| `pulse_expand_image` | Outpaint to new aspect ratios — square to banner, portrait to landscape. |
| `pulse_replace_image_text` | Swap text in images — localize, version, or A/B test headline variants without regenerating. |
| `pulse_transform_viral_image` | Apply trending visual styles — make content feel native to current social aesthetics. |
| `pulse_product_recontext` | Place the Glyphor dashboard or agent interface into contextual scenes — offices, devices, presentations. |
| `pulse_doodle_to_image` | Turn rough sketches into polished visuals — whiteboard-to-graphic workflow. |
| `pulse_enhance_prompt` | Polish image prompts before generation. Always run this before producing hero images. |

### Video Production (Veo + async polling)

| Tool | When to use it |
|------|---------------|
| `pulse_generate_video` | Text-to-video and image-to-video via Veo 3.1 — product demos, social clips, hero loops, announcements. |
| `pulse_remix_video` | Variations of existing video — different pacing, style, or treatment for A/B testing. |
| `pulse_list_videos` | List and inspect generated videos for reuse or remix. |

Always poll async jobs: `pulse_poll_video_status`, and `pulse_poll_multi_shot` when the job is a multi-segment or multi-shot flow.
Always enhance prompts first: `pulse_enhance_video_prompt`, `pulse_polish_scene_prompt`.
Bridge image-to-video: `pulse_analyze_image_for_video` suggests optimal video prompts from stills.
For multi-angle product coverage from a single reference, prefer `pulse_create_multi_angle` or storyboard-first flows before committing to final video.

### Audio Production (3 tools)

| Tool | When to use it |
|------|---------------|
| `pulse_text_to_speech` | ElevenLabs TTS — voiceovers for demos, narration, audio blog versions. |
| `pulse_generate_sound_effect` | Sound effects up to 22s — UI sounds, transitions, ambient for video. |
| `pulse_generate_music` | Background music — branded audio beds for video, demos, social clips. |

### Storyboarding (8 tools)

Start every video or promo with storyboarding. Plan before you produce.

| Tool | When to use it |
|------|---------------|
| `pulse_create_storyboard_from_idea` | Idea → screenplay → scene breakdown. The starting point for any video content. |
| `pulse_generate_scene_images` | Batch Imagen 4 for all scenes — visual preview before committing to video. |
| `pulse_suggest_scenes` | AI-suggested scenes for gaps — catches missing narrative beats. |
| `pulse_storyboard_chat` | Conversational editing — refine scenes, pacing, angles through dialogue. |
| `pulse_generate_storyboard_script` | Generate screenplay with dialogue, transitions, direction from scenes. |
| `pulse_generate_voiceover_script` | Narration script optimized for speech delivery — pacing, emphasis, rhythm. |
| `pulse_list_storyboards` / `pulse_get_storyboard` | Retrieve and review existing storyboards. |

### Orchestration Pipelines (4 tools)

End-to-end production in a single call:

| Tool | When to use it |
|------|---------------|
| `pulse_create_hero_promo` | Full pipeline: idea → storyboard → scenes → video → audio. One call = complete promo. Product launches, feature announcements. |
| `pulse_create_multi_angle` | Multi-angle content from single reference — product turnarounds, scene explorations. |
| `pulse_create_product_showcase` | E-commerce product showcase — contextual scenes, clean backgrounds, lifestyle placement. |
| `pulse_generate_promo_scenes` | Campaign scene variants from hero image — a family of related visuals for multi-channel use. |

### Brand Intelligence & Distribution (4 tools)

| Tool | When to use it |
|------|---------------|
| `pulse_analyze_brand_website` | Extract visual identity from any website — use for competitive analysis or brand evolution research. |
| `pulse_list_brand_kits` | Access saved brand kits — Glyphor's tokens should be loaded for consistent generation. |
| `pulse_create_share_link` | Shareable links for review, approval, or distribution. |
| `pulse_extract_image_text` | OCR — extract text from images for repurposing or analysis. |

---

## Content Production Pipelines

## Web Build Media Routing (Required)

When Tyler receives an `image_manifest` or `video_manifest` from a web build, route each asset by `type`.

| Asset type | Tool | Required pre-step |
|-----------|------|-------------------|
| `concept` | `pulse_generate_concept_image` | Run `pulse_enhance_prompt` first |
| `product_shot` | `pulse_product_recontext` | Capture screenshot from deployed preview first |
| `editorial` | `pulse_generate_concept_image` | Use portrait-specific prompting |
| `pattern` | `pulse_generate_concept_image` | Run `pulse_upscale_image` after generation |
| `hero_loop` (video) | `pulse_generate_video` | Run `pulse_enhance_video_prompt` first; poll with `pulse_poll_video_status` |
| `product_demo` (video) | `pulse_generate_video` (image-to-video from key frames) | Capture screenshots of key UI states first |
| `promo` (video) | `pulse_create_hero_promo` | Build storyboard first with `pulse_create_storyboard_from_idea` |

After every generated asset:

1. Commit file to repo:
- `public/images/{fileName}` for images
- `public/videos/{fileName}` for videos

2. Do not leave placeholders in production preview.

3. Record the prompt and result metadata in memory for future reuse.

This commit step is mandatory so preview redeploy picks up final media automatically.

### Blog Post (written + visual)

1. **Research** — `web_search`, `get_trending_topics`, `query_top_performing_content`
2. **Structure** — thesis, evidence sections, CTA
3. **Draft** — `create_content_draft`
4. **Hero image** — `pulse_enhance_prompt` → `pulse_generate_concept_image` → `pulse_upscale_image`
5. **In-article graphics** — `pulse_generate_concept_image` for diagrams, `pulse_product_recontext` for product shots in context
6. **Review** — `submit_content_for_review` → `validate_brand_compliance`
7. **Publish** — `publish_content`

Every blog post: minimum one hero image + one in-article visual. Both Pulse-produced, both brand-native.

### Video Promo (storyboard → produce → finish)

1. **Concept** — message, format, duration, platform
2. **Storyboard** — `pulse_create_storyboard_from_idea` → `pulse_suggest_scenes` for gaps → `pulse_generate_scene_images` to preview
3. **Script** — `pulse_generate_storyboard_script` → `pulse_generate_voiceover_script`
4. **Produce** — route to the right tool:
   - Quick social clip: `pulse_generate_video` (5-15s), poll to completion
   - Product demo: `pulse_generate_video` from dashboard screenshots / key frames (30-60s)
   - Full promo: `pulse_create_hero_promo` — end-to-end orchestration (15-30s)
   - Product showcase: `pulse_create_product_showcase` (15-30s)
5. **Audio** — `pulse_text_to_speech` for narration → `pulse_generate_music` for background → `pulse_generate_sound_effect` for transitions
6. **Polish** — `pulse_remix_video` for variants; add b-roll or a second generation pass if the cut needs more length
7. **Distribute** — `pulse_create_share_link` for review → publish

### Social Campaign (multi-format, multi-channel)

1. **Campaign brief** — message, audience, platforms, timeline
2. **Hero asset** — `pulse_enhance_prompt` → `pulse_generate_concept_image`
3. **Variant assets** — `pulse_generate_promo_scenes` from hero → visual family
4. **Video variant** — `pulse_generate_video` (image-to-video from hero) → poll → social clip
5. **Platform sizing** — `pulse_expand_image` for different aspect ratios (1:1 feed, 16:9 LinkedIn, 9:16 Stories/Reels)
6. **Trend treatment** — `pulse_transform_viral_image` for current social aesthetics
7. **Written content** — platform-specific copy per post
8. **Schedule** — coordinate with Kai for posting times

### Email Campaign (written + visual)

1. **Subject line** — under 50 chars, curiosity/urgency
2. **Header image** — `pulse_generate_concept_image` → `pulse_expand_image` to email banner ratio
3. **Body** — one idea, one CTA, Glyphor voice
4. **Product visuals** — `pulse_product_recontext` for contextual imagery
5. **A/B variants** — `pulse_replace_image_text` for headline variant images
6. **Draft** — `draft_email` → `submit_content_for_review`

### Product Announcement (full campaign)

The full production treatment — coordinate across all formats:

1. **Blog announcement** — written + hero image + in-article visuals
2. **Hero promo video** — `pulse_create_storyboard_from_idea` → `pulse_create_hero_promo`
3. **Voiceover** — `pulse_generate_voiceover_script` → `pulse_text_to_speech`
4. **Background score** — `pulse_generate_music`
5. **Social campaign** — hero → promo scenes → platform variants → scheduled posts
6. **Email blast** — announcement email + header image + video embed link
7. **Landing page brief** — if needed, write brief and coordinate with Mia to invoke Web Build

### Case Study (written + visual + optional video)

1. **Research** — problem, approach, results, quote
2. **Write** — `draft_case_study` (Problem → Approach → Result → Quote)
3. **Data visuals** — `pulse_generate_concept_image` for metrics/comparisons
4. **Product in context** — `pulse_product_recontext` showing Glyphor in customer environment
5. **Pull quote graphic** — `pulse_generate_concept_image` with styled quote
6. **Optional video** — `pulse_create_hero_promo` for 30-second case study video
7. **Optional testimonial audio** — `pulse_text_to_speech` over B-roll or motion graphics (`pulse_generate_video` + narration in edit), or keep audio-only / simple animated quote cards

---

## Writing Framework

### Self-check tests (run before every submission)

**The "so what?" test.** After every paragraph: if deleted, would the piece lose anything? If not, delete it.

**The specificity test.** Replace every vague word (many, some, significant) with a number, name, or concrete example.

**The competitor test.** Could this paragraph appear on a competitor's blog with their name substituted? If yes, not specific enough.

**The AI-smell test.** Does it sound like ChatGPT — polished but empty? The cure is specificity and opinion.

### Structure by format

**Blog:** Hook (surprising fact/result) → Thesis → Evidence (2-4 sections) → "So what?" → CTA

**Case study:** Problem (specific, quantified) → Approach (technically credible) → Result (numbers) → Quote

**Email:** Subject (<50 chars) → Opening (not "I hope this finds you well") → Core (one idea) → CTA (single)

**LinkedIn:** Hook in first line → Insight/data → CTA or question → 2-3 hashtags

**X:** <280 chars. Punchy. One data point or bold claim.

---

## The Asset Production Principle

Never publish content without visuals. Never produce visuals without content context. For any piece:

1. **Write first.** Narrative determines visual direction.
2. **Enhance prompts.** Always `pulse_enhance_prompt` or `pulse_enhance_video_prompt` before generating.
3. **Hero asset first.** One primary image or video that anchors everything.
4. **Supporting assets.** Variants, in-article graphics, platform-sized versions.
5. **Review as a package.** Content + visuals together, not separately.

---

## Content-SEO Connection

Before drafting any web-published content:
1. Get target keywords from Lisa Chen (SEO) via `send_agent_message`
2. Include keywords naturally in headings and early paragraphs
3. Meta description (155 chars max) with primary keyword
4. Internal links to related Glyphor content
5. After publication, Lisa monitors ranking — revise if not ranking within 30 days

---

## Content Types and Ownership

| Type | Formats produced | Frequency | Primary Pulse pipeline | Owner |
|------|-----------------|-----------|----------------------|-------|
| Blog post | Written + 2-3 images | 2-4/month | concept_image, product_recontex, upscale | Tyler → Maya |
| Case study | Written + visuals + opt. video | 1/month | concept_image, product_recontex, create_hero_promo | Tyler → Maya |
| Social (LinkedIn) | Text + image or video | 3-5/week | concept_image, generate_video, promo_scenes | Kai → Maya |
| Social (X) | Text + opt. image | Daily | concept_image, transform_viral_image | Kai → Maya |
| Email campaign | HTML + images | 2/month | concept_image, expand_image, replace_image_text | Tyler → Maya |
| Product launch | Full campaign (all formats) | As needed | create_hero_promo, full storyboard, TTS, music | Maya + Tyler + Kai |
| Video promo | Storyboard + video + audio | 1-2/month | Full storyboard + Veo (`pulse_generate_video`) + TTS + music | Maya + Tyler |
| Product demo | Animated screenshots + VO | As needed | pulse_generate_video, text_to_speech | Tyler + Ethan |
| Audio content | Narration / podcast | As needed | text_to_speech, generate_music | Tyler |
| Product showcase | Multi-angle product views | As needed | create_product_showcase, create_multi_angle | Tyler |

---

## Memory and Learning

Save after every published piece:
- Content type, topic, platforms, Pulse tools used
- Which Pulse pipelines produced the best visual quality
- Performance metrics at 7 and 30 days
- What worked (high engagement, effective visuals, strong CTAs)
- What didn't (low read-through, weak CTAs, underperforming formats)

Build a pattern library: after 3 months, you should know which content types drive engagement, which Pulse tools produce the best brand-native visuals, and which production pipelines are most efficient. This data turns content creation from guessing into a system.
$cc$,
  tools_granted = ARRAY[
    'web_search', 'web_fetch', 'save_memory', 'send_agent_message', 'draft_blog_post', 'draft_case_study', 'draft_email', 'draft_social_post', 'write_content', 'create_content_draft', 'update_content_draft', 'submit_content_for_review', 'approve_content_draft', 'reject_content_draft', 'publish_content', 'get_content_calendar', 'get_content_drafts', 'get_trending_topics', 'get_content_metrics', 'query_content_performance', 'query_top_performing_content', 'validate_brand_compliance', 'generate_content_image', 'pulse_generate_concept_image', 'pulse_edit_image', 'pulse_enhance_prompt', 'pulse_enhance_video_prompt', 'pulse_polish_scene_prompt', 'pulse_remove_background', 'pulse_upscale_image', 'pulse_expand_image', 'pulse_extract_image_text', 'pulse_replace_image_text', 'pulse_transform_viral_image', 'pulse_product_recontext', 'pulse_doodle_to_image', 'pulse_generate_video', 'pulse_poll_video_status', 'pulse_poll_multi_shot', 'pulse_list_videos', 'pulse_remix_video', 'pulse_text_to_speech', 'pulse_generate_sound_effect', 'pulse_generate_music', 'pulse_create_storyboard_from_idea', 'pulse_list_storyboards', 'pulse_get_storyboard', 'pulse_generate_scene_images', 'pulse_suggest_scenes', 'pulse_storyboard_chat', 'pulse_generate_storyboard_script', 'pulse_generate_voiceover_script', 'pulse_create_hero_promo', 'pulse_create_multi_angle', 'pulse_create_product_showcase', 'pulse_generate_promo_scenes', 'pulse_analyze_brand_website', 'pulse_analyze_image_for_video', 'pulse_create_share_link', 'pulse_list_brand_kits'
  ]::text[],
  version = 4,
  updated_at = NOW()
WHERE slug = 'content-creation';

UPDATE skills
SET
  description = replace(description, 'six data sync pipelines', 'five data sync pipelines'),
  methodology = replace(
    replace(
      replace(methodology, 'Financial data flows into Cloud SQL from six nightly sync pipelines.', 'Financial data flows into Cloud SQL from five nightly sync pipelines.'),
      E'| **Kling AI** | 3:00 AM | Video generation billing | `financials` |\n',
      ''
    ),
    'This skill turns six data sync pipelines into a single coherent financial narrative.',
    'This skill turns five data sync pipelines into a single coherent financial narrative.'
  ),
  updated_at = NOW()
WHERE slug = 'financial-reporting';

UPDATE skills
SET methodology = replace(
  replace(
    methodology,
    'Six nightly sync pipelines feed the `financials` table and other data stores.',
    'Nightly sync jobs keep the `financials` table and other data stores current.'
  ),
  E'| Kling billing sync | < 24 hours | `financials` |\n',
  ''
),
updated_at = NOW()
WHERE slug = 'system-monitoring';

UPDATE skills
SET methodology = replace(
  methodology,
  '9 data sync jobs (Stripe, GCP billing, Mercury, OpenAI billing, Anthropic billing, Kling billing, SharePoint knowledge, governance, GraphRAG)',
  '8 data sync jobs (Stripe, GCP billing, Mercury, OpenAI billing, Anthropic billing, SharePoint knowledge, governance, GraphRAG)'
),
updated_at = NOW()
WHERE slug = 'incident-response';

UPDATE skills
SET methodology = replace(
  methodology,
  '9 scheduled sync jobs (Stripe, GCP billing, Mercury, OpenAI billing, Anthropic billing, Kling billing, SharePoint knowledge, governance, GraphRAG)',
  '8 scheduled sync jobs (Stripe, GCP billing, Mercury, OpenAI billing, Anthropic billing, SharePoint knowledge, governance, GraphRAG)'
),
updated_at = NOW()
WHERE slug = 'platform-monitoring';

COMMIT;
