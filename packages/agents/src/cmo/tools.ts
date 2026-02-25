/**
 * CMO — Tool Definitions
 *
 * Tools for: content generation, social media planning,
 * SEO analysis, and brand content management.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';
import { PulseClient } from '@glyphor/integrations';

function getPulseClient(): PulseClient | null {
  try { return PulseClient.fromEnv(); } catch { return null; }
}

export function createCMOTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return [
    {
      name: 'get_product_metrics',
      description: 'Get current product metrics to inform content with real data points.',
      parameters: {
        product: {
          type: 'string',
          description: 'Product slug',
          required: true,
          enum: ['fuse', 'pulse'],
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const metrics = await memory.getProductMetrics(params.product as 'fuse' | 'pulse');
        return { success: true, data: metrics };
      },
    },

    {
      name: 'get_recent_activity',
      description: 'Get recent company activity to find content-worthy events.',
      parameters: {
        hours: {
          type: 'number',
          description: 'Number of hours to look back (default: 168 for a week)',
          required: false,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const hours = (params.hours as number) || 168;
        const activity = await memory.getRecentActivity(hours);
        return { success: true, data: activity };
      },
    },

    {
      name: 'read_company_memory',
      description: 'Read from company memory for brand guidelines, prior content, etc.',
      parameters: {
        key: {
          type: 'string',
          description: 'Memory key (e.g., "brand.voice", "content.calendar", "marketing.strategy")',
          required: true,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const value = await memory.read(params.key as string);
        return { success: true, data: value };
      },
    },

    {
      name: 'write_content',
      description: 'Write generated content (blog posts, social posts, case studies) to GCS.',
      parameters: {
        content_type: {
          type: 'string',
          description: 'Type of content',
          required: true,
          enum: ['blog_post', 'social_post', 'case_study', 'content_calendar', 'seo_report'],
        },
        title: {
          type: 'string',
          description: 'Content title or identifier',
          required: true,
        },
        content_markdown: {
          type: 'string',
          description: 'The content in markdown format',
          required: true,
        },
        platform: {
          type: 'string',
          description: 'Target platform for social posts',
          required: false,
          enum: ['twitter', 'linkedin', 'product_hunt', 'blog'],
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const date = new Date().toISOString().split('T')[0];
        const contentType = params.content_type as string;
        const title = (params.title as string).replace(/[^a-z0-9-]/gi, '-').toLowerCase();
        await memory.writeDocument(
          `content/cmo/${contentType}/${date}-${title}.md`,
          params.content_markdown as string,
        );
        await memory.write(
          `content.${contentType}.latest`,
          { date, title: params.title, type: contentType, platform: params.platform },
          ctx.agentId,
        );
        return { success: true, data: { archived: true, path: `content/cmo/${contentType}/${date}-${title}.md` }, memoryKeysWritten: 1 };
      },
    },

    {
      name: 'write_company_memory',
      description: 'Write a value to company shared memory (e.g., update content calendar).',
      parameters: {
        key: {
          type: 'string',
          description: 'Memory key to write',
          required: true,
        },
        value: {
          type: 'object',
          description: 'Value to store',
          required: true,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        await memory.write(params.key as string, params.value, ctx.agentId);
        return { success: true, memoryKeysWritten: 1 };
      },
    },

    {
      name: 'log_activity',
      description: 'Log an activity to the company activity feed.',
      parameters: {
        action: {
          type: 'string',
          description: 'Action type',
          required: true,
          enum: ['content', 'analysis'],
        },
        summary: {
          type: 'string',
          description: 'Short summary',
          required: true,
        },
        product: {
          type: 'string',
          description: 'Related product',
          required: false,
          enum: ['fuse', 'pulse', 'company'],
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        await memory.appendActivity({
          agentRole: ctx.agentRole,
          action: params.action as 'content' | 'analysis',
          product: (params.product as 'fuse' | 'pulse' | 'company') ?? 'company',
          summary: params.summary as string,
          createdAt: new Date().toISOString(),
        });
        return { success: true, memoryKeysWritten: 1 };
      },
    },

    {
      name: 'create_decision',
      description: 'Create a decision for founder approval (e.g., content strategy shifts, brand changes).',
      parameters: {
        tier: {
          type: 'string',
          description: 'Decision tier',
          required: true,
          enum: ['yellow', 'red'],
        },
        title: {
          type: 'string',
          description: 'Short decision title',
          required: true,
        },
        summary: {
          type: 'string',
          description: 'Context and recommendation',
          required: true,
        },
        reasoning: {
          type: 'string',
          description: 'Justification',
          required: true,
        },
        assigned_to: {
          type: 'array',
          description: 'Founders to assign',
          required: true,
          items: { type: 'string', description: 'Founder name' },
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const id = await memory.createDecision({
          tier: params.tier as 'yellow' | 'red',
          status: 'pending',
          title: params.title as string,
          summary: params.summary as string,
          proposedBy: ctx.agentRole,
          reasoning: params.reasoning as string,
          assignedTo: params.assigned_to as string[],
        });
        return { success: true, data: { decisionId: id }, memoryKeysWritten: 1 };
      },
    },

    // ── Pulse Creative Studio tools (MCP) ──

    {
      name: 'pulse_generate_concept_image',
      description: 'Generate a standalone image using Pulse (our own product). Use for blog hero images, social graphics, Product Hunt screenshots, ad creatives, thumbnails. Always use Pulse for visual content — we dogfood our own product.',
      parameters: {
        prompt: { type: 'string', description: 'Detailed image prompt describing the desired visual', required: true },
        aspect_ratio: { type: 'string', description: 'Aspect ratio: 1:1 (social), 16:9 (blog/PH), 9:16 (stories), 4:3', enum: ['1:1', '16:9', '9:16', '4:3'] },
        style: { type: 'string', description: 'Visual style hint to include in the prompt' },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: 'Pulse not configured (PULSE_SERVICE_ROLE_KEY missing)' };
        const image = await pulse.generateConceptImage({
          prompt: params.prompt as string,
          aspect_ratio: params.aspect_ratio as '1:1' | '16:9' | '9:16' | '4:3',
          style: params.style as string,
        });
        await memory.appendActivity({ agentRole: ctx.agentRole, action: 'content', product: 'pulse', summary: `Generated concept image via Pulse: ${(params.prompt as string).slice(0, 80)}`, createdAt: new Date().toISOString() });
        return { success: true, data: { imageId: image.id, url: image.url } };
      },
    },

    {
      name: 'pulse_create_storyboard',
      description: 'Create a multi-scene storyboard in Pulse from a creative idea. Pulse generates a screenplay, parses scenes, and saves the storyboard. Use for Product Hunt demos, product walkthroughs, ad sequences.',
      parameters: {
        idea: { type: 'string', description: 'Creative idea or concept to turn into a storyboard', required: true },
        title: { type: 'string', description: 'Optional storyboard title' },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: 'Pulse not configured (PULSE_SERVICE_ROLE_KEY missing)' };
        const storyboard = await pulse.createStoryboardFromIdea({
          idea: params.idea as string,
          title: params.title as string,
        });
        await memory.appendActivity({ agentRole: ctx.agentRole, action: 'content', product: 'pulse', summary: `Created storyboard via Pulse: ${storyboard.title}`, createdAt: new Date().toISOString() });
        return { success: true, data: { storyboardId: storyboard.id, title: storyboard.title, sceneCount: storyboard.scenes.length } };
      },
    },

    {
      name: 'pulse_generate_video',
      description: 'Generate a video clip using Pulse. Use for product demos, social video content, explainer clips. Models: veo-3.1, kling.',
      parameters: {
        prompt: { type: 'string', description: 'Video prompt describing the desired content', required: true },
        model: { type: 'string', description: 'Video model', enum: ['veo-3.1', 'kling'] },
        aspect_ratio: { type: 'string', description: 'Aspect ratio', enum: ['16:9', '9:16', '1:1'] },
        source_image_url: { type: 'string', description: 'Image URL for image-to-video generation' },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: 'Pulse not configured (PULSE_SERVICE_ROLE_KEY missing)' };
        const video = await pulse.generateVideo({
          prompt: params.prompt as string,
          model: params.model as 'veo-3.1' | 'kling',
          aspect_ratio: params.aspect_ratio as '16:9' | '9:16' | '1:1',
          source_image_url: params.source_image_url as string,
        });
        await memory.appendActivity({ agentRole: ctx.agentRole, action: 'content', product: 'pulse', summary: `Generated video via Pulse: ${(params.prompt as string).slice(0, 80)}`, createdAt: new Date().toISOString() });
        return { success: true, data: { videoId: video.id, status: video.status, url: video.url } };
      },
    },

    {
      name: 'pulse_enhance_prompt',
      description: 'Enhance a rough prompt into a production-ready prompt using Pulse AI. Use before generating images or video for better results.',
      parameters: {
        prompt: { type: 'string', description: 'Rough prompt to enhance', required: true },
        medium: { type: 'string', description: 'Target medium: image or video', enum: ['image', 'video'] },
      },
      execute: async (params): Promise<ToolResult> => {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: 'Pulse not configured (PULSE_SERVICE_ROLE_KEY missing)' };
        const enhanced = await pulse.enhancePrompt({
          prompt: params.prompt as string,
          medium: params.medium as 'image' | 'video',
        });
        return { success: true, data: { enhancedPrompt: enhanced } };
      },
    },

    {
      name: 'pulse_list_storyboards',
      description: 'List existing Pulse storyboards to review previously created content.',
      parameters: {
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
      execute: async (params): Promise<ToolResult> => {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: 'Pulse not configured (PULSE_SERVICE_ROLE_KEY missing)' };
        const storyboards = await pulse.listStoryboards({ limit: params.limit as number });
        return { success: true, data: storyboards };
      },
    },

    {
      name: 'pulse_poll_video_status',
      description: 'Check the generation status of a Pulse video. Video generation is async — poll until completed.',
      parameters: {
        video_id: { type: 'string', description: 'Video ID to check', required: true },
      },
      execute: async (params): Promise<ToolResult> => {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: 'Pulse not configured (PULSE_SERVICE_ROLE_KEY missing)' };
        const status = await pulse.pollVideoStatus({ video_id: params.video_id as string });
        return { success: true, data: status };
      },
    },
  ];
}
