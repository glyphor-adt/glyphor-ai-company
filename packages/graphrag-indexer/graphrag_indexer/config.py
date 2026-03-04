"""
Configuration — loads env vars, builds GraphRAG and Cloud SQL configs.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from repo root (local dev: parents[3], Docker: REPO_ROOT env var)
_repo_root_env = os.environ.get("REPO_ROOT")
_REPO_ROOT = Path(_repo_root_env) if _repo_root_env else Path(__file__).resolve().parents[3]
load_dotenv(_REPO_ROOT / ".env")

# ─── Cloud SQL (PostgreSQL) ──────────────────────────────────────
DB_HOST = os.environ.get("DB_HOST", "localhost")
DB_NAME = os.environ.get("DB_NAME", "glyphor")
DB_USER = os.environ.get("DB_USER", "glyphor")
DB_PASSWORD = os.environ.get("DB_PASSWORD", "")

# ─── LLM ─────────────────────────────────────────────────────────
GEMINI_API_KEY = os.environ["GOOGLE_AI_API_KEY"]
LLM_MODEL = "gemini-2.5-flash"
EMBEDDING_MODEL = "gemini-embedding-001"
EMBEDDING_DIMENSIONS = 768

# ─── Paths ───────────────────────────────────────────────────────
INDEXER_ROOT = Path(__file__).resolve().parent.parent
PROMPTS_DIR = INDEXER_ROOT / "prompts"      # auto-tuned prompts land here
INPUT_DIR = INDEXER_ROOT / "input"          # collected docs staged here
OUTPUT_DIR = INDEXER_ROOT / "output"        # GraphRAG output artifacts

KNOWLEDGE_DIR = _REPO_ROOT / "packages" / "company-knowledge"
DOCS_DIR = _REPO_ROOT / "docs"

# ─── GraphRAG tuning ─────────────────────────────────────────────
# Domain hint for auto prompt tuning
DOMAIN = (
    "An AI-first company called Glyphor that builds autonomous software platforms "
    "(Fuse for web development, Pulse for creative/branding). The company is run by "
    "~30 AI agents (executives and sub-team specialists) orchestrated by a scheduler, "
    "with two human founders (Kristina and Andrew) who work part-time. Key concepts "
    "include: multi-agent orchestration, authority tiers (green/yellow/red), knowledge "
    "graph, founder directives, work assignments, competitive landscape (Lovable, Bolt, "
    "Devin, Cursor), enterprise sales pipeline, Cloud Run infrastructure on GCP, "
    "Cloud SQL for data, Gemini for LLM inference."
)

ENTITY_TYPES = [
    "PERSON", "AGENT", "PRODUCT", "COMPANY", "TECHNOLOGY",
    "METRIC", "DECISION", "RISK", "EVENT", "GOAL",
    "INFRASTRUCTURE", "COMPETITOR", "DEPARTMENT",
]

# Map GraphRAG entity types → kg_nodes node_type
ENTITY_TYPE_TO_NODE_TYPE = {
    "PERSON": "entity",
    "AGENT": "entity",
    "PRODUCT": "entity",
    "COMPANY": "entity",
    "TECHNOLOGY": "entity",
    "METRIC": "metric",
    "DECISION": "decision",
    "RISK": "risk",
    "EVENT": "event",
    "GOAL": "goal",
    "INFRASTRUCTURE": "entity",
    "COMPETITOR": "entity",
    "DEPARTMENT": "entity",
    # Types actually produced by the tuned extraction prompt
    "ORGANIZATIONAL CONCEPT": "entity",
    "TECHNOLOGY PLATFORM/SERVICE": "entity",
    "DATA STORE/TABLE": "entity",
    "AI AGENT ROLE": "entity",
    "COMMUNICATION CHANNEL": "entity",
    "AUTHORITY TIER": "entity",
    "HUMAN FOUNDER": "entity",
}

# Map GraphRAG relationship types → kg_edges edge_type
RELATIONSHIP_TYPE_MAP = {
    "USES": "depends_on",
    "MANAGES": "owns",
    "REPORTS_TO": "belongs_to",
    "COMPETES_WITH": "relates_to",
    "DEPENDS_ON": "depends_on",
    "PRODUCES": "resulted_in",
    "CAUSES": "caused",
    "MITIGATES": "mitigates",
    "AFFECTS": "affects",
    "SUPPORTS": "supports",
    "CONTRADICTS": "contradicts",
    "PART_OF": "belongs_to",
    "RELATES_TO": "relates_to",
}
