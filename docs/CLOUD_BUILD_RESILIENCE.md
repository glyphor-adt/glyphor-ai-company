# Cloud Build Resilience and Troubleshooting Guide

## Overview
This guide documents improvements made to reduce Cloud Build intermittent failures and provides troubleshooting steps for common issues.

## Problem Statement
Cloud Build failures were concentrated in step 0 (`gcr.io/cloud-builders/docker`) with:
- Exit status 1 or 2
- ~25% failure rate
- No useful log detail
- Intermittent/transient nature

## Improvements Implemented

### 1. Enable Docker BuildKit (`DOCKER_BUILDKIT=1`)
**What it does:**
- Provides better error reporting with detailed stack traces
- Enables improved caching for faster builds
- Shows more granular progress information
- Better handles network failures

**Implementation:**
All Cloud Build YAML files now include:
```yaml
env:
  - 'DOCKER_BUILDKIT=1'
```

### 2. Detailed Progress Logging (`--progress=plain`)
**What it does:**
- Shows detailed build output instead of terse summaries
- Captures layer-by-layer progress
- Makes debugging easier when failures occur

**Implementation:**
All docker build commands now include:
```yaml
args:
  - 'build'
  - '--progress=plain'
```

### 3. Enhanced Logging Configuration
**What it does:**
- Streams logs in real-time
- Uses Cloud Logging for better searchability
- Retains logs for post-mortem analysis

**Implementation:**
```yaml
options:
  logging: CLOUD_LOGGING_ONLY
  logStreamingOption: STREAM_ON
```

### 4. Retry Wrapper Script
**Location:** `scripts/docker-build-with-retry.sh`

**What it does:**
- Automatically retries failed builds up to 3 times
- Uses exponential backoff (10s, 20s, 40s)
- Handles transient network/registry failures

**Usage:**
```bash
./scripts/docker-build-with-retry.sh \
  -f docker/Dockerfile.scheduler \
  -t us-central1-docker.pkg.dev/ai-glyphor-company/glyphor/scheduler:latest \
  .
```

**Environment variables:**
- `MAX_RETRIES` (default: 3)
- `RETRY_DELAY` (default: 10 seconds)
- `EXPONENTIAL_BACKOFF` (default: true)

### 5. Inline Retry Logic Example
For Cloud Build environments, see `cloudbuild-with-retry.yaml` for a complete example using inline bash retry logic.

## Common Failure Scenarios

### Exit Status 1: Build Failure
**Possible causes:**
- Dockerfile syntax errors
- Missing build dependencies
- Network timeout pulling base images
- Artifact Registry authentication issues

**Troubleshooting:**
1. Check Cloud Build logs in GCP Console
2. Look for specific error messages in build output
3. Verify network connectivity to Docker Hub / Artifact Registry
4. Check if base image exists and is accessible

### Exit Status 2: System/Docker Failure
**Possible causes:**
- Docker daemon issues
- Out of disk space
- Network quota exceeded
- Artifact Registry rate limiting

**Troubleshooting:**
1. Check Cloud Build machine resources
2. Verify Artifact Registry quotas
3. Look for rate limiting errors in logs
4. Consider using higher-spec build machines

### Intermittent Failures (Network/Registry)
**Symptoms:**
- Build succeeds on retry
- Random failures with no code changes
- Timeout errors

**Solutions:**
- Use retry logic (already implemented)
- Increase timeout values
- Use BuildKit caching
- Consider using GCP-hosted base images

## Monitoring and Debugging

### View Recent Build Failures
```bash
gcloud builds list --filter="status=FAILURE" --limit=10
```

### Get Detailed Logs for a Build
```bash
gcloud builds log <BUILD_ID>
```

### Search Cloud Logging
```bash
gcloud logging read "resource.type=build AND severity>=ERROR" --limit=50
```

### Check Artifact Registry Issues
```bash
gcloud artifacts operations list --location=us-central1
```

## Performance Optimizations

### 1. BuildKit Cache Mounts
For frequently rebuilt images, consider adding cache mounts:
```dockerfile
RUN --mount=type=cache,target=/root/.npm \
    npm ci
```

### 2. Multi-stage Builds
Already implemented in most Dockerfiles to reduce image size and build time.

### 3. Parallel Builds
When building multiple services, use parallel builds in `cloudbuild-all.yaml` (already implemented with IDs).

### 4. Layer Caching
BuildKit automatically caches layers. Ensure:
- Base images are stable
- Dependencies are installed before source code
- `.dockerignore` excludes unnecessary files

## Maintenance

### When to Update Cloud Build Config
- New services added
- Dockerfile changes require different build args
- Timeout needs adjustment
- New retry strategies needed

### Testing Changes
Before deploying Cloud Build config changes:
1. Test locally with Docker
2. Test in a separate GCP project
3. Use `cloudbuild-temp.yaml` for experiments
4. Monitor first few production builds closely

## References

### Recent Failures (Pre-Fix)
- scheduler: 2425147e-0f6d-4dda-93b8-1b3826229dba (exit 2)
- dashboard: 21057dd5-b09b-4035-b826-6b32469ccc0b (exit 2)
- scheduler: bc0c5700-d5b0-4c38-970e-d6849cf849f0 (exit 1)

### Useful Links
- [Cloud Build Documentation](https://cloud.google.com/build/docs)
- [Docker BuildKit](https://docs.docker.com/build/buildkit/)
- [Artifact Registry](https://cloud.google.com/artifact-registry/docs)
- [Cloud Build Quotas](https://cloud.google.com/build/quotas)

## Next Steps (If Issues Persist)

1. **Enable Cloud Build Retry Policy** (GCP Console):
   - Configure automatic retries in Cloud Build triggers
   - Set retry conditions based on exit codes

2. **Increase Machine Resources**:
   ```yaml
   options:
     machineType: 'E2_HIGHCPU_8'
   ```

3. **Use Cloud Build Private Pools**:
   - Dedicated build infrastructure
   - Better network reliability
   - Configurable resources

4. **Implement Advanced Monitoring**:
   - Set up Cloud Build metrics in Cloud Monitoring
   - Create alerts for failure rate > threshold
   - Track build duration trends

5. **Consider Alternative Strategies**:
   - Pre-build and cache base images
   - Use Cloud Build cache with `--cache-from`
   - Migrate to GitHub Actions (already implemented as primary)
