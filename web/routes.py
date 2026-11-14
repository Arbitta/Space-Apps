"""Páginas existentes del equipo, servidas por la misma aplicación Flask."""

from flask import Blueprint, render_template

web = Blueprint("web", __name__)


@web.get("/")
@web.get("/index.html")
def index():
    return render_template("index.html")


@web.get("/explorer")
@web.get("/explorer.html")
def explorer():
    return render_template("explorer.html")


@web.get("/results")
@web.get("/results.html")
def results():
    return render_template("results.html")


@web.get("/compare")
@web.get("/compare.html")
def compare():
    return render_template("compare.html")


@web.get("/missions")
def missions():
    return render_template("missions.html")


@web.get("/about")
def about():
    return render_template("about.html")
