# Terraform (GCP)

## Per-agent service accounts

All `sa-*` identities from `packages/integrations/src/governance/iamSync.ts` are defined in `main.tf`: `google_service_account.cfo_agent` (`sa-nadia`) plus `google_service_account.agent_owner` (for_each). After apply, use output `agent_owner_service_account_emails` and `cfo_agent_service_account_email`.

## Remote state (GCS)

State lives in bucket **`ai-glyphor-company-terraform-state`** (region `us-central1`, versioning enabled).

```bash
cd infra/terraform
terraform init -backend-config=backend.hcl
```

**First time** (no local state): that’s enough.

**Migrating from local `.tfstate`** (if you have `terraform.tfstate` in this folder):

```bash
terraform init -backend-config=backend.hcl -migrate-state
```

Then apply as usual:

```bash
terraform plan  -var-file=terraform.tfvars   # or -var="project_id=..."
terraform apply -var-file=terraform.tfvars
```

## Permissions

Whoever runs `terraform` needs write access to that bucket, e.g.:

- `roles/storage.objectAdmin` on `ai-glyphor-company-terraform-state`, or
- Project `Owner` / `Editor` (broader than needed).

CI/CD should use a dedicated service account with object admin on the state bucket only.

## Existing GCP resources + new remote state (important)

If the project **already had** Cloud Run, SQL, secrets, etc. **before** the first `terraform apply` against this GCS backend, Terraform’s state is **empty** and `apply` will try to **create** everything again → **409 already exists** errors and a **partial state**.

**Fix (pick one):**

1. **Restore old state** — If you still have a previous `terraform.tfstate` (or a GCS backup), put that state back in the remote bucket (same `prefix` as `backend.hcl`) or run `terraform init -backend-config=backend.hcl -migrate-state` from the directory that still has the local state file.

2. **Import** — For each resource that already exists, run `terraform import …` with the correct GCP id until `terraform plan` is clean. Use the [Terraform Google provider import docs](https://registry.terraform.io/providers/hashicorp/google/latest/docs/guides/resource_reference) for id formats.

3. **CFO billing IAM** — **Nadia** is the CFO *agent*; in GCP she is the service account **`sa-nadia@<project>.iam.gserviceaccount.com`** (created by Terraform, listed in `iamSync.ts`). That SA gets `billing.viewer` + BigQuery read on the billing export dataset. To grant the same to **human** founders, set:
   ```hcl
   cfo_billing_console_users = ["kristina@glyphor.ai", "andrew@glyphor.ai"]
   ```

**`db-readonly-password` secret** must have at least **one secret version** (payload) in Secret Manager, or resources that read it will fail with “no versions”.
