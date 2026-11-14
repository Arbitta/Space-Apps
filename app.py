"""Application Factory de la API de EarthLens."""

from flask import Flask

from api.errors import register_error_handlers
from api.routes import api
from services.api_service import EarthLensService
from services.bulk import PowerBulkService
from services.cache import DEFAULT_CACHE_DIR, JsonCache
from services.cities import CATALOG_PATH


def create_app(config=None):
    app = Flask(__name__, static_folder=None)
    app.config.from_mapping(
        MAX_CONTENT_LENGTH=16384,
        CACHE_DIR=DEFAULT_CACHE_DIR,
        CATALOG_PATH=CATALOG_PATH,
        POWER_REQUEST_DELAY=1.0,
        POWER_CACHE_MAX_AGE_DAYS=None,
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
    app.register_blueprint(api)
    register_error_handlers(app)
    return app


if __name__ == "__main__":
    create_app().run(host="127.0.0.1", port=5000, debug=False)
