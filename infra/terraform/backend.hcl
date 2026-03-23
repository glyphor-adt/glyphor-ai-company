# Remote state in GCS (bucket created in project ai-glyphor-company).
# Run: terraform init -backend-config=backend.hcl
# If you already have local .tfstate: terraform init -backend-config=backend.hcl -migrate-state

bucket = "ai-glyphor-company-terraform-state"
prefix = "terraform/glyphor-ai-company"
