"""
EarthLens — Endpoints REST del Contrato de la API (Página 6 del PDF)
Archivo: routes/api_routes.py
Endpoints:
  - GET  /api/variables
  - POST /api/analyze
  - POST /api/compare
  - GET  /api/missions
  - GET  /api/missions/<mission_id>
"""

from __future__ import annotations

from typing import Any, Dict, Tuple

from services.datasets import get_mission_by_id, get_missions_list, get_variables_catalog
from services.power import fetch_nasa_power_series
from services.trend_analysis import (
    VARIABLES_CATALOG,
    analyze_series,
    compare_two_locations,
)


def validate_analyze_payload(payload: Dict[str, Any]) -> Tuple[bool, str, Dict[str, Any]]:
    """Valida los parámetros de entrada según el contrato de POST /api/analyze."""
    if not isinstance(payload, dict):
        return False, "El cuerpo de la solicitud debe ser un objeto JSON.", {}

    try:
        latitude = float(payload["latitude"])
        longitude = float(payload["longitude"])
    except (KeyError, TypeError, ValueError):
        return False, "Se requieren coordenadas numéricas 'latitude' y 'longitude'.", {}

    if not (-90.0 <= latitude <= 90.0) or not (-180.0 <= longitude <= 180.0):
        return False, "Coordenadas fuera de rango válido (lat: [-90, 90], lon: [-180, 180]).", {}

    variable = str(payload.get("variable", "T2M")).strip().upper()
    if variable not in VARIABLES_CATALOG:
        return (
            False,
            f"Variable '{variable}' no válida. Opciones permitidas: {list(VARIABLES_CATALOG.keys())}",
            {},
        )

    try:
        start_year = int(payload.get("start_year", 2000))
        end_year = int(payload.get("end_year", 2024))
    except (TypeError, ValueError):
        return False, "Los campos 'start_year' y 'end_year' deben ser años enteros.", {}

    if start_year < 1981 or end_year > 2026 or end_year - start_year < 2:
        return (
            False,
            "El período debe estar entre 1981 y 2026 y abarcar al menos 3 años (end_year - start_year >= 2).",
            {},
        )

    location_name = payload.get("location_name") or payload.get("location")
    if isinstance(location_name, dict):
        location_name = location_name.get("name")

    return (
        True,
        "",
        {
            "latitude": latitude,
            "longitude": longitude,
            "variable": variable,
            "start_year": start_year,
            "end_year": end_year,
            "location_name": str(location_name) if location_name else None,
        },
    )


def handle_analyze_request(payload: Dict[str, Any]) -> Tuple[Dict[str, Any], int]:
    """Procesa POST /api/analyze y devuelve (response_dict, http_status_code)."""
    ok, err_msg, clean = validate_analyze_payload(payload)
    if not ok:
        return {"error": err_msg}, 400

    series, source = fetch_nasa_power_series(
        latitude=clean["latitude"],
        longitude=clean["longitude"],
        variable=clean["variable"],
        start_year=clean["start_year"],
        end_year=clean["end_year"],
    )

    result = analyze_series(
        raw_data=series,
        variable=clean["variable"],
        source=source,
        start_year=clean["start_year"],
        end_year=clean["end_year"],
        location_name=clean["location_name"],
    )
    return result, 200


def handle_compare_request(payload: Dict[str, Any]) -> Tuple[Dict[str, Any], int]:
    """
    Procesa POST /api/compare para dos ubicaciones con la misma variable y período.
    Acepta formato:
      {
        "variable": "T2M",
        "start_year": 2000,
        "end_year": 2024,
        "location_a": {"latitude": -45.86, "longitude": -67.50, "name": "Comodoro Rivadavia"},
        "location_b": {"latitude": -54.80, "longitude": -68.30, "name": "Ushuaia"}
      }
    """
    if not isinstance(payload, dict):
        return {"error": "El cuerpo de la solicitud debe ser un objeto JSON."}, 400

    loc_a = payload.get("location_a") or {}
    loc_b = payload.get("location_b") or {}
    shared_var = payload.get("variable", loc_a.get("variable", "T2M"))
    shared_start = payload.get("start_year", loc_a.get("start_year", 2000))
    shared_end = payload.get("end_year", loc_a.get("end_year", 2024))

    req_a = {
        "latitude": loc_a.get("latitude"),
        "longitude": loc_a.get("longitude"),
        "variable": shared_var,
        "start_year": shared_start,
        "end_year": shared_end,
        "location_name": loc_a.get("name", "Ubicación A"),
    }
    req_b = {
        "latitude": loc_b.get("latitude"),
        "longitude": loc_b.get("longitude"),
        "variable": shared_var,
        "start_year": shared_start,
        "end_year": shared_end,
        "location_name": loc_b.get("name", "Ubicación B"),
    }

    res_a, code_a = handle_analyze_request(req_a)
    if code_a != 200:
        return {"error": f"Ubicación A inválida: {res_a.get('error')}"}, 400

    res_b, code_b = handle_analyze_request(req_b)
    if code_b != 200:
        return {"error": f"Ubicación B inválida: {res_b.get('error')}"}, 400

    comparison = compare_two_locations(
        res_a,
        res_b,
        name_a=req_a["location_name"] or "Ubicación A",
        name_b=req_b["location_name"] or "Ubicación B",
    )
    return comparison, 200


def register_api_routes(app: Any) -> None:
    """Registra los endpoints REST en una aplicación Flask."""
    from flask import jsonify, request  # type: ignore

    @app.route("/api/variables", methods=["GET"])
    def api_variables():
        return jsonify({"variables": get_variables_catalog()}), 200

    @app.route("/api/analyze", methods=["POST"])
    def api_analyze():
        payload = request.get_json(silent=True) or {}
        resp, status = handle_analyze_request(payload)
        return jsonify(resp), status

    @app.route("/api/compare", methods=["POST"])
    def api_compare():
        payload = request.get_json(silent=True) or {}
        resp, status = handle_compare_request(payload)
        return jsonify(resp), status

    @app.route("/api/missions", methods=["GET"])
    def api_missions():
        return jsonify({"missions": get_missions_list()}), 200

    @app.route("/api/missions/<mission_id>", methods=["GET"])
    def api_mission_detail(mission_id: str):
        mission = get_mission_by_id(mission_id)
        if not mission:
            return jsonify({"error": f"Misión '{mission_id}' no encontrada."}), 404
        return jsonify(mission), 200
