"""
EarthLens — Servidor Local (app.py)
Ejecuta:
    python app.py
Y abrirá automáticamente el navegador en http://127.0.0.1:5000/
"""

import json
import math
import mimetypes
import os
import socket
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import URLError
from urllib.parse import parse_qs, urlparse
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


def extract_annual_series(param_data, start_year, end_year):
    """Extrae la serie anual de un parámetro en la respuesta mensual de NASA POWER."""
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


def fetch_nasa_power_monthly_to_annual(lat, lon, variable, start_year, end_year):
    """Consulta el endpoint mensual de NASA POWER para una variable y agrega el valor anual (ANN)."""
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
    return extract_annual_series(param_data, start_year, end_year)


def process_summary_all_variables(lat, lon, start_year=2000, end_year=2024):
    """Consulta TODAS las variables del catálogo en una sola llamada a NASA POWER para el Inicio."""
    codes = [v["code"] for v in VARIABLES_CATALOG]
    params_csv = ",".join(codes)
    url = (
        f"https://power.larc.nasa.gov/api/temporal/monthly/point"
        f"?parameters={params_csv}&community=RE"
        f"&longitude={lon}&latitude={lat}"
        f"&start={start_year}&end={end_year}&format=JSON"
    )
    try:
        req = Request(url, headers={"User-Agent": "EarthLens-SpaceApps/1.0"})
        with urlopen(req, timeout=9) as resp:
            payload = json.loads(resp.read().decode("utf-8"))

        all_params = payload["properties"]["parameter"]
        estimations = {}
        for var_meta in VARIABLES_CATALOG:
            code = var_meta["code"]
            p_data = all_params.get(code, {})
            series = extract_annual_series(p_data, start_year, end_year)
            if len(series) >= 3:
                mean_val = round(sum(pt["value"] for pt in series) / len(series), 2)
                stats, conclusion = compute_linear_regression(series, start_year, end_year, var_meta["unit"])
                estimations[code] = {
                    "variable": code,
                    "unit": var_meta["unit"],
                    "mean_value": mean_val,
                    "latest_value": series[-1]["value"],
                    "statistics": stats,
                    "conclusion": conclusion
                }
        if estimations:
            return 200, {
                "is_mock": False,
                "latitude": lat,
                "longitude": lon,
                "start_year": start_year,
                "end_year": end_year,
                "estimations": estimations
            }
    except (URLError, TimeoutError, KeyError, ValueError, OSError) as exc:
        return 503, {"error": f"No se pudo conectar con NASA POWER ({exc})."}

    return 503, {"error": "Datos insuficientes de NASA POWER."}


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


class EarthLensHandler(BaseHTTPRequestHandler):
    def _send_json(self, status, data):
        raw = json.dumps(data, ensure_ascii=False).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
        except (ConnectionAbortedError, BrokenPipeError):
            pass

    def _send_file(self, filepath):
        if not filepath.is_file():
            self._send_json(404, {"error": "Archivo no encontrado"})
            return
        mime, _ = mimetypes.guess_type(str(filepath))
        content = filepath.read_bytes()
        try:
            self.send_response(200)
            self.send_header("Content-Type", (mime or "text/plain") + "; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        except (ConnectionAbortedError, BrokenPipeError):
            pass

    def do_GET(self):
        parsed = urlparse(self.path)
        route = parsed.path

        if route in ("/", "/index", "/index.html"):
            self._send_file(BASE_DIR / "templates" / "index.html")
        elif route in ("/explorer", "/explorer.html"):
            self._send_file(BASE_DIR / "templates" / "explorer.html")
        elif route in ("/results", "/results.html"):
            self._send_file(BASE_DIR / "templates" / "results.html")
        elif route in ("/compare", "/compare.html"):
            self._send_file(BASE_DIR / "templates" / "compare.html")
        elif route == "/api/variables":
            self._send_json(200, VARIABLES_CATALOG)
        elif route == "/api/summary":
            qs = parse_qs(parsed.query)
            try:
                lat = float(qs.get("lat", [-34.6037])[0])
                lon = float(qs.get("lon", [-58.3816])[0])
                start_year = int(qs.get("start_year", [2000])[0])
                end_year = int(qs.get("end_year", [2024])[0])
            except (TypeError, ValueError):
                self._send_json(400, {"error": "Parámetros inválidos"})
                return
            status, payload = process_summary_all_variables(lat, lon, start_year, end_year)
            self._send_json(status, payload)
        elif route.startswith("/static/"):
            rel = route.lstrip("/")
            self._send_file(BASE_DIR / rel)
        elif route == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
        else:
            self._send_json(404, {"error": f"Ruta {route} no encontrada"})

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
            self._send_json(404, {"error": "Endpoint no encontrado"})


def find_available_port(preferred_port=5000):
    """Encuentra el puerto 5000 o el siguiente libre si ya está en uso."""
    for port in (preferred_port, 5001, 5002, 8000, 8080):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return port
    return preferred_port


if __name__ == "__main__":
    preferred = int(os.environ.get("PORT", 5000))
    port = find_available_port(preferred)
    url = f"http://127.0.0.1:{port}/"

    print("=" * 60)
    print(f"🌍 Servidor EarthLens activo en: {url}")
    print(f"   - Inicio:     {url}")
    print(f"   - Explorador: {url}explorer")
    print(f"   - Resultados: {url}results")
    print(f"   - Comparador: {url}compare")
    print("=" * 60)

    # Abrir automáticamente el navegador tras 0.8 segundos
    threading.Timer(0.8, lambda: webbrowser.open(url)).start()

    server = ThreadingHTTPServer(("127.0.0.1", port), EarthLensHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor detenido.")
        server.server_close()
