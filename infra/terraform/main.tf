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
    "stripe-secret-key",
    "stripe-webhook-secret",
    "gcp-billing-dataset",
    "gcp-billing-table",
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

# ─── Cloud Run: Scheduler ────────────────────────────────────
resource "google_cloud_run_v2_service" "scheduler" {
  name     = "glyphor-scheduler"
  location = var.region

  template {
    service_account = google_service_account.glyphor.email

    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/glyphor/scheduler:latest"

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      env {
        name  = "NODE_ENV"
        value = "production"
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

# ─── Cloud Run: Chief of Staff Agent ─────────────────────────
resource "google_cloud_run_v2_service" "chief_of_staff" {
  name     = "glyphor-chief-of-staff"
  location = var.region

  template {
    service_account = google_service_account.glyphor.email
    timeout         = "300s"

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
          memory = "256Mi"
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

output "service_account_email" {
  value = google_service_account.glyphor.email
}
