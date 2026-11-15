"""
EarthLens — Servidor Principal Unificado (app.py)
Integra los módulos:
  - Rol 01 (Inicio e Identidad: /, /index, /about)
  - Rol 02 (Explorador y Mapa: /explorer)
  - Rol 03 (Resultados y Comparador: /results, /compare)
  - Rol 04 (Backend y Consumo NASA POWER: /api/analyze, /api/summary, /api/variables)
  - Rol 05 (Misiones y Modo Detective: /missions, /api/missions)
  - Rol 06 (Estadística SciPy, Integración y Pruebas: services/trend_analysis.py, /api/compare)
"""

from __future__ import annotations

import json
import mimetypes
import os
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from routes.api_routes import (
    handle_analyze_request,
    handle_compare_request,
    handle_summary_request,
    handle_time_machine_request,
    register_api_routes,
)
from services.datasets import get_mission_by_id, get_missions_list, get_variables_catalog
from services.time_machine import get_argentina_cities

BASE_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "static"


def _resolve_page_file(page_slug: str) -> Path:
    """Resuelve la plantilla HTML solicitada o usa un respaldo seguro."""
    clean = page_slug.strip("/").replace("templates/", "")
    if not clean or clean in ("index", "index.html"):
        candidate = TEMPLATES_DIR / "index.html"
    elif clean.endswith(".html"):
        candidate = TEMPLATES_DIR / clean
    else:
        candidate = TEMPLATES_DIR / f"{clean}.html"

    if candidate.is_file():
        return candidate
    if (TEMPLATES_DIR / "index.html").is_file():
        return TEMPLATES_DIR / "index.html"
    return TEMPLATES_DIR / "results.html"


def create_app() -> Any:
    """Crea y configura la aplicación Flask unificada de EarthLens."""
    from flask import Flask, send_file, send_from_directory  # type: ignore

    app = Flask(
        __name__,
        template_folder=str(TEMPLATES_DIR),
        static_folder=str(STATIC_DIR),
        static_url_path="/static",
    )

    register_api_routes(app)

    @app.route("/")
    @app.route("/index")
    @app.route("/index.html")
    def index_page():
        return send_file(str(_resolve_page_file("index.html")))

    @app.route("/explorer")
    @app.route("/explorer.html")
    def explorer_page():
        return send_file(str(_resolve_page_file("explorer.html")))

    @app.route("/results")
    @app.route("/results.html")
    def results_page():
        return send_file(str(_resolve_page_file("results.html")))

    @app.route("/compare")
    @app.route("/compare.html")
    def compare_page():
        return send_file(str(_resolve_page_file("compare.html")))

    @app.route("/time-machine")
    @app.route("/time-machine.html")
    @app.route("/time_machine")
    @app.route("/time_machine.html")
    def time_machine_page():
        return send_file(str(_resolve_page_file("time_machine.html")))

    @app.route("/missions")
    @app.route("/missions.html")
    def missions_page():
        target = TEMPLATES_DIR / "missions.html"
        if target.is_file():
            return send_file(str(target))
        return send_file(str(_resolve_page_file("explorer.html")))

    @app.route("/about")
    @app.route("/about.html")
    def about_page():
        target = TEMPLATES_DIR / "about.html"
        if target.is_file():
            return send_file(str(target))
        return send_file(str(_resolve_page_file("index.html")))

    @app.route("/templates/<path:filename>")
    def templates_passthrough(filename: str):
        return send_from_directory(str(TEMPLATES_DIR), filename)

    return app


class EarthLensUnifiedHandler(BaseHTTPRequestHandler):
    """Servidor HTTP nativo de respaldo cuando se ejecuta sin Flask instalado localmente."""

    def _send_json(self, data: Any, status: int = 200) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (ConnectionAbortedError, BrokenPipeError):
            pass

    def _send_file(self, file_path: Path) -> None:
        if not file_path.is_file():
            self._send_json({"error": "Archivo no encontrado"}, 404)
            return
        ctype, _ = mimetypes.guess_type(str(file_path))
        content = file_path.read_bytes()
        try:
            self.send_response(200)
            self.send_header("Content-Type", (ctype or "text/plain") + "; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        except (ConnectionAbortedError, BrokenPipeError):
            pass

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/variables":
            return self._send_json({"variables": get_variables_catalog()}, 200)
        if path == "/api/cities":
            qs = parse_qs(parsed.query)
            region = qs.get("region", [None])[0]
            cities = get_argentina_cities(region=region)
            return self._send_json({"cities": cities, "count": len(cities)}, 200)
        if path == "/api/time-machine":
            qs = parse_qs(parsed.query)
            payload = {
                "city_id": qs.get("city_id", [None])[0],
                "latitude": qs.get("latitude", qs.get("lat", [-45.86]))[0],
                "longitude": qs.get("longitude", qs.get("lon", [-67.50]))[0],
                "variable": qs.get("variable", ["T2M"])[0],
                "start_year": qs.get("start_year", [2000])[0],
                "end_year": qs.get("end_year", [2024])[0],
                "split_year": qs.get("split_year", [None])[0],
                "location_name": qs.get("location_name", qs.get("location", [None]))[0],
                "region": qs.get("region", [None])[0],
                "lat_span": qs.get("lat_span", [1.5])[0],
                "lon_span": qs.get("lon_span", [1.875])[0],
                "include_regional": qs.get("include_regional", ["1"])[0] != "0",
            }
            resp, status = handle_time_machine_request(payload)
            return self._send_json(resp, status)
        if path == "/api/summary":
            qs = parse_qs(parsed.query)
            resp, status = handle_summary_request(
                lat=qs.get("lat", [-34.6037])[0],
                lon=qs.get("lon", [-58.3816])[0],
                start_year=qs.get("start_year", [2000])[0],
                end_year=qs.get("end_year", [2024])[0],
            )
            return self._send_json(resp, status)
        if path == "/api/missions":
            return self._send_json({"missions": get_missions_list()}, 200)
        if path.startswith("/api/missions/"):
            m_id = path.split("/api/missions/", 1)[1]
            mission = get_mission_by_id(m_id)
            if not mission:
                return self._send_json({"error": "Misión no encontrada"}, 404)
            return self._send_json(mission, 200)
        if path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return

        if path.startswith("/static/"):
            target = (BASE_DIR / path.lstrip("/")).resolve()
            if str(target).startswith(str(BASE_DIR)):
                return self._send_file(target)

        if path in ("/", "/index", "/index.html", "/templates/index.html"):
            return self._send_file(_resolve_page_file("index.html"))
        if path in ("/explorer", "/explorer.html", "/templates/explorer.html"):
            return self._send_file(_resolve_page_file("explorer.html"))
        if path in ("/results", "/results.html", "/templates/results.html"):
            return self._send_file(_resolve_page_file("results.html"))
        if path in ("/compare", "/compare.html", "/templates/compare.html"):
            return self._send_file(_resolve_page_file("compare.html"))
        if path in (
            "/time-machine",
            "/time-machine.html",
            "/time_machine",
            "/time_machine.html",
            "/templates/time_machine.html",
        ):
            return self._send_file(_resolve_page_file("time_machine.html"))
        if path in ("/missions", "/missions.html", "/templates/missions.html"):
            return self._send_file(_resolve_page_file("missions.html"))
        if path in ("/about", "/about.html", "/templates/about.html"):
            return self._send_file(_resolve_page_file("about.html"))

        candidate = (BASE_DIR / path.lstrip("/")).resolve()
        if str(candidate).startswith(str(BASE_DIR)) and candidate.is_file():
            return self._send_file(candidate)

        self._send_json({"error": f"Ruta {path} no encontrada"}, 404)

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
        if parsed.path == "/api/time-machine":
            resp, status = handle_time_machine_request(payload)
            return self._send_json(resp, status)

        self._send_json({"error": "Endpoint no encontrado"}, 404)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "127.0.0.1")
    url = f"http://127.0.0.1:{port}/"
    threading.Timer(0.8, lambda: webbrowser.open(url)).start()

    try:
        flask_app = create_app()
        print(f"🌍 EarthLens Unificado (Flask + SciPy) corriendo en {url}")
        flask_app.run(host=host, port=port, debug=False)
    except ImportError:
        print(f"🌍 EarthLens Unificado (Servidor integrado) corriendo en {url}")
        server = ThreadingHTTPServer((host, port), EarthLensUnifiedHandler)
        server.serve_forever()
