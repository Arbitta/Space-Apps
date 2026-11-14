"""
EarthLens — Servidor Principal e Integración de Módulos (app.py)
NASA Space Apps Challenge 2026 · Be An Earth System Trend Detective!
"""

from __future__ import annotations

import json
import mimetypes
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from routes.api_routes import (
    handle_analyze_request,
    handle_compare_request,
    register_api_routes,
)
from services.datasets import get_mission_by_id, get_missions_list, get_variables_catalog

BASE_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "static"


def create_app() -> Any:
    """Crea y configura la aplicación Flask oficial de EarthLens."""
    from flask import Flask, redirect, send_from_directory  # type: ignore

    app = Flask(
        __name__,
        template_folder=str(TEMPLATES_DIR),
        static_folder=str(STATIC_DIR),
        static_url_path="/static",
    )

    register_api_routes(app)

    @app.route("/")
    def root_index():
        index_file = TEMPLATES_DIR / "index.html"
        if index_file.exists():
            return send_from_directory(str(TEMPLATES_DIR), "index.html")
        return redirect("/templates/results.html")

    @app.route("/<page_name>.html")
    @app.route("/templates/<page_name>.html")
    def serve_template_html(page_name: str):
        target = TEMPLATES_DIR / f"{page_name}.html"
        if target.exists():
            return send_from_directory(str(TEMPLATES_DIR), f"{page_name}.html")
        return send_from_directory(str(TEMPLATES_DIR), "results.html")

    @app.route("/results")
    def results_route():
        return send_from_directory(str(TEMPLATES_DIR), "results.html")

    @app.route("/compare")
    def compare_route():
        return send_from_directory(str(TEMPLATES_DIR), "compare.html")

    return app


class _FallbackEarthLensHandler(BaseHTTPRequestHandler):
    """Servidor HTTP nativo de respaldo en caso de ejecutar sin Flask instalado localmente."""

    def _send_json(self, data: Any, status: int = 200) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/variables":
            return self._send_json({"variables": get_variables_catalog()}, 200)
        if path == "/api/missions":
            return self._send_json({"missions": get_missions_list()}, 200)
        if path.startswith("/api/missions/"):
            m_id = path.split("/api/missions/", 1)[1]
            mission = get_mission_by_id(m_id)
            if not mission:
                return self._send_json({"error": "Misión no encontrada"}, 404)
            return self._send_json(mission, 200)

        if path in ("/", "/results", "/results.html"):
            path = "/templates/results.html"
        elif path in ("/compare", "/compare.html"):
            path = "/templates/compare.html"
        elif path.endswith(".html") and not path.startswith("/templates/"):
            candidate = TEMPLATES_DIR / path.lstrip("/")
            if candidate.exists():
                path = f"/templates/{path.lstrip('/')}"

        file_path = (BASE_DIR / path.lstrip("/")).resolve()
        if not str(file_path).startswith(str(BASE_DIR)) or not file_path.is_file():
            fallback = TEMPLATES_DIR / "results.html"
            if fallback.is_file() and path.endswith(".html"):
                file_path = fallback
            else:
                self.send_error(404, "Archivo no encontrado")
                return

        ctype, _ = mimetypes.guess_type(str(file_path))
        content = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype or "application/octet-stream")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            return self._send_json({"error": "JSON inválido"}, 400)

        if parsed.path == "/api/analyze":
            resp, status = handle_analyze_request(payload)
            return self._send_json(resp, status)
        if parsed.path == "/api/compare":
            resp, status = handle_compare_request(payload)
            return self._send_json(resp, status)

        self._send_json({"error": "Endpoint no encontrado"}, 404)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "0.0.0.0")
    try:
        flask_app = create_app()
        print(f"🌍 EarthLens (Flask + SciPy) corriendo en http://{host}:{port}")
        flask_app.run(host=host, port=port, debug=False)
    except ImportError:
        print(f"🌍 EarthLens (Servidor integrado) corriendo en http://{host}:{port}")
        server = HTTPServer((host, port), _FallbackEarthLensHandler)
        server.serve_forever()
