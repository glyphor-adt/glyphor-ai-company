terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }

  backend "gcs" {
    # Configure via: terraform init -backend-config="bucket=<tfstate-bucket>"
  }
}

variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region for resource deployment"
  type        = string
  default     = "us-central1"
}

variable "environment" {
  description = "Deployment environment (dev, staging, prod)"
  type        = string
  default     = "prod"
}

variable "supabase_url" {
  description = "Public Supabase URL for dashboard build"
  type        = string
  default     = "https://ztucrgzcoaryzuvkcaif.supabase.co"
}

variable "supabase_anon_key" {
  description = "Public Supabase anon key for dashboard build"
  type        = string
  sensitive   = true
}

variable "founder_emails" {
  description = "Google accounts allowed to access the dashboard"
  type        = list(string)
  default     = ["kristina@glyphor.ai", "andrew@glyphor.ai"]
}

variable "billing_account_id" {
  description = "GCP billing account ID (format: XXXXXX-XXXXXX-XXXXXX)"
  type        = string
  default     = "012B03-F562EC-184CD8"
}

variable "cfo_emails" {
  description = "CFO / finance Google accounts granted read-only billing access"
  type        = list(string)
  default     = ["cfo@glyphor.ai"]
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# ─── APIs ─────────────────────────────────────────────────────
resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "cloudscheduler.googleapis.com",
    "pubsub.googleapis.com",
    "secretmanager.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "bigquery.googleapis.com",
    "redis.googleapis.com",
    "vpcaccess.googleapis.com",
  ])
  service            = each.value
  disable_on_destroy = false
}

# ─── Service Account ─────────────────────────────────────────
resource "google_service_account" "glyphor" {
  account_id   = "glyphor-agent-runner"
  display_name = "Glyphor Agent Runner"
}

# ─── Artifact Registry ───────────────────────────────────────
resource "google_artifact_registry_repository" "glyphor" {
  location      = var.region
  repository_id = "glyphor"
  format        = "DOCKER"

  depends_on = [google_project_service.apis["artifactregistry.googleapis.com"]]
}

# ─── Pub/Sub ──────────────────────────────────────────────────
resource "google_pubsub_topic" "agent_tasks" {
  name = "glyphor-agent-tasks"

  depends_on = [google_project_service.apis["pubsub.googleapis.com"]]
}

resource "google_pubsub_subscription" "agent_tasks_push" {
  name  = "glyphor-agent-tasks-push"
  topic = google_pubsub_topic.agent_tasks.id

  push_config {
    push_endpoint = google_cloud_run_v2_service.scheduler.uri
    oidc_token {
      service_account_email = google_service_account.glyphor.email
    }
  }

  ack_deadline_seconds = 300
}

resource "google_pubsub_topic" "glyphor_events" {
  name = "glyphor-events"

  depends_on = [google_project_service.apis["pubsub.googleapis.com"]]
}

resource "google_pubsub_subscription" "glyphor_events_push" {
  name  = "glyphor-events-push"
  topic = google_pubsub_topic.glyphor_events.id

  push_config {
    push_endpoint = "${google_cloud_run_v2_service.scheduler.uri}/event"
    oidc_token {
      service_account_email = google_service_account.glyphor.email
    }
  }

  ack_deadline_seconds = 300
}

# ─── Secret Manager ──────────────────────────────────────────
locals {
  secrets = [
    "google-ai-api-key",
    "openai-api-key",
    "anthropic-api-key",
    "supabase-url",
    "supabase-service-key",
    "gcs-bucket",
    "azure-tenant-id",
    "azure-client-id",
    "azure-client-secret",
    "teams-team-id",
    "teams-channel-briefing-kristina-id",
    "teams-channel-briefing-andrew-id",
    "teams-channel-decisions-id",
    "teams-channel-general-id",
    "teams-channel-engineering-id",
    "teams-channel-growth-id",
    "teams-channel-financials-id",
    "teams-channel-product-fuse-id",
    "teams-channel-product-pulse-id",
    "teams-user-andrew-id",
    "teams-user-kristina-id",
    "stripe-secret-key",
    "stripe-webhook-secret",
    "gcp-billing-dataset",
    "gcp-billing-table",
    "azure-mail-client-id",
    "azure-mail-client-secret",
    "github-token",
    "gcp-project-id",
    "acs-connection-string",
    "bot-app-id",
    "bot-app-secret",
  ]
}

resource "google_secret_manager_secret" "secrets" {
  for_each  = toset(local.secrets)
  secret_id = each.value

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis["secretmanager.googleapis.com"]]
}

resource "google_secret_manager_secret_iam_member" "runner_access" {
  for_each  = toset(local.secrets)
  secret_id = google_secret_manager_secret.secrets[each.value].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.glyphor.email}"
}

# ─── VPC Connector (required for Memorystore access) ─────────
resource "google_vpc_access_connector" "glyphor" {
  name          = "glyphor-connector"
  region        = var.region
  ip_cidr_range = "10.8.0.0/28"
  network       = "default"

  depends_on = [google_project_service.apis["vpcaccess.googleapis.com"]]
}

# ─── Memorystore for Redis ───────────────────────────────────
resource "google_redis_instance" "cache" {
  name           = "glyphor-cache"
  tier           = "BASIC"
  memory_size_gb = 1
  region         = var.region

  redis_version = "REDIS_7_2"
  display_name  = "Glyphor Agent Cache"

  # Auth disabled — access controlled by VPC
  auth_enabled = false

  redis_configs = {
    maxmemory-policy = "allkeys-lru"
  }

  depends_on = [google_project_service.apis["redis.googleapis.com"]]
}

# ─── Cloud Run: Scheduler ────────────────────────────────────
resource "google_cloud_run_v2_service" "scheduler" {
  name     = "glyphor-scheduler"
  location = var.region

  template {
    service_account = google_service_account.glyphor.email

    vpc_access {
      connector = google_vpc_access_connector.glyphor.id
      egress    = "PRIVATE_RANGES_ONLY"
    }

    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/glyphor/scheduler:latest"

      resources {
        limits = {
          cpu    = "2"
          memory = "4Gi"
        }
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }

      env {
        name  = "REDIS_HOST"
        value = google_redis_instance.cache.host
      }

      env {
        name  = "REDIS_PORT"
        value = tostring(google_redis_instance.cache.port)
      }

      dynamic "env" {
        for_each = local.secrets
        content {
          name = upper(replace(env.value, "-", "_"))
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.secrets[env.value].secret_id
              version = "latest"
            }
          }
        }
      }
    }

    # Scheduler must be single-instance to prevent duplicate heartbeat processing
    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }
  }

  depends_on = [
    google_project_service.apis["run.googleapis.com"],
    google_secret_manager_secret_iam_member.runner_access,
  ]
}

# ─── Cloud Run: Chief of Staff Agent ─────────────────────────
resource "google_cloud_run_v2_service" "chief_of_staff" {
  name     = "glyphor-chief-of-staff"
  location = var.region

  template {
    service_account = google_service_account.glyphor.email
    timeout         = "300s"

    vpc_access {
      connector = google_vpc_access_connector.glyphor.id
      egress    = "PRIVATE_RANGES_ONLY"
    }

    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/glyphor/chief-of-staff:latest"

      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }

      env {
        name  = "REDIS_HOST"
        value = google_redis_instance.cache.host
      }

      env {
        name  = "REDIS_PORT"
        value = tostring(google_redis_instance.cache.port)
      }

      dynamic "env" {
        for_each = local.secrets
        content {
          name = upper(replace(env.value, "-", "_"))
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.secrets[env.value].secret_id
              version = "latest"
            }
          }
        }
      }
    }

    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }
  }

  depends_on = [
    google_project_service.apis["run.googleapis.com"],
    google_secret_manager_secret_iam_member.runner_access,
  ]
}

# ─── Cloud Run: Voice Gateway ─────────────────────────────────
resource "google_cloud_run_v2_service" "voice_gateway" {
  name     = "glyphor-voice-gateway"
  location = var.region

  template {
    service_account = google_service_account.glyphor.email

    vpc_access {
      connector = google_vpc_access_connector.glyphor.id
      egress    = "PRIVATE_RANGES_ONLY"
    }

    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/glyphor/voice-gateway:latest"

      ports {
        container_port = 8090
      }

      resources {
        limits = {
          cpu    = "2"
          memory = "2Gi"
        }
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }

      env {
        name  = "PORT"
        value = "8090"
      }

      env {
        name  = "REDIS_HOST"
        value = google_redis_instance.cache.host
      }

      env {
        name  = "REDIS_PORT"
        value = tostring(google_redis_instance.cache.port)
      }

      dynamic "env" {
        for_each = local.secrets
        content {
          name = upper(replace(env.value, "-", "_"))
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.secrets[env.value].secret_id
              version = "latest"
            }
          }
        }
      }
    }

    scaling {
      min_instance_count = 0
      max_instance_count = 3
    }
  }

  depends_on = [
    google_project_service.apis["run.googleapis.com"],
    google_secret_manager_secret_iam_member.runner_access,
  ]
}

# ─── Cloud Scheduler: Morning Briefings ──────────────────────
resource "google_cloud_scheduler_job" "briefing_kristina" {
  name      = "cos-briefing-kristina"
  schedule  = "0 12 * * 1-5"
  time_zone = "America/Chicago"
  region    = var.region

  pubsub_target {
    topic_name = google_pubsub_topic.agent_tasks.id
    data = base64encode(jsonencode({
      agentRole = "chief-of-staff"
      task      = "morning_briefing"
      payload   = { founder = "kristina" }
    }))
  }

  depends_on = [google_project_service.apis["cloudscheduler.googleapis.com"]]
}

resource "google_cloud_scheduler_job" "briefing_andrew" {
  name      = "cos-briefing-andrew"
  schedule  = "30 12 * * 1-5"
  time_zone = "America/Chicago"
  region    = var.region

  pubsub_target {
    topic_name = google_pubsub_topic.agent_tasks.id
    data = base64encode(jsonencode({
      agentRole = "chief-of-staff"
      task      = "morning_briefing"
      payload   = { founder = "andrew" }
    }))
  }

  depends_on = [google_project_service.apis["cloudscheduler.googleapis.com"]]
}

# ─── Cloud Scheduler: CoS Orchestration (hourly backup sweep) ──
# Primary detection is via heartbeat (~10 min); this hourly cron is a safety net.
resource "google_cloud_scheduler_job" "cos_orchestrate" {
  name      = "cos-orchestrate"
  schedule  = "0 * * * *"
  time_zone = "UTC"
  region    = var.region

  pubsub_target {
    topic_name = google_pubsub_topic.agent_tasks.id
    data = base64encode(jsonencode({
      agentRole = "chief-of-staff"
      task      = "orchestrate"
      payload   = {}
    }))
  }

  depends_on = [google_project_service.apis["cloudscheduler.googleapis.com"]]
}

# ─── Cloud Scheduler: CoS EOD Summary ───────────────────────
resource "google_cloud_scheduler_job" "cos_eod_summary" {
  name      = "cos-eod-summary"
  schedule  = "0 23 * * *"
  time_zone = "UTC"
  region    = var.region

  pubsub_target {
    topic_name = google_pubsub_topic.agent_tasks.id
    data = base64encode(jsonencode({
      agentRole = "chief-of-staff"
      task      = "eod_summary"
      payload   = {}
    }))
  }

  depends_on = [google_project_service.apis["cloudscheduler.googleapis.com"]]
}

# ─── Cloud Scheduler: C-Suite Agents ─────────────────────────
resource "google_cloud_scheduler_job" "cto_health_check" {
  name      = "cto-health-check"
  schedule  = "0 */2 * * *"
  time_zone = "UTC"
  region    = var.region

  pubsub_target {
    topic_name = google_pubsub_topic.agent_tasks.id
    data = base64encode(jsonencode({
      agentRole = "cto"
      task      = "platform_health_check"
      payload   = {}
    }))
  }

  depends_on = [google_project_service.apis["cloudscheduler.googleapis.com"]]
}

resource "google_cloud_scheduler_job" "cfo_daily_costs" {
  name      = "cfo-daily-costs"
  schedule  = "0 14 * * *"
  time_zone = "America/Chicago"
  region    = var.region

  pubsub_target {
    topic_name = google_pubsub_topic.agent_tasks.id
    data = base64encode(jsonencode({
      agentRole = "cfo"
      task      = "daily_cost_check"
      payload   = {}
    }))
  }

  depends_on = [google_project_service.apis["cloudscheduler.googleapis.com"]]
}

resource "google_cloud_scheduler_job" "cpo_usage_analysis" {
  name      = "cpo-usage-analysis"
  schedule  = "0 15 * * *"
  time_zone = "America/Chicago"
  region    = var.region

  pubsub_target {
    topic_name = google_pubsub_topic.agent_tasks.id
    data = base64encode(jsonencode({
      agentRole = "cpo"
      task      = "weekly_usage_analysis"
      payload   = {}
    }))
  }

  depends_on = [google_project_service.apis["cloudscheduler.googleapis.com"]]
}

resource "google_cloud_scheduler_job" "cmo_content_calendar" {
  name      = "cmo-content-calendar"
  schedule  = "0 14 * * *"
  time_zone = "America/Chicago"
  region    = var.region

  pubsub_target {
    topic_name = google_pubsub_topic.agent_tasks.id
    data = base64encode(jsonencode({
      agentRole = "cmo"
      task      = "weekly_content_planning"
      payload   = {}
    }))
  }

  depends_on = [google_project_service.apis["cloudscheduler.googleapis.com"]]
}

resource "google_cloud_scheduler_job" "vpcs_health_scoring" {
  name      = "vpcs-health-scoring"
  schedule  = "0 13 * * *"
  time_zone = "America/Chicago"
  region    = var.region

  pubsub_target {
    topic_name = google_pubsub_topic.agent_tasks.id
    data = base64encode(jsonencode({
      agentRole = "vp-customer-success"
      task      = "daily_health_scoring"
      payload   = {}
    }))
  }

  depends_on = [google_project_service.apis["cloudscheduler.googleapis.com"]]
}

resource "google_cloud_scheduler_job" "vps_pipeline_review" {
  name      = "vps-pipeline-review"
  schedule  = "0 14 * * *"
  time_zone = "America/Chicago"
  region    = var.region

  pubsub_target {
    topic_name = google_pubsub_topic.agent_tasks.id
    data = base64encode(jsonencode({
      agentRole = "vp-sales"
      task      = "pipeline_review"
      payload   = {}
    }))
  }

  depends_on = [google_project_service.apis["cloudscheduler.googleapis.com"]]
}

# ─── Cloud Scheduler: Data Sync Jobs ─────────────────────────
resource "google_cloud_scheduler_job" "sync_stripe" {
  name      = "sync-stripe"
  schedule  = "0 6 * * *"
  time_zone = "UTC"
  region    = var.region

  http_target {
    uri         = "${google_cloud_run_v2_service.scheduler.uri}/sync/stripe"
    http_method = "POST"
    oidc_token {
      service_account_email = google_service_account.glyphor.email
    }
  }

  depends_on = [google_project_service.apis["cloudscheduler.googleapis.com"]]
}

resource "google_cloud_scheduler_job" "sync_gcp_billing" {
  name      = "sync-gcp-billing"
  schedule  = "0 7 * * *"
  time_zone = "UTC"
  region    = var.region

  http_target {
    uri         = "${google_cloud_run_v2_service.scheduler.uri}/sync/gcp-billing"
    http_method = "POST"
    oidc_token {
      service_account_email = google_service_account.glyphor.email
    }
  }

  depends_on = [google_project_service.apis["cloudscheduler.googleapis.com"]]
}

resource "google_cloud_scheduler_job" "sync_mercury" {
  name      = "sync-mercury"
  schedule  = "0 8 * * *"
  time_zone = "UTC"
  region    = var.region

  http_target {
    uri         = "${google_cloud_run_v2_service.scheduler.uri}/sync/mercury"
    http_method = "POST"
    oidc_token {
      service_account_email = google_service_account.glyphor.email
    }
  }

  depends_on = [google_project_service.apis["cloudscheduler.googleapis.com"]]
}

# ─── IAM ──────────────────────────────────────────────────────
resource "google_cloud_run_v2_service_iam_member" "scheduler_invoker" {
  name     = google_cloud_run_v2_service.scheduler.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.glyphor.email}"
}

resource "google_cloud_run_v2_service_iam_member" "cos_invoker" {
  name     = google_cloud_run_v2_service.chief_of_staff.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.glyphor.email}"
}

# Voice gateway is publicly accessible — dashboard browser calls it directly
resource "google_cloud_run_v2_service_iam_member" "voice_gateway_public" {
  name     = google_cloud_run_v2_service.voice_gateway.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_project_iam_member" "gcs_access" {
  project = var.project_id
  role    = "roles/storage.objectAdmin"
  member  = "serviceAccount:${google_service_account.glyphor.email}"
}

resource "google_project_iam_member" "monitoring_viewer" {
  project = var.project_id
  role    = "roles/monitoring.viewer"
  member  = "serviceAccount:${google_service_account.glyphor.email}"
}

resource "google_project_iam_member" "cloudbuild_viewer" {
  project = var.project_id
  role    = "roles/cloudbuild.builds.viewer"
  member  = "serviceAccount:${google_service_account.glyphor.email}"
}

# ─── Cloud Run: Dashboard ─────────────────────────────────────
resource "google_cloud_run_v2_service" "dashboard" {
  name     = "glyphor-dashboard"
  location = var.region

  template {
    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/glyphor/dashboard:latest"

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "4Gi"
        }
      }

      startup_probe {
        http_get {
          path = "/healthz"
          port = 8080
        }
        initial_delay_seconds = 0
        period_seconds        = 3
        failure_threshold     = 3
      }
    }

    scaling {
      min_instance_count = 0
      max_instance_count = 3
    }
  }

  depends_on = [
    google_project_service.apis["run.googleapis.com"],
  ]
}

# Dashboard is publicly accessible — app handles Google Sign-In auth
resource "google_cloud_run_v2_service_iam_member" "dashboard_public" {
  name     = google_cloud_run_v2_service.dashboard.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ─── CFO Billing Access ───────────────────────────────────────
# billing.viewer  → GCP Console › Billing: cost reports, invoices, budgets
# bigquery.dataViewer + bigquery.jobUser → direct SQL on the billing export dataset

resource "google_billing_account_iam_member" "cfo_billing_viewer" {
  for_each           = toset(var.cfo_emails)
  billing_account_id = var.billing_account_id
  role               = "roles/billing.viewer"
  member             = "user:${each.value}"
}

resource "google_bigquery_dataset_iam_member" "cfo_bq_data_viewer" {
  for_each   = toset(var.cfo_emails)
  project    = var.project_id
  dataset_id = "billing_export"
  role       = "roles/bigquery.dataViewer"
  member     = "user:${each.value}"
}

resource "google_project_iam_member" "cfo_bq_job_user" {
  for_each = toset(var.cfo_emails)
  project  = var.project_id
  role     = "roles/bigquery.jobUser"
  member   = "user:${each.value}"
}

# ─── Scheduler SA → BigQuery (billing sync) ──────────────────
resource "google_bigquery_dataset_iam_member" "scheduler_bq_data_viewer" {
  project    = var.project_id
  dataset_id = "billing_export"
  role       = "roles/bigquery.dataViewer"
  member     = "serviceAccount:${google_service_account.glyphor.email}"
}

resource "google_project_iam_member" "scheduler_bq_job_user" {
  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.glyphor.email}"
}

# ─── Cross-Project Access: Fuse & Pulse ──────────────────────
# Marcus (CTO) needs visibility into the Fuse and Pulse GCP projects
# for platform health monitoring, deployment management, and log access.

variable "fuse_project_id" {
  description = "GCP project ID for the Fuse product"
  type        = string
  default     = "gen-lang-client-0834143721"
}

variable "pulse_project_id" {
  description = "GCP project ID for the Pulse product"
  type        = string
  default     = "glyphor-pulse"
}

locals {
  # Roles granted on both Fuse and Pulse projects
  cross_project_roles = [
    "roles/monitoring.viewer",
    "roles/run.viewer",
    "roles/logging.viewer",
    "roles/cloudbuild.builds.viewer",
  ]
}

resource "google_project_iam_member" "fuse_access" {
  for_each = toset(local.cross_project_roles)
  project  = var.fuse_project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.glyphor.email}"
}

resource "google_project_iam_member" "fuse_secrets" {
  project = var.fuse_project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.glyphor.email}"
}

resource "google_project_iam_member" "pulse_access" {
  for_each = toset(local.cross_project_roles)
  project  = var.pulse_project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.glyphor.email}"
}

# ─── Global Admin — Central Access Provisioning ──────────────
# Manages IAM for all agent service accounts across all projects.
# Scoped to service-account-level admin — CANNOT modify project-level
# IAM bindings where founder access (kristina@, andrew@, DevOps@) lives.

resource "google_service_account" "global_admin" {
  account_id   = "glyphor-global-admin"
  display_name = "Glyphor Global Admin"
  description  = "Central admin for provisioning access across all Glyphor projects. Cannot modify founder access."
}

locals {
  # Scoped admin roles — can manage service accounts and secrets,
  # but NOT project-level IAM (protects founder bindings).
  global_admin_roles = [
    "roles/iam.serviceAccountAdmin",     # Create/manage service accounts
    "roles/iam.serviceAccountKeyAdmin",  # Manage SA keys
    "roles/iam.roleViewer",              # View available roles
    "roles/secretmanager.admin",         # Manage secrets + their IAM
    "roles/run.admin",                   # Manage Cloud Run + its IAM
  ]

  all_project_ids = [
    var.project_id,
    var.fuse_project_id,
    var.pulse_project_id,
  ]

  # Cartesian product: every (project, role) pair
  admin_bindings = flatten([
    for proj in local.all_project_ids : [
      for role in local.global_admin_roles : {
        key     = "${proj}--${role}"
        project = proj
        role    = role
      }
    ]
  ])
}

resource "google_project_iam_member" "global_admin_access" {
  for_each = { for b in local.admin_bindings : b.key => b }
  project  = each.value.project
  role     = each.value.role
  member   = "serviceAccount:${google_service_account.global_admin.email}"
}

# ─── Outputs ──────────────────────────────────────────────────
output "dashboard_url" {
  value = google_cloud_run_v2_service.dashboard.uri
}

output "scheduler_url" {
  value = google_cloud_run_v2_service.scheduler.uri
}

output "chief_of_staff_url" {
  value = google_cloud_run_v2_service.chief_of_staff.uri
}

output "voice_gateway_url" {
  value = google_cloud_run_v2_service.voice_gateway.uri
}

output "service_account_email" {
  value = google_service_account.glyphor.email
}

output "global_admin_email" {
  value = google_service_account.global_admin.email
}

output "redis_host" {
  value = google_redis_instance.cache.host
}

output "redis_port" {
  value = google_redis_instance.cache.port
}
