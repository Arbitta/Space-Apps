"""
EarthLens — Servidor Local de Prueba (app.py)
Permite probar la pantalla de Explorador (/explorer) y el contrato JSON
de los endpoints /api/variables y /api/analyze localmente.
Soporta Flask (si está instalado) o http.server nativo de Python como respaldo automático.
"""

import json
import math
import mimetypes
import os
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen

BASE_DIR = Path(__file__).resolve().parent

VARIABLES_CATALOG = [
    {
        "code": "T2M",
        "name": "Temperatura media a 2 metros",
        "shortName": "Temperatura media",
        "unit": "deg C",
        "displayUnit": "°C",
        "priority": "Primera",
        "source": "NASA POWER / MERRA-2",
        "description": "Promedio anual de la temperatura del aire a 2 metros sobre la superficie. Variable principal del MVP."
    },
    {
        "code": "PRECTOTCORR",
        "name": "Precipitaciones corregidas",
        "shortName": "Precipitaciones",
        "unit": "mm/day",
        "displayUnit": "mm/día",
        "priority": "Alta",
        "source": "NASA POWER / MERRA-2",
        "description": "Precipitación total corregida promedio. Permite analizar sequías o incrementos de lluvias."
    },
    {
        "code": "RH2M",
        "name": "Humedad relativa a 2 metros",
        "shortName": "Humedad relativa",
        "unit": "%",
        "displayUnit": "%",
        "priority": "Alta",
        "source": "NASA POWER / MERRA-2",
        "description": "Porcentaje de humedad atmosférica a 2 metros. Nota científica: la humedad relativa no equivale a la humedad del suelo."
    },
    {
        "code": "WS2M",
        "name": "Velocidad del viento a 2 metros",
        "shortName": "Velocidad del viento",
        "unit": "m/s",
        "displayUnit": "m/s",
        "priority": "Alta",
        "source": "NASA POWER / MERRA-2",
        "description": "Velocidad media del viento a 2 metros de altura. Útil para evaluar cambios en regímenes eólicos."
    },
    {
        "code": "T2M_MAX",
        "name": "Temperatura máxima a 2 metros",
        "shortName": "Temperatura máxima",
        "unit": "deg C",
        "displayUnit": "°C",
        "priority": "Secundaria",
        "source": "NASA POWER / MERRA-2",
        "description": "Temperatura máxima registrada a 2 metros para evaluar extremos cálidos."
    },
    {
        "code": "T2M_MIN",
        "name": "Temperatura mínima a 2 metros",
        "shortName": "Temperatura mínima",
        "unit": "deg C",
        "displayUnit": "°C",
        "priority": "Secundaria",
        "source": "NASA POWER / MERRA-2",
        "description": "Temperatura mínima registrada a 2 metros para evaluar extremos fríos y heladas."
    }
]


def compute_linear_regression(series, start_year, end_year, unit):
    """Calcula pendiente, cambio por década, cambio total y p-valor aproximado."""
    n = len(series)
    if n < 2:
        return {
            "slope": 0.0,
            "change_per_decade": 0.0,
            "total_change": 0.0,
            "p_value": 1.0,
            "significant": False,
            "direction": "no_clear_trend"
        }, "Datos insuficientes para calcular tendencia."

    xs = [pt["year"] for pt in series]
    ys = [pt["value"] for pt in series]
    mean_x = sum(xs) / n
    mean_y = sum(ys) / n

    s_xx = sum((x - mean_x) ** 2 for x in xs)
    s_xy = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
    s_yy = sum((y - mean_y) ** 2 for y in ys)

    slope = s_xy / s_xx if s_xx > 0 else 0.0
    intercept = mean_y - slope * mean_x

    dof = max(1, n - 2)
    sse = max(0.0, s_yy - slope * s_xy)
    mse = sse / dof
    se_slope = math.sqrt(mse / s_xx) if s_xx > 0 and mse > 0 else 0.0
    t_stat = abs(slope / se_slope) if se_slope > 0 else 0.0

    p_value = round(math.erfc(t_stat / math.sqrt(2.0)), 4)
    significant = p_value < 0.05

    change_per_decade = round(slope * 10.0, 3)
    total_change = round(slope * (end_year - start_year), 2)
    slope_rounded = round(slope, 4)

    if slope_rounded > 0.0005:
        direction = "increasing"
    elif slope_rounded < -0.0005:
        direction = "decreasing"
    else:
        direction = "no_clear_trend"

    if significant and direction == "increasing":
        conclusion = f"Se detectó una tendencia ascendente estadísticamente significativa ({change_per_decade:+} {unit}/década, p = {p_value})."
    elif significant and direction == "decreasing":
        conclusion = f"Se detectó una tendencia descendente estadísticamente significativa ({change_per_decade:+} {unit}/década, p = {p_value})."
    else:
        conclusion = f"No se detectó evidencia estadística suficiente de tendencia lineal en el período (p = {p_value})."

    return {
        "slope": slope_rounded,
        "intercept": round(intercept, 3),
        "change_per_decade": change_per_decade,
        "total_change": total_change,
        "p_value": p_value,
        "significant": significant,
        "direction": direction
    }, conclusion


def fetch_nasa_power_monthly_to_annual(lat, lon, variable, start_year, end_year):
    """Consulta el endpoint mensual de NASA POWER y agrega el valor anual (ANN)."""
    url = (
        f"https://power.larc.nasa.gov/api/temporal/monthly/point"
        f"?parameters={variable}&community=RE"
        f"&longitude={lon}&latitude={lat}"
        f"&start={start_year}&end={end_year}&format=JSON"
    )
    req = Request(url, headers={"User-Agent": "EarthLens-SpaceApps/1.0"})
    with urlopen(req, timeout=8) as resp:
        payload = json.loads(resp.read().decode("utf-8"))

    param_data = payload["properties"]["parameter"][variable]
    series = []
    for year in range(start_year, end_year + 1):
        ann_key = f"{year}13"
        val = param_data.get(ann_key)
        if val is not None and val > -900:
            series.append({"year": year, "value": round(float(val), 2)})
        else:
            monthly_vals = [
                float(param_data[f"{year}{m:02d}"])
                for m in range(1, 13)
                if f"{year}{m:02d}" in param_data and float(param_data[f"{year}{m:02d}"]) > -900
            ]
            if len(monthly_vals) >= 10:
                series.append({"year": year, "value": round(sum(monthly_vals) / len(monthly_vals), 2)})

    return series


def process_analyze_payload(body):
    """Procesa el payload de POST /api/analyze y retorna (status_code, response_dict)."""
    try:
        lat = float(body.get("latitude"))
        lon = float(body.get("longitude"))
        variable = str(body.get("variable", "T2M")).strip().upper()
        start_year = int(body.get("start_year", 2000))
        end_year = int(body.get("end_year", 2024))
    except (TypeError, ValueError):
        return 400, {"error": "Parámetros inválidos en la solicitud JSON."}

    if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
        return 400, {"error": "Coordenadas fuera de rango (-90..90, -180..180)."}
    if start_year < 1981 or end_year > 2024 or start_year >= end_year:
        return 400, {"error": "Rango de años inválido (1981–2024, start_year < end_year)."}

    var_meta = next((v for v in VARIABLES_CATALOG if v["code"] == variable), VARIABLES_CATALOG[0])

    try:
        series = fetch_nasa_power_monthly_to_annual(lat, lon, variable, start_year, end_year)
        if len(series) < 3:
            raise ValueError("Serie de NASA POWER con menos de 3 años válidos.")
        stats, conclusion = compute_linear_regression(series, start_year, end_year, var_meta["unit"])
        return 200, {
            "is_mock": False,
            "variable": variable,
            "source": "NASA POWER / MERRA-2",
            "unit": var_meta["unit"],
            "series": series,
            "statistics": stats,
            "conclusion": conclusion
        }
    except (URLError, TimeoutError, KeyError, ValueError, OSError) as exc:
        return 503, {
            "error": f"No se pudo conectar con NASA POWER en este momento ({exc})."
        }


# Intentar usar Flask si está instalado; de lo contrario, usar http.server estándar
try:
    from flask import Flask, jsonify, redirect, render_template, request, url_for

    app = Flask(__name__)

    @app.route("/")
    def index():
        return redirect(url_for("explorer"))

    @app.route("/explorer")
    def explorer():
        return render_template("explorer.html")

    @app.route("/api/variables", methods=["GET"])
    def get_variables():
        return jsonify(VARIABLES_CATALOG)

    @app.route("/api/analyze", methods=["POST"])
    def analyze():
        body = request.get_json(silent=True) or {}
        status, payload = process_analyze_payload(body)
        return jsonify(payload), status

    HAS_FLASK = True
except ImportError:
    HAS_FLASK = False
    from http.server import BaseHTTPRequestHandler, HTTPServer
    from urllib.parse import urlparse

    class EarthLensHandler(BaseHTTPRequestHandler):
        def _send_json(self, status, data):
            raw = json.dumps(data, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def _send_file(self, filepath):
            if not filepath.is_file():
                self.send_error(404, "Archivo no encontrado")
                return
            mime, _ = mimetypes.guess_type(str(filepath))
            content = filepath.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", (mime or "text/plain") + "; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)

        def do_GET(self):
            parsed = urlparse(self.path)
            route = parsed.path

            if route in ("/", "/explorer", "/explorer.html"):
                self._send_file(BASE_DIR / "templates" / "explorer.html")
            elif route == "/api/variables":
                self._send_json(200, VARIABLES_CATALOG)
            elif route.startswith("/static/"):
                rel = route.lstrip("/")
                self._send_file(BASE_DIR / rel)
            else:
                self.send_error(404, f"Ruta {route} aun no implementada en este modulo")

        def do_POST(self):
            parsed = urlparse(self.path)
            if parsed.path == "/api/analyze":
                length = int(self.headers.get("Content-Length", 0))
                raw_body = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
                try:
                    body = json.loads(raw_body)
                except json.JSONDecodeError:
                    body = {}
                status, payload = process_analyze_payload(body)
                self._send_json(status, payload)
            else:
                self.send_error(404, "Endpoint no encontrado")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    if HAS_FLASK:
        print(f"Iniciando EarthLens con Flask en http://127.0.0.1:{port}/explorer")
        app.run(debug=True, port=port)
    else:
        print(f"Flask no detectado; iniciando servidor nativo de Python en http://127.0.0.1:{port}/explorer")
        server = HTTPServer(("127.0.0.1", port), EarthLensHandler)
        server.serve_forever()
