/**
 * Pulse Creative Studio Integration
 *
 * API client for Glyphor Pulse (pulse.glyphor.ai) — image generation,
 * video generation, brand analysis, and storyboard creation.
 *
 * Backend: Supabase Edge Functions (Deno/TS)
 * Project ID: iyabxcmsncmbtbbdngid
 *
 * Used by: Maya (CMO), Tyler (Content Creator), Kai (Social Media Manager)
 */

export interface PulseConfig {
  supabaseUrl: string;     // https://iyabxcmsncmbtbbdngid.supabase.co
  serviceRoleKey: string;  // Pulse project service role key
}

export interface ImageGenerationParams {
  prompt: string;
  model?: 'imagen-4' | 'gemini';
  aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3';
  style?: string;           // e.g., "photorealistic", "illustration", "minimalist"
  brandKit?: string;         // Brand kit ID for on-brand generation
  count?: number;            // Number of variants (1-4)
}

export interface VideoGenerationParams {
  prompt: string;
  model?: 'kling' | 'veo' | 'sora' | 'runway';
  duration?: number;         // seconds (5, 10, 15)
  aspectRatio?: '16:9' | '9:16' | '1:1';
  sourceImageUrl?: string;   // For image-to-video
}

export interface BrandAnalysisParams {
  url?: string;              // Website URL to analyze
  logoUrl?: string;          // Logo image URL
}

export interface StoryboardParams {
  title: string;
  scenes: { description: string; duration?: number }[];
  brandKit?: string;
  generateVideo?: boolean;
}

export interface PulseAsset {
  id: string;
  url: string;
  type: 'image' | 'video' | 'brand_kit' | 'storyboard';
  model?: string;
  prompt?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface BrandKit {
  id: string;
  name: string;
  colors: { primary: string; secondary: string; accent: string; background: string };
  fonts: { heading: string; body: string };
  logoUrl?: string;
  voiceTone?: string;
}

export class PulseClient {
  private readonly supabaseUrl: string;
  private readonly serviceRoleKey: string;

  constructor(config: PulseConfig) {
    this.supabaseUrl = config.supabaseUrl.replace(/\/$/, '');
    this.serviceRoleKey = config.serviceRoleKey;
  }

  static fromEnv(): PulseClient {
    const supabaseUrl = process.env.PULSE_SUPABASE_URL ?? 'https://iyabxcmsncmbtbbdngid.supabase.co';
    const serviceRoleKey = process.env.PULSE_SERVICE_ROLE_KEY;
    if (!serviceRoleKey) throw new Error('PULSE_SERVICE_ROLE_KEY not configured');
    return new PulseClient({ supabaseUrl, serviceRoleKey });
  }

  private async callEdgeFunction<T>(functionName: string, body: Record<string, unknown>): Promise<T> {
    const url = `${this.supabaseUrl}/functions/v1/${functionName}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.serviceRoleKey}`,
        'apikey': this.serviceRoleKey,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Pulse ${functionName} ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  /** Generate images using Pulse's AI image pipeline */
  async generateImage(params: ImageGenerationParams): Promise<PulseAsset> {
    return this.callEdgeFunction<PulseAsset>('generate-image', {
      prompt: params.prompt,
      model: params.model ?? 'imagen-4',
      aspect_ratio: params.aspectRatio ?? '1:1',
      style: params.style,
      brand_kit_id: params.brandKit,
      count: params.count ?? 1,
      source: 'agent-platform',
    });
  }

  /** Generate video using Pulse's video pipeline */
  async generateVideo(params: VideoGenerationParams): Promise<PulseAsset> {
    return this.callEdgeFunction<PulseAsset>('generate-video', {
      prompt: params.prompt,
      model: params.model ?? 'kling',
      duration: params.duration ?? 5,
      aspect_ratio: params.aspectRatio ?? '16:9',
      source_image_url: params.sourceImageUrl,
      source: 'agent-platform',
    });
  }

  /** Analyze a brand from URL/logo and extract brand kit */
  async analyzeBrand(params: BrandAnalysisParams): Promise<BrandKit> {
    return this.callEdgeFunction<BrandKit>('analyze-brand', {
      url: params.url,
      logo_url: params.logoUrl,
      source: 'agent-platform',
    });
  }

  /** Create a multi-scene storyboard */
  async createStoryboard(params: StoryboardParams): Promise<PulseAsset> {
    return this.callEdgeFunction<PulseAsset>('create-storyboard', {
      title: params.title,
      scenes: params.scenes,
      brand_kit_id: params.brandKit,
      generate_video: params.generateVideo ?? false,
      source: 'agent-platform',
    });
  }

  /** Get the Glyphor brand kit for on-brand content generation */
  async getGlyphorBrandKit(): Promise<BrandKit> {
    return this.callEdgeFunction<BrandKit>('get-brand-kit', {
      brand_name: 'glyphor',
      source: 'agent-platform',
    });
  }

  /** List recently generated assets by the agent platform */
  async listAgentAssets(options?: { type?: string; limit?: number }): Promise<PulseAsset[]> {
    return this.callEdgeFunction<PulseAsset[]>('list-assets', {
      source: 'agent-platform',
      type: options?.type,
      limit: options?.limit ?? 20,
    });
  }

  /** Check generation status for async jobs (video generation) */
  async checkJobStatus(jobId: string): Promise<{ status: 'pending' | 'processing' | 'completed' | 'failed'; asset?: PulseAsset }> {
    return this.callEdgeFunction('check-job-status', { job_id: jobId });
  }
}
