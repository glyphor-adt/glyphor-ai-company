# Cloudflare Preview Worker

This worker binds branded preview hosts like `https://acme.preview.glyphor.ai` to the matching Vercel deployment URL written by `cloudflare_register_preview`.

## What It Does

- Reads `deployments/{slug}.json` from the `glyphor-fuse-storage` R2 bucket.
- Resolves the target `deployment_url` from that metadata.
- Proxies the incoming request to the Vercel deployment.
- Rewrites same-origin redirects back to the branded `preview.glyphor.ai` host.
- Exposes `GET /__preview/health` and `GET /__preview/meta` for debugging.

## Required Cloudflare Setup

1. Create or confirm an R2 bucket named `glyphor-fuse-storage`.
2. Deploy this worker with Wrangler:
   - `npm run preview-worker:deploy`
3. Ensure the route in `wrangler.toml` is active for `*.preview.glyphor.ai/*`.
4. Create a proxied wildcard DNS record so Cloudflare receives requests for preview subdomains.
   - Typical setup: `*.preview` as a proxied `CNAME` to `preview.glyphor.ai`
   - If you prefer a different DNS shape, keep the hostname under the `glyphor.ai` zone and proxied through Cloudflare.

## Local Commands

- `npm run preview-worker:dev`
- `npm run preview-worker:typecheck`

## Expected Metadata Shape

The registration tools already write this JSON to R2:

```json
{
  "deployment_url": "https://project-abc123.vercel.app",
  "preview_url": "https://project.preview.glyphor.ai",
  "github_repo_url": "https://github.com/Glyphor-Fuse/project",
  "project_name": "Project",
  "registered_at": "2026-03-31T23:59:59.000Z"
}
```

## Smoke Check

1. Run `cloudflare_register_preview` for a known Vercel deployment.
2. Visit `https://<slug>.preview.glyphor.ai/__preview/meta` and confirm the registration resolves.
3. Visit `https://<slug>.preview.glyphor.ai/` and confirm the Vercel site is served through the branded host.