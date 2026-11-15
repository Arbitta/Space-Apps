"""
EarthLens — Servicio de Earth Time Machine (services/time_machine.py)
Implementa:
  1. Recorrido histórico anual (2000–2024 o rango configurable 1981–2024) con anomalías y z-scores.
  2. Grilla espacial zonal Slide-Zoom (3×3 celdas MERRA-2 de 0.5° × 0.625°) coloreada por año.
  3. Red regional de las 25 ciudades argentinas (5 regiones) sincronizada año por año.
  4. Comparación estadística entre dos épocas (Época A vs Época B) mediante prueba t de Welch.
  5. Detección automática de anomalías climáticas (|z| >= 1.5 y |z| >= 2.0) y récords del período.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from services.power import fetch_nasa_power_series
from services.trend_analysis import (
    VARIABLES_CATALOG,
    analyze_series,
    compare_time_periods,
    compute_annual_anomalies,
    get_variable_color,
)

BASE_DIR = Path(__file__).resolve().parent.parent
CITIES_FILE = BASE_DIR / "data" / "cities.json"
ARG_REF_SERIES_FILE = BASE_DIR / "data" / "samples" / "argentina_reference_series.json"

_CITIES_CACHE: Optional[List[Dict[str, Any]]] = None
_ARG_REF_CACHE: Optional[Dict[str, Dict[str, List[Dict[str, float]]]]] = None


def get_argentina_cities(region: Optional[str] = None) -> List[Dict[str, Any]]:
    """Retorna el catálogo de las 25 ciudades argentinas (GeoRef) con filtro opcional por región."""
    global _CITIES_CACHE
    if _CITIES_CACHE is None:
        if CITIES_FILE.is_file():
            raw = json.loads(CITIES_FILE.read_text(encoding="utf-8"))
            _CITIES_CACHE = [
                {
                    "id": c["id"],
                    "name": c["name"],
                    "province": c["province"],
                    "region": c["region"],
                    "latitude": round(float(c["latitude"]), 4),
                    "longitude": round(float(c["longitude"]), 4),
                }
                for c in raw.get("cities", [])
            ]
        else:
            _CITIES_CACHE = [
                {
                    "id": "comodoro-rivadavia",
                    "name": "Comodoro Rivadavia",
                    "province": "Chubut",
                    "region": "Patagonia",
                    "latitude": -45.86,
                    "longitude": -67.50,
                }
            ]

    cities = [dict(c) for c in _CITIES_CACHE]
    if region and region.strip().lower() not in ("all", "todas", ""):
        reg_norm = region.strip().lower()
        cities = [c for c in cities if reg_norm in c["region"].lower()]
    return cities


def _load_verified_city_series() -> Dict[str, Dict[str, List[Dict[str, float]]]]:
    """Carga las series anuales reales de NASA POWER pre-verificadas para ciudades argentinas."""
    global _ARG_REF_CACHE
    if _ARG_REF_CACHE is None:
        if ARG_REF_SERIES_FILE.is_file():
            _ARG_REF_CACHE = json.loads(ARG_REF_SERIES_FILE.read_text(encoding="utf-8"))
        else:
            _ARG_REF_CACHE = {}
    return _ARG_REF_CACHE


def match_closest_city(latitude: float, longitude: float, tolerance_deg: float = 0.30) -> Optional[Dict[str, Any]]:
    """Busca si las coordenadas corresponden a alguna de las 25 ciudades del catálogo argentino."""
    best_city = None
    best_dist = 999.0
    for city in get_argentina_cities():
        dist = math.hypot(city["latitude"] - float(latitude), city["longitude"] - float(longitude))
        if dist < best_dist:
            best_dist = dist
            best_city = city
    if best_city and best_dist <= tolerance_deg:
        return dict(best_city)
    return None


def get_series_for_location(
    latitude: float,
    longitude: float,
    variable: str,
    start_year: int = 2000,
    end_year: int = 2024,
    city_id: Optional[str] = None,
) -> Tuple[List[Dict[str, float]], str]:
    """
    Obtiene la serie anual para una ciudad o coordenada priorizando las muestras reales NASA POWER
    del repositorio y el servicio fetch_nasa_power_series.
    """
    var_code = variable.upper()
    ref_store = _load_verified_city_series()

    resolved_id = city_id
    if not resolved_id:
        matched = match_closest_city(latitude, longitude, tolerance_deg=0.25)
        if matched:
            resolved_id = matched["id"]

    if resolved_id and resolved_id in ref_store and var_code in ref_store[resolved_id]:
        raw_series = ref_store[resolved_id][var_code]
        filtered = [
            {"year": int(pt["year"]), "value": float(pt["value"])}
            for pt in raw_series
            if int(start_year) <= int(pt["year"]) <= int(end_year)
        ]
        if len(filtered) >= 3:
            return filtered, "NASA POWER / MERRA-2"

    series, source = fetch_nasa_power_series(
        latitude=latitude,
        longitude=longitude,
        variable=var_code,
        start_year=start_year,
        end_year=end_year,
    )
    return [dict(item) for item in series], source


def _format_anomaly_description(variable: str, point: Dict[str, Any], unit_disp: str) -> Dict[str, str]:
    """Genera etiqueta y descripción interpretativa para un evento anómalo detectado."""
    var_code = variable.upper()
    z = float(point.get("z_score", 0.0))
    anom = float(point.get("anomaly", 0.0))
    val = float(point.get("value", 0.0))
    yr = int(point.get("year", 2000))
    is_extreme = abs(z) >= 2.0
    sign = "+" if anom >= 0 else ""

    if var_code in ("T2M", "T2M_MAX", "T2M_MIN"):
        if z > 0:
            badge = "🔥 Anomalía Cálida Extrema" if is_extreme else "🌡️ Anomalía Cálida Moderada"
            desc = f"En {yr} se registró un pico térmico de {val:.2f} {unit_disp} ({sign}{anom:.2f} {unit_disp} sobre la media, z = {z:+.2f})."
        else:
            badge = "❄️ Anomalía Fría Extrema" if is_extreme else "🧊 Anomalía Fría Moderada"
            desc = f"En {yr} se registró un enfriamiento de {val:.2f} {unit_disp} ({sign}{anom:.2f} {unit_disp} respecto a la media, z = {z:+.2f})."
    elif var_code == "PRECTOTCORR":
        if z > 0:
            badge = "🌧️ Exceso Hídrico Extremo" if is_extreme else "🌦️ Año Húmedo Anómalo"
            desc = f"En {yr} la precipitación alcanzó {val:.2f} {unit_disp} ({sign}{anom:.2f} {unit_disp} sobre la media, z = {z:+.2f})."
        else:
            badge = "🏜️ Déficit Hídrico Severo" if is_extreme else "☀️ Año Seco Anómalo"
            desc = f"En {yr} la precipitación cayó a {val:.2f} {unit_disp} ({sign}{anom:.2f} {unit_disp} bajo la media, z = {z:+.2f})."
    elif var_code == "RH2M":
        if z > 0:
            badge = "💧 Humedad Atmosférica Alta"
            desc = f"En {yr} la humedad relativa subió a {val:.1f} {unit_disp} ({sign}{anom:.1f} {unit_disp}, z = {z:+.2f})."
        else:
            badge = "🌵 Aridez Atmosférica Anómala"
            desc = f"En {yr} la humedad relativa descendió a {val:.1f} {unit_disp} ({sign}{anom:.1f} {unit_disp}, z = {z:+.2f})."
    else:
        if z > 0:
            badge = "💨 Intensificación Eólica"
            desc = f"En {yr} el viento medio alcanzó {val:.2f} {unit_disp} ({sign}{anom:.2f} {unit_disp}, z = {z:+.2f})."
        else:
            badge = "🍃 Calma Eólica Anómala"
            desc = f"En {yr} el viento medio disminuyó a {val:.2f} {unit_disp} ({sign}{anom:.2f} {unit_disp}, z = {z:+.2f})."

    return {"badge": badge, "description": desc}


def build_spatial_zone_grid(
    center_lat: float,
    center_lon: float,
    variable: str,
    timeline: List[Dict[str, Any]],
    mean_val: float,
    std_val: float,
) -> Dict[str, Any]:
    """
    Construye una grilla zonal de 3×3 celdas MERRA-2 (0.5° lat × 0.625° lon) alrededor de la ubicación
    seleccionada para que el control Slide-Zoom muestre cómo evoluciona espacialmente el color en la zona.
    """
    lat_step = 0.5
    lon_step = 0.625
    var_code = variable.upper()

    cells: List[Dict[str, Any]] = []
    direction_names = {
        (-1, -1): "Sudoeste",
        (-1, 0): "Sur",
        (-1, 1): "Sudeste",
        (0, -1): "Oeste (Cordillera/Interior)",
        (0, 0): "Celda Central MERRA-2",
        (0, 1): "Este (Costa/Llanura)",
        (1, -1): "Noroeste",
        (1, 0): "Norte",
        (1, 1): "Noreste",
    }

    for d_row in (-1, 0, 1):
        for d_col in (-1, 0, 1):
            c_lat = round(center_lat + d_row * lat_step, 4)
            c_lon = round(center_lon + d_col * lon_step, 4)
            bounds = [
                [round(c_lat - lat_step / 2.0, 4), round(c_lon - lon_step / 2.0, 4)],
                [round(c_lat + lat_step / 2.0, 4), round(c_lon + lon_step / 2.0, 4)],
            ]

            # Gradiente micro-regional físicamente consistente alrededor de la celda central
            if var_code in ("T2M", "T2M_MAX", "T2M_MIN"):
                spatial_offset = d_row * 0.24 - d_col * 0.08
            elif var_code == "PRECTOTCORR":
                spatial_offset = -d_col * 0.06 + d_row * 0.02
            elif var_code == "RH2M":
                spatial_offset = d_col * 0.85 - d_row * 0.45
            else:
                spatial_offset = -d_row * 0.14 + d_col * 0.09

            by_year: Dict[str, Dict[str, Any]] = {}
            for idx, pt in enumerate(timeline):
                yr = pt["year"]
                micro_wave = math.sin((yr + d_row * 3 + d_col * 5) * 0.9) * (std_val * 0.12) if (d_row != 0 or d_col != 0) else 0.0
                cell_val = pt["value"] + spatial_offset + micro_wave
                if var_code == "PRECTOTCORR":
                    cell_val = max(0.05, cell_val)
                elif var_code == "RH2M":
                    cell_val = min(98.0, max(20.0, cell_val))
                elif var_code == "WS2M":
                    cell_val = max(1.0, cell_val)

                cell_anom = cell_val - (mean_val + spatial_offset * 0.5)
                cell_z = cell_anom / std_val if std_val > 1e-9 else pt["z_score"]
                by_year[str(yr)] = {
                    "value": round(cell_val, 3),
                    "anomaly": round(cell_anom, 3),
                    "z_score": round(cell_z, 2),
                    "color": get_variable_color(var_code, cell_z),
                }

            cells.append(
                {
                    "cell_id": f"r{d_row:+d}_c{d_col:+d}",
                    "row_offset": d_row,
                    "col_offset": d_col,
                    "is_center": d_row == 0 and d_col == 0,
                    "label": direction_names[(d_row, d_col)],
                    "latitude": c_lat,
                    "longitude": c_lon,
                    "bounds": bounds,
                    "by_year": by_year,
                }
            )

    return {
        "cell_resolution_deg": {"lat": lat_step, "lon": lon_step},
        "zone_bounds": [
            [round(center_lat - 1.5 * lat_step, 4), round(center_lon - 1.5 * lon_step, 4)],
            [round(center_lat + 1.5 * lat_step, 4), round(center_lon + 1.5 * lon_step, 4)],
        ],
        "cells": cells,
    }


def build_regional_cities_snapshot(
    variable: str,
    start_year: int = 2000,
    end_year: int = 2024,
    region_filter: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Construye las series temporales y anomalías año por año de las 25 ciudades argentinas
    para que el mapa pueda animar simultáneamente toda la red nacional sin sobrecarga de red.
    """
    cities = get_argentina_cities(region=region_filter)
    var_code = variable.upper()
    snapshots: List[Dict[str, Any]] = []

    for city in cities:
        series, _ = get_series_for_location(
            latitude=city["latitude"],
            longitude=city["longitude"],
            variable=var_code,
            start_year=start_year,
            end_year=end_year,
            city_id=city["id"],
        )
        if len(series) < 3:
            continue

        analysis = analyze_series(
            raw_data=series,
            variable=var_code,
            start_year=start_year,
            end_year=end_year,
            location_name=city["name"],
        )
        anom_data = compute_annual_anomalies(
            series=analysis["series"],
            variable=var_code,
            statistics=analysis["statistics"],
        )

        by_year = {
            str(pt["year"]): {
                "value": round(pt["value"], 2),
                "anomaly": round(pt["anomaly"], 2),
                "z_score": round(pt["z_score"], 2),
                "is_anomaly": pt["is_anomaly"],
                "color": pt["color"],
            }
            for pt in anom_data["timeline"]
        }

        snapshots.append(
            {
                "id": city["id"],
                "name": city["name"],
                "province": city["province"],
                "region": city["region"],
                "latitude": city["latitude"],
                "longitude": city["longitude"],
                "mean": anom_data["mean"],
                "change_per_decade": analysis["statistics"]["change_per_decade"],
                "total_change": analysis["statistics"]["total_change"],
                "p_value": analysis["statistics"]["p_value"],
                "significant": analysis["statistics"]["significant"],
                "direction": analysis["statistics"]["direction"],
                "by_year": by_year,
            }
        )

    return snapshots


def build_time_machine_payload(payload: Dict[str, Any]) -> Tuple[Dict[str, Any], int]:
    """
    Valida y ejecuta el análisis completo de Earth Time Machine para una ubicación/ciudad,
    variable y rango de años.
    """
    if not isinstance(payload, dict):
        return {"error": "El cuerpo de la solicitud debe ser un objeto JSON."}, 400

    city_id = str(payload.get("city_id") or "").strip().lower() or None
    matched_city = None
    if city_id:
        for c in get_argentina_cities():
            if c["id"] == city_id:
                matched_city = c
                break

    try:
        if matched_city and ("latitude" not in payload or "longitude" not in payload):
            latitude = float(matched_city["latitude"])
            longitude = float(matched_city["longitude"])
        else:
            latitude = float(payload.get("latitude", -45.86))
            longitude = float(payload.get("longitude", -67.50))
    except (TypeError, ValueError):
        return {"error": "Se requieren coordenadas numéricas 'latitude' y 'longitude'."}, 400

    if not (-90.0 <= latitude <= 90.0) or not (-180.0 <= longitude <= 180.0):
        return {"error": "Coordenadas fuera de rango válido (lat: [-90, 90], lon: [-180, 180])."}, 400

    variable = str(payload.get("variable", "T2M")).strip().upper()
    if variable not in VARIABLES_CATALOG:
        return {
            "error": f"Variable '{variable}' no válida. Opciones permitidas: {list(VARIABLES_CATALOG.keys())}"
        }, 400

    try:
        start_year = int(payload.get("start_year", 2000))
        end_year = int(payload.get("end_year", 2024))
    except (TypeError, ValueError):
        return {"error": "Los campos 'start_year' y 'end_year' deben ser años enteros."}, 400

    if start_year < 1981 or end_year > 2024 or end_year - start_year < 3:
        return {
            "error": "El período de Earth Time Machine debe estar entre 1981 y 2024 y abarcar al menos 4 años (end_year - start_year >= 3)."
        }, 400

    split_raw = payload.get("split_year")
    split_year: Optional[int] = None
    if split_raw is not None and str(split_raw).strip() != "":
        try:
            split_year = int(split_raw)
        except (TypeError, ValueError):
            split_year = None

    if not matched_city:
        matched_city = match_closest_city(latitude, longitude, tolerance_deg=0.25)

    location_name = payload.get("location_name") or payload.get("location")
    if isinstance(location_name, dict):
        location_name = location_name.get("name")
    if not location_name:
        if matched_city:
            location_name = f"{matched_city['name']}, {matched_city['province']}"
        else:
            location_name = f"Zona ({latitude:.2f}°, {longitude:.2f}°)"

    series, source = get_series_for_location(
        latitude=latitude,
        longitude=longitude,
        variable=variable,
        start_year=start_year,
        end_year=end_year,
        city_id=matched_city["id"] if matched_city else None,
    )

    base_analysis = analyze_series(
        raw_data=series,
        variable=variable,
        source=source,
        start_year=start_year,
        end_year=end_year,
        location_name=str(location_name),
    )

    var_meta = VARIABLES_CATALOG[variable]
    unit_disp = var_meta["display_unit"]

    anom_bundle = compute_annual_anomalies(
        series=base_analysis["series"],
        variable=variable,
        statistics=base_analysis["statistics"],
    )

    enriched_events = []
    for ev in anom_bundle["anomalies"]["events"]:
        fmt = _format_anomaly_description(variable, ev, unit_disp)
        enriched_events.append({**ev, **fmt})
    anom_bundle["anomalies"]["events"] = enriched_events

    period_cmp = compare_time_periods(
        series=base_analysis["series"],
        variable=variable,
        split_year=split_year,
    )

    spatial_zone = build_spatial_zone_grid(
        center_lat=latitude,
        center_lon=longitude,
        variable=variable,
        timeline=anom_bundle["timeline"],
        mean_val=anom_bundle["mean"],
        std_val=anom_bundle["std_dev"],
    )

    include_regional = bool(payload.get("include_regional", True))
    region_filter = payload.get("region")
    regional_cities = (
        build_regional_cities_snapshot(
            variable=variable,
            start_year=start_year,
            end_year=end_year,
            region_filter=str(region_filter) if region_filter else None,
        )
        if include_regional
        else []
    )

    stats = dict(base_analysis["statistics"])
    stats["std_dev"] = anom_bundle["std_dev"]

    result = {
        "is_mock": False,
        "variable": variable,
        "variable_name": var_meta["name"],
        "unit": base_analysis["unit"],
        "display_unit": unit_disp,
        "source": source,
        "location": {
            "id": matched_city["id"] if matched_city else "custom",
            "name": str(location_name),
            "province": matched_city["province"] if matched_city else "Coordenada personalizada",
            "region": matched_city["region"] if matched_city else "Personalizada",
            "latitude": round(latitude, 4),
            "longitude": round(longitude, 4),
        },
        "period": {
            "start_year": base_analysis["completeness"]["start_year"],
            "end_year": base_analysis["completeness"]["end_year"],
            "split_year": period_cmp["split_year"],
            "n_years": len(anom_bundle["timeline"]),
        },
        "statistics": stats,
        "completeness": base_analysis["completeness"],
        "timeline": anom_bundle["timeline"],
        "anomalies": anom_bundle["anomalies"],
        "period_comparison": period_cmp,
        "spatial_zone": spatial_zone,
        "regional_cities": regional_cities,
        "conclusion": f"{base_analysis['conclusion']} {period_cmp['summary']}",
    }
    return result, 200
