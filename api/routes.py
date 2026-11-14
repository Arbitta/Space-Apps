"""Rutas del Blueprint; delegan catálogo, validación y datos a los servicios."""

from flask import Blueprint, current_app, request
from werkzeug.exceptions import UnsupportedMediaType

from api.responses import success
from services.api_service import ServiceError


api = Blueprint("api", __name__, url_prefix="/api")


def service():
    return current_app.extensions["earthlens_service"]


def query_parameters(allowed=()):
    if set(request.args) - set(allowed):
        raise ServiceError("invalid_request", "La solicitud contiene filtros no admitidos.")
    result = {}
    for name in request.args:
        values = request.args.getlist(name)
        if len(values) != 1 or not values[0].strip():
            raise ServiceError("invalid_request", "Cada filtro debe contener un único texto no vacío.", details={"field": name})
        result[name] = values[0]
    return result


@api.get("/health")
def health():
    query_parameters()
    return success({"service": "EarthLens", "status": "up", "country_code": "AR"})


@api.get("/variables")
def variables():
    query_parameters()
    data = service().list_variables()
    return success(data, meta={"count": len(data)})


@api.get("/cities")
def cities():
    filters = query_parameters(("province", "region"))
    data = service().list_cities(**filters)
    return success(data, meta={"count": len(data), "filters": filters})


@api.get("/cities/<city_id>")
def city(city_id):
    query_parameters()
    return success(service().get_city(city_id))


@api.get("/regions")
def regions():
    query_parameters()
    data = service().list_regions()
    return success(data, meta={"count": len(data)})


@api.post("/data")
def data():
    query_parameters()
    if not request.is_json:
        raise UnsupportedMediaType()
    result, meta = service().get_data(request.get_json())
    return success(result, meta=meta)
