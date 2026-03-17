@echo off
echo === DEPLOY START ===
call gcloud builds submit --config=cloudbuild-worker.yaml --project=ai-glyphor-company --timeout=600 --async 2>&1
echo === DEPLOY END (exit code: %ERRORLEVEL%) ===
