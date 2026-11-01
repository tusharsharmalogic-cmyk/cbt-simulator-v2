"""GET /api/tests, GET /api/tests/<id>"""
from flask import Blueprint, jsonify

from core import test_loader

bp = Blueprint("tests", __name__, url_prefix="/api/tests")


@bp.get("")
def list_tests():
    return jsonify(test_loader.list_tests())


@bp.get("/<test_id>")
def get_test(test_id):
    try:
        t = test_loader.load_test(test_id)
    except ValueError as e:  # json.JSONDecodeError ValueError ka subclass hai
        return jsonify(error=f"Test ka JSON kharab hai: {e}"), 422
    if t is None:
        return jsonify(error="Test nahi mila"), 404
    return jsonify(t)
