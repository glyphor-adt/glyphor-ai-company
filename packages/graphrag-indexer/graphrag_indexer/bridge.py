"""
Bridge — syncs GraphRAG extracted entities and relationships to Cloud SQL kg_nodes / kg_edges.

Mirrors the deduplication logic from KnowledgeGraphWriter (0.92 similarity threshold)
and maps GraphRAG types to existing kg_nodes node_type / kg_edges edge_type.
"""

import json
import os
import re
import time
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras
from google import genai as google_genai

import re

from .config import (
    DB_HOST, DB_NAME, DB_USER, DB_PASSWORD,
    GEMINI_API_KEY, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS,
    ENTITY_TYPE_TO_NODE_TYPE, RELATIONSHIP_TYPE_MAP,
)


# ─── Relationship type classifier ────────────────────────────────
# GraphRAG's tuned prompts produce full-sentence relationship descriptions as types
# (e.g. "KAI NAKAMURA REPORTS TECHNICAL FEASIBILITY FINDINGS TO SOPHIA LIN").
# We classify these into short edge_type labels for kg_edges.

_REL_KEYWORD_MAP = [
    # order matters — first match wins
    (r"\b(reports?\s+to|reporting|accountable\s+to)\b", "belongs_to"),
    (r"\b(manages?|oversees?|leads?|supervises?|directs?|runs?|heads?)\b", "owns"),
    (r"\b(uses?|utilizes?|leverages?|employs?|interfaces?\s+with|integrates?\s+with)\b", "depends_on"),
    (r"\b(depends?\s+on|relies?\s+on|requires?|needs?|demands?)\b", "depends_on"),
    (r"\b(part\s+of|member\s+of|belongs?\s+to|within|under|inside|component\s+of)\b", "belongs_to"),
    (r"\b(creates?|produces?|generates?|builds?|develops?|designs?|implements?|writes?)\b", "resulted_in"),
    (r"\b(defines?|specifies?|describes?|outlines?|establishes?|sets?\s+up)\b", "resulted_in"),
    (r"\b(causes?|triggers?|results?\s+in|leads?\s+to|brings?\s+about)\b", "caused"),
    (r"\b(mitigates?|reduces?|addresses?|resolves?|fixes?|handles?|prevents?)\b", "mitigates"),
    (r"\b(affects?|impacts?|influences?|shapes?|changes?|modifies?|alters?)\b", "affects"),
    (r"\b(supports?|enables?|facilitates?|assists?|helps?|aids?|empowers?)\b", "supports"),
    (r"\b(provides?|supplies?|delivers?|offers?|gives?|sends?|transfers?)\b", "supports"),
    (r"\b(contradicts?|conflicts?\s+with|opposes?|disagrees?|challenges?)\b", "contradicts"),
    (r"\b(monitors?|tracks?|measures?|evaluates?|assesses?|observes?|watches?)\b", "monitors"),
    (r"\b(reviews?|validates?|approves?|checks?|verifies?|audits?)\b", "monitors"),
    (r"\b(assigns?|allocat|delegates?|distributes?)\b", "owns"),
    (r"\b(processes?|orchestrat|execut)\b", "owns"),
    (r"\b(stores?|saves?|persists?|records?|logs?|captures?)\b", "depends_on"),
    (r"\b(collaborates?|works?\s+with|coordinates?|partners?|cooperat)\b", "supports"),
    (r"\b(connects?|links?|bridges?|maps?\s+to|associated\s+with)\b", "relates_to"),
    (r"\b(competes?\s+with|rivals?|competing)\b", "relates_to"),
]

def _classify_relationship_type(raw_type: str) -> str:
    """Classify a full-sentence relationship type into a short edge_type."""
    # Try exact match first (for well-formed short types)
    upper = raw_type.strip().upper()
    if upper in RELATIONSHIP_TYPE_MAP:
        return RELATIONSHIP_TYPE_MAP[upper]
    # Keyword scan
    lower = raw_type.lower()
    for pattern, edge_type in _REL_KEYWORD_MAP:
        if re.search(pattern, lower):
            return edge_type
    return "relates_to"

# ─── Embedding helper ────────────────────────────────────────────

_genai_client = google_genai.Client(api_key=GEMINI_API_KEY)

def _embed(text: str) -> list[float]:
    """Generate a 768-dim embedding via Gemini with retry on transient errors."""
    for attempt in range(5):
        try:
            result = _genai_client.models.embed_content(
                model=EMBEDDING_MODEL,
                contents=text,
            )
            return result.embeddings[0].values[:EMBEDDING_DIMENSIONS]
        except Exception as e:
            if attempt == 4:
                raise
            wait = 2 ** attempt  # 1, 2, 4, 8, 16 seconds
            print(f"[Bridge] Embedding retry {attempt + 1}/5 after {wait}s: {e}")
            time.sleep(wait)


# ─── Deduplication ────────────────────────────────────────────────

SIMILARITY_THRESHOLD = 0.92  # match KnowledgeGraphWriter threshold

def _normalize_title(title: str) -> str:
    """Normalize a title for near-duplicate detection.
    Strips parenthetical suffixes, underscores, extra whitespace, case."""
    t = title.strip().upper()
    t = re.sub(r"\s*\([^)]*\)\s*$", "", t)
    t = t.replace("_", " ")
    t = re.sub(r"\s+", " ", t).strip()
    return t

def _get_connection():
    """Get a psycopg2 connection to Cloud SQL."""
    return psycopg2.connect(
        host=DB_HOST,
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
    )


def _find_duplicate(conn, embedding: list[float], threshold: float = SIMILARITY_THRESHOLD):
    """
    Find a near-duplicate kg_node using cosine similarity via pgvector's <=> operator.
    Returns the matching row dict or None.
    """
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT id, title, node_type, content, 1 - (embedding <=> %s::vector) AS similarity
               FROM kg_nodes
               WHERE embedding IS NOT NULL
               ORDER BY embedding <=> %s::vector
               LIMIT 1""",
            (json.dumps(embedding), json.dumps(embedding)),
        )
        row = cur.fetchone()
        if row and row["similarity"] >= threshold:
            return dict(row)
    return None


def _validate_existing(conn, node_id: str):
    """Bump times_validated on an existing node via read + update."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT times_validated FROM kg_nodes WHERE id = %s", (node_id,))
        row = cur.fetchone()
        current = row["times_validated"] if row and row.get("times_validated") else 0
        cur.execute(
            "UPDATE kg_nodes SET times_validated = %s, updated_at = %s WHERE id = %s",
            (current + 1, datetime.now(timezone.utc).isoformat(), node_id),
        )
    conn.commit()


# ─── Junk filter ──────────────────────────────────────────────────
# Filter out entities that are clearly JSON field names, generic programming
# terms, or too short to be meaningful knowledge graph nodes.

_JUNK_WORDS = frozenset({
    "summary", "status", "type", "id", "name", "value", "data", "key",
    "result", "error", "message", "content", "title", "description",
    "count", "index", "text", "true", "false", "null", "undefined",
    "object", "array", "string", "number", "boolean", "function",
    "class", "method", "property", "field", "column", "row", "table",
    "list", "item", "element", "node", "edge", "source", "target",
    "weight", "score", "label", "tag", "category", "kind", "mode",
    "state", "action", "event", "task", "run", "step", "phase",
    "stage", "level", "tier", "turn", "round", "cycle", "version",
    "config", "option", "setting", "param", "arg", "input", "output",
    "format", "url", "path", "file", "dir", "log", "info", "debug",
    "warn", "test", "spec", "mock", "stub", "fix", "bug", "todo",
    "note", "comment",
})

def _is_junk_entity(name: str) -> bool:
    """Return True if a name is too generic or looks like a code artifact."""
    t = name.strip()
    if len(t) <= 2:
        return True
    if "[]" in t or "{}" in t:
        return True
    if t.lower() in _JUNK_WORDS:
        return True
    return False


# ─── Smart node_type classifier ──────────────────────────────────
# Sub-classifies "ORGANIZATIONAL CONCEPT" entities into specific kg_nodes
# node_types using keyword heuristics on the entity name + description.

_NODE_TYPE_KEYWORDS = [
    # People and roles
    (r"\b(ceo|cto|cfo|coo|vp|director|manager|engineer|analyst|designer|lead|founder|chief|head)\b", "person"),
    (r"\b(team|department|division|unit|group|squad)\b", "team"),
    # Tech / tools
    (r"\b(api|sdk|framework|library|package|module|service|microservice|endpoint|webhook)\b", "tool"),
    (r"\b(database|supabase|postgres|redis|cache|storage|bucket|queue)\b", "tool"),
    (r"\b(model|gpt|gemini|claude|llm|embedding|vector|transformer|neural)\b", "tool"),
    (r"\b(github|slack|teams|discord|jira|confluence|notion|figma)\b", "tool"),
    (r"\b(docker|kubernetes|k8s|terraform|cloud\s*run|gcp|aws|azure)\b", "tool"),
    (r"\b(typescript|python|javascript|react|node|next\.?js|vue|angular)\b", "tool"),
    # Organizations
    (r"\b(company|organization|corporation|startup|venture|enterprise)\b", "organization"),
    (r"\b(glyphor|openai|google|microsoft|anthropic|meta)\b", "organization"),
    # Products and projects
    (r"\b(product|platform|app|application|dashboard|portal|website|feature)\b", "project"),
    (r"\b(project|initiative|program|workstream|sprint|roadmap)\b", "project"),
    # Concepts and processes
    (r"\b(strategy|plan|approach|methodology|framework|process|workflow|pipeline)\b", "concept"),
    (r"\b(protocol|standard|guideline|policy|rule|requirement|specification)\b", "concept"),
    (r"\b(architecture|design|pattern|principle|practice|convention)\b", "concept"),
    (r"\b(authority|permission|access|role|rbac|tier|level)\b", "concept"),
    (r"\b(memory|context|knowledge|intelligence|learning|training)\b", "concept"),
    (r"\b(communication|collaboration|coordination|orchestration|integration)\b", "concept"),
    # Goals and metrics
    (r"\b(goal|objective|target|milestone|okr|kpi)\b", "goal"),
    (r"\b(metric|measurement|score|rate|percentage|ratio|benchmark)\b", "metric"),
    # Events
    (r"\b(meeting|standup|review|retrospective|demo|presentation|launch)\b", "event"),
    (r"\b(incident|outage|failure|error|issue|bug|alert)\b", "event"),
    (r"\b(release|deployment|migration|upgrade|update)\b", "event"),
    # Risks and decisions
    (r"\b(risk|threat|vulnerability|concern|blocker|impediment)\b", "risk"),
    (r"\b(decision|approval|resolution|verdict|judgment)\b", "decision"),
    # Patterns and hypotheses
    (r"\b(trend|signal|insight|finding|observation|analysis)\b", "pattern"),
    (r"\b(hypothesis|theory|assumption|experiment|test)\b", "hypothesis"),
    # Documents
    (r"\b(document|report|brief|summary|memo|proposal|specification|runbook)\b", "document"),
    (r"\b(checklist|template|guide|manual|playbook|handbook)\b", "document"),
]

def _classify_node_type(name: str, description: str, raw_type: str) -> str:
    """Determine the best kg_nodes node_type for an entity."""
    # Direct mapping first
    mapped = ENTITY_TYPE_TO_NODE_TYPE.get(raw_type)
    if mapped and mapped != "entity":
        return mapped

    # For ORGANIZATIONAL CONCEPT and other "entity" mappings, try keyword sub-classification
    text = f"{name} {description}".lower()
    for pattern, node_type in _NODE_TYPE_KEYWORDS:
        if re.search(pattern, text):
            return node_type

    return mapped or "entity"


# ─── Sync ─────────────────────────────────────────────────────────

class GraphRAGBridge:
    """Syncs GraphRAG extraction output into Cloud SQL kg_nodes / kg_edges."""

    def __init__(self):
        self.conn = _get_connection()
        self._entity_id_map: dict[str, str] = {}  # graphrag entity name → kg_node UUID
        self._norm_title_map: dict[str, str] = {}  # normalized title → kg_node UUID (for dedup)

    def sync_entities(self, entities: list[dict]) -> int:
        """
        Upsert entities into kg_nodes.
        Deduplicates at 0.92 similarity — if a near-match exists, validate it
        instead of creating a duplicate.
        Returns count of new nodes created.
        """
        created = 0
        deduped = 0
        skipped = 0
        for i, ent in enumerate(entities):
            name = ent.get("name", "").strip()
            description = ent.get("description", "").strip()
            ent_type = ent.get("type", "UNKNOWN").upper()
            if not name or _is_junk_entity(name):
                skipped += 1
                continue

            # Check normalized title for near-duplicate (catches parenthetical variants)
            norm = _normalize_title(name)
            if norm in self._norm_title_map:
                self._entity_id_map[name.upper()] = self._norm_title_map[norm]
                _validate_existing(self.conn, self._norm_title_map[norm])
                deduped += 1
                if (i + 1) % 100 == 0:
                    print(f"[Bridge] Progress: {i + 1}/{len(entities)} ({created} new, {deduped} deduped)")
                continue

            embed_text = f"{name}. {description}" if description else name
            embedding = _embed(embed_text)

            # Deduplicate
            existing = _find_duplicate(self.conn, embedding)
            if existing:
                _validate_existing(self.conn, existing["id"])
                self._entity_id_map[name.upper()] = existing["id"]
                self._norm_title_map[norm] = existing["id"]
                deduped += 1
                if (i + 1) % 100 == 0:
                    print(f"[Bridge] Progress: {i + 1}/{len(entities)} ({created} new, {deduped} deduped)")
                continue

            node_type = _classify_node_type(name, description, ent_type)

            now = datetime.now(timezone.utc).isoformat()
            metadata = json.dumps({"graphrag_type": ent_type, "graphrag_id": ent.get("id", "")})
            tags = [ent_type.lower()]

            with self.conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """INSERT INTO kg_nodes
                       (node_type, title, content, created_by, embedding, source_type,
                        importance, tags, metadata, occurred_at)
                       VALUES (%s, %s, %s, %s, %s::vector, %s, %s, %s, %s, %s)
                       RETURNING id""",
                    (node_type, name, description or name, "graphrag-indexer",
                     json.dumps(embedding), "graphrag", 0.6, tags, metadata, now),
                )
                row = cur.fetchone()
            self.conn.commit()

            if row:
                self._entity_id_map[name.upper()] = row["id"]
                self._norm_title_map[norm] = row["id"]
                created += 1
            else:
                print(f"[Bridge] Failed to insert entity: {name}")

            if (i + 1) % 100 == 0:
                print(f"[Bridge] Progress: {i + 1}/{len(entities)} ({created} new, {deduped} deduped)")
            # Throttle embedding calls to stay within rate limits
            if (i + 1) % 50 == 0:
                time.sleep(1)

        print(f"[Bridge] Synced entities: {created} new, {deduped} deduped, {skipped} junk skipped")
        return created

    def sync_relationships(self, relationships: list[dict]) -> int:
        """
        Upsert relationships into kg_edges.
        Uses the entity_id_map built during sync_entities to resolve source/target.
        Returns count of edges created/updated.
        """
        synced = 0
        for rel in relationships:
            source_name = rel.get("source", "").upper()
            target_name = rel.get("target", "").upper()
            rel_type = rel.get("type", "RELATES_TO").upper()

            source_id = self._entity_id_map.get(source_name)
            target_id = self._entity_id_map.get(target_name)

            if not source_id or not target_id:
                continue
            if source_id == target_id:
                continue

            edge_type = _classify_relationship_type(rel_type)
            weight = rel.get("weight", 0.7)

            with self.conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """INSERT INTO kg_edges
                       (source_id, target_id, edge_type, strength, confidence, created_by, evidence)
                       VALUES (%s, %s, %s, %s, %s, %s, %s)
                       ON CONFLICT (source_id, target_id, edge_type)
                       DO UPDATE SET strength = EXCLUDED.strength, evidence = EXCLUDED.evidence
                       RETURNING id""",
                    (source_id, target_id, edge_type,
                     min(max(weight, 0.1), 1.0), 0.7,
                     "graphrag-indexer",
                     rel.get("description", "Extracted by GraphRAG")),
                )
                row = cur.fetchone()
            self.conn.commit()

            if row:
                synced += 1

        print(f"[Bridge] Synced {synced}/{len(relationships)} relationships")
        return synced

    def sync_community_reports(self, reports: list[dict]) -> int:
        """
        Store community summaries as special kg_nodes of type 'pattern'.
        These represent emergent themes discovered by GraphRAG's Leiden clustering.
        """
        created = 0
        for report in reports:
            title = report.get("title", "").strip()
            summary = report.get("summary", "").strip()
            if not title or not summary:
                continue

            embed_text = f"{title}. {summary[:500]}"
            embedding = _embed(embed_text)

            existing = _find_duplicate(self.conn, embedding)
            if existing:
                _validate_existing(self.conn, existing["id"])
                continue

            now = datetime.now(timezone.utc).isoformat()
            metadata = json.dumps({
                "graphrag_community_id": report.get("id", ""),
                "level": report.get("level", 0),
                "rank": report.get("rank", 0),
            })
            tags = ["community-report", f"level-{report.get('level', 0)}"]

            with self.conn.cursor() as cur:
                cur.execute(
                    """INSERT INTO kg_nodes
                       (node_type, title, content, created_by, embedding, source_type,
                        importance, tags, metadata, occurred_at)
                       VALUES (%s, %s, %s, %s, %s::vector, %s, %s, %s, %s, %s)
                       RETURNING id""",
                    ("pattern", f"[Community] {title}", summary, "graphrag-indexer",
                     json.dumps(embedding), "graphrag", 0.7, tags, metadata, now),
                )
                row = cur.fetchone()
            self.conn.commit()

            if row:
                created += 1

        print(f"[Bridge] Synced {created} community reports as pattern nodes")
        return created

    def run(self, entities: list[dict], relationships: list[dict],
            community_reports: list[dict] | None = None) -> dict:
        """Full sync pipeline: entities → relationships → community reports."""
        nodes_created = self.sync_entities(entities)
        edges_created = self.sync_relationships(relationships)
        communities_created = 0
        if community_reports:
            communities_created = self.sync_community_reports(community_reports)

        return {
            "nodes_created": nodes_created,
            "edges_created": edges_created,
            "communities_created": communities_created,
            "total_entities_processed": len(entities),
            "total_relationships_processed": len(relationships),
        }
