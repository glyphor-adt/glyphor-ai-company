import { createBuildWebsiteFoundationTools } from '../../packages/agents/src/shared/webBuildTools.ts';
import { createGithubFromTemplateTools } from '../../packages/integrations/src/github/githubFromTemplate.ts';
import { createGithubPushFilesTools } from '../../packages/integrations/src/github/githubPushFiles.ts';
import { createVercelProjectTools } from '../../packages/integrations/src/vercel/vercelProjectTools.ts';
import { createCloudflarePreviewTools } from '../../packages/integrations/src/cloudflare/previewTools.ts';
import { TOOL_CAPABILITY_MAP } from '../../packages/agent-runtime/src/routing/toolCapabilityMap.ts';
import { WRITE_TOOLS } from '../../packages/agent-runtime/src/types.ts';

async function main(): Promise<void> {
  const failures: string[] = [];
  const check = (condition: boolean, message: string): void => {
    if (!condition) failures.push(message);
  };

  const foundationTool = createBuildWebsiteFoundationTools().find((tool) => tool.name === 'build_website_foundation');
  check(Boolean(foundationTool), 'Missing build_website_foundation tool');
  if (foundationTool) {
    const result = await foundationTool.execute({}, { abortSignal: AbortSignal.timeout(1000) } as never);
    check(result.success === false && String(result.error).includes('normalized_brief is required'), 'build_website_foundation validation failed');
  }

  const githubTemplateResult = await createGithubFromTemplateTools()[0].execute({}, { abortSignal: AbortSignal.timeout(1000) } as never);
  check(githubTemplateResult.success === false && String(githubTemplateResult.error).includes('repo_name is required'), 'github_create_from_template validation failed');

  const githubPushResult = await createGithubPushFilesTools()[0].execute({}, { abortSignal: AbortSignal.timeout(1000) } as never);
  check(githubPushResult.success === false && String(githubPushResult.error).includes('repo is required'), 'github_push_files validation failed');

  const [vercelCreateTool, vercelPreviewTool] = createVercelProjectTools();
  const vercelCreateResult = await vercelCreateTool.execute({}, { abortSignal: AbortSignal.timeout(1000) } as never);
  check(vercelCreateResult.success === false && String(vercelCreateResult.error).includes('repo_name is required'), 'vercel_create_project validation failed');
  const vercelPreviewResult = await vercelPreviewTool.execute({}, { abortSignal: AbortSignal.timeout(1000) } as never);
  check(vercelPreviewResult.success === false && String(vercelPreviewResult.error).includes('project_name is required'), 'vercel_get_preview_url validation failed');

  const [cloudflareRegisterTool, cloudflareUpdateTool] = createCloudflarePreviewTools();
  const cloudflareRegisterResult = await cloudflareRegisterTool.execute(
    { project_slug: 'Invalid Slug', vercel_deployment_url: 'https://example.vercel.app' },
    { abortSignal: AbortSignal.timeout(1000) } as never,
  );
  check(
    cloudflareRegisterResult.success === false &&
      String(cloudflareRegisterResult.error).includes('project_slug must use lowercase letters, numbers, and hyphens only'),
    'cloudflare_register_preview validation failed',
  );
  const cloudflareUpdateResult = await cloudflareUpdateTool.execute(
    { project_slug: 'valid-slug' },
    { abortSignal: AbortSignal.timeout(1000) } as never,
  );
  check(
    cloudflareUpdateResult.success === false && String(cloudflareUpdateResult.error).includes('vercel_deployment_url is required'),
    'cloudflare_update_preview validation failed',
  );

  for (const toolName of [
    'build_website_foundation',
    'github_create_from_template',
    'github_push_files',
    'vercel_create_project',
    'vercel_get_preview_url',
    'cloudflare_register_preview',
    'cloudflare_update_preview',
  ]) {
    check(Object.prototype.hasOwnProperty.call(TOOL_CAPABILITY_MAP, toolName), `Capability map missing ${toolName}`);
  }

  check(WRITE_TOOLS.has('build_website_foundation'), 'WRITE_TOOLS missing build_website_foundation');
  check(WRITE_TOOLS.has('github_create_from_template'), 'WRITE_TOOLS missing github_create_from_template');
  check(WRITE_TOOLS.has('github_push_files'), 'WRITE_TOOLS missing github_push_files');
  check(WRITE_TOOLS.has('vercel_create_project'), 'WRITE_TOOLS missing vercel_create_project');
  check(WRITE_TOOLS.has('cloudflare_register_preview'), 'WRITE_TOOLS missing cloudflare_register_preview');
  check(WRITE_TOOLS.has('cloudflare_update_preview'), 'WRITE_TOOLS missing cloudflare_update_preview');
  check(!WRITE_TOOLS.has('vercel_get_preview_url'), 'WRITE_TOOLS should not include vercel_get_preview_url');

  if (failures.length > 0) {
    console.error(JSON.stringify({ ok: false, failures }, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify({ ok: true, checks: 'factory-validation-and-runtime-metadata' }, null, 2));
}

void main();
