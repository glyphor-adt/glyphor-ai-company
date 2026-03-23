# Agent service accounts — code vs Terraform vs GCP

**Project checked:** `ai-glyphor-company`  
**Source of truth in code:** `packages/integrations/src/governance/iamSync.ts` (`SERVICE_ACCOUNTS`)  
**Last GCP inventory:** run `gcloud iam service-accounts list --project=ai-glyphor-company` to refresh.

## 1. `iamSync.ts` expects these emails

| Email (GCP) | Agent role |
|-------------|------------|
| `sa-marcus@…` | `cto` |
| `sa-nadia@…` | `cfo` |
| `sa-alex@…` | `platform-engineer` |
| `sa-jordan@…` | `devops-engineer` |
| `sa-elena@…` | `cpo` |
| `sa-maya@…` | `cmo` |
| `sa-rachel@…` | `vp-sales` |
| `sa-mia@…` | `vp-design` |
| `sa-sarah@…` | `chief-of-staff` |
| `sa-production-deploy@…` | *(no agent role)* |

## 2. Terraform defines (today)

| Terraform resource | `account_id` | Email suffix |
|--------------------|--------------|--------------|
| `google_service_account.glyphor` | `glyphor-agent-runner` | `glyphor-agent-runner@…` |
| `google_service_account.worker` | `glyphor-worker` | `glyphor-worker@…` |
| `google_service_account.cfo_agent` | `sa-nadia` | `sa-nadia@…` |
| `google_service_account.global_admin` | `glyphor-global-admin` | `glyphor-global-admin@…` |
| `google_service_account.agent_owner["marcus"]` | `sa-marcus` | `sa-marcus@…` |
| `google_service_account.agent_owner["alex"]` | `sa-alex` | `sa-alex@…` |
| `google_service_account.agent_owner["jordan"]` | `sa-jordan` | `sa-jordan@…` |
| `google_service_account.agent_owner["elena"]` | `sa-elena` | `sa-elena@…` |
| `google_service_account.agent_owner["maya"]` | `sa-maya` | `sa-maya@…` |
| `google_service_account.agent_owner["rachel"]` | `sa-rachel` | `sa-rachel@…` |
| `google_service_account.agent_owner["mia"]` | `sa-mia` | `sa-mia@…` |
| `google_service_account.agent_owner["sarah"]` | `sa-sarah` | `sa-sarah@…` |
| `google_service_account.agent_owner["production_deploy"]` | `sa-production-deploy` | `sa-production-deploy@…` |

Local map: `local.agent_owner_service_accounts` in `infra/terraform/main.tf`. Output: `agent_owner_service_account_emails`.

## 3. GCP actually has (sample inventory)

| Email | Notes |
|-------|--------|
| `glyphor-agent-runner@…` | Matches TF; main agent runtime |
| `glyphor-worker@…` | Matches TF |
| `glyphor-global-admin@…` | Matches TF |
| `glyphor-mcp-client@…` | Not in `iamSync` list |
| `devops-jordan@…` | **Naming drift:** looks like Jordan (devops) but `iamSync` expects `sa-jordan@…` |
| `staging-telemetry-sa@…` | Not in `iamSync` list |
| `…-compute@developer.gserviceaccount.com` | Default compute SA |

**After `terraform apply`:** all `iamSync` emails should exist in GCP. Until then, they are **TF-defined only**.

**Legacy drift:** `devops-jordan@…` may still exist alongside new `sa-jordan@…`. Migrate workloads/IAM to `sa-jordan`, then remove the old SA when safe.

## 4. Gap summary

| Status | Accounts |
|--------|----------|
| **Aligned** | `glyphor-agent-runner`, `glyphor-worker`, `glyphor-global-admin` exist in GCP + TF (shared runtime / admin; not in `iamSync` list). |
| **TF + `iamSync` (created on apply)** | `sa-nadia` + all `google_service_account.agent_owner` keys — see §2. |
| **Legacy** | `devops-jordan` vs `sa-jordan` — two different principals until you consolidate. |

## 5. Next steps

- Run **`terraform apply`** (with working state) to create all `sa-*` accounts in GCP.  
- **Import** if any `sa-*` already exists:  
  `terraform import 'google_service_account.agent_owner["marcus"]' projects/<project>/serviceAccounts/sa-marcus@<project>.iam.gserviceaccount.com`  
- Attach **IAM roles** per agent as you split Cloud Run / deploy identities off `glyphor-agent-runner`.  
- Deprecate **`devops-jordan`** after moving to **`sa-jordan`**.

## 6. Quick refresh commands

```bash
gcloud iam service-accounts list --project=ai-glyphor-company --format="table(email,displayName)"

# Compare to iamSync
grep "email:" packages/integrations/src/governance/iamSync.ts
grep 'resource "google_service_account"' infra/terraform/main.tf -A2
```
