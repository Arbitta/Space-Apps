"""Suite de pruebas para el modulo Earth Time Machine (Rol 03 + Producto Temporal)."""

from __future__ import annotations

import json
import threading
import unittest
from http.server import ThreadingHTTPServer
from urllib import request

from app import EarthLensUnifiedHandler
from routes.api_routes import handle_time_machine_request
from services.time_machine import build_time_machine_payload, get_argentina_cities
from services.trend_analysis import (
    compare_time_periods,
    compute_annual_anomalies,
    get_variable_color,
)


class TimeMachineUnitAndServiceTest(unittest.TestCase):
    """Pruebas unitarias y de caja blanca para la logica de Earth Time Machine."""

    def test_rol03_helpers_anomalies_and_period_comparison(self) -> None:
        series = [
            {"year": 2000 + index, "value": 14.0 + (index * 0.08)}
            for index in range(25)
        ]

        color_high = get_variable_color("T2M", 2.2)
        self.assertEqual(color_high, "#dc2626")

        anomalies = compute_annual_anomalies(series, variable="T2M")
        self.assertEqual(len(anomalies["timeline"]), 25)
        self.assertAlmostEqual(
            sum(item["anomaly"] for item in anomalies["timeline"]),
            0.0,
            places=2,
        )

        comparison = compare_time_periods(
            series,
            variable="T2M",
            split_year=2012,
        )
        self.assertGreater(comparison["delta_mean"], 0.8)
        self.assertLess(comparison["p_value"], 0.001)
        self.assertTrue(comparison["significant_shift"])

    def test_argentina_cities_catalog_integrity(self) -> None:
        cities = get_argentina_cities()
        self.assertEqual(len(cities), 25)
        ids = {city["id"] for city in cities}
        self.assertIn("comodoro-rivadavia", ids)
        self.assertIn("mendoza", ids)
        self.assertIn("buenos-aires", ids)

    def test_build_time_machine_payload_structure_and_spatial_grid(self) -> None:
        payload, status = build_time_machine_payload(
            {
                "city_id": "comodoro-rivadavia",
                "variable": "T2M",
                "start_year": 2000,
                "end_year": 2024,
                "split_year": 2012,
            }
        )

        self.assertEqual(status, 200)
        self.assertEqual(payload["variable"], "T2M")
        self.assertEqual(len(payload["timeline"]), 25)
        self.assertEqual(len(payload["spatial_zone"]["cells"]), 9)
        self.assertEqual(len(payload["regional_cities"]), 25)
        self.assertIn("period_comparison", payload)
        self.assertIn("anomalies", payload)

        center_cells = [
            cell for cell in payload["spatial_zone"]["cells"] if cell["is_center"]
        ]
        self.assertEqual(len(center_cells), 1)
        self.assertIn("2000", center_cells[0]["by_year"])

    def test_resizing_quadrant_changes_areal_series_and_statistics(self) -> None:
        small_box, _ = build_time_machine_payload(
            {
                "city_id": "comodoro-rivadavia",
                "variable": "T2M",
                "start_year": 2000,
                "end_year": 2024,
                "lat_span": 0.45,
                "lon_span": 0.55,
                "include_regional": False,
            }
        )
        large_box, _ = build_time_machine_payload(
            {
                "city_id": "comodoro-rivadavia",
                "variable": "T2M",
                "start_year": 2000,
                "end_year": 2024,
                "lat_span": 10.0,
                "lon_span": 12.0,
                "include_regional": False,
            }
        )

        self.assertNotEqual(
            small_box["statistics"]["mean"],
            large_box["statistics"]["mean"],
        )
        self.assertNotEqual(
            small_box["timeline"][0]["value"],
            large_box["timeline"][0]["value"],
        )
        self.assertGreater(
            small_box["statistics"]["std_dev"],
            large_box["statistics"]["std_dev"],
        )


class TimeMachineHttpAndConcurrencyTest(unittest.TestCase):
    """Pruebas HTTP de caja negra y concurrencia para /time-machine y /api/time-machine."""

    @classmethod
    def setUpClass(cls) -> None:
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

    def test_get_time_machine_html_page(self) -> None:
        with request.urlopen(f"{self.base_url}/time-machine", timeout=5) as response:
            html = response.read().decode("utf-8")
            self.assertEqual(response.status, 200)
            self.assertIn("Earth Time Machine", html)
            self.assertIn("tmCitySelect", html)
            self.assertIn("tmYearSlider", html)

    def test_get_cities_endpoint(self) -> None:
        with request.urlopen(f"{self.base_url}/api/cities", timeout=5) as response:
            body = json.loads(response.read().decode("utf-8"))
            self.assertEqual(response.status, 200)
            self.assertEqual(body["count"], 25)

    def test_post_and_get_api_time_machine_http(self) -> None:
        req_data = json.dumps(
            {
                "city_id": "mendoza",
                "variable": "PRECTOTCORR",
                "start_year": 2000,
                "end_year": 2024,
            }
        ).encode("utf-8")
        http_req = request.Request(
            f"{self.base_url}/api/time-machine",
            data=req_data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with request.urlopen(http_req, timeout=5) as response:
            payload = json.loads(response.read().decode("utf-8"))
            self.assertEqual(response.status, 200)
            self.assertEqual(payload["variable"], "PRECTOTCORR")
            self.assertEqual(len(payload["timeline"]), 25)

    def test_concurrent_time_machine_requests_thread_safety(self) -> None:
        cities = ["comodoro-rivadavia", "mendoza", "posadas", "cordoba", "ushuaia"]
        variables = ["T2M", "PRECTOTCORR", "WS2M", "T2M_MAX", "RH2M"]
        results: list[int] = []
        errors: list[Exception] = []

        def worker(index: int) -> None:
            try:
                response, status = handle_time_machine_request(
                    {
                        "city_id": cities[index % len(cities)],
                        "variable": variables[index % len(variables)],
                        "start_year": 2000,
                        "end_year": 2024,
                        "include_regional": False,
                    }
                )
                results.append(status)
                assert len(response["timeline"]) == 25
            except Exception as exc:  # pragma: no cover
                errors.append(exc)

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(10)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=5.0)

        self.assertEqual(errors, [])
        self.assertEqual(results, [200] * 10)


if __name__ == "__main__":
    unittest.main()
