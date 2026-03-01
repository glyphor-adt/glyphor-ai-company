#!/usr/bin/env bash
# docker-build-with-retry.sh — Wrapper for docker build with retry logic
# Handles transient failures from Artifact Registry, network issues, or cache problems
set -euo pipefail

# Configuration
MAX_RETRIES="${MAX_RETRIES:-3}"
RETRY_DELAY="${RETRY_DELAY:-10}"
EXPONENTIAL_BACKOFF="${EXPONENTIAL_BACKOFF:-true}"

# Parse arguments
ARGS=("$@")

echo "=== Docker Build with Retry Wrapper ==="
echo "Max retries: ${MAX_RETRIES}"
echo "Retry delay: ${RETRY_DELAY}s"
echo "Command: docker build ${ARGS[*]}"

attempt=1
while [ $attempt -le $MAX_RETRIES ]; do
  echo ""
  echo "--- Attempt ${attempt}/${MAX_RETRIES} ---"
  
  # Run docker build
  if docker build "${ARGS[@]}"; then
    echo "✓ Build succeeded on attempt ${attempt}"
    exit 0
  else
    exit_code=$?
    echo "✗ Build failed with exit code ${exit_code}"
    
    # Check if we should retry
    if [ $attempt -lt $MAX_RETRIES ]; then
      # Calculate delay with exponential backoff if enabled
      if [ "$EXPONENTIAL_BACKOFF" = "true" ]; then
        delay=$((RETRY_DELAY * (2 ** (attempt - 1))))
      else
        delay=$RETRY_DELAY
      fi
      
      echo "Retrying in ${delay} seconds..."
      sleep $delay
      attempt=$((attempt + 1))
    else
      echo "✗ All ${MAX_RETRIES} attempts failed"
      exit $exit_code
    fi
  fi
done
