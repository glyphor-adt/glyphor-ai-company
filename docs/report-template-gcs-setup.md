# Report Template Setup (GCS + Secret Manager)

This config wires auto-generated report exports to fetch template locations from GCP at generation time.

## 1. Upload templates to GCS

```bash
gsutil cp glyphor-presentation-template.pptx gs://ai-glyphor-company/templates/
gsutil cp glyphor-report-template.docx gs://ai-glyphor-company/templates/
```

## 2. Store template URIs in Secret Manager

```bash
echo -n "gs://ai-glyphor-company/templates/glyphor-report-template.docx" | \
  gcloud secrets create report-template-docx \
  --data-file=- \
  --project=ai-glyphor-company

echo -n "gs://ai-glyphor-company/templates/glyphor-presentation-template.pptx" | \
  gcloud secrets create report-template-pptx \
  --data-file=- \
  --project=ai-glyphor-company
```

To update existing secrets:

```bash
echo -n "gs://ai-glyphor-company/templates/glyphor-report-template.docx" | \
  gcloud secrets versions add report-template-docx \
  --data-file=- \
  --project=ai-glyphor-company

echo -n "gs://ai-glyphor-company/templates/glyphor-presentation-template.pptx" | \
  gcloud secrets versions add report-template-pptx \
  --data-file=- \
  --project=ai-glyphor-company
```

## 3. Runtime wiring used by scheduler

The scheduler report exporter now resolves templates in this order:

1. `REPORT_TEMPLATE_DOCX_URI` / `REPORT_TEMPLATE_PPTX_URI` env vars
2. Secret Manager values (defaults):
   - `report-template-docx`
   - `report-template-pptx`

Optional overrides for secret names:

- `REPORT_TEMPLATE_DOCX_SECRET_NAME`
- `REPORT_TEMPLATE_PPTX_SECRET_NAME`

Project ID must be set via either:

- `GCP_PROJECT_ID`
- `GCP_PROJECT`

## 4. IAM required by scheduler service account

Grant access to template secrets and template bucket objects:

- `roles/secretmanager.secretAccessor`
- `roles/storage.objectViewer`

## 5. Current behavior note

Exporter paths are template-aware and now fetch template URIs + template bytes from GCS at generation time.
Current generation still uses the existing in-code builders for final rendering while template merge adapters are completed.
