"""
Bridge — syncs GraphRAG extracted entities and relationships to Supabase kg_nodes / kg_edges.

Mirrors the deduplication logic from KnowledgeGraphWriter (0.92 similarity threshold)
and maps GraphRAG types to existing kg_nodes node_type / kg_edges edge_type.
"""

import json
import os
from datetime import datetime, timezone

from google import genai as google_genai
from supabase import create_client

from .config import (
    SUPABASE_URL, SUPABASE_KEY,
    GEMINI_API_KEY, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS,
    ENTITY_TYPE_TO_NODE_TYPE, RELATIONSHIP_TYPE_MAP,
)

# ─── Embedding helper ────────────────────────────────────────────

_genai_client = google_genai.Client(api_key=GEMINI_API_KEY)

def _embed(text: str) -> list[float]:
    """Generate a 768-dim embedding via Gemini."""
    result = _genai_client.models.embed_content(
        model=EMBEDDING_MODEL,
        contents=text,
    )
    return result.embeddings[0].values[:EMBEDDING_DIMENSIONS]


# ─── Deduplication ────────────────────────────────────────────────

SIMILARITY_THRESHOLD = 0.92  # match KnowledgeGraphWriter threshold

def _find_duplicate(supabase, embedding: list[float], threshold: float = SIMILARITY_THRESHOLD):
    """
    Find a near-duplicate kg_node using cosine similarity via the
    match_kg_nodes RPC (same one KnowledgeGraphReader uses).
    Returns the matching row dict or None.
    """
    result = supabase.rpc("match_kg_nodes", {
        "query_embedding": json.dumps(embedding),
        "match_count": 1,
        "match_threshold": threshold,
    }).execute()

    if result.data and len(result.data) > 0:
        return result.data[0]
    return None


def _validate_existing(supabase, node_id: str):
    """Bump times_validated on an existing node (same as KnowledgeGraphWriter)."""
    supabase.rpc("kg_validate_node", {"p_node_id": node_id}).execute()


# ─── Sync ─────────────────────────────────────────────────────────

class GraphRAGBridge:
    """Syncs GraphRAG extraction output into Supabase kg_nodes / kg_edges."""

    def __init__(self):
        self.supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
        self._entity_id_map: dict[str, str] = {}  # graphrag entity name → kg_node UUID

    def sync_entities(self, entities: list[dict]) -> int:
        """
        Upsert entities into kg_nodes.
        Deduplicates at 0.92 similarity — if a near-match exists, validate it
        instead of creating a duplicate.
        Returns count of new nodes created.
        """
        created = 0
        for ent in entities:
            name = ent.get("name", "").strip()
            description = ent.get("description", "").strip()
            ent_type = ent.get("type", "UNKNOWN").upper()
            if not name:
                continue

            embed_text = f"{name}. {description}" if description else name
            embedding = _embed(embed_text)

            # Deduplicate
            existing = _find_duplicate(self.supabase, embedding)
            if existing:
                _validate_existing(self.supabase, existing["id"])
                self._entity_id_map[name.upper()] = existing["id"]
                continue

            node_type = ENTITY_TYPE_TO_NODE_TYPE.get(ent_type, "entity")

            result = self.supabase.table("kg_nodes").insert({
                "node_type": node_type,
                "title": name,
                "content": description or name,
                "created_by": "graphrag-indexer",
                "embedding": json.dumps(embedding),
                "source_type": "graphrag",
                "importance": 0.6,
                "tags": [ent_type.lower()],
                "metadata": {"graphrag_type": ent_type, "graphrag_id": ent.get("id", "")},
                "occurred_at": datetime.now(timezone.utc).isoformat(),
            }).execute()

            if result.data and len(result.data) > 0:
                self._entity_id_map[name.upper()] = result.data[0]["id"]
                created += 1
            else:
                print(f"[Bridge] Failed to insert entity: {name}")

        print(f"[Bridge] Synced entities: {created} new, {len(entities) - created} deduplicated")
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

            edge_type = RELATIONSHIP_TYPE_MAP.get(rel_type, "relates_to")
            weight = rel.get("weight", 0.7)

            result = self.supabase.table("kg_edges").upsert(
                {
                    "source_id": source_id,
                    "target_id": target_id,
                    "edge_type": edge_type,
                    "strength": min(max(weight, 0.1), 1.0),
                    "confidence": 0.7,
                    "evidence": rel.get("description", "Extracted by GraphRAG"),
                },
                on_conflict="source_id,target_id,edge_type",
            ).execute()

            if result.data:
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

            existing = _find_duplicate(self.supabase, embedding)
            if existing:
                _validate_existing(self.supabase, existing["id"])
                continue

            result = self.supabase.table("kg_nodes").insert({
                "node_type": "pattern",
                "title": f"[Community] {title}",
                "content": summary,
                "created_by": "graphrag-indexer",
                "embedding": json.dumps(embedding),
                "source_type": "graphrag",
                "importance": 0.7,
                "tags": ["community-report", f"level-{report.get('level', 0)}"],
                "metadata": {
                    "graphrag_community_id": report.get("id", ""),
                    "level": report.get("level", 0),
                    "rank": report.get("rank", 0),
                },
                "occurred_at": datetime.now(timezone.utc).isoformat(),
            }).execute()

            if result.data and len(result.data) > 0:
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
