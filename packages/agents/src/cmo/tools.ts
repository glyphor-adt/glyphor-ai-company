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

    // ── Pulse Creative Studio tools ──

    {
      name: 'pulse_generate_image',
      description: 'Generate a marketing image using Pulse (our own product). Use for blog hero images, social graphics, Product Hunt screenshots, ad creatives. Always use Pulse for visual content — we dogfood our own product.',
      parameters: {
        prompt: { type: 'string', description: 'Detailed image prompt describing the desired visual', required: true },
        aspect_ratio: { type: 'string', description: 'Aspect ratio: 1:1 (social), 16:9 (blog/PH), 9:16 (stories)', enum: ['1:1', '16:9', '9:16', '4:3'] },
        style: { type: 'string', description: 'Visual style: photorealistic, illustration, minimalist, abstract, branded' },
        use_brand_kit: { type: 'boolean', description: 'Whether to apply Glyphor brand kit (colors, fonts)' },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: 'Pulse not configured (PULSE_SERVICE_ROLE_KEY missing)' };
        const brandKit = params.use_brand_kit ? 'glyphor' : undefined;
        const asset = await pulse.generateImage({
          prompt: params.prompt as string,
          aspectRatio: params.aspect_ratio as '1:1' | '16:9' | '9:16' | '4:3',
          style: params.style as string,
          brandKit,
        });
        await memory.appendActivity({ agentRole: ctx.agentRole, action: 'content', product: 'pulse', summary: `Generated image via Pulse: ${(params.prompt as string).slice(0, 80)}`, createdAt: new Date().toISOString() });
        return { success: true, data: { assetId: asset.id, url: asset.url, type: 'image' } };
      },
    },

    {
      name: 'pulse_generate_video',
      description: 'Generate a marketing video using Pulse. Use for product demos, social video content, Product Hunt demo video, explainer clips.',
      parameters: {
        prompt: { type: 'string', description: 'Video prompt describing the desired content', required: true },
        model: { type: 'string', description: 'Video model', enum: ['kling', 'veo', 'sora', 'runway'] },
        duration: { type: 'number', description: 'Duration in seconds (5, 10, 15)' },
        aspect_ratio: { type: 'string', description: 'Aspect ratio', enum: ['16:9', '9:16', '1:1'] },
        source_image_url: { type: 'string', description: 'Image URL for image-to-video generation' },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: 'Pulse not configured (PULSE_SERVICE_ROLE_KEY missing)' };
        const asset = await pulse.generateVideo({
          prompt: params.prompt as string,
          model: params.model as 'kling' | 'veo' | 'sora' | 'runway',
          duration: params.duration as number,
          aspectRatio: params.aspect_ratio as '16:9' | '9:16' | '1:1',
          sourceImageUrl: params.source_image_url as string,
        });
        await memory.appendActivity({ agentRole: ctx.agentRole, action: 'content', product: 'pulse', summary: `Generated video via Pulse: ${(params.prompt as string).slice(0, 80)}`, createdAt: new Date().toISOString() });
        return { success: true, data: { assetId: asset.id, url: asset.url, type: 'video', model: asset.model } };
      },
    },

    {
      name: 'pulse_create_storyboard',
      description: 'Create a multi-scene storyboard in Pulse. Use for Product Hunt demo, product walkthroughs, social ad sequences.',
      parameters: {
        title: { type: 'string', description: 'Storyboard title', required: true },
        scenes: { type: 'array', description: 'Array of scene descriptions', required: true, items: { type: 'object', description: 'A scene entry', properties: { description: { type: 'string', description: 'Scene description' }, duration: { type: 'number', description: 'Scene duration in seconds' } } } },
        generate_video: { type: 'boolean', description: 'Auto-generate video from storyboard' },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: 'Pulse not configured (PULSE_SERVICE_ROLE_KEY missing)' };
        const asset = await pulse.createStoryboard({
          title: params.title as string,
          scenes: params.scenes as { description: string; duration?: number }[],
          brandKit: 'glyphor',
          generateVideo: params.generate_video as boolean,
        });
        await memory.appendActivity({ agentRole: ctx.agentRole, action: 'content', product: 'pulse', summary: `Created storyboard via Pulse: ${params.title}`, createdAt: new Date().toISOString() });
        return { success: true, data: { assetId: asset.id, url: asset.url, type: 'storyboard' } };
      },
    },

    {
      name: 'pulse_analyze_brand',
      description: 'Analyze a brand or competitor using Pulse brand analysis. Extracts colors, fonts, voice from a URL or logo.',
      parameters: {
        url: { type: 'string', description: 'Website URL to analyze' },
        logo_url: { type: 'string', description: 'Logo image URL to analyze' },
      },
      execute: async (params): Promise<ToolResult> => {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: 'Pulse not configured (PULSE_SERVICE_ROLE_KEY missing)' };
        const kit = await pulse.analyzeBrand({ url: params.url as string, logoUrl: params.logo_url as string });
        return { success: true, data: kit };
      },
    },
  ];
}
