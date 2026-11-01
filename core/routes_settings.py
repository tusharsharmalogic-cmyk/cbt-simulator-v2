"""GET/PUT /api/settings — filhaal sirf theme."""
from flask import Blueprint, jsonify, request

import config
from core.storage import read_json, write_json_atomic

bp = Blueprint("settings", __name__, url_prefix="/api/settings")

_ALLOWED_THEMES = ("system", "light", "dark")
_DEFAULT = {"theme": "system"}


def _load():
    if not config.SETTINGS_FILE.exists():
        return dict(_DEFAULT)
    try:
        d = read_json(config.SETTINGS_FILE)
        if not isinstance(d, dict):
            return dict(_DEFAULT)
        if d.get("theme") not in _ALLOWED_THEMES:
            d["theme"] = "system"
        return d
    except Exception:
        return dict(_DEFAULT)


@bp.get("")
def get_settings():
    return jsonify(_load())


@bp.put("")
def put_settings():
    body = request.get_json(silent=True) or {}
    theme = body.get("theme")
    if theme not in _ALLOWED_THEMES:
        return jsonify(error="theme 'system', 'light' ya 'dark' hona chahiye"), 422
    data = _load()
    data["theme"] = theme
    write_json_atomic(config.SETTINGS_FILE, data)
    return jsonify(data)