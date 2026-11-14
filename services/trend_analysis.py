"""Herramientas para analizar tendencias lineales en series climáticas."""

from collections.abc import Sequence
from math import isfinite

from scipy.stats import linregress, t


def analyze_trend(
    years: Sequence[float],
    values: Sequence[float],
    alpha: float = 0.05,
) -> dict[str, float | int | bool | str | list[float]]:
    """Calcula estadísticas de una tendencia lineal.

    ``years`` contiene la variable independiente (normalmente años) y
    ``values`` contiene la variable climática observada. El resultado es un
    diccionario preparado para convertirse posteriormente en JSON.
    """
    if len(years) != len(values):
        raise ValueError("years y values deben tener la misma longitud")

    if len(years) < 3:
        raise ValueError("se necesitan al menos 3 observaciones")

    if not 0 < alpha < 1:
        raise ValueError("alpha debe estar entre 0 y 1")

    try:
        numeric_years = [float(year) for year in years]
        numeric_values = [float(value) for value in values]
    except (TypeError, ValueError) as error:
        raise ValueError("years y values deben contener números") from error

    if not all(isfinite(number) for number in numeric_years + numeric_values):
        raise ValueError("years y values no pueden contener NaN o infinito")

    if len(set(numeric_years)) < 2:
        raise ValueError("years debe contener al menos dos valores distintos")

    result = linregress(numeric_years, numeric_values)
    degrees_of_freedom = len(numeric_years) - 2
    critical_value = float(t.ppf(1 - alpha / 2, degrees_of_freedom))
    margin = critical_value * result.stderr
    confidence_interval = [
        float(result.slope - margin),
        float(result.slope + margin),
    ]

    period_start = min(numeric_years)
    period_end = max(numeric_years)
    significant = bool(result.pvalue < alpha)

    if result.slope > 0:
        direction = "increasing"
        direction_text = "ascendente"
    elif result.slope < 0:
        direction = "decreasing"
        direction_text = "descendente"
    else:
        direction = "stable"
        direction_text = "estable"

    if significant:
        conclusion = (
            f"Se detectó una tendencia {direction_text} estadísticamente "
            f"significativa (p = {result.pvalue:.4g} < {alpha})."
        )
    else:
        conclusion = (
            f"No se encontró evidencia estadística suficiente de una tendencia "
            f"lineal (p = {result.pvalue:.4g} ≥ {alpha})."
        )

    return {
        "n": len(numeric_years),
        "slope": float(result.slope),
        "intercept": float(result.intercept),
        "r_value": float(result.rvalue),
        "r_squared": float(result.rvalue**2),
        "p_value": float(result.pvalue),
        "stderr": float(result.stderr),
        "change_per_decade": float(result.slope * 10),
        "total_change": float(result.slope * (period_end - period_start)),
        "significant": significant,
        "direction": direction,
        "confidence_interval_95": confidence_interval,
        "conclusion": conclusion,
    }


if __name__ == "__main__":
    anios = [2020, 2021, 2022, 2023, 2024]
    temperaturas = [12.0, 12.3, 12.5, 12.8, 13.1]
    resultado = analyze_trend(anios, temperaturas)

    print("Pendiente:", resultado["slope"])
    print("Cambio por década:", resultado["change_per_decade"])
    print("P-valor:", resultado["p_value"])
    print("IC 95%:", resultado["confidence_interval_95"])
    print("Conclusión:", resultado["conclusion"])
