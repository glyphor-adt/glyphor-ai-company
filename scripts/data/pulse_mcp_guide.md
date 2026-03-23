# Pulse MCP Server — AI Agent Instructions

> **Server URL**: `https://iyabxcmsncmbtbbdngid.supabase.co/functions/v1/pulse-mcp`
> **Protocol**: MCP Streamable HTTP
> **Version**: 1.0.0

---

## Authentication

Two authentication modes are supported:

| Mode | Header | Use Case |
|------|--------|----------|
| **User JWT** | `Authorization: Bearer <jwt>` | User-scoped actions (most common) |
| **Service Key** | `x-pulse-key: <key>` | Server-to-server / automated pipelines |

All tools require authentication. Unauthenticated requests will fail.

### Glyphor company agents (server-to-server)

Company agents (CMO, Content Creator, Social Media Manager) use **Service Key** mode only — not user JWTs.

| Env var | Maps to |
|--------|---------|
| `PULSE_MCP_ENDPOINT` | Server URL above (no trailing slash required) |
| `PULSE_SERVICE_ROLE_KEY` | The `<key>` for header **`x-pulse-key`** |

Implementation: `@glyphor/integrations` `PulseClient` sends `x-pulse-key` on every MCP request. For rare deployments that still expect Bearer with the same secret, set `PULSE_MCP_ALSO_SEND_BEARER=1`.

The edge function is documented as **MCP Streamable HTTP**; the Node client in this repo (`PulseClient`) sends JSON-RPC `tools/call` over POST. If tool calls fail with parse or transport errors, verify the deployed function’s expected request shape (streamable session vs single JSON response).

---

## Tool Categories & Usage Guide

### 📋 1. STORYBOARD MANAGEMENT

These tools manage storyboard projects — the central organizational unit for multi-scene video content.

---

#### `list_storyboards`
**What it does**: Lists the user's storyboards with metadata.
**When to use**: At the start of a session to understand what the user already has, or when the user asks "show my projects" / "what storyboards do I have?"
**Parameters**:
- `limit` (optional, default 20): Max results to return

**Example flow**: Always call this first when a user wants to work on an existing project.

---

#### `get_storyboard`
**What it does**: Retrieves full storyboard details including all scenes, prompts, image URLs, and video URLs.
**When to use**: When you need to inspect or modify a specific storyboard's content. Call after `list_storyboards` to drill into a specific project.
**Parameters**:
- `storyboard_id` (required): UUID of the storyboard

**Best practice**: Always call this before making changes to a storyboard so you have full context of existing scenes.

---

#### `storyboard_chat`
**What it does**: AI-powered conversational editing of a storyboard — can create, modify, delete, and reorder scenes through natural language.
**When to use**: When the user wants to iteratively refine scenes through conversation (e.g., "make scene 3 more dramatic", "add a closing shot", "swap scenes 2 and 4").
**Parameters**:
- `storyboard_id` (required): UUID of the storyboard
- `message` (required): User's instruction about the storyboard
- `scenes` (optional): Current scenes array for context (auto-fetched if omitted)

**Best practice**: Pass the current `scenes` array if you already have it from `get_storyboard` to avoid redundant DB lookups.

---

#### `suggest_scenes`
**What it does**: AI-suggests new scenes based on existing storyboard content.
**When to use**: When a storyboard feels incomplete and the user wants ideas for what to add next.
**Parameters**:
- `existing_scenes` (optional): Array of existing scene objects
- `storyboard_title` (optional): Title for context
- `aspect_ratio` (optional): 16:9 | 9:16 | 1:1
- `custom_prompt` (optional): Specific request for scene suggestions

---

### 🎬 2. STORYBOARD CREATION (Orchestration Pipelines)

These are **end-to-end workflows** that create complete storyboards from different starting points. Choose based on the user's input material.

---

#### `create_storyboard_from_idea`
**What it does**: Takes a creative idea/brief → generates a screenplay → parses into scenes → creates storyboard.
**When to use**: When the user has a **text-only concept** with no reference images. Best for abstract ideas, ad concepts, or story briefs.
**Parameters**:
- `idea` (required): Creative brief, ad copy, or video concept
- `title` (optional): Storyboard title
- `aspect_ratio` (optional): 16:9 | 9:16 | 1:1 (default 16:9)

**Next step**: Call `generate_scene_images` to produce visuals for the scenes.

---

#### `create_hero_promo`
**What it does**: End-to-end hero promo pipeline — takes a hero/product image + campaign brief → generates cinematic promo scenes → creates storyboard → optionally generates images.
**When to use**: When the user has a **hero image** (product shot, key visual) and wants to build a promotional campaign around it.
**Parameters**:
- `hero_image_url` (required): URL of the hero/product image
- `campaign_brief` (required): Creative direction (e.g., "Luxury perfume ad in a Parisian penthouse at dusk")
- `title` (optional): Storyboard title
- `tone` (optional): luxury | bold | playful | cinematic | minimal (default cinematic)
- `preservation_mode` (optional): inpainting | preserve-likeness | creative-freedom (default preserve-likeness)
- `aspect_ratio` (optional): 16:9 | 9:16 | 1:1 (default 16:9)
- `generate_images` (optional): Whether to generate scene images immediately (default false)

**Best practice**: Set `generate_images: true` for a complete pipeline in one call. Use `preservation_mode: "preserve-likeness"` to keep the product recognizable across scenes.

---

#### `create_multi_angle`
**What it does**: Creates a multi-angle storyboard from a single reference image — generates diverse camera angles and framings of the same subject.
**When to use**: When the user has **one reference image** and wants to explore different angles/perspectives of that subject (no campaign brief needed).
**Parameters**:
- `image_url` (required): URL of the reference/subject image
- `title` (optional): Storyboard title
- `tone` (optional): luxury | bold | playful | cinematic | minimal (default cinematic)
- `preservation_mode` (optional): inpainting | preserve-likeness | creative-freedom (default preserve-likeness)
- `aspect_ratio` (optional): 16:9 | 9:16 | 1:1 (default 16:9)
- `generate_images` (optional): Generate scene images immediately (default false)

**Difference from `create_hero_promo`**: No campaign brief — focuses purely on visual exploration of angles.

---

#### `create_product_showcase`
**What it does**: Creates a product showcase storyboard optimized for e-commerce with progressive storytelling beats (Hook → Approach → Interaction → Immersion → CTA).
**When to use**: When the user wants an **e-commerce or product marketing** storyboard.
**Parameters**:
- `product_image_url` (required): URL of the primary product image
- `brand_brief` (required): Product description, USPs, or brand story
- `title` (optional): Storyboard title
- `tone` (optional): luxury | bold | playful | cinematic | minimal (default luxury)
- `aspect_ratio` (optional): 16:9 | 9:16 | 1:1 (default **9:16** for social)
- `generate_images` (optional): Generate scene images immediately (default false)

**Best practice**: Default aspect ratio is 9:16 (vertical) — optimized for social/mobile. Use `tone: "luxury"` for premium products.

---

#### `create_narrative_storyboard`
**What it does**: Creates a narrative animation storyboard from a script or idea. Handles both raw ideas and pre-written screenplays. Best for story-driven content, explainers, and character-led narratives.
**When to use**: When the user has a **story/script** (or a story idea) rather than a product/image.
**Parameters**:
- `script_or_idea` (required): Full screenplay text or a raw creative idea/brief
- `title` (optional): Storyboard title
- `aspect_ratio` (optional): 16:9 | 9:16 | 1:1 (default 16:9)
- `reference_image_url` (optional): Reference image for character/subject anchoring
- `generate_images` (optional): Generate scene images immediately (default false)

**Smart detection**: Automatically detects if input is a formatted screenplay vs. raw idea and skips screenplay generation if not needed. Caps at 8 scenes.

---

### Decision Matrix: Which Creation Tool to Use

| User Has | Best Tool |
|----------|-----------|
| Text idea, no images | `create_storyboard_from_idea` |
| Hero/product image + campaign brief | `create_hero_promo` |
| One image, wants multiple angles | `create_multi_angle` |
| Product image + brand/marketing brief | `create_product_showcase` |
| Story/script or narrative idea | `create_narrative_storyboard` |

---

### 🎨 3. IMAGE GENERATION & EDITING

---

#### `generate_scene_images`
**What it does**: Batch-generates images for all scenes in a storyboard using Imagen 4.
**When to use**: After creating a storyboard (from any creation tool) to produce visuals for all scenes at once.
**Parameters**:
- `storyboard_id` (required): UUID of the storyboard
- `reference_image_url` (optional): Reference image URL for identity-anchored generation (maintains subject consistency)

**Best practice**: Always pass `reference_image_url` if the user provided a source image — this ensures character/product consistency across scenes.

---

#### `generate_concept_image`
**What it does**: Generates a standalone concept image using Imagen 4.
**When to use**: When the user wants a **single image** (not part of a storyboard) — concept art, social post, reference image, etc.
**Parameters**:
- `prompt` (required): Image generation prompt
- `aspect_ratio` (optional): 16:9 | 9:16 | 1:1 | 4:3 | 3:4 (default 16:9)

---

#### `list_concept_images`
**What it does**: Lists the user's previously generated concept images.
**When to use**: When the user wants to browse their image library or reference a past generation.
**Parameters**:
- `limit` (optional, default 20): Max results

---

#### `edit_image`
**What it does**: Edits an image using AI with a text prompt. Supports inpainting with optional mask.
**When to use**: When the user wants to modify an existing image — change elements, fix details, apply edits.
**Parameters**:
- `image_url` (required): URL of the image to edit
- `prompt` (required): Edit instruction (e.g., "remove the person in the background", "change the sky to sunset")
- `mask_url` (optional): Mask URL for targeted inpainting
- `edit_mode` (optional): inpaint | outpaint | default

---

#### `expand_image`
**What it does**: Expands/outpaints an image to a larger canvas using AI.
**When to use**: When changing aspect ratio or extending the scene beyond the original frame.
**Parameters**:
- `image_url` (required): URL of the image to expand
- `target_aspect_ratio` (optional): 16:9 | 9:16 | 1:1 | 4:3 | 3:4
- `prompt` (optional): Prompt to guide what appears in the expanded area

---

#### `upscale_image`
**What it does**: Upscales an image to higher resolution using AI.
**When to use**: When an image is too low-res for the intended use (e.g., before video generation or final export).
**Parameters**:
- `image_url` (required): URL of the image to upscale
- `scale_factor` (optional): 2 or 4 (default 2)

---

#### `remove_background`
**What it does**: Removes the background from an image, returning a transparent PNG.
**When to use**: When isolating a product/subject from its background for compositing or product shots.
**Parameters**:
- `image_url` (required): URL of the image

---

#### `extract_image_text`
**What it does**: Extracts/detects text from an image using OCR.
**When to use**: When you need to read text from a screenshot, sign, document, or any image with text content.
**Parameters**:
- `image_url` (required): URL of the image

---

#### `replace_image_text`
**What it does**: Replaces text in an image with new text using AI.
**When to use**: When the user wants to change text overlays, captions, or labels in an existing image.
**Parameters**:
- `image_url` (required): URL of the image
- `original_text` (required): Text to find and replace
- `new_text` (required): Replacement text

---

#### `transform_viral_image`
**What it does**: Transforms an image using a viral trend/style filter with AI.
**When to use**: When the user wants to apply a viral social media trend or style transformation to an image.
**Parameters**:
- `image_url` (required): URL of the source image
- `prompt` (required): Transformation prompt
- `trend_name` (optional): Name of the trend/style to apply

---

#### `product_recontext`
**What it does**: Places a product image into a new context/background scene using AI.
**When to use**: When the user has a product photo and wants to see it in different settings (beach, studio, kitchen, etc.).
**Parameters**:
- `product_image_url` (required): URL of the product image
- `prompt` (required): Description of the new context/background

---

### 🎥 4. VIDEO GENERATION & MANAGEMENT

---

#### `generate_video`
**What it does**: Generates a single video clip from a prompt and optional source image. Uses Veo 3.1 by default.
**When to use**: When the user wants to create a **standalone video clip** (not as part of a storyboard workflow).
**Parameters**:
- `prompt` (required): Video generation prompt
- `image_url` (optional): Source image URL for image-to-video generation
- `title` (optional): Video title
- `duration` (optional): Duration in seconds — 4, 6, or 8 for Veo 3.1 (default 6)
- `aspect_ratio` (optional): 16:9 | 9:16 (default 16:9)
- `model` (optional): veo-3.1 | veo-3.0 (default veo-3.1)

**Important**: Video generation is asynchronous. After calling this, use `poll_video_status` to check progress.

**Image-to-video**: If `image_url` is provided, the video will be generated as a continuation/animation of that image. Great for bringing concept images to life.

---

#### `poll_video_status`
**What it does**: Checks the generation status of a video.
**When to use**: After `generate_video` to check if the video is ready. Poll periodically (every 10-15 seconds).
**Parameters**:
- `video_id` (required): UUID of the video record

**Status values**: `pending` → `processing` → `completed` (with `video_url`) or `failed` (with `error_message`).

---

#### `list_videos`
**What it does**: Lists the user's generated videos with status and URLs.
**When to use**: When the user wants to browse their video library or find a specific video.
**Parameters**:
- `limit` (optional, default 20): Max results
- `status` (optional): Filter by status — pending | processing | completed | failed

---

#### `delete_video`
**What it does**: Deletes a video and its associated storage files.
**When to use**: When the user wants to remove a video. **Destructive action** — confirm with the user first.
**Parameters**:
- `video_id` (required): UUID of the video to delete

---

### 🔊 5. AUDIO GENERATION

---

#### `text_to_speech`
**What it does**: Generates speech audio from text using ElevenLabs TTS.
**When to use**: When the user needs a voiceover narration for their video/storyboard.
**Parameters**:
- `text` (required): Text to convert to speech
- `voice_id` (optional): ElevenLabs voice ID (default: "George")

---

#### `generate_sound_effect`
**What it does**: Generates a sound effect from a text description using ElevenLabs. Max 22 seconds.
**When to use**: When the user needs specific sound effects (whoosh, explosion, rain, etc.) for their video.
**Parameters**:
- `prompt` (required): Description of the sound effect (e.g., "cinematic whoosh transition", "glass breaking")
- `duration` (optional): Duration in seconds (max 22, default 5)

---

#### `generate_music`
**What it does**: Generates background music from a text description using ElevenLabs.
**When to use**: When the user needs background music for their video/storyboard.
**Parameters**:
- `prompt` (required): Description of the music — genre, mood, tempo, instruments
- `duration` (optional): Duration in seconds (default 30)

**Best practice**: Be specific about genre, mood, tempo, and instruments. Example: "Upbeat electronic lo-fi with soft synth pads, 90 BPM, modern and clean."

---

#### `generate_voiceover_script`
**What it does**: Generates a professional voiceover narration script for storyboard scenes.
**When to use**: Before calling `text_to_speech` — generates the script text from scene descriptions.
**Parameters**:
- `scenes` (required): Array of scene objects with title, description, and duration

**Workflow**: `get_storyboard` → `generate_voiceover_script` → `text_to_speech`

---

### ✨ 6. PROMPT ENHANCEMENT

These tools improve rough descriptions into production-quality prompts. Use them **before** image or video generation for better results.

---

#### `enhance_prompt`
**What it does**: Enhances a rough description into a photorealistic, production-ready **image** prompt.
**When to use**: Before `generate_concept_image` or when improving storyboard scene prompts.
**Parameters**:
- `prompt` (required): Rough description to enhance
- `style` (optional): cinematic | editorial | product | lifestyle

---

#### `enhance_video_prompt`
**What it does**: Enhances a rough description into a cinematic, production-ready **video** prompt.
**When to use**: Before `generate_video` for better results.
**Parameters**:
- `prompt` (required): Rough video description to enhance

---

#### `polish_scene_prompt`
**What it does**: Polishes a scene description into a cinematic prompt with lighting, texture, and camera details.
**When to use**: When refining individual storyboard scene prompts for maximum visual quality.
**Parameters**:
- `description` (required): Scene description to polish
- `shot_type` (optional): wide | medium | close-up | extreme-close-up | pov
- `camera_movement` (optional): static | dolly | pan | tilt | orbit | drone

**Difference from `enhance_prompt`**: More granular control over cinematography (shot type + camera movement).

---

### 🔍 7. ANALYSIS

---

#### `analyze_brand_website`
**What it does**: Analyzes a brand's website to extract visual identity, colors, typography, and ad suggestions.
**When to use**: At the start of a brand-focused project to understand the client's visual language before creating content.
**Parameters**:
- `website_url` (required): URL of the brand website

**Best practice**: Call this early in the workflow and use the extracted brand info as context for subsequent prompt enhancement and generation calls.

---

#### `analyze_image_for_video`
**What it does**: Analyzes an image and generates optimized video generation prompts based on its content.
**When to use**: When the user provides an image and wants to create a video from it but doesn't know what prompt to use.
**Parameters**:
- `image_url` (required): URL of the image

**Workflow**: `analyze_image_for_video` → use suggested prompts with `generate_video`

---

#### `generate_storyboard_script`
**What it does**: Generates a full screenplay/script from a storyboard's existing scenes.
**When to use**: When the user has a visual storyboard and wants to generate a written script from it.
**Parameters**:
- `storyboard_id` (required): UUID of the storyboard

---

### 🛠 8. UTILITY

---

#### `generate_promo_scenes`
**What it does**: Low-level tool that generates promotional scene plans from a hero image and/or brand description. Used internally by orchestration tools but available directly for custom workflows.
**When to use**: When you need more control than the orchestration tools provide. Most users should use `create_hero_promo` or `create_product_showcase` instead.
**Parameters**:
- `brand_info` (required): Brand/product description
- `hero_image_url` (optional): Hero/product image URL
- `campaign_brief` (optional): Creative direction
- `tone` (optional): luxury | bold | playful | cinematic | minimal (default cinematic)
- `preservation_mode` (optional): inpainting | preserve-likeness | creative-freedom (default preserve-likeness)
- `aspect_ratio` (optional): 16:9 | 9:16 | 1:1

---

#### `upload_source_image`
**What it does**: Uploads an image from a URL to the platform's storage.
**When to use**: When you need to persist an external image URL into the platform's storage for reliable access in generation workflows.
**Parameters**:
- `image_url` (required): URL of the image to upload
- `file_name` (optional): Filename

---

#### `create_share_link`
**What it does**: Creates a shareable link for a video or image asset.
**When to use**: When the user wants to share their content with others.
**Parameters**:
- `content_url` (required): URL of the content to share
- `content_type` (required): video | image
- `title` (optional): Title for the shared content

---

#### `check_subscription`
**What it does**: Checks the authenticated user's subscription status and available credits.
**When to use**: Before starting expensive generation workflows to ensure the user has sufficient credits. Also when the user asks about their plan/credits.
**Parameters**: None

---

## Common Workflows

### Workflow 1: Brand Ad from Scratch
```
1. analyze_brand_website(website_url)         → Extract brand identity
2. create_hero_promo(hero_image_url, campaign_brief, generate_images: true)
                                                → Create promo storyboard with images
3. generate_video(prompt, image_url)           → Generate video for key scenes
4. poll_video_status(video_id)                 → Wait for completion
5. generate_music(prompt)                      → Add background music
6. create_share_link(content_url)              → Share the result
```

### Workflow 2: Product Launch Video
```
1. create_product_showcase(product_image_url, brand_brief, generate_images: true)
                                                → Create e-commerce storyboard
2. generate_voiceover_script(scenes)           → Generate narration script
3. text_to_speech(text)                        → Produce voiceover audio
4. generate_video(prompt, image_url)           → Animate key scenes
```

### Workflow 3: Story-Driven Content
```
1. create_narrative_storyboard(script_or_idea, generate_images: true)
                                                → Create narrative storyboard
2. storyboard_chat(storyboard_id, message)     → Refine scenes iteratively
3. generate_scene_images(storyboard_id)        → Re-generate images after edits
4. generate_video(prompt, image_url)           → Bring scenes to life
```

### Workflow 4: Quick Image Generation
```
1. enhance_prompt(prompt)                      → Polish the prompt
2. generate_concept_image(enhanced_prompt)     → Generate the image
3. (optional) edit_image / expand_image / upscale_image → Post-process
```

### Workflow 5: Image-to-Video Pipeline
```
1. analyze_image_for_video(image_url)          → Get optimized video prompts
2. enhance_video_prompt(prompt)                → Polish the video prompt
3. generate_video(prompt, image_url)           → Generate the video
4. poll_video_status(video_id)                 → Wait for completion
```

---

## Important Rules for Agents

1. **Always check credits first** for large workflows — call `check_subscription` before batch operations.
2. **Video generation is async** — always follow `generate_video` with `poll_video_status`.
3. **Pass reference images for consistency** — when generating scene images, always include `reference_image_url` if available.
4. **Enhance prompts before generation** — use `enhance_prompt` / `enhance_video_prompt` / `polish_scene_prompt` to get significantly better outputs.
5. **Confirm destructive actions** — always confirm before calling `delete_video`.
6. **Use orchestration tools over manual steps** — prefer `create_hero_promo` over manually calling `generate_promo_scenes` + DB insert.
7. **Default aspect ratios matter** — product showcase defaults to 9:16 (social), everything else defaults to 16:9.
8. **Storyboard scene cap** — `create_narrative_storyboard` caps at 8 scenes for quality.
