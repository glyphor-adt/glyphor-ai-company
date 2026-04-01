# Cloudflare Preview Worker

The website pipeline already writes preview registrations into R2 via [packages/integrations/src/cloudflare/previewTools.ts](c:/Users/KristinaDenney/source/repos/glyphor-ai-company/packages/integrations/src/cloudflare/previewTools.ts). The missing production piece was a Cloudflare Worker that reads those registrations and proxies branded preview hostnames to the matching Vercel deployment.

The worker now lives in [workers/preview/src/index.ts](c:/Users/KristinaDenney/source/repos/glyphor-ai-company/workers/preview/src/index.ts) with config in [workers/preview/wrangler.toml](c:/Users/KristinaDenney/source/repos/glyphor-ai-company/workers/preview/wrangler.toml).

## Request Flow

1. Agent calls `cloudflare_register_preview` or `cloudflare_update_preview`.
2. Integration writes `deployments/<slug>.json` to the `glyphor-fuse-storage` R2 bucket.
3. Cloudflare Worker receives `https://<slug>.preview.glyphor.ai/...`.
4. Worker loads the R2 registration, resolves `deployment_url`, and proxies the request to the Vercel deployment.
5. If Vercel returns a same-origin redirect, the worker rewrites it back to the branded preview host.

## Required Cloudflare Configuration

1. Deploy the worker:
   - `npm run preview-worker:deploy`
2. Confirm the route in [workers/preview/wrangler.toml](c:/Users/KristinaDenney/source/repos/glyphor-ai-company/workers/preview/wrangler.toml):
   - `*.preview.glyphor.ai/*`
3. Create a wildcard DNS record under the `glyphor.ai` zone and keep it proxied through Cloudflare.
4. Bind the `glyphor-fuse-storage` R2 bucket to the worker as `PREVIEW_REGISTRY`.

## Debug Endpoints

- `GET /__preview/health`
- `GET /__preview/meta`

Use them on a branded preview host such as `https://coming-soon.preview.glyphor.ai/__preview/meta` to confirm the worker is reading the expected registration.