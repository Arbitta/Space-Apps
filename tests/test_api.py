"""
EarthLens — Rol 06: Pruebas de Integración y Contrato de la API (test_api.py)
Valida el contrato JSON de la Página 6 del PDF para /api/analyze, /api/compare,
/api/variables y /api/missions.
"""

import unittest
from unittest.mock import patch

try:
    import flask as _flask  # noqa: F401
    HAS_FLASK = True
except ImportError:
    HAS_FLASK = False

from app import create_app
from routes.api_routes import handle_analyze_request, handle_compare_request
from services.datasets import get_mission_by_id, get_missions_list, get_variables_catalog


class TestAPIContract(unittest.TestCase):
    """Pruebas del contrato JSON entre Frontend y Backend."""

    def test_post_api_analyze_comodoro_contract(self):
        """
        Verifica exactamente el ejemplo de Solicitud y Respuesta de la Página 6:
        latitude: -45.86, longitude: -67.50, variable: T2M, start_year: 2000, end_year: 2024
        """
        payload = {
            "latitude": -45.86,
            "longitude": -67.50,
            "variable": "T2M",
            "start_year": 2000,
            "end_year": 2024,
        }
        response, status = handle_analyze_request(payload)
        self.assertEqual(status, 200)

        # Campos obligatorios de primer nivel (Página 6)
        for key in ("variable", "source", "unit", "series", "statistics", "conclusion"):
            self.assertIn(key, response)

        self.assertEqual(response["variable"], "T2M")
        self.assertEqual(response["unit"], "deg C")
        self.assertEqual(len(response["series"]), 25)
        self.assertTrue(response["is_mock"])
        self.assertEqual(response["data_mode"], "sample")

        # Campos obligatorios dentro de statistics (Página 6)
        stats = response["statistics"]
        for skey in (
            "slope",
            "change_per_decade",
            "total_change",
            "p_value",
            "significant",
            "direction",
            "confidence_interval_95",
        ):
            self.assertIn(skey, stats)

    def test_post_api_compare_two_locations(self):
        """Verifica POST /api/compare entre Comodoro Rivadavia y Ushuaia."""
        payload = {
            "variable": "WS2M",
            "start_year": 2000,
            "end_year": 2024,
            "location_a": {
                "name": "Comodoro Rivadavia",
                "latitude": -45.86,
                "longitude": -67.50,
            },
            "location_b": {
                "name": "Ushuaia",
                "latitude": -54.80,
                "longitude": -68.30,
            },
        }
        response, status = handle_compare_request(payload)
        self.assertEqual(status, 200)
        self.assertEqual(response["variable"], "WS2M")
        self.assertIn("location_a", response)
        self.assertIn("location_b", response)
        self.assertIn("deltas", response)

    def test_api_validation_errors(self):
        """Verifica que coordenadas fuera de rango o variables inválidas retornen HTTP 400."""
        _, status_lat = handle_analyze_request(
            {"latitude": -120.0, "longitude": -67.5, "variable": "T2M"}
        )
        self.assertEqual(status_lat, 400)

        _, status_var = handle_analyze_request(
            {"latitude": -45.86, "longitude": -67.5, "variable": "INVALID_VAR"}
        )
        self.assertEqual(status_var, 400)

        _, status_years = handle_analyze_request(
            {
                "latitude": -45.86,
                "longitude": -67.5,
                "variable": "T2M",
                "start_year": 2024,
                "end_year": 2020,
            }
        )
        self.assertEqual(status_years, 400)

    def test_catalog_and_missions_resources(self):
        """Verifica el catálogo de 6 variables del MVP y las 3 misiones guiadas."""
        variables = get_variables_catalog()
        codes = [v["code"] for v in variables]
        for expected in ("T2M", "PRECTOTCORR", "RH2M", "WS2M", "T2M_MAX", "T2M_MIN"):
            self.assertIn(expected, codes)

        missions = get_missions_list()
        self.assertEqual(len(missions), 3)
        m1 = get_mission_by_id("patagonia-cambiante")
        self.assertIsNotNone(m1)
        self.assertEqual(m1["primary_variable"], "T2M")

    @unittest.skipUnless(HAS_FLASK, "Flask no instalado en el entorno local fuera de Docker")
    def test_flask_analyze_route_returns_json_contract(self):
        app = create_app()
        app.config.update(TESTING=True)

        with app.test_client() as client:
            response = client.post(
                "/api/analyze",
                json={
                    "latitude": -45.86,
                    "longitude": -67.50,
                    "variable": "T2M",
                    "start_year": 2000,
                    "end_year": 2024,
                },
            )

        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertEqual(body["data_mode"], "sample")
        self.assertIn("statistics", body)

    @patch(
        "routes.api_routes.fetch_nasa_power_series",
        return_value=(
            [{"year": 2020, "value": 10.0}, {"year": 2021, "value": 10.2}, {"year": 2022, "value": 10.4}],
            "NASA POWER / MERRA-2",
            False,
            "live",
        ),
    )
    def test_live_nasa_mode_is_exposed_without_network(self, mocked_fetch):
        response, status = handle_analyze_request(
            {
                "latitude": -45.86,
                "longitude": -67.50,
                "variable": "T2M",
                "start_year": 2020,
                "end_year": 2022,
            }
        )

        self.assertEqual(status, 200)
        self.assertFalse(response["is_mock"])
        self.assertEqual(response["data_mode"], "live")
        mocked_fetch.assert_called_once()

    @unittest.skipUnless(HAS_FLASK, "Flask no instalado en el entorno local fuera de Docker")
    def test_flask_summary_reports_data_provenance(self):
        app = create_app()
        app.config.update(TESTING=True)

        with app.test_client() as client:
            response = client.get(
                "/api/summary?lat=-45.86&lon=-67.50&start_year=2000&end_year=2024"
            )

        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertTrue(body["is_mock"])
        self.assertEqual(body["data_mode"], "sample")


if __name__ == "__main__":
    unittest.main()
