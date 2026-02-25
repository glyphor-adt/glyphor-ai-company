"""
Auto Prompt Tuner — adapts GraphRAG extraction prompts to the Glyphor domain.

Reads the staged input documents and uses GraphRAG's auto-tuning to generate
domain-specific entity extraction, summarization, and community report prompts.
Outputs tuned prompts to the prompts/ directory.

Usage:
    python -m graphrag_indexer.tune [--source docs|assignments|all]
"""

import argparse
import asyncio
import sys
from pathlib import Path

from graphrag.config import create_graphrag_config
from graphrag.prompt_tune.api import generate_indexing_prompts

from .collector import stage_documents
from .config import (
    DOMAIN, ENTITY_TYPES,
    INDEXER_ROOT, PROMPTS_DIR, INPUT_DIR,
    GEMINI_API_KEY, LLM_MODEL,
)
from .extractor import build_settings


async def run_auto_tune(source: str = "all", limit: int = 15):
    """
    Run GraphRAG auto prompt tuning:
    1. Stage input documents
    2. Sample a subset for tuning
    3. Generate tuned prompts via the LLM
    4. Write prompts to prompts/ directory
    """
    print("[Tune] Staging documents...")
    doc_count = stage_documents(source)
    if doc_count == 0:
        print("[Tune] No documents found — nothing to tune.")
        return

    # Ensure prompts dir exists
    PROMPTS_DIR.mkdir(parents=True, exist_ok=True)

    print(f"[Tune] Generating tuned prompts from {doc_count} documents...")

    # Build GraphRAG config from settings
    settings = build_settings()

    # Write a temporary settings.yaml for graphrag CLI
    import yaml
    settings_path = INDEXER_ROOT / "settings.yaml"
    with open(settings_path, "w") as f:
        yaml.dump(settings, f, default_flow_style=False)

    config = create_graphrag_config(root_dir=str(INDEXER_ROOT))

    # Run auto prompt tuning
    prompts = await generate_indexing_prompts(
        config=config,
        root=str(INDEXER_ROOT),
        domain=DOMAIN,
        language="English",
        skip_entity_types=False,
        max_tokens=8192,
        chunk_size=1200,
        n_subset_max=limit,
        k=5,
    )

    # Write tuned prompts
    for name, content in prompts.items():
        prompt_file = PROMPTS_DIR / f"{name}.txt"
        prompt_file.write_text(content, encoding="utf-8")
        print(f"  → Wrote {prompt_file.name} ({len(content)} chars)")

    print(f"[Tune] Tuning complete — {len(prompts)} prompts written to {PROMPTS_DIR}")


def main():
    parser = argparse.ArgumentParser(description="Auto-tune GraphRAG prompts for Glyphor domain")
    parser.add_argument(
        "--source", choices=["docs", "assignments", "all"], default="all",
        help="Which documents to use for tuning (default: all)",
    )
    parser.add_argument(
        "--limit", type=int, default=15,
        help="Max documents to sample for tuning (default: 15)",
    )
    args = parser.parse_args()
    asyncio.run(run_auto_tune(source=args.source, limit=args.limit))


if __name__ == "__main__":
    main()
