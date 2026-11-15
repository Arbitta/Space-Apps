"""Suite de pruebas para el módulo predictivo de Earth Time Machine (services/forecast.py + /api/forecast)."""

from __future__ import annotations

import json
import threading
import unittest
from http.server import ThreadingHTTPServer
from urllib import error, request

from app import EarthLensUnifiedHandler
from services.forecast import build_forecast, student_t_cdf, student_t_ppf


class ForecastUnitTest(unittest.TestCase):
    """Pruebas unitarias y de caja blanca para el motor predictivo y probabilidades."""

    def test_student_t_cdf_and_ppf_accuracy(self) -> None:
        self.assertAlmostEqual(student_t_cdf(0.0, 10), 0.5, places=6)
        self.assertAlmostEqual(student_t_ppf(0.975, 23), 2.0686576, places=4)
        self.assertAlmostEqual(student_t_cdf(2.0, 10), 0.963306, places=4)
        self.assertAlmostEqual(student_t_cdf(-1.5, 5), 0.096952, places=4)

    def test_insufficient_series_returns_unavailable(self) -> None:
        short_series = [{"year": 2021 + i, "value": 10.0 + i} for i in range(4)]
        res = build_forecast(short_series, variable="T2M")
        self.assertFalse(res["available"])
        self.assertIn("al menos 5", res["reason"])

    def test_strong_warming_trend_probabilities_and_conclusions(self) -> None:
        # Serie con tendencia clara y ruido moderado
        series = [
            {"year": 2000 + i, "value": 10.0 + 0.12 * i + (0.2 if i % 2 == 0 else -0.2)}
            for i in range(25)
        ]
        res = build_forecast(
            series,
            variable="T2M",
            forecast_start=2025,
            forecast_end=2034,
            custom_threshold=13.0,
            custom_direction="above",
            location_name="Comodoro Rivadavia",
        )
        self.assertTrue(res["available"])
        self.assertEqual(res["window"]["start_year"], 2025)
        self.assertEqual(res["window"]["end_year"], 2034)
        self.assertEqual(len(res["years"]), 10)
        self.assertTrue(res["model"]["significant"])
        self.assertEqual(res["confidence"], "alta")

        # En cada año futuro: IP 95% más ancho que IC 95%, y probabilidades en [0, 1]
        for pt in res["years"]:
            self.assertLessEqual(pt["pi_low"], pt["ci_low"])
            self.assertGreaterEqual(pt["pi_high"], pt["ci_high"])
            for p in pt["probabilities"].values():
                self.assertGreaterEqual(p, 0.0)
                self.assertLessEqual(p, 1.0)

        # Con calentamiento fuerte, anomalías cálidas mucho más probables que en clima estacionario
        high_mod = res["summary"]["high_moderate"]
        self.assertGreater(high_mod["prob_at_least_one"], 0.90)
        self.assertGreater(high_mod["risk_ratio"], 2.0)
        self.assertIn("custom", res["summary"])
        self.assertGreater(len(res["conclusions"]), 4)
        self.assertIn("Comodoro Rivadavia", res["headline"])

    def test_non_significant_series_adds_exploratory_warning(self) -> None:
        # Serie oscilante sin tendencia neta
        series = [
            {"year": 2000 + i, "value": 15.0 + (1.2 if i % 2 == 0 else -1.2)}
            for i in range(20)
        ]
        res = build_forecast(series, variable="RH2M", horizon=10)
        self.assertTrue(res["available"])
        self.assertFalse(res["model"]["significant"])
        self.assertIn(res["confidence"], ("baja", "media"))
        self.assertEqual(res["conclusions"][0]["level"], "warning")
        self.assertIn("no es estadísticamente significativa", res["conclusions"][0]["text"])


class ForecastHttpTest(unittest.TestCase):
    """Pruebas HTTP para /time-machine, /api/time-machine (con forecast) y /api/forecast."""

    @classmethod
    def setUpClass(cls) -> None:
        proxy_handler = request.ProxyHandler({})
        opener = request.build_opener(proxy_handler)
        request.install_opener(opener)
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), EarthLensUnifiedHandler)
        cls.port = cls.server.server_address[1]
        cls.base_url = f"http://127.0.0.1:{cls.port}"
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2.0)

    def test_time_machine_page_contains_forecast_module(self) -> None:
        with request.urlopen(f"{self.base_url}/time-machine", timeout=5) as resp:
            html = resp.read().decode("utf-8")
            self.assertEqual(resp.status, 200)
            self.assertIn("winForecast", html)
            self.assertIn("tm_forecast.js", html)
            self.assertIn("btnFcApply", html)

    def test_post_time_machine_includes_forecast(self) -> None:
        payload = json.dumps({
            "city_id": "comodoro-rivadavia",
            "variable": "T2M",
            "start_year": 2000,
            "end_year": 2024,
            "forecast_start": 2025,
            "forecast_end": 2035,
            "include_regional": False,
        }).encode("utf-8")
        req = request.Request(
            f"{self.base_url}/api/time-machine",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            self.assertEqual(resp.status, 200)
            self.assertIn("forecast", data)
            self.assertTrue(data["forecast"]["available"])
            self.assertEqual(data["forecast"]["window"]["end_year"], 2035)

    def test_post_api_forecast_recalculates_and_validates(self) -> None:
        series = [{"year": 2000 + i, "value": 11.0 + 0.04 * i} for i in range(25)]
        payload = json.dumps({
            "variable": "T2M",
            "location_name": "Zona Test",
            "series": series,
            "forecast_start": 2026,
            "forecast_end": 2032,
            "custom_threshold": 12.2,
            "custom_direction": "above",
        }).encode("utf-8")
        req = request.Request(
            f"{self.base_url}/api/forecast",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            self.assertEqual(resp.status, 200)
            self.assertTrue(data["available"])
            self.assertEqual(data["window"]["start_year"], 2026)
            self.assertEqual(data["window"]["end_year"], 2032)
            self.assertIn("custom", data["summary"])

        # Serie vacía -> HTTP 400
        bad_req = request.Request(
            f"{self.base_url}/api/forecast",
            data=json.dumps({"variable": "T2M", "series": []}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with self.assertRaises(error.HTTPError) as ctx:
            request.urlopen(bad_req, timeout=5)
        self.assertEqual(ctx.exception.code, 400)


if __name__ == "__main__":
    unittest.main()
