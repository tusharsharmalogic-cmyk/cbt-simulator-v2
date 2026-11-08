"""GET /api/test-template, PUT /api/test-template/<test_id>, DELETE /api/test-template/<test_id>.

Har test ke saath ek template save karta hai (Available Tests me "Template" button).
Data alag file me: data/test_templates.json -> {test_id: template_id}
Schedule se alag hai, kyunki test start hone par schedule entry hat jaati hai
par test ka chuna hua template rehna chahiye.
"""
from flask import Blueprint, jsonify, request

import config
from core import template_store, test_loader
from core.storage import read_json, write_json_atomic

bp = Blueprint("test_template", __name__, url_prefix="/api/test-template")


def _file():
    return config.DATA_DIR / "test_templates.json"


def load_map():
    try:
        d = read_json(_file())
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def save_map(d):
    write_json_atomic(_file(), d)


def get_template_id(test_id):
    """Test ka saved template id (ya None). Template delete ho chuka ho to None."""
    tid = load_map().get(test_id)
    if isinstance(tid, str) and template_store.get_template(tid) is not None:
        return tid
    return None


def set_template_id(test_id, template_id):
    d = load_map()
    d[test_id] = template_id
    save_map(d)


def remove_entry(test_id):
    """Test delete/merge hone par dusre routes se bhi call hota hai."""
    d = load_map()
    if test_id in d:
        del d[test_id]
        save_map(d)


def remove_template(template_id):
    """Template delete hone par us template wali saari entries hatao."""
    d = load_map()
    keep = {k: v for k, v in d.items() if v != template_id}
    if len(keep) != len(d):
        save_map(keep)


@bp.get("")
def list_map():
    d = load_map()
    tests = {t["id"] for t in test_loader.list_tests() if not t.get("error")}
    templates = {t["id"] for t in template_store.list_templates()}
    out = {k: v for k, v in d.items()
           if k in tests and isinstance(v, str) and v in templates}
    if len(out) != len(d):          # delete ho chuke test/template ki entries saaf
        save_map(out)
    return jsonify(items=out)


@bp.put("/<test_id>")
def set_one(test_id):
    p = test_loader._path_for(test_id)
    if p is None or not p.is_file():
        return jsonify(error="Test nahi mila"), 404
    body = request.get_json(silent=True) or {}
    tpl = body.get("template_id")
    if not isinstance(tpl, str) or template_store.get_template(tpl) is None:
        return jsonify(error="Valid template chuno"), 422
    set_template_id(test_id, tpl)
    # Is test ka schedule ho to wo bhi isi naye template pe aa jaye
    try:
        from core import routes_schedule
        sd = routes_schedule.load_schedule()
        e = sd.get(test_id)
        if isinstance(e, dict):
            e["template_id"] = tpl
            routes_schedule.save_schedule(sd)
    except Exception:
        pass
    return jsonify(ok=True, template_id=tpl)


@bp.delete("/<test_id>")
def clear_one(test_id):
    remove_entry(test_id)
    return jsonify(ok=True)
