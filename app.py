"""Application Factory de EarthLens: interfaz y API en el mismo origen."""

from flask import Flask
from pathlib import Path

from api.errors import register_error_handlers
from api.routes import api
from services.api_service import EarthLensService
from services.bulk import PowerBulkService
from services.cache import DEFAULT_CACHE_DIR, JsonCache
from services.cities import CATALOG_PATH
from services.analysis_service import AnalysisService
from web.routes import web
from services.fingerprint import FingerprintService
from services.radar import DEFAULT_ARTIFACT_NAME, RadarService
from services.scientific import ScientificService
from services.hydrology import HydrologyService
from api.scientific import scientific_api
from services.time_machine_service import TimeMachineService
from services.forecast_service import ForecastService


def create_app(config=None):
    app = Flask(__name__)
    app.config.from_mapping(
        MAX_CONTENT_LENGTH=16384,
        CACHE_DIR=DEFAULT_CACHE_DIR,
        CATALOG_PATH=CATALOG_PATH,
        POWER_REQUEST_DELAY=1.0,
        POWER_CACHE_MAX_AGE_DAYS=None,
        RADAR_ARTIFACT_PATH=None,
    )
    app.config.from_prefixed_env(prefix="EARTHLENS")
    if config is not None:
        app.config.update(config)
    app.json.ensure_ascii = False
    app.json.sort_keys = False

    bulk = PowerBulkService(
        JsonCache(app.config["CACHE_DIR"]),
        catalog_path=app.config["CATALOG_PATH"],
        request_delay=app.config["POWER_REQUEST_DELAY"],
        max_age_days=app.config["POWER_CACHE_MAX_AGE_DAYS"],
    )
    app.extensions["earthlens_service"] = EarthLensService(bulk)
    app.extensions["earthlens_science"] = ScientificService(app.extensions["earthlens_service"])
    app.extensions["earthlens_hydrology"] = HydrologyService(Path(app.config["CACHE_DIR"]).parent / "science")
    app.extensions["earthlens_analysis"] = AnalysisService(app.extensions["earthlens_service"])
    app.extensions["earthlens_time_machine"] = TimeMachineService(app.extensions["earthlens_analysis"],app.extensions["earthlens_science"])
    app.extensions["earthlens_forecast"] = ForecastService(app.extensions["earthlens_time_machine"])
    app.extensions["earthlens_fingerprint"] = FingerprintService(app.extensions["earthlens_analysis"])
    radar_path = app.config["RADAR_ARTIFACT_PATH"] or Path(app.config["CACHE_DIR"]).parent / DEFAULT_ARTIFACT_NAME
    app.extensions["earthlens_radar"] = RadarService(app.extensions["earthlens_analysis"], radar_path)
    app.register_blueprint(api)
    app.register_blueprint(scientific_api)
    app.register_blueprint(web)
    register_error_handlers(app)
    return app


# Entrada WSGI para la configuración Vercel recibida de main; sin consultas al importar.
app = create_app()

if __name__ == "__main__":
    create_app().run(host="127.0.0.1", port=5000, debug=False)
