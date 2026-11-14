"""Endpoints de catálogo y misiones (Persona 5).

Se registra en app.py:

    from routes.missions_routes import missions_bp
    app.register_blueprint(missions_bp)

Endpoints (GET /api/variables lo sirve app.py; acá no se redefine):
    GET /api/phenomena                      fenómenos para el recomendador
    GET /api/variables/recommend?phenomenon=sequia
    GET /api/sources                        catálogo de fuentes de datos
    GET /api/missions                       listado de casos guiados
    GET /api/missions/<id>                  detalle del caso
"""

from flask import Blueprint, jsonify, request

from services import datasets

missions_bp = Blueprint("missions", __name__, url_prefix="/api")


@missions_bp.get("/phenomena")
def phenomena():
    return jsonify({"phenomena": datasets.list_phenomena()})


@missions_bp.get("/sources")
def sources():
    return jsonify({"sources": datasets.list_sources()})


@missions_bp.get("/variables/recommend")
def recommend():
    phenomenon = request.args.get("phenomenon", "")
    if not phenomenon:
        return jsonify({"error": "Falta el parámetro 'phenomenon'.",
                        "phenomena": datasets.list_phenomena()}), 400
    return jsonify({"phenomenon": phenomenon,
                    "variables": datasets.recommend_variables(phenomenon)})


@missions_bp.get("/missions")
def missions():
    return jsonify({"missions": datasets.list_missions(),
                    "hypotheses": datasets.list_hypotheses()})


@missions_bp.get("/missions/<mission_id>")
def mission_detail(mission_id):
    mission = datasets.get_mission(mission_id)
    if mission is None:
        return jsonify({"error": f"No existe la misión '{mission_id}'."}), 404
    return jsonify(mission)
