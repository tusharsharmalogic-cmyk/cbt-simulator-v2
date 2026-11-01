"""GET/PUT/DELETE /api/templates — exam templates CRUD."""
from flask import Blueprint, jsonify, request

from core import template_store

bp = Blueprint("templates", __name__, url_prefix="/api/templates")


@bp.get("")
def list_templates():
    return jsonify(template_store.list_templates())


@bp.get("/<tid>")
def get_template(tid):
    t = template_store.get_template(tid)
    if t is None:
        return jsonify(error="Template nahi mila"), 404
    return jsonify(t)


@bp.put("/<tid>")
def put_template(tid):
    body = request.get_json(silent=True)
    if body is None:
        return jsonify(error="JSON body expected"), 400
    saved_id, result = template_store.save_template(tid, body)
    if saved_id is None:
        return jsonify(errors=result), 422
    saved = template_store.get_template(saved_id) or {}
    saved["id"] = saved_id
    return jsonify(saved)


@bp.delete("/<tid>")
def delete_template(tid):
    if template_store.delete_template(tid):
        return jsonify(ok=True)
    return jsonify(error="Template nahi mila"), 404