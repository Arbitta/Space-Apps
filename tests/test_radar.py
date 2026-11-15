import unittest
from unittest.mock import patch

from app import create_app
from services.radar import analyze_radar, load_cities


class TestRadar(unittest.TestCase):
    def test_catalog_has_25_cities(self):
        self.assertEqual(len(load_cities()), 25)

    def test_radar_returns_ranked_signals(self):
        result = analyze_radar(variable="T2M", start_year=2000, end_year=2024, limit=5)

        self.assertEqual(result["cities_analyzed"], 5)
        self.assertEqual(len(result["signals"]), 5)
        self.assertIn("statistics", result["signals"][0])
        self.assertIn("results_url", result["signals"][0])

    def test_radar_http_endpoint(self):
        app = create_app()
        app.config.update(TESTING=True)

        with app.test_client() as client:
            response = client.get("/api/radar?variable=T2M&start_year=2000&end_year=2024&limit=3")
            page = client.get("/radar")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.get_json()["signals"]), 3)

        self.assertEqual(page.status_code, 200)
        self.assertIn(b"EARTH RADAR", page.data)

    @patch("services.radar.fetch_nasa_power_series")
    def test_radar_propagates_live_mode(self, fetch_series):
        fetch_series.return_value = (
            [{"year": 2000, "value": 10.0}, {"year": 2001, "value": 10.2}, {"year": 2002, "value": 10.4}],
            "NASA POWER / MERRA-2",
            False,
            "live",
        )

        result = analyze_radar(start_year=2000, end_year=2002, limit=1, live=True)

        self.assertFalse(result["is_mock"])
        self.assertEqual(result["data_mode"], "live")
        self.assertEqual(fetch_series.call_count, len(load_cities()))
        self.assertTrue(all(call.kwargs["live"] for call in fetch_series.call_args_list))


if __name__ == "__main__":
    unittest.main()
