import { executeDynamicTool } from '../../packages/agent-runtime/src/dynamicToolExecutor.js';

async function main() {
  const out = await executeDynamicTool('search_frontend_code', {
    repo: 'glyphor-ai-company',
    query: 'path:packages',
  });
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
