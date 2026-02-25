"""
Indexer — main entry point for the collect → extract → bridge pipeline.

Usage:
    python -m graphrag_indexer.index [--source docs|assignments|all] [--skip-collect]
"""

import argparse
import subprocess
import sys
from pathlib import Path

from .collector import stage_documents
from .config import INDEXER_ROOT, OUTPUT_DIR, PROMPTS_DIR
from .extractor import (
    build_settings, write_settings_yaml,
    load_extracted_entities, load_community_reports,
)
from .bridge import GraphRAGBridge


def run_graphrag_index():
    """
    Invoke graphrag CLI to run the indexing pipeline.
    This generates entities, relationships, and community reports
    from the staged input documents.
    """
    write_settings_yaml()

    result = subprocess.run(
        [sys.executable, "-m", "graphrag", "index", "--root", str(INDEXER_ROOT)],
        capture_output=True,
        text=True,
        timeout=600,
    )

    if result.returncode != 0:
        print(f"[Index] graphrag index failed:\n{result.stderr[:2000]}")
        raise RuntimeError("GraphRAG indexing failed")

    print(f"[Index] graphrag index completed successfully")
    if result.stdout:
        # Print last few lines of output for visibility
        lines = result.stdout.strip().split("\n")
        for line in lines[-5:]:
            print(f"  {line}")


def run_pipeline(source: str = "all", skip_collect: bool = False) -> dict:
    """
    Full pipeline: collect → extract (via graphrag CLI) → bridge to Supabase.
    Returns summary dict with counts.
    """
    # 1. Collect and stage documents
    if not skip_collect:
        print("[Pipeline] Step 1/3: Collecting documents...")
        doc_count = stage_documents(source)
        if doc_count == 0:
            print("[Pipeline] No documents found — nothing to index.")
            return {"status": "empty", "documents": 0}
        print(f"[Pipeline] Staged {doc_count} documents")
    else:
        print("[Pipeline] Step 1/3: Skipping collection (--skip-collect)")

    # 2. Run GraphRAG extraction
    print("[Pipeline] Step 2/3: Running GraphRAG entity extraction...")
    has_tuned = (PROMPTS_DIR / "entity_extraction.txt").exists()
    if not has_tuned:
        print("  ⚠ No tuned prompts found — using defaults. Run `python -m graphrag_indexer.tune` first.")

    run_graphrag_index()

    # 3. Load results and bridge to Supabase
    print("[Pipeline] Step 3/3: Syncing to knowledge graph...")
    entities, relationships = load_extracted_entities()
    community_reports = load_community_reports()

    bridge = GraphRAGBridge()
    result = bridge.run(entities, relationships, community_reports)

    print(f"\n[Pipeline] Complete!")
    print(f"  Entities processed: {result['total_entities_processed']}")
    print(f"  Nodes created:      {result['nodes_created']}")
    print(f"  Edges created:      {result['edges_created']}")
    print(f"  Communities:        {result['communities_created']}")

    return result


def main():
    parser = argparse.ArgumentParser(description="Run GraphRAG indexing pipeline for Glyphor")
    parser.add_argument(
        "--source", choices=["docs", "assignments", "all"], default="all",
        help="Document source to index (default: all)",
    )
    parser.add_argument(
        "--skip-collect", action="store_true",
        help="Skip document collection — use existing input/ files",
    )
    args = parser.parse_args()
    run_pipeline(source=args.source, skip_collect=args.skip_collect)


if __name__ == "__main__":
    main()
