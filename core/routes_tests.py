"""GET /api/tests, GET /api/tests/<id>, GET /api/tests/<id>/validate?template=<tid>"""
from flask import Blueprint, jsonify, request

from core import template_store, test_loader

bp = Blueprint("tests", __name__, url_prefix="/api/tests")


@bp.get("")
def list_tests():
    return jsonify(test_loader.list_tests())


@bp.get("/<test_id>")
def get_test(test_id):
    t, err = test_loader.load_test_safe(test_id)
    if err:
        code = 404 if err == "Test nahi mila" or err == "Invalid test id" else 422
        return jsonify(error=err), code
    return jsonify(t)


@bp.get("/<test_id>/validate")
def validate(test_id):
    test, err = test_loader.load_test_safe(test_id)
    if err:
        code = 404 if err in ("Test nahi mila", "Invalid test id") else 422
        return jsonify(errors=[err], warnings=[]), code

    template = None
    tid = request.args.get("template")
    if tid:
        template = template_store.get_template(tid)
        if template is None:
            return jsonify(errors=[f"Template '{tid}' nahi mila"], warnings=[]), 404

    result = test_loader.validate_test(test, template)
    return jsonify(result)