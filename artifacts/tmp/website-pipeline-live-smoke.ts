import { createBuildWebsiteFoundationTools } from '../../packages/agents/src/shared/webBuildTools.js';
import {
  createCloudflarePreviewTools,
  createGithubFromTemplateTools,
  createGithubPushFilesTools,
  createVercelProjectTools,
} from '../../packages/integrations/src/index.js';
import type { ToolContext, ToolDefinition, ToolResult } from '../../packages/agent-runtime/src/types.js';

function createToolContext(): ToolContext {
  return {
    agentId: 'website-pipeline-live-smoke',
    agentRole: 'frontend-engineer',
    turnNumber: 1,
    abortSignal: new AbortController().signal,
    memoryBus: {} as never,
    emitEvent: () => {},
    executeChildTool: async () => ({
      note: 'Lookup executor is not configured for this smoke test.',
    }),
  };
}

function getTool(tools: ToolDefinition[], name: string): ToolDefinition {
  const tool = tools.find((entry) => entry.name === name);
  if (!tool) {
    throw new Error(`Tool not found: ${name}`);
  }
  return tool;
}

async function runTool(
  tool: ToolDefinition,
  params: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  console.log(`\n>>> ${tool.name}`);
  const result = await tool.execute(params, ctx);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function requireSuccess(result: ToolResult, label: string): Record<string, unknown> {
  if (!result.success) {
    throw new Error(`${label} failed: ${result.error ?? 'Unknown error'}`);
  }
  return (result.data as Record<string, unknown> | undefined) ?? {};
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPreview(
  tool: ToolDefinition,
  projectId: string,
  projectName: string,
  branch: string,
  ctx: ToolContext,
): Promise<string> {
  const attempts = 24;
  for (let index = 1; index <= attempts; index += 1) {
    const result = await runTool(tool, { project_id: projectId, project_name: projectName, branch }, ctx);
    const data = requireSuccess(result, 'vercel_get_preview_url');
    if (data.state === 'READY' && typeof data.preview_url === 'string' && data.preview_url.trim()) {
      return data.preview_url.trim();
    }
    console.log(`Preview not ready yet. Attempt ${index}/${attempts}. Waiting 15s...`);
    await sleep(15_000);
  }

  throw new Error(`Preview for ${projectName} on branch ${branch} did not become READY in time.`);
}

async function verifyUrl(url: string): Promise<{ ok: boolean; status: number; finalUrl: string }> {
  const response = await fetch(url, { redirect: 'follow' });
  return {
    ok: response.ok,
    status: response.status,
    finalUrl: response.url,
  };
}

async function main(): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14).toLowerCase();
  const projectSlug = `smoke-${timestamp}`;
  const branch = `feature/${projectSlug}`;
  const projectName = projectSlug;
  const ctx = createToolContext();

  const githubTools = [...createGithubFromTemplateTools(), ...createGithubPushFilesTools()];
  const vercelTools = createVercelProjectTools();
  const cloudflareTools = createCloudflarePreviewTools();
  const buildTools = createBuildWebsiteFoundationTools();

  const createRepoTool = getTool(githubTools, 'github_create_from_template');
  const pushFilesTool = getTool(githubTools, 'github_push_files');
  const createProjectTool = getTool(vercelTools, 'vercel_create_project');
  const previewTool = getTool(vercelTools, 'vercel_get_preview_url');
  const registerPreviewTool = getTool(cloudflareTools, 'cloudflare_register_preview');
  const buildTool = getTool(buildTools, 'build_website_foundation');

  const repoResult = requireSuccess(
    await runTool(
      createRepoTool,
      {
        repo_name: projectSlug,
        description: `Disposable website pipeline smoke test ${timestamp}`,
        private: true,
      },
      ctx,
    ),
    'github_create_from_template',
  );

  const fullName = String(repoResult.full_name ?? '');
  const repoUrl = String(repoResult.repo_url ?? '');
  if (!fullName) {
    throw new Error('GitHub repository result did not include full_name.');
  }

  const projectResult = requireSuccess(
    await runTool(
      createProjectTool,
      {
        repo_name: projectSlug,
        project_name: projectName,
        framework: 'vite',
      },
      ctx,
    ),
    'vercel_create_project',
  );
  const projectId = String(projectResult.project_id ?? '').trim();
  if (!projectId) {
    throw new Error('vercel_create_project did not return project_id.');
  }

  const buildResult = requireSuccess(
    await runTool(
      buildTool,
      {
        normalized_brief: {
          brandName: 'Signal Foundry',
          projectSlug: projectSlug,
          projectType: 'landing_page',
          visualManifesto:
            'Industrial precision with warm editorial contrast. Minimal chrome, strong typographic rhythm, and restrained motion.',
          signatureFeature: 'A kinetic proof strip that reveals delivery metrics as the user scrolls.',
          audience: 'B2B operators evaluating an AI workflow consultancy.',
          primaryGoal: 'Capture qualified intro calls.',
          coreSections: ['hero', 'proof', 'services', 'process', 'cta'],
        },
        brand_spec: {
          tone: ['precise', 'decisive', 'high-trust'],
          paletteDirection: 'stone neutrals, oxide accents, muted teal support',
          typographyDirection: 'bold editorial headline paired with clean grotesk body',
        },
        intake_context: {
          smoke_test: true,
          requested_by: 'copilot',
          branch,
        },
      },
      ctx,
    ),
    'build_website_foundation',
  );

  const files = buildResult.files as Record<string, string> | undefined;
  if (!files || Object.keys(files).length === 0) {
    throw new Error('build_website_foundation returned no files.');
  }

  requireSuccess(
    await runTool(
      pushFilesTool,
      {
        repo: fullName,
        branch,
        files,
        commit_message: `test: website pipeline smoke ${timestamp}`,
      },
      ctx,
    ),
    'github_push_files',
  );

  const previewUrl = await waitForPreview(previewTool, projectId, projectName, branch, ctx);

  const previewRegistration = requireSuccess(
    await runTool(
      registerPreviewTool,
      {
        project_slug: projectSlug,
        vercel_deployment_url: previewUrl,
        github_repo_url: repoUrl,
        project_name: projectName,
      },
      ctx,
    ),
    'cloudflare_register_preview',
  );

  const brandedPreviewUrl = String(previewRegistration.preview_url ?? '');
  const vercelCheck = await verifyUrl(previewUrl);
  const brandedCheck = brandedPreviewUrl ? await verifyUrl(brandedPreviewUrl) : null;

  console.log(
    JSON.stringify(
      {
        projectSlug,
        branch,
        repo: fullName,
        repoUrl,
        fileCount: Object.keys(files).length,
        model: buildResult.model,
        toolRounds: buildResult.tool_rounds,
        previewUrl,
        brandedPreviewUrl,
        vercelCheck,
        brandedCheck,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});