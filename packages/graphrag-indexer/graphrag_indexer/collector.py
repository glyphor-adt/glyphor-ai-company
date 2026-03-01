"""
Document Collector — gathers text from knowledge base and agent outputs.

Sources:
1. Company knowledge docs (CORE.md, briefs/*.md, context/*.md, COMPANY_KNOWLEDGE_BASE.md)
2. Architecture / operating docs (docs/*.md)
3. Completed agent assignment outputs (from Cloud SQL work_assignments table)
"""

import json
from pathlib import Path
import psycopg2
import psycopg2.extras

from .config import (
    DB_HOST, DB_NAME, DB_USER, DB_PASSWORD,
    KNOWLEDGE_DIR, DOCS_DIR, INPUT_DIR,
)


def collect_knowledge_docs() -> list[dict]:
    """Collect markdown files from company-knowledge and docs directories."""
    documents = []

    # Company knowledge
    for md_path in sorted(KNOWLEDGE_DIR.rglob("*.md")):
        content = md_path.read_text(encoding="utf-8", errors="replace")
        if len(content.strip()) < 50:
            continue
        rel = md_path.relative_to(KNOWLEDGE_DIR)
        documents.append({
            "id": f"knowledge/{rel}",
            "title": md_path.stem.replace("-", " ").replace("_", " ").title(),
            "text": content,
            "source": "company-knowledge",
        })

    # Architecture and operating docs
    for md_path in sorted(DOCS_DIR.glob("*.md")):
        content = md_path.read_text(encoding="utf-8", errors="replace")
        if len(content.strip()) < 50:
            continue
        documents.append({
            "id": f"docs/{md_path.name}",
            "title": md_path.stem.replace("_", " ").title(),
            "text": content,
            "source": "docs",
        })

    return documents


def collect_assignment_outputs(limit: int = 200) -> list[dict]:
    """Collect completed agent assignment outputs from Cloud SQL."""
    conn = psycopg2.connect(
        host=DB_HOST, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD,
    )
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """SELECT wa.id, wa.assigned_to, wa.task_description,
                          wa.agent_output, wa.completed_at,
                          fd.title AS directive_title, fd.category
                   FROM work_assignments wa
                   LEFT JOIN founder_directives fd ON wa.directive_id = fd.id
                   WHERE wa.status = 'completed' AND wa.agent_output IS NOT NULL
                   ORDER BY wa.completed_at DESC
                   LIMIT %s""",
                (limit,),
            )
            rows = cur.fetchall()
    finally:
        conn.close()

    documents = []
    for row in rows:
        output = row.get("agent_output", "")
        if not output or len(output.strip()) < 100:
            continue

        directive_title = row.get("directive_title") or "Unknown Directive"
        category = row.get("category") or "general"

        title = f"{row['assigned_to']} — {directive_title}"
        text = (
            f"# Assignment Output: {title}\n\n"
            f"**Agent:** {row['assigned_to']}\n"
            f"**Directive:** {directive_title}\n"
            f"**Category:** {category}\n"
            f"**Task:** {row.get('task_description', 'N/A')}\n"
            f"**Completed:** {row.get('completed_at', 'N/A')}\n\n"
            f"## Output\n\n{output}"
        )

        documents.append({
            "id": f"assignment/{row['id']}",
            "title": title,
            "text": text,
            "source": "assignment",
        })

    return documents


def stage_documents(source: str = "all") -> int:
    """
    Collect documents and write them to input/ directory as individual .txt files.
    GraphRAG reads from this directory for indexing.
    """
    INPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Clear previous staged docs
    for f in INPUT_DIR.glob("*.txt"):
        f.unlink()

    documents = []
    if source in ("docs", "all"):
        documents.extend(collect_knowledge_docs())
    if source in ("assignments", "all"):
        documents.extend(collect_assignment_outputs())

    for doc in documents:
        safe_name = doc["id"].replace("/", "_").replace("\\", "_").replace(" ", "_")
        # Strip .md extension before adding .txt
        if safe_name.endswith(".md"):
            safe_name = safe_name[:-3]
        file_path = INPUT_DIR / f"{safe_name}.txt"
        file_path.write_text(doc["text"], encoding="utf-8")

    print(f"[Collector] Staged {len(documents)} documents in {INPUT_DIR}")
    return len(documents)


if __name__ == "__main__":
    count = stage_documents("all")
    print(f"Collected {count} documents")
