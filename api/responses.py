"""Sobres JSON compartidos por los endpoints presentes y futuros."""

from flask import jsonify


API_VERSION = "1"


def success(data, *, meta=None):
    return jsonify(status="ok", data=data, meta={"api_version": API_VERSION, **(meta or {})})


def error_payload(code, message, *, details=None, meta=None):
    return {
        "status": "error",
        "error": {"code": code, "message": message, "details": details or {}},
        "meta": {"api_version": API_VERSION, **(meta or {})},
    }
