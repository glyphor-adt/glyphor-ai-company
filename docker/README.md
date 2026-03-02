# Docker Build Context Best Practices

This document outlines best practices for managing Docker builds in our monorepo setup.

## Build Context

All Dockerfiles use the **repository root (`.`)** as the build context. This enables access to:
- All package source code
- Shared configuration files (turbo.json, tsconfig.base.json)
- Cross-package dependencies during the build stage

## Multi-Stage Builds

Our Dockerfiles follow a two-stage pattern:

### Stage 1: Builder
- Installs all dependencies (including dev dependencies)
- Copies all packages via `COPY packages/ packages/`
- Builds using Turbo's selective build (`--filter=@glyphor/{service}...`)
- **All packages are available in this stage**

### Stage 2: Runtime
- Installs only production dependencies
- Copies only built artifacts from the builder stage
- **Individual packages are NOT available in this stage**

## Cross-Package Dependencies

### ❌ Wrong: Copying from unavailable source
```dockerfile
# This fails because packages/dashboard/ is not copied to runtime stage
COPY packages/dashboard/public/logo.png public/logo.png
```

### ✅ Correct: Copying from builder stage
```dockerfile
# This works because the file exists in the builder stage
COPY --from=builder /app/packages/dashboard/public/logo.png ./public/logo.png
```

## Cloud Build Configuration

### Logging Best Practices

All Cloud Build configurations include:

```yaml
steps:
  - name: 'gcr.io/cloud-builders/docker'
    args:
      - 'build'
      - '--progress=plain'  # Detailed build output
      - '-f'
      - 'docker/Dockerfile.service'
      - '-t'
      - 'image:tag'
      - '.'

options:
  logging: CLOUD_LOGGING_ONLY  # Send logs to Cloud Logging
  logStreamingOption: STREAM_ON  # Stream logs in real-time
```

### Why These Settings?

- `--progress=plain`: Provides detailed, line-by-line build output (vs. condensed tty output)
- `CLOUD_LOGGING_ONLY`: Ensures all logs are captured in Cloud Logging for debugging
- `STREAM_ON`: Enables real-time log streaming during builds

## Common Pitfalls

1. **Cross-package COPY in runtime stage**: Always use `COPY --from=builder` for files from other packages
2. **Missing build context**: Ensure the build context is `.` (repository root) in Cloud Build
3. **Insufficient logging**: Always use `--progress=plain` for debugging build failures

## Testing Locally

Before pushing changes, test Docker builds locally:

```bash
# Test scheduler
docker build --progress=plain -f docker/Dockerfile.scheduler -t test-scheduler:local .

# Test dashboard (with build args)
docker build --progress=plain -f docker/Dockerfile.dashboard \
  --build-arg VITE_SCHEDULER_URL=test \
  --build-arg VITE_GOOGLE_CLIENT_ID=test \
  --build-arg VITE_VOICE_GATEWAY_URL=test \
  -t test-dashboard:local .

# Verify contents
docker run --rm test-scheduler:local ls -lh /app/public/
```
