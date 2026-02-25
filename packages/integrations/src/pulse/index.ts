/**
 * Pulse Creative Studio — MCP Client
 *
 * Calls the Pulse MCP server (Model Context Protocol) at:
 *   https://iyabxcmsncmbtbbdngid.supabase.co/functions/v1/pulse-mcp
 *
 * Available MCP tools:
 *   create_storyboard_from_idea — Idea → screenplay → parsed scenes → saved storyboard
 *   generate_scene_images      — Batch Imagen 4 / Gemini 3 Pro image generation
 *   generate_video             — Single video clip via Veo 3.1 or Kling
 *   generate_concept_image     — Standalone image generation (thumbnails, social assets)
 *   enhance_prompt             — Rough description → production-ready prompt
 *   list_storyboards           — Browse storyboards
 *   get_storyboard             — Retrieve a storyboard by ID
 *   list_videos                — Browse generated videos
 *   poll_video_status          — Check video generation progress
 *
 * Used by: Maya (CMO), Tyler (Content Creator), Kai (Social Media Manager)
 */

export interface PulseConfig {
  mcpEndpoint: string;     // https://<project>.supabase.co/functions/v1/pulse-mcp
  serviceRoleKey: string;  // Pulse project service role key (Bearer token)
}

// ── MCP tool argument types ──

export interface CreateStoryboardArgs {
  idea: string;
  title?: string;
}

export interface GenerateSceneImagesArgs {
  storyboard_id: string;
  model?: 'imagen-4' | 'gemini-3-pro';
}

export interface GenerateVideoArgs {
  prompt: string;
  model?: 'veo-3.1' | 'kling';
  aspect_ratio?: '16:9' | '9:16' | '1:1';
  source_image_url?: string;
}

export interface GenerateConceptImageArgs {
  prompt: string;
  aspect_ratio?: '1:1' | '16:9' | '9:16' | '4:3';
  style?: string;
}

export interface EnhancePromptArgs {
  prompt: string;
  medium?: 'image' | 'video';
}

export interface ListStoryboardsArgs {
  limit?: number;
  offset?: number;
}

export interface GetStoryboardArgs {
  storyboard_id: string;
}

export interface ListVideosArgs {
  limit?: number;
  offset?: number;
}

export interface PollVideoStatusArgs {
  video_id: string;
}

// ── Response types ──

export interface McpToolResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

export interface Storyboard {
  id: string;
  title: string;
  scenes: { id: string; description: string; imageUrl?: string }[];
  createdAt: string;
}

export interface GeneratedImage {
  id: string;
  url: string;
  prompt: string;
  model?: string;
}

export interface GeneratedVideo {
  id: string;
  url?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  prompt: string;
  model?: string;
}

// Keep backward-compat alias used by barrel export
export type PulseAsset = GeneratedImage | GeneratedVideo | Storyboard;

let mcpRequestId = 0;

export class PulseClient {
  private readonly mcpEndpoint: string;
  private readonly serviceRoleKey: string;

  constructor(config: PulseConfig) {
    this.mcpEndpoint = config.mcpEndpoint.replace(/\/$/, '');
    this.serviceRoleKey = config.serviceRoleKey;
  }

  static fromEnv(): PulseClient {
    const supabaseUrl = (process.env.PULSE_SUPABASE_URL ?? 'https://iyabxcmsncmbtbbdngid.supabase.co').replace(/\/$/, '');
    const mcpEndpoint = `${supabaseUrl}/functions/v1/pulse-mcp`;
    const serviceRoleKey = process.env.PULSE_SERVICE_ROLE_KEY;
    if (!serviceRoleKey) throw new Error('PULSE_SERVICE_ROLE_KEY not configured');
    return new PulseClient({ mcpEndpoint, serviceRoleKey });
  }

  /** Send an MCP tools/call request to the Pulse server */
  private async callTool(toolName: string, args: Record<string, unknown>): Promise<McpToolResult> {
    const res = await fetch(this.mcpEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.serviceRoleKey}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++mcpRequestId,
        method: 'tools/call',
        params: { name: toolName, arguments: args },
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Pulse MCP ${toolName} ${res.status}: ${text}`);
    }
    const json = (await res.json()) as { result?: McpToolResult; error?: { message: string } };
    if (json.error) throw new Error(`Pulse MCP ${toolName}: ${json.error.message}`);
    return json.result!;
  }

  /** Parse the text content from an MCP tool result */
  private parseResult<T>(result: McpToolResult): T {
    const text = result.content.map((c) => c.text).join('');
    return JSON.parse(text) as T;
  }

  // ── High-level convenience methods ──

  /** Create a storyboard from an idea string */
  async createStoryboardFromIdea(args: CreateStoryboardArgs): Promise<Storyboard> {
    const result = await this.callTool('create_storyboard_from_idea', args as unknown as Record<string, unknown>);
    return this.parseResult<Storyboard>(result);
  }

  /** Generate images for all scenes in a storyboard */
  async generateSceneImages(args: GenerateSceneImagesArgs): Promise<GeneratedImage[]> {
    const result = await this.callTool('generate_scene_images', args as unknown as Record<string, unknown>);
    return this.parseResult<GeneratedImage[]>(result);
  }

  /** Generate a single video clip */
  async generateVideo(args: GenerateVideoArgs): Promise<GeneratedVideo> {
    const result = await this.callTool('generate_video', args as unknown as Record<string, unknown>);
    return this.parseResult<GeneratedVideo>(result);
  }

  /** Generate a standalone concept image (thumbnails, social assets, hero images) */
  async generateConceptImage(args: GenerateConceptImageArgs): Promise<GeneratedImage> {
    const result = await this.callTool('generate_concept_image', args as unknown as Record<string, unknown>);
    return this.parseResult<GeneratedImage>(result);
  }

  /** Enhance a rough prompt into a production-ready prompt */
  async enhancePrompt(args: EnhancePromptArgs): Promise<string> {
    const result = await this.callTool('enhance_prompt', args as unknown as Record<string, unknown>);
    return result.content.map((c) => c.text).join('');
  }

  /** List storyboards */
  async listStoryboards(args?: ListStoryboardsArgs): Promise<Storyboard[]> {
    const result = await this.callTool('list_storyboards', (args ?? {}) as Record<string, unknown>);
    return this.parseResult<Storyboard[]>(result);
  }

  /** Get a storyboard by ID */
  async getStoryboard(args: GetStoryboardArgs): Promise<Storyboard> {
    const result = await this.callTool('get_storyboard', args as unknown as Record<string, unknown>);
    return this.parseResult<Storyboard>(result);
  }

  /** List generated videos */
  async listVideos(args?: ListVideosArgs): Promise<GeneratedVideo[]> {
    const result = await this.callTool('list_videos', (args ?? {}) as Record<string, unknown>);
    return this.parseResult<GeneratedVideo[]>(result);
  }

  /** Poll video generation status */
  async pollVideoStatus(args: PollVideoStatusArgs): Promise<GeneratedVideo> {
    const result = await this.callTool('poll_video_status', args as unknown as Record<string, unknown>);
    return this.parseResult<GeneratedVideo>(result);
  }
}
