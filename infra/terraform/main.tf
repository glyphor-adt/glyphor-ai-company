terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }

  backend "gcs" {
    # Bucket + prefix: see backend.hcl — run: terraform init -backend-config=backend.hcl
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

variable "cfo_billing_console_users" {
  description = "Optional Google accounts (Workspace users) that also get read-only billing console + BigQuery export access. Nadia the CFO agent uses the dedicated SA sa-nadia (see google_service_account.cfo_agent), not an inbox."
  type        = list(string)
  default     = []
}

variable "enable_chief_of_staff_cloud_run" {
  description = "Create glyphor-chief-of-staff Cloud Run (needs image + all Secret Manager versions referenced in env)"
  type        = bool
  default     = false
}

variable "enable_decisions_api_cloud_run" {
  description = "Create glyphor-decisions-api Cloud Run (needs decisions-api image in Artifact Registry)"
  type        = bool
  default     = false
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
    "sqladmin.googleapis.com",
    "cloudtasks.googleapis.com",
    "firebase.googleapis.com",
  ])
  service            = each.value
  disable_on_destroy = false
}

# ─── Service Account ─────────────────────────────────────────
resource "google_service_account" "glyphor" {
  account_id   = "glyphor-agent-runner"
  display_name = "Glyphor Agent Runner"
  description  = "Service account for Glyphor AI agent Cloud Run services"
}

resource "google_service_account" "worker" {
  account_id   = "glyphor-worker"
  display_name = "Glyphor Worker"
}

# Nadia (CFO) — matches packages/integrations/src/governance/iamSync.ts (sa-nadia@…)
resource "google_service_account" "cfo_agent" {
  account_id   = "sa-nadia"
  display_name = "Nadia (CFO agent)"
  description  = "Dedicated service account for the CFO agent; grant BigQuery/billing read for tools or future direct export queries"
}

# Per-agent service accounts — keep in sync with packages/integrations/src/governance/iamSync.ts SERVICE_ACCOUNTS
# (sa-nadia is google_service_account.cfo_agent above, not repeated here)
locals {
  agent_owner_service_accounts = {
    marcus = {
      account_id   = "sa-marcus"
      display_name = "Marcus Reeves (CTO agent)"
    }
    alex = {
      account_id   = "sa-alex"
      display_name = "Alex Park (platform engineer agent)"
    }
    jordan = {
      account_id   = "sa-jordan"
      display_name = "Jordan Hayes (devops engineer agent)"
    }
    elena = {
      account_id   = "sa-elena"
      display_name = "Elena Vasquez (CPO agent)"
    }
    maya = {
      account_id   = "sa-maya"
      display_name = "Maya Brooks (CMO agent)"
    }
    rachel = {
      account_id   = "sa-rachel"
      display_name = "Rachel Kim (VP sales agent)"
    }
    mia = {
      account_id   = "sa-mia"
      display_name = "Mia Tanaka (VP design agent)"
    }
    sarah = {
      account_id   = "sa-sarah"
      display_name = "Sarah Chen (Chief of Staff agent)"
    }
    production_deploy = {
      account_id   = "sa-production-deploy"
      display_name = "Production deploy automation"
    }
  }
}

resource "google_service_account" "agent_owner" {
  for_each     = local.agent_owner_service_accounts
  account_id   = each.value.account_id
  display_name = each.value.display_name
  description  = "Per-agent identity; must match iamSync.ts SERVICE_ACCOUNTS emails for this project"
}

# ─── Artifact Registry ───────────────────────────────────────
resource "google_artifact_registry_repository" "glyphor" {
  location        = var.region
  repository_id = "glyphor"
  format          = "DOCKER"
  description     = "Glyphor AI Company container images"

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

  lifecycle {
    ignore_changes = [push_config, ack_deadline_seconds]
  }
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
    "teams-channel-product-web-build-id",
    "teams-channel-product-pulse-id",
    "teams-user-andrew-id",
    "teams-user-kristina-id",
    # Graph @mentions on #Deliverables — Entra user object IDs
    "teams-founder-kristina-aad-id",
    "teams-founder-andrew-aad-id",
    "stripe-secret-key",
    "stripe-webhook-secret",
    "gcp-billing-dataset",
    "gcp-billing-table",
    "azure-mail-client-id",
    "azure-mail-client-secret",
    "github-token",
    "gcp-project-id",
    # Pulse Creative Studio MCP (CMO, content-creator, social-media-manager) — versions must exist in Secret Manager
    "pulse-service-role-key",
    "pulse-mcp-endpoint",
    "acs-connection-string",
    "bot-app-id",
    "bot-app-secret",
    "db-password",
    "db-readonly-password",
    "firebase-client-email",
    "firebase-private-key",
  ]

  # db-password is injected explicitly as DB_PASSWORD on Cloud Run services that use Cloud SQL — do not duplicate via dynamic env.
  cloud_run_secret_env_keys = [for s in local.secrets : s if s != "db-password"]
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

resource "google_secret_manager_secret_iam_member" "worker_secret_access" {
  for_each  = toset(local.secrets)
  secret_id = google_secret_manager_secret.secrets[each.value].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.worker.email}"
}

# ─── VPC Connector (required for Memorystore access) ─────────
resource "google_vpc_access_connector" "glyphor" {
  name          = "glyphor-connector"
  region        = var.region
  ip_cidr_range = "10.8.0.0/28"
  network       = "default"

  depends_on = [google_project_service.apis["vpcaccess.googleapis.com"]]

  # Imported connector: GCP sets throughput/instance defaults that differ from provider defaults; avoid forced replacement
  lifecycle {
    ignore_changes = [
      max_throughput,
      min_throughput,
      min_instances,
      max_instances,
    ]
  }
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

# ─── Cloud SQL for PostgreSQL ─────────────────────────────────
resource "google_sql_database_instance" "glyphor_db" {
  name             = "glyphor-db"
  database_version = "POSTGRES_15"
  region           = var.region

  settings {
    tier              = "db-custom-2-8192"
    availability_type = "REGIONAL"
    disk_size         = 20
    disk_autoresize   = true

    backup_configuration {
      enabled                        = true
      start_time                     = "03:00"
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = 7
      backup_retention_settings {
        retained_backups = 14
      }
    }

    maintenance_window {
      day  = 7 # Sunday
      hour = 5
    }

    database_flags {
      name  = "max_connections"
      value = "200"
    }

    # Matches live instance (public IP + authorized networks). Do not switch to private-only here without a migration plan.
    ip_configuration {
      ipv4_enabled = true
      authorized_networks {
        value = "104.190.175.230/32"
      }
    }
  }

  deletion_protection = true

  lifecycle {
    ignore_changes = [settings]
  }

  depends_on = [google_project_service.apis["sqladmin.googleapis.com"]]
}

resource "google_sql_database" "glyphor" {
  name     = "glyphor"
  instance = google_sql_database_instance.glyphor_db.name
}

resource "google_sql_user" "glyphor_app" {
  name     = "glyphor_app"
  instance = google_sql_database_instance.glyphor_db.name
  password = data.google_secret_manager_secret_version.db_password.secret_data
  lifecycle {
    ignore_changes = [password]
  }
}

# Password is not read from Secret Manager here: the principal running Terraform may lack
# accessor on db-readonly-password while still managing other resources. After import,
# ignore_changes keeps the real password in Cloud SQL in sync with the secret outside TF.
resource "google_sql_user" "glyphor_readonly" {
  name     = "glyphor_readonly"
  instance = google_sql_database_instance.glyphor_db.name
  password = "import-placeholder-do-not-use-rotate-in-console"
  lifecycle {
    ignore_changes = [password]
  }
}

# Read by secret id so plan/refresh works before all google_secret_manager_secret.secrets are in state
data "google_secret_manager_secret_version" "db_password" {
  project = var.project_id
  secret  = "db-password"
  version = "latest"
}

# ─── Cloud Storage: Platform Assets ──────────────────────────
resource "google_storage_bucket" "platform_assets" {
  name     = "glyphor-platform-assets"
  location = var.region

  uniform_bucket_level_access = true
  force_destroy               = false

  cors {
    origin          = ["https://app.glyphor.ai", "http://localhost:3000"]
    response_header = ["Content-Type", "Content-Range"]
    method          = ["GET", "HEAD", "PUT", "POST"]
    max_age_seconds = 3600
  }
}

# ─── Cloud Tasks Queues ──────────────────────────────────────
resource "google_cloud_tasks_queue" "agent_runs" {
  name     = "agent-runs"
  location = var.region

  rate_limits {
    max_dispatches_per_second = 50
    max_concurrent_dispatches = 100
  }

  retry_config {
    max_attempts       = 3
    min_backoff        = "10s"
    max_backoff        = "300s"
    max_retry_duration = "0s"
  }

  depends_on = [google_project_service.apis["cloudtasks.googleapis.com"]]

  lifecycle {
    ignore_changes = [rate_limits, retry_config]
  }
}

resource "google_cloud_tasks_queue" "agent_runs_priority" {
  name     = "agent-runs-priority"
  location = var.region

  rate_limits {
    max_dispatches_per_second = 20
    max_concurrent_dispatches = 50
  }

  retry_config {
    max_attempts       = 5
    min_backoff        = "5s"
    max_backoff        = "120s"
    max_retry_duration = "0s"
  }

  depends_on = [google_project_service.apis["cloudtasks.googleapis.com"]]

  lifecycle {
    ignore_changes = [rate_limits, retry_config]
  }
}

resource "google_cloud_tasks_queue" "delivery" {
  name     = "delivery"
  location = var.region

  rate_limits {
    max_dispatches_per_second = 10
    max_concurrent_dispatches = 50
  }

  retry_config {
    max_attempts       = 3
    min_backoff        = "5s"
    max_backoff        = "60s"
    max_retry_duration = "0s"
  }

  depends_on = [google_project_service.apis["cloudtasks.googleapis.com"]]

  lifecycle {
    ignore_changes = [rate_limits, retry_config]
  }
}

# ─── Cloud Run: Scheduler ────────────────────────────────────
resource "google_cloud_run_v2_service" "scheduler" {
  name     = "glyphor-scheduler"
  location = var.region

  template {
    service_account = google_service_account.glyphor.email
    timeout         = "1800s"

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

      env {
        name  = "REDIS_TLS"
        value = "false"
      }

      env {
        name  = "WORKER_URL"
        value = google_cloud_run_v2_service.worker.uri
      }

      env {
        name  = "WORKER_SERVICE_ACCOUNT"
        value = google_service_account.worker.email
      }

      dynamic "env" {
        for_each = local.cloud_run_secret_env_keys
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

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      env {
        name  = "DB_HOST"
        value = "/cloudsql/${google_sql_database_instance.glyphor_db.connection_name}"
      }
      env {
        name  = "DB_NAME"
        value = "glyphor"
      }
      env {
        name  = "DB_USER"
        value = "glyphor_app"
      }
      env {
        name = "DB_PASSWORD"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.secrets["db-password"].secret_id
            version = "latest"
          }
        }
      }
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.glyphor_db.connection_name]
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

  # Deployed revision is source of truth (image digests, env order, probes) until CI pins digests in TF
  lifecycle {
    ignore_changes = [template, client, client_version]
  }
}

# ─── Cloud Run: Chief of Staff Agent ─────────────────────────
resource "google_cloud_run_v2_service" "chief_of_staff" {
  count    = var.enable_chief_of_staff_cloud_run ? 1 : 0
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

      env {
        name  = "REDIS_TLS"
        value = "false"
      }

      dynamic "env" {
        for_each = local.cloud_run_secret_env_keys
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

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      env {
        name  = "DB_HOST"
        value = "/cloudsql/${google_sql_database_instance.glyphor_db.connection_name}"
      }
      env {
        name  = "DB_NAME"
        value = "glyphor"
      }
      env {
        name  = "DB_USER"
        value = "glyphor_app"
      }
      env {
        name = "DB_PASSWORD"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.secrets["db-password"].secret_id
            version = "latest"
          }
        }
      }
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.glyphor_db.connection_name]
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

      env {
        name  = "REDIS_TLS"
        value = "false"
      }

      dynamic "env" {
        for_each = local.cloud_run_secret_env_keys
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

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      env {
        name  = "DB_HOST"
        value = "/cloudsql/${google_sql_database_instance.glyphor_db.connection_name}"
      }
      env {
        name  = "DB_NAME"
        value = "glyphor"
      }
      env {
        name  = "DB_USER"
        value = "glyphor_app"
      }
      env {
        name = "DB_PASSWORD"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.secrets["db-password"].secret_id
            version = "latest"
          }
        }
      }
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.glyphor_db.connection_name]
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

  lifecycle {
    ignore_changes = [template, client, client_version]
  }
}

# ─── Cloud Run: Worker ────────────────────────────────────────
resource "google_cloud_run_v2_service" "worker" {
  name     = "glyphor-worker"
  location = var.region

  template {
    service_account = google_service_account.worker.email
    timeout         = "1800s"

    vpc_access {
      connector = google_vpc_access_connector.glyphor.id
      egress    = "PRIVATE_RANGES_ONLY"
    }

    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/glyphor/worker:latest"

      ports {
        container_port = 8080
      }

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

      env {
        name  = "REDIS_TLS"
        value = "false"
      }

      dynamic "env" {
        for_each = local.cloud_run_secret_env_keys
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

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      env {
        name  = "DB_HOST"
        value = "/cloudsql/${google_sql_database_instance.glyphor_db.connection_name}"
      }
      env {
        name  = "DB_NAME"
        value = "glyphor"
      }
      env {
        name  = "DB_USER"
        value = "glyphor_app"
      }
      env {
        name = "DB_PASSWORD"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.secrets["db-password"].secret_id
            version = "latest"
          }
        }
      }
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.glyphor_db.connection_name]
      }
    }

    scaling {
      min_instance_count = 1
      max_instance_count = 100
    }

    max_instance_request_concurrency = 10
  }

  depends_on = [
    google_project_service.apis["run.googleapis.com"],
    google_secret_manager_secret_iam_member.worker_secret_access,
  ]

  lifecycle {
    ignore_changes = [template, client, client_version]
  }
}

# ─── Cloud Run: Decisions API ────────────────────────────────
resource "google_cloud_run_v2_service" "decisions_api" {
  count    = var.enable_decisions_api_cloud_run ? 1 : 0
  name     = "glyphor-decisions-api"
  location = var.region

  template {
    service_account = google_service_account.glyphor.email
    timeout         = "60s"

    vpc_access {
      connector = google_vpc_access_connector.glyphor.id
      egress    = "PRIVATE_RANGES_ONLY"
    }

    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/glyphor/decisions-api:latest"

      ports {
        container_port = 8080
      }

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
        for_each = local.cloud_run_secret_env_keys
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

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      env {
        name  = "DB_HOST"
        value = "/cloudsql/${google_sql_database_instance.glyphor_db.connection_name}"
      }
      env {
        name  = "DB_NAME"
        value = "glyphor"
      }
      env {
        name  = "DB_USER"
        value = "glyphor_app"
      }
      env {
        name = "DB_PASSWORD"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.secrets["db-password"].secret_id
            version = "latest"
          }
        }
      }
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.glyphor_db.connection_name]
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

# ─── Cloud Scheduler: Morning Briefing (both founders, single run) ──────────
resource "google_cloud_scheduler_job" "briefing_both" {
  name      = "cos-briefing-both"
  schedule  = "0 12 * * 1-5"
  time_zone = "America/Chicago"
  region    = var.region

  pubsub_target {
    topic_name = google_pubsub_topic.agent_tasks.id
    data = base64encode(jsonencode({
      agentRole = "chief-of-staff"
      task      = "morning_briefing"
      payload   = { founder = "both" }
    }))
  }

  depends_on = [google_project_service.apis["cloudscheduler.googleapis.com"]]
}

# ─── Cloud Scheduler: CoS Midday Status Digest ──────────────
resource "google_cloud_scheduler_job" "cos_midday_digest" {
  name      = "cos-midday-digest"
  schedule  = "0 12 * * 1-5"
  time_zone = "America/Chicago"
  region    = var.region

  pubsub_target {
    topic_name = google_pubsub_topic.agent_tasks.id
    data = base64encode(jsonencode({
      agentRole = "chief-of-staff"
      task      = "midday_digest"
      payload   = { founder = "both" }
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
  schedule  = "0 18 * * 1-5"
  time_zone = "America/Chicago"
  region    = var.region

  pubsub_target {
    topic_name = google_pubsub_topic.agent_tasks.id
    data = base64encode(jsonencode({
      agentRole = "chief-of-staff"
      task      = "eod_summary"
      payload   = { founder = "both" }
    }))
  }

  depends_on = [google_project_service.apis["cloudscheduler.googleapis.com"]]
}

# ─── Cloud Scheduler: CoS Weekly Review ─────────────────────
resource "google_cloud_scheduler_job" "cos_weekly_review" {
  name      = "cos-weekly-review"
  schedule  = "0 9 * * 1"
  time_zone = "America/Chicago"
  region    = var.region

  pubsub_target {
    topic_name = google_pubsub_topic.agent_tasks.id
    data = base64encode(jsonencode({
      agentRole = "chief-of-staff"
      task      = "weekly_review"
      payload   = {}
    }))
  }

  depends_on = [google_project_service.apis["cloudscheduler.googleapis.com"]]
}

# ─── Cloud Scheduler: CoS Monthly Retrospective ─────────────
resource "google_cloud_scheduler_job" "cos_monthly_retrospective" {
  name      = "cos-monthly-retrospective"
  schedule  = "0 10 1 * *"
  time_zone = "America/Chicago"
  region    = var.region

  pubsub_target {
    topic_name = google_pubsub_topic.agent_tasks.id
    data = base64encode(jsonencode({
      agentRole = "chief-of-staff"
      task      = "monthly_retrospective"
      payload   = {}
    }))
  }

  depends_on = [google_project_service.apis["cloudscheduler.googleapis.com"]]
}

# ─── Cloud Scheduler: CoS Strategic Planning ────────────────
resource "google_cloud_scheduler_job" "cos_strategic_planning" {
  name      = "cos-strategic-planning"
  schedule  = "0 14 * * 1"
  time_zone = "America/Chicago"
  region    = var.region

  pubsub_target {
    topic_name = google_pubsub_topic.agent_tasks.id
    data = base64encode(jsonencode({
      agentRole = "chief-of-staff"
      task      = "strategic_planning"
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

# ─── CTO: Daily Deployment Summary (weekdays 9am CT) ────────
resource "google_cloud_scheduler_job" "cto_daily_deploy_summary" {
  name      = "cto-daily-deploy-summary"
  schedule  = "0 9 * * 1-5"
  time_zone = "America/Chicago"
  region    = var.region

  pubsub_target {
    topic_name = google_pubsub_topic.agent_tasks.id
    data = base64encode(jsonencode({
      agentRole = "cto"
      task      = "daily_deployment_summary"
      payload   = {}
    }))
  }

  depends_on = [google_project_service.apis["cloudscheduler.googleapis.com"]]
}

# ─── CTO: Weekly Infrastructure Audit (Monday 8am CT) ────────
resource "google_cloud_scheduler_job" "cto_weekly_infra_audit" {
  name      = "cto-weekly-infra-audit"
  schedule  = "0 8 * * 1"
  time_zone = "America/Chicago"
  region    = var.region

  pubsub_target {
    topic_name = google_pubsub_topic.agent_tasks.id
    data = base64encode(jsonencode({
      agentRole = "cto"
      task      = "infrastructure_audit"
      payload   = {}
    }))
  }

  depends_on = [google_project_service.apis["cloudscheduler.googleapis.com"]]
}

# ─── CTO (Marcus) IAM — per-agent SA role bindings ──────────
# Desired state: run.developer (not admin), scoped pubsub, cloudbuild, logging
locals {
  cto_agent_roles = [
    "roles/run.developer",
    "roles/pubsub.publisher",
    "roles/pubsub.subscriber",
    "roles/secretmanager.secretAccessor",
    "roles/storage.objectAdmin",
    "roles/cloudbuild.builds.editor",
    "roles/logging.viewer",
    "roles/artifactregistry.reader",
  ]
}

resource "google_project_iam_member" "cto_agent_roles" {
  for_each = toset(local.cto_agent_roles)
  project  = var.project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.agent_owner["marcus"].email}"
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

# ─── Agent365 Mail Triage (weekday mornings, staggered) ──────
resource "google_cloud_scheduler_job" "cos_mail_triage" {
  name      = "cos-mail-triage"
  schedule  = "0 8 * * 1-5"
  time_zone = "America/Chicago"
  region    = var.region

  pubsub_target {
    topic_name = google_pubsub_topic.agent_tasks.id
    data = base64encode(jsonencode({
      agentRole = "chief-of-staff"
      task      = "agent365_mail_triage"
      payload   = {}
    }))
  }

  depends_on = [google_project_service.apis["cloudscheduler.googleapis.com"]]
}

resource "google_cloud_scheduler_job" "cto_mail_triage" {
  name      = "cto-mail-triage"
  schedule  = "15 8 * * 1-5"
  time_zone = "America/Chicago"
  region    = var.region

  pubsub_target {
    topic_name = google_pubsub_topic.agent_tasks.id
    data = base64encode(jsonencode({
      agentRole = "cto"
      task      = "agent365_mail_triage"
      payload   = {}
    }))
  }

  depends_on = [google_project_service.apis["cloudscheduler.googleapis.com"]]
}

resource "google_cloud_scheduler_job" "cfo_mail_triage" {
  name      = "cfo-mail-triage"
  schedule  = "30 8 * * 1-5"
  time_zone = "America/Chicago"
  region    = var.region

  pubsub_target {
    topic_name = google_pubsub_topic.agent_tasks.id
    data = base64encode(jsonencode({
      agentRole = "cfo"
      task      = "agent365_mail_triage"
      payload   = {}
    }))
  }

  depends_on = [google_project_service.apis["cloudscheduler.googleapis.com"]]
}

resource "google_cloud_scheduler_job" "cpo_mail_triage" {
  name      = "cpo-mail-triage"
  schedule  = "45 8 * * 1-5"
  time_zone = "America/Chicago"
  region    = var.region

  pubsub_target {
    topic_name = google_pubsub_topic.agent_tasks.id
    data = base64encode(jsonencode({
      agentRole = "cpo"
      task      = "agent365_mail_triage"
      payload   = {}
    }))
  }

  depends_on = [google_project_service.apis["cloudscheduler.googleapis.com"]]
}

resource "google_cloud_scheduler_job" "cmo_mail_triage" {
  name      = "cmo-mail-triage"
  schedule  = "0 9 * * 1-5"
  time_zone = "America/Chicago"
  region    = var.region

  pubsub_target {
    topic_name = google_pubsub_topic.agent_tasks.id
    data = base64encode(jsonencode({
      agentRole = "cmo"
      task      = "agent365_mail_triage"
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

# ─── Cloud Scheduler: Heartbeat ──────────────────────────────
# Fires every 10 minutes to run lightweight agent check-ins (DB only, no LLM calls).
# Dispatches work_loop tasks for agents with pending assignments or wake-queue entries.
resource "google_cloud_scheduler_job" "heartbeat" {
  name             = "glyphor-heartbeat"
  schedule         = "*/10 * * * *"
  time_zone        = "UTC"
  region           = var.region
  attempt_deadline = "120s"

  http_target {
    uri         = "${google_cloud_run_v2_service.scheduler.uri}/heartbeat"
    http_method = "POST"
    body        = base64encode("{}")
    headers = {
      "Content-Type" = "application/json"
    }
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
  count    = var.enable_chief_of_staff_cloud_run ? 1 : 0
  name     = google_cloud_run_v2_service.chief_of_staff[0].name
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

resource "google_project_iam_member" "cloudsql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.glyphor.email}"
}

resource "google_project_iam_member" "worker_cloudsql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.worker.email}"
}

# gcp_create_secret / tooling: add secret versions (secretAccessor alone is read-only)
resource "google_project_iam_member" "glyphor_secret_version_adder" {
  project = var.project_id
  role    = "roles/secretmanager.secretVersionAdder"
  member  = "serviceAccount:${google_service_account.glyphor.email}"
}

resource "google_project_iam_member" "worker_secret_version_adder" {
  project = var.project_id
  role    = "roles/secretmanager.secretVersionAdder"
  member  = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_cloud_run_v2_service_iam_member" "worker_invoker" {
  name     = google_cloud_run_v2_service.worker.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.glyphor.email}"
}

resource "google_cloud_run_v2_service_iam_member" "decisions_api_invoker" {
  count    = var.enable_decisions_api_cloud_run ? 1 : 0
  name     = google_cloud_run_v2_service.decisions_api[0].name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.glyphor.email}"
}

resource "google_project_iam_member" "cloudtasks_enqueuer" {
  project = var.project_id
  role    = "roles/cloudtasks.enqueuer"
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

  lifecycle {
    ignore_changes = [template, client, client_version]
  }
}

# Dashboard is publicly accessible — app handles Google Sign-In auth
resource "google_cloud_run_v2_service_iam_member" "dashboard_public" {
  name     = google_cloud_run_v2_service.dashboard.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ─── CFO billing access (Nadia = service account, not a Google user) ───
# See packages/integrations/src/governance/iamSync.ts — sa-nadia@<project>.iam.gserviceaccount.com
# billing.viewer → Billing API / console-style visibility for that principal
# bigquery.dataViewer + bigquery.jobUser → query billing export table in BigQuery
# Note: CFO tools today mostly read synced costs from Cloud SQL (gcp_billing); this SA is the
# correct GCP identity if you run CFO as this SA or add direct BigQuery tools later.

resource "google_billing_account_iam_member" "cfo_agent_billing_viewer" {
  billing_account_id = var.billing_account_id
  role               = "roles/billing.viewer"
  member             = "serviceAccount:${google_service_account.cfo_agent.email}"
}

resource "google_bigquery_dataset_iam_member" "cfo_agent_bq_data_viewer" {
  project    = var.project_id
  dataset_id = "billing_export"
  role       = "roles/bigquery.dataViewer"
  member     = "serviceAccount:${google_service_account.cfo_agent.email}"
}

resource "google_project_iam_member" "cfo_agent_bq_job_user" {
  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.cfo_agent.email}"
}

resource "google_billing_account_iam_member" "cfo_human_billing_viewer" {
  for_each           = toset(var.cfo_billing_console_users)
  billing_account_id = var.billing_account_id
  role               = "roles/billing.viewer"
  member             = "user:${each.value}"
}

resource "google_bigquery_dataset_iam_member" "cfo_human_bq_data_viewer" {
  for_each   = toset(var.cfo_billing_console_users)
  project    = var.project_id
  dataset_id = "billing_export"
  role       = "roles/bigquery.dataViewer"
  member     = "user:${each.value}"
}

resource "google_project_iam_member" "cfo_human_bq_job_user" {
  for_each = toset(var.cfo_billing_console_users)
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

# ─── Cross-Project Access: Web Build & Pulse ─────────────────
# Marcus (CTO) needs visibility into the web build and Pulse GCP projects
# for platform health monitoring, deployment management, and log access.

variable "web_build_project_id" {
  description = "GCP project ID for the web build product"
  type        = string
  default     = "gen-lang-client-0834143721"
}

variable "pulse_project_id" {
  description = "GCP project ID for the Pulse product"
  type        = string
  default     = "glyphor-pulse"
}

locals {
  # Roles granted on both web build and Pulse projects
  cross_project_roles = [
    "roles/monitoring.viewer",
    "roles/run.viewer",
    "roles/logging.viewer",
    "roles/cloudbuild.builds.viewer",
  ]
}

resource "google_project_iam_member" "fuse_access" {
  for_each = toset(local.cross_project_roles)
  project  = var.web_build_project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.glyphor.email}"
}

resource "google_project_iam_member" "fuse_secrets" {
  project = var.web_build_project_id
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
    var.web_build_project_id,
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
  value = var.enable_chief_of_staff_cloud_run ? google_cloud_run_v2_service.chief_of_staff[0].uri : null
}

output "voice_gateway_url" {
  value = google_cloud_run_v2_service.voice_gateway.uri
}

output "service_account_email" {
  value = google_service_account.glyphor.email
}

output "cfo_agent_service_account_email" {
  description = "Nadia (CFO agent) — use as Cloud Run / Workload identity for CFO workloads that need billing or BigQuery export"
  value       = google_service_account.cfo_agent.email
}

output "agent_owner_service_account_emails" {
  description = "Per-agent SAs (iamSync.ts); keys: marcus, alex, jordan, elena, maya, rachel, mia, sarah, production_deploy"
  value       = { for k, sa in google_service_account.agent_owner : k => sa.email }
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

output "worker_url" {
  value = google_cloud_run_v2_service.worker.uri
}

output "decisions_api_url" {
  value = var.enable_decisions_api_cloud_run ? google_cloud_run_v2_service.decisions_api[0].uri : null
}

output "worker_service_account_email" {
  value = google_service_account.worker.email
}

output "cloud_sql_connection_name" {
  value = google_sql_database_instance.glyphor_db.connection_name
}
