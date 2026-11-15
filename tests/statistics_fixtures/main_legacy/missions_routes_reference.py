"""Endpoints extra del Modo detective (Persona 5).

GET /api/missions y GET /api/missions/<id> los registra routes/api_routes.py
(usan services.datasets). Acá solo están los endpoints del recomendador y
del catálogo de fuentes:

    GET /api/phenomena                          fenómenos para el recomendador
    GET /api/variables/recommend?phenomenon=..  variables sugeridas
    GET /api/sources                            catálogo de fuentes de datos

`handle_missions_get(path, query)` sirve lo mismo para el servidor de
respaldo sin Flask (EarthLensUnifiedHandler en app.py).
"""

from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

from services import datasets


def handle_missions_get(path: str, query: Dict[str, Any]) -> Optional[Tuple[Dict[str, Any], int]]:
    """Devuelve (respuesta, status) si `path` es un endpoint de este módulo; si no, None."""
    if path == "/api/phenomena":
        return {"phenomena": datasets.list_phenomena()}, 200
    if path == "/api/sources":
        return {"sources": datasets.list_sources()}, 200
    if path == "/api/variables/recommend":
        phenomenon = query.get("phenomenon", "")
        if isinstance(phenomenon, list):
            phenomenon = phenomenon[0] if phenomenon else ""
        if not phenomenon:
            return {"error": "Falta el parámetro 'phenomenon'.",
                    "phenomena": datasets.list_phenomena()}, 400
        return {"phenomenon": phenomenon,
                "variables": datasets.recommend_variables(phenomenon)}, 200
    return None


def register_missions_routes(app: Any) -> None:
    """Registra los endpoints en la app Flask."""
    from flask import jsonify, request  # type: ignore

    def _serve(path: str):
        resp, status = handle_missions_get(path, request.args.to_dict())
        return jsonify(resp), status

    app.add_url_rule("/api/phenomena", "missions_phenomena",
                     lambda: _serve("/api/phenomena"), methods=["GET"])
    app.add_url_rule("/api/sources", "missions_sources",
                     lambda: _serve("/api/sources"), methods=["GET"])
    app.add_url_rule("/api/variables/recommend", "missions_recommend",
                     lambda: _serve("/api/variables/recommend"), methods=["GET"])
