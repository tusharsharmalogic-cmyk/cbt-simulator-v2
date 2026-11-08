"""GET /api/schedule, PUT /api/schedule/<test_id>, DELETE /api/schedule/<test_id>.

Test ko ek date (YYYY-MM-DD, time nahi) + template ke saath schedule karta hai.
Data alag file me: data/schedule.json -> {test_id: {"date": "...", "template_id": "..."}}
"""
import re

from flask import Blueprint, jsonify, request

import config
from core import template_store, test_loader
from core.storage import read_json, write_json_atomic

bp = Blueprint("schedule", __name__, url_prefix="/api/schedule")

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

def _file():
    return config.DATA_DIR / "schedule.json"

def load_schedule():
    try:
        d = read_json(_file())
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}

def save_schedule(d):
    write_json_atomic(_file(), d)

def remove_entry(test_id):
    """Dusre routes (delete/merge) se bhi call ho sakta hai."""
    d = load_schedule()
    if test_id in d:
        del d[test_id]
        save_schedule(d)

@bp.get("")
def list_schedule():
    d = load_schedule()
    tests = {t["id"]: t for t in test_loader.list_tests() if not t.get("error")}
    templates = {t["id"]: t for t in template_store.list_templates() if not t.get("error")}
    out, changed = [], False
    for tid in list(d.keys()):
        if tid not in tests:          # test delete/merge ho chuka -> entry hata do
            del d[tid]
            changed = True
            continue
        e = d[tid] if isinstance(d[tid], dict) else {}
        tpl = templates.get(e.get("template_id"))
        out.append({
            "test_id": tid,
            "test_name": tests[tid].get("name", tid),
            "date": e.get("date"),
            "template_id": e.get("template_id"),
            "template_name": tpl.get("name") if tpl else None,
        })
    if changed:
        save_schedule(d)
    out.sort(key=lambda x: x.get("date") or "")
    return jsonify(items=out)

@bp.put("/<test_id>")
def set_schedule(test_id):
    p = test_loader._path_for(test_id)
    if p is None or not p.is_file():
        return jsonify(error="Test nahi mila"), 404
    body = request.get_json(silent=True) or {}
    date = body.get("date")
    tpl = body.get("template_id")
    if not isinstance(date, str) or not _DATE_RE.match(date):
        return jsonify(error="Date (YYYY-MM-DD) chahiye"), 422
    from core import routes_testtpl
    if tpl is None or tpl == "":
        # Test pe template pehle se saved ho to wahi use hoga (dobara nahi puchte)
        tpl = routes_testtpl.get_template_id(test_id)
        if tpl is None:
            return jsonify(error="Is test ke liye template chuno"), 422
    elif not isinstance(tpl, str) or template_store.get_template(tpl) is None:
        return jsonify(error="Valid template chuno"), 422
    else:
        # Schedule me naya template chuna to test pe bhi save, taaki dobara na puche
        routes_testtpl.set_template_id(test_id, tpl)
    d = load_schedule()
    d[test_id] = {"date": date, "template_id": tpl}
    save_schedule(d)
    return jsonify(ok=True)

@bp.delete("/<test_id>")
def clear_schedule(test_id):
    remove_entry(test_id)
    return jsonify(ok=True)