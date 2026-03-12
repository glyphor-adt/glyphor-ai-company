/**
 * Pulse Creative Studio — Complete Tool Set
 *
 * Shared Pulse MCP tools used by all marketing agents (CMO, Content Creator, Social Media Manager).
 * Wraps all 41 Pulse MCP server endpoints.
 */
import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import type { CompanyMemoryStore } from '@glyphor/company-memory';
import { PulseClient } from '@glyphor/integrations';

function getPulseClient(): PulseClient | null {
  try { return PulseClient.fromEnv(); } catch { return null; }
}

const PULSE_UNAVAILABLE_MSG = 'Pulse is not yet deployed — the product is still in development. Pulse tools will be available once Pulse launches. Report this as a blocker to Sarah (Chief of Staff) so it can be tracked.';
const PULSE_TOOL_TIMEOUT_MS = 7000;

function wrapPulseTools(tools: ToolDefinition[]): ToolDefinition[] {
  return tools.map((tool) => {
    const originalExecute = tool.execute.bind(tool);
    return {
      ...tool,
      async execute(params, ctx): Promise<ToolResult> {
        try {
          return await Promise.race([
            originalExecute(params, ctx),
            new Promise<ToolResult>((resolve) =>
              setTimeout(
                () => resolve({ success: false, error: `Pulse MCP ${tool.name} timed out after ${PULSE_TOOL_TIMEOUT_MS}ms` }),
                PULSE_TOOL_TIMEOUT_MS,
              ),
            ),
          ]);
        } catch (error) {
          return {
            success: false,
            error: `Pulse MCP ${tool.name}: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    };
  });
}

export function createAllPulseTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return wrapPulseTools([
    // ── Storyboard Management ──

    {
      name: 'pulse_list_storyboards',
      description: 'List storyboards with id, title, status, scene count, and thumbnail.',
      parameters: {
        limit: { type: 'number', description: 'Max results (default 20)' },
        offset: { type: 'number', description: 'Pagination offset' },
      },
      async execute(params): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const storyboards = await pulse.listStoryboards({ limit: params.limit as number, offset: params.offset as number });
        return { success: true, data: storyboards };
      },
    },

    {
      name: 'pulse_get_storyboard',
      description: 'Retrieve full storyboard details including all scenes, prompts, and image URLs.',
      parameters: {
        storyboard_id: { type: 'string', description: 'Storyboard ID to retrieve', required: true },
      },
      async execute(params): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const storyboard = await pulse.getStoryboard({ storyboard_id: params.storyboard_id as string });
        return { success: true, data: storyboard };
      },
    },

    {
      name: 'pulse_create_storyboard',
      description: 'Generate a screenplay from a creative idea and create a new storyboard with parsed scenes. Use for Product Hunt demos, product walkthroughs, ad sequences.',
      parameters: {
        idea: { type: 'string', description: 'Creative idea or concept to turn into a storyboard', required: true },
        title: { type: 'string', description: 'Optional storyboard title' },
      },
      async execute(params, ctx): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const storyboard = await pulse.createStoryboardFromIdea({
          idea: params.idea as string,
          title: params.title as string,
        });
        await memory.appendActivity({ agentRole: ctx.agentRole, action: 'content', product: 'pulse', summary: `Created storyboard via Pulse: ${storyboard.title}`, createdAt: new Date().toISOString() });
        return { success: true, data: { storyboardId: storyboard.id, title: storyboard.title, sceneCount: storyboard.scenes.length } };
      },
    },

    {
      name: 'pulse_generate_scene_images',
      description: 'Batch-generate images for all scenes in a storyboard using Imagen 4 / Gemini. Supports reference image for character continuity. Include generated images in your reply using markdown ![scene](url) so the user can see them.',
      parameters: {
        storyboard_id: { type: 'string', description: 'Storyboard ID to generate scene images for', required: true },
        model: { type: 'string', description: 'Image model', enum: ['imagen-4', 'gemini-3-pro'] },
        reference_image_url: { type: 'string', description: 'Reference image URL for character/style continuity' },
      },
      async execute(params, ctx): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const images = await pulse.generateSceneImages({
          storyboard_id: params.storyboard_id as string,
          model: params.model as 'imagen-4' | 'gemini-3-pro',
          reference_image_url: params.reference_image_url as string,
        });
        await memory.appendActivity({ agentRole: ctx.agentRole, action: 'content', product: 'pulse', summary: `Generated ${images.length} scene images for storyboard ${params.storyboard_id}`, createdAt: new Date().toISOString() });
        return { success: true, data: images.map(i => ({ imageId: i.id, url: i.url, display_hint: `![Scene image](${i.url})` })) };
      },
    },

    {
      name: 'pulse_suggest_scenes',
      description: 'AI-suggest new scenes for a storyboard based on existing scenes. Fills narrative gaps with diverse shot types.',
      parameters: {
        storyboard_id: { type: 'string', description: 'Storyboard ID to suggest scenes for', required: true },
      },
      async execute(params): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const result = await pulse.callAndParse('suggest_scenes', { storyboard_id: params.storyboard_id });
        return { success: true, data: result };
      },
    },

    {
      name: 'pulse_storyboard_chat',
      description: 'Chat with AI about a storyboard to create, modify, delete, or reorder scenes.',
      parameters: {
        storyboard_id: { type: 'string', description: 'Storyboard ID to chat about', required: true },
        message: { type: 'string', description: 'Chat message with instructions for the storyboard', required: true },
      },
      async execute(params): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const result = await pulse.callAndParse('storyboard_chat', { storyboard_id: params.storyboard_id, message: params.message });
        return { success: true, data: result };
      },
    },

    {
      name: 'pulse_generate_storyboard_script',
      description: "Generate a full screenplay/script from a storyboard's scenes.",
      parameters: {
        storyboard_id: { type: 'string', description: 'Storyboard ID to generate script from', required: true },
      },
      async execute(params): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const script = await pulse.callAndGetText('generate_storyboard_script', { storyboard_id: params.storyboard_id });
        return { success: true, data: { script } };
      },
    },

    {
      name: 'pulse_generate_promo_scenes',
      description: 'Generate promotional video scenes from a hero image and/or campaign brief. Supports image-to-scenes via hero_image_url + base64 conversion on the server. Returns scene angles with prompts, shot types, and camera movements.',
      parameters: {
        hero_image_url: { type: 'string', description: 'URL of the hero/product image to generate scenes from' },
        campaign_brief: { type: 'string', description: 'Campaign brief or brand description for scene direction' },
        tone: { type: 'string', description: 'Visual tone: luxury | bold | playful | cinematic | minimal (default cinematic)' },
        preservation_mode: { type: 'string', description: 'inpainting | preserve-likeness | creative-freedom (default preserve-likeness)' },
        aspect_ratio: { type: 'string', description: '16:9 | 9:16 | 1:1 (default 16:9)' },
        title: { type: 'string', description: 'Optional title for the promo' },
      },
      async execute(params): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const result = await pulse.callAndParse('generate_promo_scenes', {
          hero_image_url: params.hero_image_url,
          campaign_brief: params.campaign_brief,
          tone: params.tone || 'cinematic',
          preservation_mode: params.preservation_mode || 'preserve-likeness',
          aspect_ratio: params.aspect_ratio || '16:9',
          title: params.title,
        });
        return { success: true, data: result };
      },
    },

    {
      name: 'pulse_create_hero_promo',
      description: 'End-to-end Hero Promo pipeline: takes a hero image URL + campaign brief, generates cinematic promo scenes, creates a storyboard, and optionally generates scene images. Returns storyboard ID.',
      parameters: {
        hero_image_url: { type: 'string', description: 'URL of the hero/product image', required: true },
        campaign_brief: { type: 'string', description: "Creative direction (e.g. 'Luxury perfume ad in a Parisian penthouse at dusk')", required: true },
        title: { type: 'string', description: 'Storyboard title (auto-generated if omitted)' },
        tone: { type: 'string', description: 'Visual tone: luxury | bold | playful | cinematic | minimal (default cinematic)' },
        preservation_mode: { type: 'string', description: 'inpainting | preserve-likeness | creative-freedom (default preserve-likeness)' },
        aspect_ratio: { type: 'string', description: '16:9 | 9:16 | 1:1 (default 16:9)' },
        generate_images: { type: 'boolean', description: 'Whether to also generate scene images immediately (default false)' },
      },
      async execute(params, ctx): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const result = await pulse.callAndParse('create_hero_promo', {
          hero_image_url: params.hero_image_url,
          campaign_brief: params.campaign_brief,
          title: params.title,
          tone: params.tone,
          preservation_mode: params.preservation_mode,
          aspect_ratio: params.aspect_ratio,
          generate_images: params.generate_images,
        });
        await memory.appendActivity({ agentRole: ctx.agentRole, action: 'content', product: 'pulse', summary: `Created hero promo storyboard: ${(params.campaign_brief as string).slice(0, 60)}`, createdAt: new Date().toISOString() });
        return { success: true, data: result };
      },
    },

    {
      name: 'pulse_create_multi_angle',
      description: 'Create a multi-angle storyboard from a single reference image. Generates diverse camera angles and framings of the same subject. Returns storyboard ID.',
      parameters: {
        image_url: { type: 'string', description: 'URL of the reference/subject image', required: true },
        title: { type: 'string', description: 'Storyboard title (auto-generated if omitted)' },
        tone: { type: 'string', description: 'Visual tone: luxury | bold | playful | cinematic | minimal (default cinematic)' },
        preservation_mode: { type: 'string', description: 'inpainting | preserve-likeness | creative-freedom (default preserve-likeness)' },
        aspect_ratio: { type: 'string', description: '16:9 | 9:16 | 1:1 (default 16:9)' },
        generate_images: { type: 'boolean', description: 'Whether to also generate scene images immediately (default false)' },
      },
      async execute(params, ctx): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const result = await pulse.callAndParse('create_multi_angle', {
          image_url: params.image_url,
          title: params.title,
          tone: params.tone,
          preservation_mode: params.preservation_mode,
          aspect_ratio: params.aspect_ratio,
          generate_images: params.generate_images,
        });
        await memory.appendActivity({ agentRole: ctx.agentRole, action: 'content', product: 'pulse', summary: `Created multi-angle storyboard from image`, createdAt: new Date().toISOString() });
        return { success: true, data: result };
      },
    },

    {
      name: 'pulse_create_product_showcase',
      description: 'Create a product showcase storyboard from product image + brand brief. Optimized for e-commerce with progressive storytelling beats (Hook → Approach → Interaction → Immersion → CTA). Defaults to 9:16 for social and luxury tone.',
      parameters: {
        product_image_url: { type: 'string', description: 'URL of the primary product image', required: true },
        brand_brief: { type: 'string', description: 'Product description, USPs, or brand story', required: true },
        title: { type: 'string', description: 'Storyboard title' },
        tone: { type: 'string', description: 'Visual tone: luxury | bold | playful | cinematic | minimal (default luxury)' },
        aspect_ratio: { type: 'string', description: '16:9 | 9:16 | 1:1 (default 9:16 for social)' },
        generate_images: { type: 'boolean', description: 'Whether to also generate scene images immediately (default false)' },
      },
      async execute(params, ctx): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const result = await pulse.callAndParse('create_product_showcase', {
          product_image_url: params.product_image_url,
          brand_brief: params.brand_brief,
          title: params.title,
          tone: params.tone,
          aspect_ratio: params.aspect_ratio,
          generate_images: params.generate_images,
        });
        await memory.appendActivity({ agentRole: ctx.agentRole, action: 'content', product: 'pulse', summary: `Created product showcase: ${(params.brand_brief as string).slice(0, 60)}`, createdAt: new Date().toISOString() });
        return { success: true, data: result };
      },
    },

    {
      name: 'pulse_create_narrative_storyboard',
      description: 'Create a narrative animation storyboard from a script or idea. Generates a screenplay, parses it into scenes, creates the storyboard. Best for story-driven content, explainers, and character-led narratives.',
      parameters: {
        script_or_idea: { type: 'string', description: 'Full screenplay text or a raw creative idea/brief', required: true },
        title: { type: 'string', description: 'Storyboard title' },
        aspect_ratio: { type: 'string', description: '16:9 | 9:16 | 1:1 (default 16:9)' },
        reference_image_url: { type: 'string', description: 'Optional reference image URL for character/subject anchoring' },
        generate_images: { type: 'boolean', description: 'Whether to also generate scene images immediately (default false)' },
      },
      async execute(params, ctx): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const result = await pulse.callAndParse('create_narrative_storyboard', {
          script_or_idea: params.script_or_idea,
          title: params.title,
          aspect_ratio: params.aspect_ratio,
          reference_image_url: params.reference_image_url,
          generate_images: params.generate_images,
        });
        await memory.appendActivity({ agentRole: ctx.agentRole, action: 'content', product: 'pulse', summary: `Created narrative storyboard: ${(params.script_or_idea as string).slice(0, 60)}`, createdAt: new Date().toISOString() });
        return { success: true, data: result };
      },
    },

    {
      name: 'pulse_create_ad_storyboard',
      description: 'Create an ad storyboard optimized for paid media (Instagram, TikTok, YouTube pre-roll). Takes a product image, target platform, ad objective, and CTA. Generates platform-optimized scenes with proper aspect ratios and attention-grabbing hooks.',
      parameters: {
        product_image_url: { type: 'string', description: 'URL of the product/hero image', required: true },
        platform: { type: 'string', description: 'Target ad platform: instagram | tiktok | youtube | facebook | linkedin (default instagram)', required: true },
        ad_objective: { type: 'string', description: 'Ad goal: awareness | consideration | conversion (default awareness)' },
        cta_text: { type: 'string', description: 'Call-to-action text (e.g. "Shop Now", "Learn More")' },
        brand_brief: { type: 'string', description: 'Product/brand description and USPs', required: true },
        title: { type: 'string', description: 'Storyboard title' },
        tone: { type: 'string', description: 'Visual tone: luxury | bold | playful | cinematic | minimal (default bold)' },
        generate_images: { type: 'boolean', description: 'Whether to also generate scene images immediately (default false)' },
      },
      async execute(params, ctx): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        // Map platform to optimal aspect ratio
        const platformRatios: Record<string, string> = { instagram: '1:1', tiktok: '9:16', youtube: '16:9', facebook: '1:1', linkedin: '16:9' };
        const platform = (params.platform as string) || 'instagram';
        const aspectRatio = platformRatios[platform] || '1:1';
        const result = await pulse.callAndParse('create_ad_storyboard', {
          product_image_url: params.product_image_url,
          platform,
          ad_objective: params.ad_objective || 'awareness',
          cta_text: params.cta_text,
          brand_brief: params.brand_brief,
          title: params.title,
          tone: params.tone || 'bold',
          aspect_ratio: aspectRatio,
          generate_images: params.generate_images,
        });
        await memory.appendActivity({ agentRole: ctx.agentRole, action: 'content', product: 'pulse', summary: `Created ${platform} ad storyboard: ${(params.brand_brief as string).slice(0, 50)}`, createdAt: new Date().toISOString() });
        return { success: true, data: result };
      },
    },

    {
      name: 'pulse_generate_voiceover_script',
      description: 'Generate a professional voiceover narration script for a set of storyboard scenes.',
      parameters: {
        storyboard_id: { type: 'string', description: 'Storyboard ID to generate voiceover script for', required: true },
      },
      async execute(params): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const script = await pulse.callAndGetText('generate_voiceover_script', { storyboard_id: params.storyboard_id });
        return { success: true, data: { script } };
      },
    },

    // ── Video Generation & Management ──

    {
      name: 'pulse_generate_video',
      description: 'Generate a single video clip from a prompt and optional source image. Supports Veo 3.1, Veo 3.0, Kling 2.1. Include the video URL in your reply so the user can see it.',
      parameters: {
        prompt: { type: 'string', description: 'Video prompt describing the desired content', required: true },
        model: { type: 'string', description: 'Video model', enum: ['veo-3.1', 'veo-3.0', 'kling-2.1'] },
        aspect_ratio: { type: 'string', description: 'Aspect ratio', enum: ['16:9', '9:16', '1:1'] },
        source_image_url: { type: 'string', description: 'Image URL for image-to-video generation' },
      },
      async execute(params, ctx): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const video = await pulse.generateVideo({
          prompt: params.prompt as string,
          model: params.model as 'veo-3.1' | 'veo-3.0' | 'kling-2.1',
          aspect_ratio: params.aspect_ratio as '16:9' | '9:16' | '1:1',
          source_image_url: params.source_image_url as string,
        });
        await memory.appendActivity({ agentRole: ctx.agentRole, action: 'content', product: 'pulse', summary: `Generated video via Pulse: ${(params.prompt as string).slice(0, 80)}`, createdAt: new Date().toISOString() });
        return { success: true, data: { videoId: video.id, status: video.status, url: video.url, display_hint: video.url ? `[Watch video](${video.url})` : undefined } };
      },
    },

    {
      name: 'pulse_poll_video_status',
      description: 'Check the generation status of a video. Returns status, progress %, and video URL when complete.',
      parameters: {
        video_id: { type: 'string', description: 'Video ID to check', required: true },
      },
      async execute(params): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const status = await pulse.pollVideoStatus({ video_id: params.video_id as string });
        return { success: true, data: status };
      },
    },

    {
      name: 'pulse_list_videos',
      description: 'List generated videos with status and URLs. Filterable by status.',
      parameters: {
        limit: { type: 'number', description: 'Max results (default 20)' },
        status: { type: 'string', description: 'Filter by status', enum: ['pending', 'processing', 'completed', 'failed'] },
      },
      async execute(params): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const videos = await pulse.listVideos({ limit: params.limit as number, status: params.status as 'pending' | 'processing' | 'completed' | 'failed' });
        return { success: true, data: videos };
      },
    },

    {
      name: 'pulse_delete_video',
      description: 'Delete a video and its associated storage files.',
      parameters: {
        video_id: { type: 'string', description: 'Video ID to delete', required: true },
      },
      async execute(params): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const result = await pulse.callAndParse('delete_video', { video_id: params.video_id });
        return { success: true, data: result };
      },
    },

    {
      name: 'pulse_remix_video',
      description: 'Create a remix/variation of an existing video with a new prompt.',
      parameters: {
        video_id: { type: 'string', description: 'Original video ID to remix', required: true },
        prompt: { type: 'string', description: 'New prompt for the remix variation', required: true },
      },
      async execute(params): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const result = await pulse.callAndParse('remix_video', { video_id: params.video_id, prompt: params.prompt });
        return { success: true, data: result };
      },
    },

    {
      name: 'pulse_batch_generate_videos',
      description: 'Batch-generate video clips for all scenes in a storyboard. Each scene becomes a video clip using the scene image as the source frame. Returns an array of video IDs with statuses. Poll individual videos with pulse_poll_video_status.',
      parameters: {
        storyboard_id: { type: 'string', description: 'Storyboard ID to generate videos for', required: true },
        model: { type: 'string', description: 'Video model: veo-3.1 | veo-3.0 | kling-2.1 (default veo-3.1)' },
        duration: { type: 'number', description: 'Clip duration in seconds (default 5)' },
        with_audio: { type: 'boolean', description: 'Whether to include generated audio/voiceover per scene (default false)' },
      },
      async execute(params, ctx): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const result = await pulse.callAndParse('batch_generate_videos', {
          storyboard_id: params.storyboard_id,
          model: params.model || 'veo-3.1',
          duration: params.duration || 5,
          with_audio: params.with_audio || false,
        });
        await memory.appendActivity({ agentRole: ctx.agentRole, action: 'content', product: 'pulse', summary: `Batch generated videos for storyboard ${params.storyboard_id}`, createdAt: new Date().toISOString() });
        return { success: true, data: result };
      },
    },

    // ── Prompt Enhancement ──

    {
      name: 'pulse_enhance_prompt',
      description: 'Enhance a rough description into a photorealistic, production-ready image prompt.',
      parameters: {
        prompt: { type: 'string', description: 'Rough prompt to enhance', required: true },
        medium: { type: 'string', description: 'Target medium: image or video', enum: ['image', 'video'] },
      },
      async execute(params): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const enhanced = await pulse.enhancePrompt({
          prompt: params.prompt as string,
          medium: params.medium as 'image' | 'video',
        });
        return { success: true, data: { enhancedPrompt: enhanced } };
      },
    },

    {
      name: 'pulse_enhance_video_prompt',
      description: 'Enhance a rough description into a cinematic, production-ready video prompt optimized for Veo/Kling.',
      parameters: {
        prompt: { type: 'string', description: 'Rough video prompt to enhance', required: true },
      },
      async execute(params): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const enhanced = await pulse.callAndGetText('enhance_video_prompt', { prompt: params.prompt });
        return { success: true, data: { enhancedPrompt: enhanced } };
      },
    },

    {
      name: 'pulse_polish_scene_prompt',
      description: 'Polish a scene description into a cinematic image/video prompt with lighting, texture, and camera details.',
      parameters: {
        prompt: { type: 'string', description: 'Scene description to polish', required: true },
      },
      async execute(params): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const polished = await pulse.callAndGetText('polish_scene_prompt', { prompt: params.prompt });
        return { success: true, data: { polishedPrompt: polished } };
      },
    },

    // ── Image Generation & Editing ──

    {
      name: 'pulse_generate_concept_image',
      description: 'Generate a standalone concept image using Imagen 4. Use for thumbnails, social media graphics, blog hero images, standalone visuals. Always use Pulse for visual content — we dogfood our own product. IMPORTANT: When you get the result, include the image in your reply using markdown: ![description](url) so the user can see it inline.',
      parameters: {
        prompt: { type: 'string', description: 'Detailed image prompt describing the desired visual', required: true },
        aspect_ratio: { type: 'string', description: 'Aspect ratio: 1:1 (social), 16:9 (blog/PH), 9:16 (stories), 4:3', enum: ['1:1', '16:9', '9:16', '4:3'] },
        style: { type: 'string', description: 'Visual style hint to include in the prompt' },
      },
      async execute(params, ctx): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const image = await pulse.generateConceptImage({
          prompt: params.prompt as string,
          aspect_ratio: params.aspect_ratio as '1:1' | '16:9' | '9:16' | '4:3',
          style: params.style as string,
        });
        await memory.appendActivity({ agentRole: ctx.agentRole, action: 'content', product: 'pulse', summary: `Generated concept image via Pulse: ${(params.prompt as string).slice(0, 80)}`, createdAt: new Date().toISOString() });
        return { success: true, data: { imageId: image.id, url: image.url, display_hint: `![${(params.prompt as string).slice(0, 60)}](${image.url})` } };
      },
    },

    {
      name: 'pulse_edit_image',
      description: 'Edit an image using AI with a text prompt. Supports inpainting with optional mask.',
      parameters: {
        image_url: { type: 'string', description: 'URL of the image to edit', required: true },
        prompt: { type: 'string', description: 'Text description of the desired edit', required: true },
        mask_url: { type: 'string', description: 'Optional mask image URL for inpainting (white = edit area)' },
      },
      async execute(params): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const result = await pulse.callAndParse('edit_image', { image_url: params.image_url, prompt: params.prompt, mask_url: params.mask_url });
        return { success: true, data: result };
      },
    },

    {
      name: 'pulse_upscale_image',
      description: 'Upscale an image to higher resolution using AI (2x or 4x).',
      parameters: {
        image_url: { type: 'string', description: 'URL of the image to upscale', required: true },
        scale: { type: 'number', description: 'Upscale factor: 2 or 4', enum: ['2', '4'] },
      },
      async execute(params): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const result = await pulse.callAndParse('upscale_image', { image_url: params.image_url, scale: params.scale });
        return { success: true, data: result };
      },
    },

    {
      name: 'pulse_expand_image',
      description: 'Expand/outpaint an image to a larger canvas using AI.',
      parameters: {
        image_url: { type: 'string', description: 'URL of the image to expand', required: true },
        prompt: { type: 'string', description: 'Description of what should fill the expanded area' },
        target_aspect_ratio: { type: 'string', description: 'Target aspect ratio for the expanded image', enum: ['1:1', '16:9', '9:16', '4:3'] },
      },
      async execute(params): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const result = await pulse.callAndParse('expand_image', { image_url: params.image_url, prompt: params.prompt, target_aspect_ratio: params.target_aspect_ratio });
        return { success: true, data: result };
      },
    },

    {
      name: 'pulse_remove_background',
      description: 'Remove the background from an image, returning a transparent PNG.',
      parameters: {
        image_url: { type: 'string', description: 'URL of the image to remove background from', required: true },
      },
      async execute(params): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const result = await pulse.callAndParse('remove_background', { image_url: params.image_url });
        return { success: true, data: result };
      },
    },

    {
      name: 'pulse_extract_image_text',
      description: 'Extract/detect text from an image using OCR.',
      parameters: {
        image_url: { type: 'string', description: 'URL of the image to extract text from', required: true },
      },
      async execute(params): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const result = await pulse.callAndParse('extract_image_text', { image_url: params.image_url });
        return { success: true, data: result };
      },
    },

    {
      name: 'pulse_replace_image_text',
      description: 'Replace text in an image with new text using AI.',
      parameters: {
        image_url: { type: 'string', description: 'URL of the image to edit', required: true },
        old_text: { type: 'string', description: 'Text to find and replace', required: true },
        new_text: { type: 'string', description: 'Replacement text', required: true },
      },
      async execute(params): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const result = await pulse.callAndParse('replace_image_text', { image_url: params.image_url, old_text: params.old_text, new_text: params.new_text });
        return { success: true, data: result };
      },
    },

    {
      name: 'pulse_transform_viral_image',
      description: 'Transform an image using a viral trend/style filter with AI.',
      parameters: {
        image_url: { type: 'string', description: 'URL of the image to transform', required: true },
        style: { type: 'string', description: 'Viral trend/style to apply', required: true },
      },
      async execute(params): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const result = await pulse.callAndParse('transform_viral_image', { image_url: params.image_url, style: params.style });
        return { success: true, data: result };
      },
    },

    {
      name: 'pulse_product_recontext',
      description: 'Place a product image into a new context/background scene using AI.',
      parameters: {
        product_image_url: { type: 'string', description: 'URL of the product image', required: true },
        context_prompt: { type: 'string', description: 'Description of the new context/background scene', required: true },
      },
      async execute(params): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const result = await pulse.callAndParse('product_recontext', { product_image_url: params.product_image_url, context_prompt: params.context_prompt });
        return { success: true, data: result };
      },
    },

    {
      name: 'pulse_doodle_to_image',
      description: 'Convert a doodle/sketch into a polished image using AI.',
      parameters: {
        image_url: { type: 'string', description: 'URL of the doodle/sketch image', required: true },
        prompt: { type: 'string', description: 'Description of the desired polished output', required: true },
      },
      async execute(params): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const result = await pulse.callAndParse('doodle_to_image', { image_url: params.image_url, prompt: params.prompt });
        return { success: true, data: result };
      },
    },

    {
      name: 'pulse_upload_source_image',
      description: 'Upload an image from a URL to Pulse storage for use in generation workflows.',
      parameters: {
        url: { type: 'string', description: 'URL of the image to upload', required: true },
      },
      async execute(params): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const result = await pulse.callAndParse('upload_source_image', { url: params.url });
        return { success: true, data: result };
      },
    },

    // ── Audio & Sound ──

    {
      name: 'pulse_text_to_speech',
      description: 'Generate speech audio from text using ElevenLabs TTS. Multiple voice options available.',
      parameters: {
        text: { type: 'string', description: 'Text to convert to speech', required: true },
        voice: { type: 'string', description: 'Voice to use for TTS' },
      },
      async execute(params): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const result = await pulse.callAndParse('text_to_speech', { text: params.text, voice: params.voice });
        return { success: true, data: result };
      },
    },

    {
      name: 'pulse_generate_sound_effect',
      description: 'Generate a sound effect from a text description (max 22 seconds).',
      parameters: {
        prompt: { type: 'string', description: 'Text description of the desired sound effect', required: true },
        duration: { type: 'number', description: 'Duration in seconds (max 22)' },
      },
      async execute(params): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const result = await pulse.callAndParse('generate_sound_effect', { prompt: params.prompt, duration: params.duration });
        return { success: true, data: result };
      },
    },

    {
      name: 'pulse_generate_music',
      description: 'Generate background music from a text description (genre, mood, tempo).',
      parameters: {
        prompt: { type: 'string', description: 'Description of the desired music (genre, mood, tempo)', required: true },
        duration: { type: 'number', description: 'Duration in seconds' },
      },
      async execute(params): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const result = await pulse.callAndParse('generate_music', { prompt: params.prompt, duration: params.duration });
        return { success: true, data: result };
      },
    },

    // ── Avatar & Lip-Sync ──

    {
      name: 'pulse_generate_avatar',
      description: 'Generate an AI avatar video from a portrait image using Kling.',
      parameters: {
        portrait_image_url: { type: 'string', description: 'URL of the portrait image', required: true },
        prompt: { type: 'string', description: 'Instructions for the avatar animation' },
      },
      async execute(params): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const result = await pulse.callAndParse('generate_avatar', { portrait_image_url: params.portrait_image_url, prompt: params.prompt });
        return { success: true, data: result };
      },
    },

    {
      name: 'pulse_poll_avatar_status',
      description: 'Check the status of a Kling avatar generation task.',
      parameters: {
        task_id: { type: 'string', description: 'Avatar task ID to check', required: true },
      },
      async execute(params): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const result = await pulse.callAndParse('poll_avatar_status', { task_id: params.task_id });
        return { success: true, data: result };
      },
    },

    {
      name: 'pulse_generate_lipsync',
      description: 'Generate lip-synced video from a video and audio file using Kling.',
      parameters: {
        video_url: { type: 'string', description: 'URL of the video', required: true },
        audio_url: { type: 'string', description: 'URL of the audio file', required: true },
      },
      async execute(params): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const result = await pulse.callAndParse('generate_lipsync', { video_url: params.video_url, audio_url: params.audio_url });
        return { success: true, data: result };
      },
    },

    {
      name: 'pulse_poll_lipsync_status',
      description: 'Check the status of a Kling lip-sync generation task.',
      parameters: {
        task_id: { type: 'string', description: 'Lip-sync task ID to check', required: true },
      },
      async execute(params): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const result = await pulse.callAndParse('poll_lipsync_status', { task_id: params.task_id });
        return { success: true, data: result };
      },
    },

    {
      name: 'pulse_kling_multi_shot',
      description: 'Generate multiple angle images from a single product/subject image using Kling AI Multi-Shot API. Submits the request, polls until completion, extracts all 3 generated angle images, and re-uploads them to R2 for persistent storage. Returns persistent R2 URLs for each angle. Include the images in your reply using markdown ![angle](url).',
      parameters: {
        image_url: { type: 'string', description: 'URL of the source product/subject image', required: true },
        prompt: { type: 'string', description: 'Description of the subject and desired angles/variations' },
      },
      async execute(params, ctx): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const result = await pulse.callAndParse('kling_multi_shot', { image_url: params.image_url, prompt: params.prompt });
        await memory.appendActivity({ agentRole: ctx.agentRole, action: 'content', product: 'pulse', summary: `Generated multi-shot angles via Kling Multi-Shot`, createdAt: new Date().toISOString() });
        return { success: true, data: result };
      },
    },

    {
      name: 'pulse_poll_multi_shot',
      description: 'Poll the status of a Kling Multi-Shot task. When complete, extracts all generated angle images and uploads them to R2 for persistent storage. Returns task status and persistent R2 URLs when finished. Include the images in your reply using markdown ![angle](url).',
      parameters: {
        task_id: { type: 'string', description: 'The task ID returned from pulse_kling_multi_shot', required: true },
      },
      async execute(params): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const result = await pulse.callAndParse('poll_multi_shot', { task_id: params.task_id });
        return { success: true, data: result };
      },
    },

    // ── Analysis ──

    {
      name: 'pulse_analyze_brand_website',
      description: "Analyze a brand's website to extract visual identity, colors, typography, value propositions, and ad suggestions.",
      parameters: {
        url: { type: 'string', description: 'URL of the brand website to analyze', required: true },
      },
      async execute(params): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const result = await pulse.callAndParse('analyze_brand_website', { url: params.url });
        return { success: true, data: result };
      },
    },

    {
      name: 'pulse_analyze_image_for_video',
      description: 'Analyze an image and generate optimized video generation prompts based on its content.',
      parameters: {
        image_url: { type: 'string', description: 'URL of the image to analyze', required: true },
      },
      async execute(params): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const result = await pulse.callAndParse('analyze_image_for_video', { image_url: params.image_url });
        return { success: true, data: result };
      },
    },

    // ── Account & Data ──

    {
      name: 'pulse_check_subscription',
      description: 'Check the Pulse subscription status and available credits.',
      parameters: {},
      async execute(): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const result = await pulse.callAndParse('check_subscription', {});
        return { success: true, data: result };
      },
    },

    {
      name: 'pulse_list_concept_images',
      description: 'List previously generated concept images.',
      parameters: {
        limit: { type: 'number', description: 'Max results (default 20)' },
        offset: { type: 'number', description: 'Pagination offset' },
      },
      async execute(params): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const result = await pulse.callAndParse('list_concept_images', { limit: params.limit, offset: params.offset });
        return { success: true, data: result };
      },
    },

    {
      name: 'pulse_list_brand_kits',
      description: 'List saved brand kits with colors, fonts, and logos.',
      parameters: {
        limit: { type: 'number', description: 'Max results (default 20)' },
        offset: { type: 'number', description: 'Pagination offset' },
      },
      async execute(params): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const result = await pulse.callAndParse('list_brand_kits', { limit: params.limit, offset: params.offset });
        return { success: true, data: result };
      },
    },

    {
      name: 'pulse_create_share_link',
      description: 'Create a shareable link for a video or image asset.',
      parameters: {
        asset_id: { type: 'string', description: 'ID of the asset to share', required: true },
        asset_type: { type: 'string', description: 'Type of asset', required: true, enum: ['video', 'image', 'storyboard'] },
      },
      async execute(params): Promise<ToolResult> {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: PULSE_UNAVAILABLE_MSG };
        const result = await pulse.callAndParse('create_share_link', { asset_id: params.asset_id, asset_type: params.asset_type });
        return { success: true, data: result };
      },
    },
  ]);
}
