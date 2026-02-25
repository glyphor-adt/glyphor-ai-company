"""
HTTP Server — lightweight trigger endpoint for the GraphRAG indexer.

Designed to be called by Cloud Scheduler or the main Node.js scheduler.
Runs as a standalone Python service (separate Cloud Run service or sidecar).

Endpoints:
    POST /index   — Run the full collect → extract → bridge pipeline
    POST /tune    — Run auto prompt tuning
    GET  /health  — Health check

Usage:
    python -m graphrag_indexer.server [--port 8090]
"""

import asyncio
import json
import os
import traceback
from http.server import HTTPServer, BaseHTTPRequestHandler
from threading import Thread

from .index import run_pipeline
from .tune import run_auto_tune


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

                result = run_pipeline(source=source)
                self._json_response(200, {"status": "ok", "result": result})

            elif self.path == "/tune":
                source = body.get("source", "all")
                limit = body.get("limit", 15)
                asyncio.run(run_auto_tune(source=source, limit=limit))
                self._json_response(200, {"status": "ok", "message": "tuning complete"})

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
