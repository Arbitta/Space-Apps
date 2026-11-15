"""Mapeo HTTP con mensajes públicos controlados, sin excepciones internas."""

from flask import jsonify
from werkzeug.exceptions import HTTPException

from api.responses import error_payload
from services.api_service import ServiceError


SERVICE_STATUS = {
    'authentication_required':401,
    'csrf_invalid':403,
    'event_not_found':404,
    'account_conflict':409,
    'rate_limited':429,
    "water_feature_not_found": 404,
    "provider_auth_required": 503,
    "provider_not_verified": 503,
    "invalid_request": 400,
    "coordinates_not_supported": 400,
    "city_not_found": 404,
    "provider_timeout": 504,
    "provider_unavailable": 503,
    "provider_error": 502,
    "provider_invalid_response": 502,
    "internal_error": 500,
    "analysis_unavailable": 503,
    "insufficient_data": 422,
    "incompatible_analysis": 422,
    "cache_unavailable": 503,
    "radar_unavailable": 503,
    "radar_invalid_artifact": 503,
}
HTTP_ERRORS = {
    400: ("invalid_request", "La solicitud JSON es inválida."),
    404: ("not_found", "El recurso solicitado no existe."),
    405: ("method_not_allowed", "El método HTTP no está permitido para este recurso."),
    413: ("request_too_large", "El cuerpo de la solicitud supera el límite permitido."),
    415: ("unsupported_media_type", "Usar Content-Type: application/json."),
    500: ("internal_error", "No se pudo procesar la solicitud."),
}


def register_error_handlers(app):
    @app.errorhandler(ServiceError)
    def handle_service_error(error):
        return jsonify(error_payload(error.code, error.message, details=error.details, meta=error.meta)), SERVICE_STATUS[error.code]

    @app.errorhandler(HTTPException)
    def handle_http_error(error):
        code, message = HTTP_ERRORS.get(error.code, ("http_error", "No se pudo procesar la solicitud HTTP."))
        response = error.get_response()
        response.data = app.json.dumps(error_payload(code, message))
        response.content_type = "application/json"
        return response  # Conserva encabezados de protocolo como Allow en 405.

    @app.errorhandler(Exception)
    def handle_unexpected_error(error):
        app.logger.error("Error interno en EarthLens (%s).", type(error).__name__)
        return jsonify(error_payload("internal_error", "No se pudo procesar la solicitud.")), 500
