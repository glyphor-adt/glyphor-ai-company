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

# ─── Secret Manager ──────────────────────────────────────────
locals {
  secrets = [
    "google-ai-api-key",
    "supabase-url",
    "supabase-service-key",
    "gcs-bucket",
    "teams-webhook-kristina",
    "teams-webhook-andrew",
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

# ─── Outputs ──────────────────────────────────────────────────
output "scheduler_url" {
  value = google_cloud_run_v2_service.scheduler.uri
}

output "chief_of_staff_url" {
  value = google_cloud_run_v2_service.chief_of_staff.uri
}

output "service_account_email" {
  value = google_service_account.glyphor.email
}
