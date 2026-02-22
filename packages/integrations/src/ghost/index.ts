/**
 * Ghost CMS Integration — Content publishing and management
 *
 * Admin API key: Maya (publish, unpublish, manage tags)
 * Content API key: Tyler, Lisa (read only — drafts, published content)
 */

interface GhostConfig {
  url: string;              // e.g., https://blog.glyphor.com
  adminApiKey?: string;     // key-id:secret format
  contentApiKey?: string;
}

interface GhostPost {
  id: string;
  title: string;
  slug: string;
  html?: string;
  status: 'draft' | 'published' | 'scheduled';
  published_at?: string;
  created_at: string;
  updated_at: string;
  tags?: { name: string; slug: string }[];
  meta_title?: string;
  meta_description?: string;
}

interface GhostCreateParams {
  title: string;
  html: string;
  status?: 'draft' | 'published';
  tags?: string[];
  meta_title?: string;
  meta_description?: string;
}

export class GhostClient {
  private readonly url: string;
  private readonly adminApiKey?: string;
  private readonly contentApiKey?: string;

  constructor(config: GhostConfig) {
    this.url = config.url.replace(/\/$/, '');
    this.adminApiKey = config.adminApiKey;
    this.contentApiKey = config.contentApiKey;
  }

  static fromEnv(): GhostClient {
    return new GhostClient({
      url: process.env.GHOST_URL ?? 'https://blog.glyphor.com',
      adminApiKey: process.env.GHOST_ADMIN_API_KEY,
      contentApiKey: process.env.GHOST_CONTENT_API_KEY,
    });
  }

  private async generateAdminToken(): Promise<string> {
    if (!this.adminApiKey) throw new Error('Ghost Admin API key not configured');
    const [id, secret] = this.adminApiKey.split(':');
    // Ghost Admin API uses JWT with the key id and secret
    // In production, use jose or similar JWT library
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: id })).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(JSON.stringify({ iat: now, exp: now + 300, aud: '/admin/' })).toString('base64url');
    const { createHmac } = await import('node:crypto');
    const signature = createHmac('sha256', Buffer.from(secret, 'hex'))
      .update(`${header}.${payload}`)
      .digest('base64url');
    return `${header}.${payload}.${signature}`;
  }

  async listPosts(options?: { status?: string; limit?: number }): Promise<GhostPost[]> {
    const params = new URLSearchParams();
    if (options?.status) params.set('filter', `status:${options.status}`);
    params.set('limit', String(options?.limit ?? 15));

    if (this.contentApiKey) {
      params.set('key', this.contentApiKey);
      const res = await fetch(`${this.url}/ghost/api/content/posts/?${params}`);
      const data = await res.json() as { posts: GhostPost[] };
      return data.posts ?? [];
    }

    const token = await this.generateAdminToken();
    const res = await fetch(`${this.url}/ghost/api/admin/posts/?${params}`, {
      headers: { Authorization: `Ghost ${token}` },
    });
    const data = await res.json() as { posts: GhostPost[] };
    return data.posts ?? [];
  }

  async createDraft(post: GhostCreateParams): Promise<GhostPost> {
    const token = await this.generateAdminToken();
    const res = await fetch(`${this.url}/ghost/api/admin/posts/`, {
      method: 'POST',
      headers: {
        Authorization: `Ghost ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        posts: [{
          ...post,
          status: post.status ?? 'draft',
          tags: post.tags?.map((name) => ({ name })),
        }],
      }),
    });
    const data = await res.json() as { posts: GhostPost[] };
    return data.posts[0];
  }

  async publishPost(postId: string): Promise<GhostPost> {
    const token = await this.generateAdminToken();
    const res = await fetch(`${this.url}/ghost/api/admin/posts/${postId}/`, {
      method: 'PUT',
      headers: {
        Authorization: `Ghost ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ posts: [{ status: 'published', updated_at: new Date().toISOString() }] }),
    });
    const data = await res.json() as { posts: GhostPost[] };
    return data.posts[0];
  }

  async unpublishPost(postId: string): Promise<GhostPost> {
    const token = await this.generateAdminToken();
    const res = await fetch(`${this.url}/ghost/api/admin/posts/${postId}/`, {
      method: 'PUT',
      headers: {
        Authorization: `Ghost ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ posts: [{ status: 'draft', updated_at: new Date().toISOString() }] }),
    });
    const data = await res.json() as { posts: GhostPost[] };
    return data.posts[0];
  }
}
