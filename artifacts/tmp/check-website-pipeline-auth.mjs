import { getWebsitePipelineGitHubToken } from '../../packages/integrations/dist/github/websitePipelineAuth.js';

try {
  const token = await getWebsitePipelineGitHubToken();
  const response = await fetch('https://api.github.com/repos/Glyphor-Fuse/glyphor-fuse-template', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  const body = await response.json().catch(() => null);
  console.log(JSON.stringify({ status: response.status, body }, null, 2));
  process.exit(response.ok ? 0 : 1);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
