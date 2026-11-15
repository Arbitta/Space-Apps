"""Motor del Earth Radar: ranking de tendencias por ciudad argentina."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from services.power import fetch_nasa_power_series
from services.trend_analysis import VARIABLES_CATALOG, analyze_series


DATA_FILE = Path(__file__).resolve().parent.parent / "data" / "cities_argentina.json"


@lru_cache(maxsize=1)
def load_cities() -> tuple[dict[str, Any], ...]:
    """Carga el catálogo estable de ciudades usado por el radar."""
    with DATA_FILE.open(encoding="utf-8") as file:
        return tuple(json.load(file))


def analyze_radar(
    variable: str = "T2M",
    start_year: int = 2000,
    end_year: int = 2024,
    region: str | None = None,
    limit: int | None = None,
    live: bool | None = None,
) -> dict[str, Any]:
    """Analiza y ordena las señales ambientales de las ciudades catalogadas."""
    variable = variable.upper()
    if variable not in VARIABLES_CATALOG:
        raise ValueError(f"Variable no soportada: {variable}")
    if end_year - start_year < 2:
        raise ValueError("El período debe abarcar al menos 3 años")
    if limit is not None and not 1 <= limit <= 25:
        raise ValueError("limit debe estar entre 1 y 25")

    selected = [
        city
        for city in load_cities()
        if not region or city["region"].lower() == region.strip().lower()
    ]

    signals = []
    for city in selected:
        series, source, is_mock, data_mode = fetch_nasa_power_series(
            latitude=city["latitude"],
            longitude=city["longitude"],
            variable=variable,
            start_year=start_year,
            end_year=end_year,
            live=live,
        )
        analysis = analyze_series(
            raw_data=series,
            variable=variable,
            source=source,
            start_year=start_year,
            end_year=end_year,
            location_name=city["name"],
        )
        stats = analysis["statistics"]
        signal_type = (
            stats["direction"] if stats["significant"] else "inconclusive"
        )
        signals.append(
            {
                "city": city,
                "variable": variable,
                "period": {"start_year": start_year, "end_year": end_year},
                "statistics": stats,
                "conclusion": analysis["conclusion"],
                "source": source,
                "is_mock": is_mock,
                "data_mode": data_mode,
                "signal_type": signal_type,
                "results_url": (
                    f"/results?lat={city['latitude']}&lon={city['longitude']}"
                    f"&label={city['name']}&variable={variable}"
                    f"&start_year={start_year}&end_year={end_year}"
                ),
                "investigation_url": (
                    f"/results?lat={city['latitude']}&lon={city['longitude']}"
                    f"&label={city['name']}&variable={variable}"
                    f"&start_year={start_year}&end_year={end_year}"
                ),
            }
        )

    signals.sort(
        key=lambda item: (
            item["statistics"]["significant"],
            abs(item["statistics"]["change_per_decade"]),
        ),
        reverse=True,
    )
    if limit is not None:
        signals = signals[:limit]

    modes = {item["data_mode"] for item in signals}
    return {
        "variable": variable,
        "period": {"start_year": start_year, "end_year": end_year},
        "region": region,
        "cities_analyzed": len(signals),
        "data_mode": next(iter(modes)) if len(modes) == 1 else "mixed",
        "is_mock": any(item["is_mock"] for item in signals),
        "signals": signals,
    }
