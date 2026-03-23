# Terraform state reconciliation (manual + automated steps)

**Project:** `ai-glyphor-company`  
**Backend:** GCS (`infra/terraform/backend.hcl`)

## What was fixed in `main.tf`

1. **`data.google_secret_manager_secret_version.db_password`** — Uses `project` + secret id string so refresh works before all `google_secret_manager_secret.secrets` entries exist in state.
2. **`google_sql_user.glyphor_readonly`** — Cloud SQL had **no** `glyphor_readonly` user; Terraform principal also could not read `db-readonly-password` from Secret Manager. The user is managed with a placeholder password + **`lifecycle { ignore_changes = [password] }`** so you can create the user on first apply or create it manually and align the secret later.
3. **`google_vpc_access_connector.glyphor`** — After import, provider defaults for throughput/instances differed from GCP → **`lifecycle.ignore_changes`** on those fields to avoid **forced replacement** of the connector.

## What was imported into state (representative)

- `google_service_account` — `glyphor`, `worker`, `global_admin` (+ agent SAs from earlier targeted apply)
- `google_vpc_access_connector.glyphor`
- `google_redis_instance.cache`
- `google_sql_database_instance.glyphor_db`, `google_sql_database.glyphor`, `google_sql_user.glyphor_app`
- `google_artifact_registry_repository.glyphor`
- `google_pubsub_topic.agent_tasks`, `google_pubsub_subscription.agent_tasks_push`
- `google_cloud_run_v2_service` — `scheduler`, `worker`, `dashboard`, `voice_gateway`
- `google_cloud_tasks_queue` — `agent_runs`, `agent_runs_priority`, `delivery`
- All **`google_secret_manager_secret.secrets[...]`** in `local.secrets` (where import succeeded)
- Existing CFO billing IAM on `sa-nadia` (from earlier apply)

## GCP reality vs Terraform (not imported — no matching resource)

| Terraform resource | Notes |
|--------------------|--------|
| `google_cloud_run_v2_service.chief_of_staff` | No `glyphor-chief-of-staff` service in `us-central1` (Cos may run elsewhere or under another name). |
| `google_cloud_run_v2_service.decisions_api` | No `glyphor-decisions-api` in listed services. |
| `google_pubsub_subscription.glyphor_events_push` | Subscription `glyphor-events-push` **not found** in GCP. |

## Scheduler jobs: GCP vs Terraform

GCP currently has a **subset** of jobs defined in Terraform (e.g. no `cos-midday-digest`, `cos-weekly-review`, … in the list you had at reconcile time). Missing jobs will show as **to add** on `plan`; existing ones may need **import** or will conflict on create.

Import ID format:

`terraform import google_cloud_scheduler_job.<resource_name> projects/ai-glyphor-company/locations/us-central1/jobs/<job-id>`

## Why a full `terraform apply` was **not** run here

`terraform plan` still showed **~12 in-place updates** to **Cloud Run** (e.g. image `:digest` → `:latest`, env block reordering, probe timing). Applying that without CI/CD alignment can **change production behavior**. Resolve by:

- Pinning images to the same digests/tags as deployed, **or**
- `lifecycle { ignore_changes = [template] }` on specific services until configs match, **or**
- One-time apply during a maintenance window after review.

## Check status

```bash
cd infra/terraform
terraform init -backend-config=backend.hcl
terraform plan -var="project_id=ai-glyphor-company"
```

## Next steps (recommended order)

1. Review the **Cloud Run** section of `plan` and align `main.tf` with what’s deployed **or** add targeted `ignore_changes`.
2. **Import** remaining `google_cloud_scheduler_job` resources that already exist (see GCP job names).
3. **Import** `google_secret_manager_secret_iam_member` / `google_project_iam_member` where bindings already exist (otherwise apply may duplicate or error).
4. **Create** `glyphor_events_push` subscription in GCP or remove/adjust the Terraform resource if push to scheduler is obsolete.
5. **Create** `google_sql_user.glyphor_readonly` via `terraform apply -target=...` when ready, or create the user in Cloud SQL and keep `ignore_changes` on password.
