"""
Entity Extractor — runs GraphRAG entity extraction with auto-tuned prompts.

Uses the graphrag v3 library to:
1. Load config (settings.yaml) with Gemini via litellm
2. Extract entities and relationships from staged documents
3. Return structured entity/relationship data for the bridge
"""

import json
from pathlib import Path

from .config import (
    GEMINI_API_KEY, LLM_MODEL, EMBEDDING_MODEL,
    INDEXER_ROOT, PROMPTS_DIR, INPUT_DIR, OUTPUT_DIR,
    ENTITY_TYPES,
)


def write_settings_yaml() -> Path:
    """Write a settings.yaml that GraphRAG v3 load_config() can read."""
    import yaml

    # GraphRAG v3 uses litellm — Gemini models use "gemini/" prefix
    settings = {
        "completion_models": {
            "default": {
                "model_provider": "gemini",
                "model": f"gemini/{LLM_MODEL}",
                "api_key": "${GOOGLE_AI_API_KEY}",
                "call_args": {
                    "max_tokens": 8192,
                    "temperature": 0.0,
                },
            },
        },
        "embedding_models": {
            "default": {
                "model_provider": "gemini",
                "model": f"gemini/{EMBEDDING_MODEL}",
                "api_key": "${GOOGLE_AI_API_KEY}",
            },
        },
        "input": {
            "type": "file",
            "file_type": "text",
            "base_dir": str(INPUT_DIR),
        },
        "output_storage": {
            "type": "file",
            "base_dir": str(OUTPUT_DIR),
        },
        "chunking": {
            "size": 1200,
            "overlap": 200,
        },
        "extract_graph": {
            "entity_types": ENTITY_TYPES,
            "prompt": str(PROMPTS_DIR / "entity_extraction.txt") if (PROMPTS_DIR / "entity_extraction.txt").exists() else None,
        },
        "community_reports": {
            "prompt": str(PROMPTS_DIR / "community_report.txt") if (PROMPTS_DIR / "community_report.txt").exists() else None,
        },
        "summarize_descriptions": {
            "prompt": str(PROMPTS_DIR / "summarize_descriptions.txt") if (PROMPTS_DIR / "summarize_descriptions.txt").exists() else None,
        },
        "snapshots": {"graphml": True},
    }

    # Remove None prompt entries
    for section in ("extract_graph", "community_reports", "summarize_descriptions"):
        if settings[section].get("prompt") is None:
            del settings[section]["prompt"]

    settings_path = INDEXER_ROOT / "settings.yaml"
    with open(settings_path, "w") as f:
        yaml.dump(settings, f, default_flow_style=False)
    print(f"[Extractor] Wrote settings to {settings_path}")
    return settings_path


def load_config():
    """Load GraphRagConfig from the settings.yaml."""
    from graphrag.config.load_config import load_config as _load_config
    return _load_config(root_dir=str(INDEXER_ROOT))


def load_extracted_entities() -> tuple[list[dict], list[dict]]:
    """
    Load entities and relationships from GraphRAG output artifacts.
    Returns (entities, relationships) as lists of dicts.
    """
    entities = []
    relationships = []

    # GraphRAG outputs parquet files in output/artifacts/
    artifacts_dir = OUTPUT_DIR / "artifacts"
    if not artifacts_dir.exists():
        print(f"[Extractor] No artifacts found at {artifacts_dir}")
        return entities, relationships

    # Try to load entities from parquet
    entities_file = artifacts_dir / "create_final_entities.parquet"
    rels_file = artifacts_dir / "create_final_relationships.parquet"

    if entities_file.exists():
        try:
            import pandas as pd
            df = pd.read_parquet(entities_file)
            for _, row in df.iterrows():
                entities.append({
                    "id": str(row.get("id", "")),
                    "name": str(row.get("name", row.get("title", ""))),
                    "type": str(row.get("type", "UNKNOWN")).upper(),
                    "description": str(row.get("description", "")),
                })
        except ImportError:
            # Fallback: try JSON output
            json_file = artifacts_dir / "entities.json"
            if json_file.exists():
                entities = json.loads(json_file.read_text())

    if rels_file.exists():
        try:
            import pandas as pd
            df = pd.read_parquet(rels_file)
            for _, row in df.iterrows():
                relationships.append({
                    "source": str(row.get("source", "")),
                    "target": str(row.get("target", "")),
                    "type": str(row.get("type", row.get("description", "RELATES_TO"))).upper(),
                    "description": str(row.get("description", "")),
                    "weight": float(row.get("weight", 0.7)),
                })
        except ImportError:
            json_file = artifacts_dir / "relationships.json"
            if json_file.exists():
                relationships = json.loads(json_file.read_text())

    print(f"[Extractor] Loaded {len(entities)} entities, {len(relationships)} relationships")
    return entities, relationships


def load_community_reports() -> list[dict]:
    """Load community summaries from GraphRAG output."""
    artifacts_dir = OUTPUT_DIR / "artifacts"
    reports_file = artifacts_dir / "create_final_community_reports.parquet"

    if not reports_file.exists():
        return []

    try:
        import pandas as pd
        df = pd.read_parquet(reports_file)
        reports = []
        for _, row in df.iterrows():
            reports.append({
                "id": str(row.get("id", "")),
                "title": str(row.get("title", "")),
                "summary": str(row.get("summary", "")),
                "level": int(row.get("level", 0)),
                "rank": float(row.get("rank", 0)),
            })
        print(f"[Extractor] Loaded {len(reports)} community reports")
        return reports
    except ImportError:
        print("[Extractor] pandas not available — skipping community reports")
        return []
