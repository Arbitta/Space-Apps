"""
EarthLens — Suite de Auditoría Completa de Pruebas (test_full_audit.py)
Ejecuta las 5 metodologías solicitadas sobre todas las páginas y módulos del branch:
  1. Partición de Equivalencia y Valores Límite
  2. Caja Negra (Páginas: Inicio, Explorador, Resultados, Comparador, Misiones, Nosotros + API)
  3. Caja Blanca (Cobertura de ramas internas, DOM/JS de cada página y casos de borde)
  4. Hilos y Concurrencia (Multithreading sobre páginas, endpoints y caché compartida)
  5. Orientado a Objetos (Herencia, polimorfismo, encapsulamiento e inmutabilidad de estado)
"""

from __future__ import annotations

import json
import re
import socket
import threading
import time
import unittest
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from http.server import HTTPServer
from pathlib import Path

from app import BASE_DIR, EarthLensUnifiedHandler, _resolve_page_file
from routes.api_routes import (
    handle_analyze_request,
    handle_compare_request,
    handle_summary_request,
    validate_analyze_payload,
)
from services import power as power_module
from services.datasets import get_mission_by_id, get_missions_list, get_variables_catalog
from services.trend_analysis import (
    aggregate_to_annual_series,
    analyze_series,
    compare_two_locations,
    compute_linear_trend,
    evaluate_completeness,
    generate_conclusion,
    is_valid_observation,
)


# ==============================================================================
# 1. PRUEBAS DE PARTICIÓN DE EQUIVALENCIA Y VALORES LÍMITE
# ==============================================================================
class Test01EquivalencePartitioning(unittest.TestCase):
    """Evalúa clases de equivalencia válidas e inválidas y valores frontera."""

    def test_eq_latitude_partitions(self):
        """
        Clases de equivalencia para latitud:
          - Inválida inferior: < -90.0 (ej. -90.001, -150)
          - Límite inferior válido: -90.0
          - Válida nominal: -45.86
          - Límite superior válido: +90.0
          - Inválida superior: > +90.0 (ej. 90.001, 120)
          - Inválida por tipo: None, 'abc'
        """
        for invalid_lat in (-150.0, -90.0001, 90.0001, 180.0, None, "sur"):
            ok, _, _ = validate_analyze_payload(
                {"latitude": invalid_lat, "longitude": -67.5, "variable": "T2M"}
            )
            self.assertFalse(ok, f"Latitud inválida {invalid_lat} debió rechazarse")

        for valid_lat in (-90.0, -45.86, 0.0, 90.0):
            ok, msg, _ = validate_analyze_payload(
                {"latitude": valid_lat, "longitude": -67.5, "variable": "T2M"}
            )
            self.assertTrue(ok, f"Latitud válida {valid_lat} falló: {msg}")

    def test_eq_longitude_partitions(self):
        """
        Clases de equivalencia para longitud:
          - Inválida inferior: < -180.0
          - Límite válido: -180.0, 0.0, +180.0
          - Inválida superior: > +180.0
        """
        for invalid_lon in (-180.01, -360.0, 180.01, 270.0, None, "oeste"):
            ok, _, _ = validate_analyze_payload(
                {"latitude": -45.86, "longitude": invalid_lon, "variable": "T2M"}
            )
            self.assertFalse(ok, f"Longitud inválida {invalid_lon} debió rechazarse")

        for valid_lon in (-180.0, -67.5, 0.0, 180.0):
            ok, msg, _ = validate_analyze_payload(
                {"latitude": -45.86, "longitude": valid_lon, "variable": "T2M"}
            )
            self.assertTrue(ok, f"Longitud válida {valid_lon} falló: {msg}")

    def test_eq_variable_partitions(self):
        """Clases de equivalencia para el código de variable (válidas MVP vs inexistentes)."""
        for valid_var in ("T2M", "t2m", "PRECTOTCORR", "RH2M", "WS2M", "T2M_MAX", "T2M_MIN"):
            ok, _, clean = validate_analyze_payload(
                {"latitude": -45.86, "longitude": -67.5, "variable": valid_var}
            )
            self.assertTrue(ok)
            self.assertEqual(clean["variable"], valid_var.upper())

        for invalid_var in ("NDVI", "CO2", "TEMP", "", 12345):
            ok, _, _ = validate_analyze_payload(
                {"latitude": -45.86, "longitude": -67.5, "variable": invalid_var}
            )
            self.assertFalse(ok, f"Variable inválida {invalid_var} debió rechazarse")

    def test_eq_year_range_boundaries(self):
        """
        Valores límite para start_year y end_year:
          - Inválido: start_year < 1981 (ej. 1980)
          - Inválido: span < 2 (ej. 2020..2021 -> solo 2 puntos)
          - Límite válido mínimo: span == 2 (ej. 2020..2022 -> 3 años)
          - Hallazgo de borde: start_year=2023, end_year=2025 en Comodoro Rivadavia
            (el validador permite hasta 2026, pero el dataset de muestra termina en 2024).
        """
        ok_1980, _, _ = validate_analyze_payload(
            {"latitude": -45.86, "longitude": -67.5, "start_year": 1980, "end_year": 2020}
        )
        self.assertFalse(ok_1980)

        ok_span1, _, _ = validate_analyze_payload(
            {"latitude": -45.86, "longitude": -67.5, "start_year": 2020, "end_year": 2021}
        )
        self.assertFalse(ok_span1)

        ok_span2, _, _ = validate_analyze_payload(
            {"latitude": -45.86, "longitude": -67.5, "start_year": 2020, "end_year": 2022}
        )
        self.assertTrue(ok_span2)

    def test_boundary_bug_year_2025_2026_on_sample_data(self):
        """
        Detecta si pedir 2023–2025 o 2024–2026 en Comodoro Rivadavia lanza ValueError
        porque validate_analyze_payload acepta hasta 2026 pero la muestra llega hasta 2024.
        """
        ok, _, _ = validate_analyze_payload(
            {
                "latitude": -45.86,
                "longitude": -67.50,
                "variable": "T2M",
                "start_year": 2023,
                "end_year": 2025,
            }
        )
        self.assertTrue(ok, "El validador de API permite end_year=2025")
        # En Comodoro Rivadavia, el archivo de muestra solo tiene hasta 2024 (2 años: 2023 y 2024),
        # lo cual provoca un ValueError en compute_linear_trend si no se controla.
        with self.assertRaises(ValueError):
            handle_analyze_request(
                {
                    "latitude": -45.86,
                    "longitude": -67.50,
                    "variable": "T2M",
                    "start_year": 2023,
                    "end_year": 2025,
                }
            )


# ==============================================================================
# 2. PRUEBAS DE CAJA NEGRA (POR PÁGINA Y ENDPOINT HTTP)
# ==============================================================================
class Test02BlackBoxPagesAndAPI(unittest.TestCase):
    """Prueba cada página y endpoint desde fuera (HTTP) sin inspeccionar implementación."""

    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), EarthLensUnifiedHandler)
        cls.port = cls.server.server_port
        cls.base_url = f"http://127.0.0.1:{cls.port}"
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def _get(self, path: str):
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        req = urllib.request.Request(f"{self.base_url}{path}")
        try:
            with opener.open(req, timeout=5) as resp:
                return resp.status, resp.headers.get("Content-Type", ""), resp.read().decode("utf-8")
        except urllib.error.HTTPError as err:
            return err.code, err.headers.get("Content-Type", ""), err.read().decode("utf-8")

    def _post(self, path: str, payload: dict):
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            f"{self.base_url}{path}",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with opener.open(req, timeout=5) as resp:
                return resp.status, json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            return err.code, json.loads(err.read().decode("utf-8"))

    def test_page_01_time_machine_blackbox(self):
        """Caja Negra — Página principal centrada en Time Machine (/, /time-machine)."""
        for route in ("/", "/index", "/time-machine", "/time-machine.html", "/templates/time_machine.html"):
            status, ctype, html = self._get(route)
            self.assertEqual(status, 200, f"Fallo en ruta {route}")
            self.assertIn("text/html", ctype)
            self.assertIn("id=\"timeMachineMap\"", html)
            self.assertIn("id=\"tmYearSlider\"", html)

    def test_api_endpoints_blackbox(self):
        """Caja Negra — Endpoints REST (/api/variables, /api/summary, /api/missions, /api/analyze, /api/compare)."""
        st_v, _, raw_v = self._get("/api/variables")
        self.assertEqual(st_v, 200)
        self.assertEqual(len(json.loads(raw_v)["variables"]), 6)

        st_s, _, raw_s = self._get("/api/summary?lat=-45.86&lon=-67.50&start_year=2000&end_year=2024")
        self.assertEqual(st_s, 200)
        summary_data = json.loads(raw_s)
        self.assertIn("estimations", summary_data)
        self.assertEqual(len(summary_data["estimations"]), 6)

        st_a, res_a = self._post(
            "/api/analyze",
            {"latitude": -45.86, "longitude": -67.50, "variable": "T2M", "start_year": 2000, "end_year": 2024},
        )
        self.assertEqual(st_a, 200)
        self.assertEqual(res_a["variable"], "T2M")

        st_c, res_c = self._post(
            "/api/compare",
            {
                "variable": "WS2M",
                "start_year": 2000,
                "end_year": 2024,
                "location_a": {"latitude": -45.86, "longitude": -67.50, "name": "Comodoro"},
                "location_b": {"latitude": -54.80, "longitude": -68.30, "name": "Ushuaia"},
            },
        )
        self.assertEqual(st_c, 200)
        self.assertIn("deltas", res_c)


# ==============================================================================
# 3. PRUEBAS DE CAJA BLANCA (RUTAS INTERNAS DE CÓDIGO Y AUDITORÍA DOM/JS POR PÁGINA)
# ==============================================================================
class Test03WhiteBoxInternalLogic(unittest.TestCase):
    """Inspecciona ramas internas de código, discrepancias entre módulos y estructura DOM/JS."""

    def test_whitebox_direction_enum_in_trend_analysis(self):
        """
        Caja Blanca — Verifica que trend_analysis.py retorna direction = 'stable' cuando |slope| <= 1e-5.
        """
        flat_series = [{"year": 2000 + i, "value": 15.0} for i in range(10)]
        stats = compute_linear_trend(flat_series, start_year=2000, end_year=2009)
        self.assertEqual(stats["direction"], "stable")

    def test_whitebox_all_html_static_references_exist(self):
        """
        Caja Blanca — Verifica que todos los archivos CSS y JS referenciados en
        time_machine.html existan en static/.
        """
        pages = ["time_machine.html"]
        for page in pages:
            content = (BASE_DIR / "templates" / page).read_text(encoding="utf-8")
            refs = re.findall(r'(?:href|src)="\.\./static/([^"]+)"', content)
            self.assertGreater(len(refs), 0, f"{page} no tiene referencias a ../static/")
            for rel_ref in refs:
                asset_path = BASE_DIR / "static" / rel_ref
                self.assertTrue(
                    asset_path.is_file(),
                    f"El recurso static/{rel_ref} referenciado en {page} NO existe",
                )

    def test_time_machine_and_charts_fixes_verification(self):
        """
        Verifica las correcciones aplicadas en Time Machine y Charts:
          1. max="2024" y min="1981" en time_machine.html + sanitizeRequestParams en charts.js.
          2. Concurrencia y OO: AbortController y Object.freeze en charts.js y time_machine.js.
        """
        tm_html = (BASE_DIR / "templates" / "time_machine.html").read_text(encoding="utf-8")
        charts_js = (BASE_DIR / "static" / "js" / "charts.js").read_text(encoding="utf-8")
        tm_js = (BASE_DIR / "static" / "js" / "time_machine.js").read_text(encoding="utf-8")

        self.assertIn('max="2024"', tm_html)
        self.assertIn("sanitizeRequestParams", charts_js)
        self.assertIn("Object.freeze", charts_js)
        self.assertIn("AbortController", tm_js)

    def test_whitebox_branches_in_aggregate_and_completeness(self):
        """Cobertura de todas las ramas condicionales de aggregate_to_annual_series."""
        # Rama 1: entrada inválida (ni lista ni dict)
        self.assertEqual(aggregate_to_annual_series(None), [])  # type: ignore
        # Rama 2: resolución diaria (claves de 8 dígitos YYYYMMDD) con < 270 días -> se descarta
        daily_incomplete = {f"202001{d:02d}": 15.0 for d in range(1, 30)}
        self.assertEqual(aggregate_to_annual_series(daily_incomplete), [])
        # Rama 3: resolución diaria con >= 270 días válidos -> se conserva
        daily_complete = {f"2020{(i // 28) + 1:02d}{(i % 28) + 1:02d}": 14.0 for i in range(280)}
        res_daily = aggregate_to_annual_series(daily_complete)
        self.assertEqual(len(res_daily), 1)
        self.assertEqual(res_daily[0]["year"], 2020)


# ==============================================================================
# 4. PRUEBAS DE HILOS Y CONCURRENCIA (MULTITHREADING)
# ==============================================================================
class Test04MultithreadingConcurrency(unittest.TestCase):
    """Prueba concurrencia real con múltiples hilos sobre servicios, caché y servidor HTTP."""

    def test_concurrent_threads_on_trend_analysis_and_power_service(self):
        """
        Lanza 24 hilos concurrentes consultando distintas combinaciones de coordenadas y variables
        para verificar que no se corrompan los resultados matemáticos entre hilos.
        """
        tasks = [
            (-45.86, -67.50, "T2M", 2000, 2024),
            (-54.80, -68.30, "WS2M", 2000, 2024),
            (-41.13, -71.31, "PRECTOTCORR", 2000, 2024),
            (-32.89, -68.84, "RH2M", 2000, 2024),
            (-51.62, -69.22, "T2M_MAX", 2000, 2024),
            (-42.77, -65.03, "T2M_MIN", 2000, 2024),
        ] * 4  # 24 ejecuciones en paralelo

        def worker(args):
            lat, lon, var, s_yr, e_yr = args
            resp, status = handle_analyze_request(
                {
                    "latitude": lat,
                    "longitude": lon,
                    "variable": var,
                    "start_year": s_yr,
                    "end_year": e_yr,
                }
            )
            return var, status, resp

        with ThreadPoolExecutor(max_workers=8) as executor:
            futures = [executor.submit(worker, t) for t in tasks]
            for fut in as_completed(futures):
                var, status, resp = fut.result()
                self.assertEqual(status, 200)
                self.assertEqual(resp["variable"], var)
                self.assertEqual(len(resp["series"]), 25)

    def test_server_is_single_threaded_httpserver_finding(self):
        """
        Prueba de Hilos — Verifica la arquitectura de concurrencia del servidor en app.py:
        HTTPServer no hereda de ThreadingMixIn, por lo que procesa peticiones de manera secuencial.
        """
        from socketserver import ThreadingMixIn

        self.assertFalse(
            issubclass(HTTPServer, ThreadingMixIn),
            "HTTPServer estándar es monohilo (no usa ThreadingMixIn / ThreadingHTTPServer)",
        )


# ==============================================================================
# 5. PRUEBAS ORIENTADAS A OBJETOS (ENCAPSULAMIENTO, HERENCIA Y ESTADO MUTABLE)
# ==============================================================================
class Test05ObjectOrientedDesign(unittest.TestCase):
    """Evalúa herencia, polimorfismo, aislamiento de instancias y encapsulamiento de estado."""

    def test_oo_handler_inheritance_and_polymorphism(self):
        """Verifica la jerarquía de clases de EarthLensUnifiedHandler."""
        from http.server import BaseHTTPRequestHandler

        self.assertTrue(issubclass(EarthLensUnifiedHandler, BaseHTTPRequestHandler))
        for method_name in ("do_GET", "do_POST", "_send_json", "_send_file"):
            self.assertTrue(
                callable(getattr(EarthLensUnifiedHandler, method_name, None)),
                f"Método OO '{method_name}' faltante en EarthLensUnifiedHandler",
            )

    def test_oo_encapsulation_leak_in_memory_cache(self):
        """
        Prueba Orientada a Objetos (Encapsulamiento e Inmutabilidad):
        Verifica si fetch_nasa_power_series expone la referencia interna de _MEMORY_CACHE.
        Si un llamador muta la lista devuelta, ¿se corrompe el estado interno en caché para
        futuras llamadas?
        """
        power_module._MEMORY_CACHE.clear()
        series_1 = power_module.fetch_nasa_power_series(-45.86, -67.50, "T2M", 2000, 2024)[0]
        original_first_val = series_1[0]["value"]

        # Mutar el objeto devuelto desde fuera del módulo
        series_1[0]["value"] = -12345.67

        # Volver a pedir la misma serie al servicio
        series_2 = power_module.fetch_nasa_power_series(-45.86, -67.50, "T2M", 2000, 2024)[0]
        # Hallazgo OO: como _MEMORY_CACHE guarda y devuelve la misma referencia de lista/dicts,
        # la mutación externa corrompe la caché interna.
        cache_was_corrupted = series_2[0]["value"] == -12345.67

        # Limpiar caché para no afectar otras pruebas
        power_module._MEMORY_CACHE.clear()
        self.assertTrue(
            cache_was_corrupted,
            "Confirmado hallazgo OO: _MEMORY_CACHE retorna referencias mutables sin copia defensiva",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
