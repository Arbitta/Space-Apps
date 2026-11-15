"""
EarthLens — Endpoints REST del Contrato de la API (Página 6 del PDF + Inicio/Explorador)
Archivo: routes/api_routes.py
Endpoints:
  - GET  /api/variables
  - GET  /api/summary
  - POST /api/analyze
  - POST /api/compare
  - GET  /api/missions
  - GET  /api/missions/<mission_id>
"""

from __future__ import annotations

from typing import Any, Dict, Tuple

from services.datasets import get_mission_by_id, get_missions_list, get_variables_catalog
from services.power import fetch_nasa_power_series
from services.time_machine import build_time_machine_payload, get_argentina_cities
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
    result["is_mock"] = False
    return result, 200


def handle_summary_request(
    lat: Any = -34.6037,
    lon: Any = -58.3816,
    start_year: Any = 2000,
    end_year: Any = 2024,
) -> Tuple[Dict[str, Any], int]:
    """
    Procesa GET /api/summary (utilizado por la pantalla de Inicio index.html)
    calculando las estadísticas de todas las variables del catálogo con el motor del Rol 06.
    """
    try:
        lat_f = float(lat)
        lon_f = float(lon)
        s_yr = int(start_year)
        e_yr = int(end_year)
    except (TypeError, ValueError):
        return {"error": "Parámetros inválidos en /api/summary"}, 400

    if not (-90.0 <= lat_f <= 90.0) or not (-180.0 <= lon_f <= 180.0) or s_yr >= e_yr:
        return {"error": "Coordenadas o años fuera de rango"}, 400

    estimations: Dict[str, Any] = {}
    for code in VARIABLES_CATALOG.keys():
        res, status = handle_analyze_request(
            {
                "latitude": lat_f,
                "longitude": lon_f,
                "variable": code,
                "start_year": s_yr,
                "end_year": e_yr,
            }
        )
        if status == 200 and res.get("series"):
            series = res["series"]
            estimations[code] = {
                "variable": code,
                "unit": res["unit"],
                "mean_value": res["statistics"]["mean"],
                "latest_value": series[-1]["value"],
                "statistics": res["statistics"],
                "conclusion": res["conclusion"],
            }

    return (
        {
            "is_mock": False,
            "latitude": lat_f,
            "longitude": lon_f,
            "start_year": s_yr,
            "end_year": e_yr,
            "estimations": estimations,
        },
        200,
    )


def handle_compare_request(payload: Dict[str, Any]) -> Tuple[Dict[str, Any], int]:
    """
    Procesa POST /api/compare para dos ubicaciones con la misma variable y período.
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


def handle_time_machine_request(payload: Dict[str, Any]) -> Tuple[Dict[str, Any], int]:
    """
    Procesa POST/GET /api/time-machine y retorna la matriz temporal 2000–2024,
    grilla espacial MERRA-2 3×3, red de 25 ciudades argentinas, anomalías y comparación de épocas.
    """
    return build_time_machine_payload(payload)


def register_api_routes(app: Any) -> None:
    """Registra los endpoints REST en una aplicación Flask."""
    from flask import jsonify, request  # type: ignore

    @app.route("/api/variables", methods=["GET"])
    def api_variables():
        return jsonify({"variables": get_variables_catalog()}), 200

    @app.route("/api/cities", methods=["GET"])
    def api_cities():
        region = request.args.get("region")
        cities = get_argentina_cities(region=region)
        return jsonify({"cities": cities, "count": len(cities)}), 200

    @app.route("/api/summary", methods=["GET"])
    def api_summary():
        resp, status = handle_summary_request(
            lat=request.args.get("lat", -34.6037),
            lon=request.args.get("lon", -58.3816),
            start_year=request.args.get("start_year", 2000),
            end_year=request.args.get("end_year", 2024),
        )
        return jsonify(resp), status

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

    @app.route("/api/time-machine", methods=["GET", "POST"])
    def api_time_machine():
        if request.method == "POST":
            payload = request.get_json(silent=True) or {}
        else:
            payload = {
                "city_id": request.args.get("city_id"),
                "latitude": request.args.get("latitude", request.args.get("lat", -45.86)),
                "longitude": request.args.get("longitude", request.args.get("lon", -67.50)),
                "variable": request.args.get("variable", "T2M"),
                "start_year": request.args.get("start_year", 2000),
                "end_year": request.args.get("end_year", 2024),
                "split_year": request.args.get("split_year"),
                "location_name": request.args.get("location_name") or request.args.get("location"),
                "region": request.args.get("region"),
                "include_regional": request.args.get("include_regional", "1") != "0",
            }
        resp, status = handle_time_machine_request(payload)
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
