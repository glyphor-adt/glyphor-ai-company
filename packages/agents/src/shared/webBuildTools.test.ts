import { describe, expect, it, vi } from 'vitest';

const { createWebBuildTools } = await import('./webBuildTools.js');

function createContext(executeChildTool: (toolName: string, params: Record<string, unknown>) => Promise<unknown>) {
  return {
    agentId: 'test-agent',
    agentRole: 'frontend-engineer',
    turnNumber: 1,
    abortSignal: new AbortController().signal,
    memoryBus: {
      read: vi.fn(),
      write: vi.fn(),
      appendActivity: vi.fn(),
      createDecision: vi.fn(),
      getDecisions: vi.fn(),
      getRecentActivity: vi.fn(),
      getProductMetrics: vi.fn(),
      getFinancials: vi.fn(),
    },
    emitEvent: vi.fn(),
    executeChildTool,
  } as const;
}

describe('webBuildTools website pipeline replacement', () => {
  it('routes prototype builds through the website pipeline and returns the branded preview url', async () => {
    const appendActivity = vi.fn();
    const calls: string[] = [];
    const executeChildTool = vi.fn(async (toolName: string) => {
      calls.push(toolName);
      switch (toolName) {
        case 'normalize_design_brief':
          return {
            audience_persona: 'Founders',
            primary_conversion_action: 'Book a demo',
            emotional_target: 'Confidence',
            one_sentence_memory: 'Acme launches faster.',
            aesthetic_direction: 'Editorial boldness',
            product_type: 'marketing_page',
          };
        case 'github_create_from_template':
          return { full_name: 'Glyphor-Fuse/acme-launch', owner: 'Glyphor-Fuse', repo: 'acme-launch' };
        case 'vercel_create_project':
          return { project_id: 'vercel-123', project_name: 'acme-launch' };
        case 'build_website_foundation':
          return {
            files: { 'src/App.tsx': 'export default function App() { return null; }' },
            architectural_reasoning: 'reasoning',
            design_plan: { sections: [{ id: 'hero' }] },
            image_manifest: [],
          };
        case 'github_push_files':
          return { commit_sha: 'abc123', branch_url: 'https://github.com/Glyphor-Fuse/acme-launch/tree/feature/prototype-build' };
        case 'vercel_get_preview_url':
          return { state: 'READY', preview_url: 'https://acme-launch-git-feature.vercel.app' };
        case 'cloudflare_register_preview':
          return { preview_url: 'https://acme-launch.preview.glyphor.ai' };
        case 'github_create_pull_request':
          return { pr_number: 17, pr_url: 'https://github.com/Glyphor-Fuse/acme-launch/pull/17', draft: true };
        default:
          throw new Error(`Unexpected child tool: ${toolName}`);
      }
    });

    const memory = { appendActivity } as unknown as Parameters<typeof createWebBuildTools>[0];
    const tool = createWebBuildTools(memory, { allowBuild: true, allowIterate: false, allowUpgrade: false })
      .find((entry) => entry.name === 'invoke_web_build');

    expect(tool).toBeDefined();

    const result = await tool!.execute({
      brief: 'Brand: Acme Launch\nAudience: Founders\nCTA: Book a demo',
      tier: 'prototype',
      brand_context: { brand_name: 'Acme Launch' },
    }, createContext(executeChildTool));

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      project_id: 'Glyphor-Fuse/acme-launch',
      preview_url: 'https://acme-launch.preview.glyphor.ai',
      deploy_url: 'https://acme-launch-git-feature.vercel.app',
      github_pr_url: 'https://github.com/Glyphor-Fuse/acme-launch/pull/17',
      tier_used: 'prototype',
    });
    expect(calls).toEqual([
      'normalize_design_brief',
      'github_create_from_template',
      'vercel_create_project',
      'build_website_foundation',
      'github_push_files',
      'vercel_get_preview_url',
      'cloudflare_register_preview',
      'github_create_pull_request',
    ]);
    expect(appendActivity).toHaveBeenCalledOnce();
  });

  it('ships full builds through PR merge and production verification', async () => {
    const appendActivity = vi.fn();
    const executeChildTool = vi.fn(async (toolName: string) => {
      switch (toolName) {
        case 'normalize_design_brief':
          return {
            audience_persona: 'Operators',
            primary_conversion_action: 'Start trial',
            emotional_target: 'Urgency',
            one_sentence_memory: 'Pilot turns prompts into operations.',
            aesthetic_direction: 'Bold minimal',
            product_type: 'web_application',
          };
        case 'github_create_from_template':
          return { full_name: 'Glyphor-Fuse/pilot-ops', owner: 'Glyphor-Fuse', repo: 'pilot-ops' };
        case 'vercel_create_project':
          return { project_id: 'vercel-999', project_name: 'pilot-ops' };
        case 'build_website_foundation':
          return {
            files: { 'src/App.tsx': 'export default function App() { return null; }' },
            architectural_reasoning: 'reasoning',
            design_plan: { sections: [{ id: 'hero' }, { id: 'cta' }] },
            image_manifest: [],
          };
        case 'github_push_files':
          return { commit_sha: 'def456', branch_url: 'https://github.com/Glyphor-Fuse/pilot-ops/tree/feature/initial-build' };
        case 'vercel_get_preview_url':
          return { state: 'READY', preview_url: 'https://pilot-ops-git-feature.vercel.app' };
        case 'cloudflare_register_preview':
          return { preview_url: 'https://pilot-ops.preview.glyphor.ai' };
        case 'github_create_pull_request':
          return { pr_number: 42, pr_url: 'https://github.com/Glyphor-Fuse/pilot-ops/pull/42' };
        case 'github_wait_for_pull_request_checks':
          return { wait_result: 'success', ready_to_merge: true };
        case 'github_merge_pull_request':
          return { merged: true, sha: 'merge789' };
        case 'vercel_get_production_url':
          return { state: 'READY', production_url: 'https://pilot-ops.vercel.app' };
        default:
          throw new Error(`Unexpected child tool: ${toolName}`);
      }
    });

    const memory = { appendActivity } as unknown as Parameters<typeof createWebBuildTools>[0];
    const tool = createWebBuildTools(memory, { allowBuild: true, allowIterate: false, allowUpgrade: false })
      .find((entry) => entry.name === 'invoke_web_build');

    const result = await tool!.execute({
      brief: 'Brand: Pilot Ops\nAudience: Operators\nCTA: Start trial',
      tier: 'full_build',
      brand_context: { brand_name: 'Pilot Ops' },
    }, createContext(executeChildTool));

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      project_id: 'Glyphor-Fuse/pilot-ops',
      preview_url: 'https://pilot-ops.preview.glyphor.ai',
      deploy_url: 'https://pilot-ops.vercel.app',
      github_pr_url: 'https://github.com/Glyphor-Fuse/pilot-ops/pull/42',
      tier_used: 'full_build',
    });
    expect(executeChildTool).toHaveBeenCalledWith('github_merge_pull_request', expect.objectContaining({ repo: 'Glyphor-Fuse/pilot-ops', pr_number: 42 }));
    expect(appendActivity).toHaveBeenCalledOnce();
  });
});