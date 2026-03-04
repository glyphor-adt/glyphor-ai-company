"""
HTTP Server — lightweight trigger endpoint for the GraphRAG indexer.

Designed to be called by Cloud Scheduler or the main Node.js scheduler.
Runs as a standalone Python service (separate Cloud Run service or sidecar).

Endpoints:
    POST /index   — Run the full collect → extract → bridge pipeline (async)
    POST /tune    — Run auto prompt tuning (async)
    GET  /health  — Health check

Both /index and /tune respond 202 immediately and run in a background thread.
On completion they update ``data_sync_status`` in PostgreSQL directly.

Usage:
    python -m graphrag_indexer.server [--port 8090]
"""

import asyncio
import json
import os
import traceback
from datetime import datetime, timezone
from http.server import HTTPServer, BaseHTTPRequestHandler
from threading import Thread

import psycopg2

from .config import DB_HOST, DB_NAME, DB_USER, DB_PASSWORD
from .index import run_pipeline
from .tune import run_auto_tune


def _update_sync_status(sync_id: str, success: bool, error_msg: str | None = None):
    """Write result directly into data_sync_status."""
    now = datetime.now(timezone.utc).isoformat()
    try:
        conn = psycopg2.connect(host=DB_HOST, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD)
        conn.autocommit = True
        with conn.cursor() as cur:
            if success:
                cur.execute(
                    "INSERT INTO data_sync_status (id, last_success_at, consecutive_failures, status, updated_at) "
                    "VALUES (%s,%s,0,'ok',%s) "
                    "ON CONFLICT (id) DO UPDATE SET last_success_at=EXCLUDED.last_success_at, "
                    "consecutive_failures=0, status='ok', updated_at=EXCLUDED.updated_at",
                    (sync_id, now, now),
                )
            else:
                cur.execute("SELECT consecutive_failures FROM data_sync_status WHERE id=%s", (sync_id,))
                row = cur.fetchone()
                failures = (row[0] if row else 0) + 1
                status = 'failing' if failures >= 3 else 'stale'
                cur.execute(
                    "INSERT INTO data_sync_status (id, last_failure_at, last_error, consecutive_failures, status, updated_at) "
                    "VALUES (%s,%s,%s,%s,%s,%s) "
                    "ON CONFLICT (id) DO UPDATE SET last_failure_at=EXCLUDED.last_failure_at, "
                    "last_error=EXCLUDED.last_error, consecutive_failures=EXCLUDED.consecutive_failures, "
                    "status=EXCLUDED.status, updated_at=EXCLUDED.updated_at",
                    (sync_id, now, (error_msg or '')[:500], failures, status, now),
                )
        conn.close()
        print(f"[SyncStatus] Updated {sync_id}: {'ok' if success else 'error'}")
    except Exception as e:
        print(f"[SyncStatus] Failed to update {sync_id}: {e}")


def _run_index_bg(source: str):
    """Run indexing pipeline in background, update DB when done."""
    try:
        print(f"[Index] Background pipeline starting (source={source})")
        result = run_pipeline(source=source)
        print(f"[Index] Pipeline complete: {result}")
        _update_sync_status('graphrag-index', True)
    except Exception as e:
        traceback.print_exc()
        _update_sync_status('graphrag-index', False, str(e))


def _run_tune_bg(source: str, limit: int):
    """Run auto-tune in background, update DB when done."""
    try:
        print(f"[Tune] Background tuning starting (source={source}, limit={limit})")
        asyncio.run(run_auto_tune(source=source, limit=limit))
        print("[Tune] Tuning complete")
        _update_sync_status('graphrag-tune', True)
    except Exception as e:
        traceback.print_exc()
        _update_sync_status('graphrag-tune', False, str(e))


class IndexerHandler(BaseHTTPRequestHandler):
    """Simple HTTP handler for indexer triggers."""

    def do_GET(self):
        if self.path == "/health":
            self._json_response(200, {"status": "ok", "service": "graphrag-indexer"})
        else:
            self._json_response(404, {"error": "not found"})

    def do_POST(self):
        try:
            body = self._read_body()

            if self.path == "/index":
                source = body.get("source", "all")
                if source not in ("docs", "assignments", "all"):
                    self._json_response(400, {"error": "source must be docs, assignments, or all"})
                    return
                Thread(target=_run_index_bg, args=(source,), daemon=True).start()
                self._json_response(202, {"status": "accepted", "message": "indexing started in background"})

            elif self.path == "/tune":
                source = body.get("source", "all")
                limit = body.get("limit", 15)
                Thread(target=_run_tune_bg, args=(source, limit), daemon=True).start()
                self._json_response(202, {"status": "accepted", "message": "tuning started in background"})

            else:
                self._json_response(404, {"error": "not found"})

        except Exception as e:
            traceback.print_exc()
            self._json_response(500, {"error": str(e)[:500]})

    def _read_body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {}

    def _json_response(self, status: int, data: dict):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        print(f"[Server] {args[0]} {args[1]} {args[2]}")


def main():
    import argparse
    parser = argparse.ArgumentParser(description="GraphRAG Indexer HTTP Server")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8090")))
    args = parser.parse_args()

    server = HTTPServer(("0.0.0.0", args.port), IndexerHandler)
    print(f"[Server] GraphRAG Indexer listening on port {args.port}")
    print(f"  POST /index  — run indexing pipeline")
    print(f"  POST /tune   — run auto prompt tuning")
    print(f"  GET  /health — health check")
    server.serve_forever()


if __name__ == "__main__":
    main()
