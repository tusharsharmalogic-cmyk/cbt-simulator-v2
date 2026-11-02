"""Attempt API.

Every mutation returns fresh timing. 409 for submitted / time_up / subject_locked.
"""
import time

from flask import Blueprint, jsonify, request

from core import attempt_store, template_store, test_loader, timer

bp = Blueprint("attempts", __name__, url_prefix="/api/attempts")


def _get_or_404(aid):
    a = attempt_store.load(aid)
    if a is None:
        return None, (jsonify(error="Attempt nahi mila"), 404)
    return a, None


def _finalize_if_over(a):
    """Returns (a, err_msg | None). Auto-finalize pe err_msg 'time_up' + saved."""
    a, was_finalized = attempt_store.ensure_finalized(a)
    if a.get("status") == "submitted":
        return a, "already_submitted" if not was_finalized else "time_up"
    return a, None


def _save_and_view(a, strip=True):
    with attempt_store._LOCK:
        attempt_store.save(a)
    return jsonify(attempt_store.client_view(a, strip_answers=strip))


# ---------- list / get / delete ----------

@bp.get("")
def list_attempts():
    return jsonify(attempt_store.list_attempts())


@bp.get("/<aid>")
def get_attempt(aid):
    a, err = _get_or_404(aid)
    if err:
        return err
    a, _ = attempt_store.ensure_finalized(a)
    strip = a.get("status") == "in_progress"
    return jsonify(attempt_store.client_view(a, strip_answers=strip))


@bp.delete("/<aid>")
def delete_attempt(aid):
    if attempt_store.delete(aid):
        return jsonify(ok=True)
    return jsonify(error="Attempt nahi mila"), 404


# ---------- create ----------

@bp.post("")
def create():
    body = request.get_json(silent=True) or {}
    template_id = body.get("template_id")
    test_id = body.get("test_id")
    if not template_id or not test_id:
        return jsonify(error="template_id aur test_id dono chahiye"), 422

    template = template_store.get_template(template_id)
    if template is None:
        return jsonify(error="Template nahi mila"), 404

    test, t_err = test_loader.load_test_safe(test_id)
    if t_err:
        return jsonify(error=t_err), 422

    v = test_loader.validate_test(test, template)
    if v["errors"]:
        return jsonify(errors=v["errors"], warnings=v["warnings"]), 422

    a = attempt_store.create_attempt(template, test, test_id)
    return jsonify(attempt_store.client_view(a, strip_answers=True))


# ---------- mutations ----------

def _prepare_mutation(aid):
    """Returns (a, error_response | None)."""
    a, err = _get_or_404(aid)
    if err:
        return None, err
    a, g = _finalize_if_over(a)
    if g:
        return None, (jsonify(error=g), 409)
    return a, None


@bp.post("/<aid>/answer")
def answer(aid):
    a, err = _prepare_mutation(aid)
    if err:
        return err
    body = request.get_json(silent=True) or {}
    subject = body.get("subject")
    index = body.get("index")
    choice = body.get("choice")
    if not isinstance(subject, str) or not isinstance(index, int):
        return jsonify(error="subject/index required"), 422
    lock = attempt_store._is_current_subject_allowed(a, subject, time.time())
    if lock:
        return jsonify(error=lock), 409
    try:
        attempt_store.apply_answer(a, subject, index, choice)
    except ValueError as e:
        return jsonify(error=str(e)), 422
    return _save_and_view(a)


@bp.post("/<aid>/mark")
def mark(aid):
    a, err = _prepare_mutation(aid)
    if err:
        return err
    body = request.get_json(silent=True) or {}
    subject = body.get("subject")
    index = body.get("index")
    marked = body.get("marked")
    if not isinstance(subject, str) or not isinstance(index, int) or not isinstance(marked, bool):
        return jsonify(error="subject/index/marked required"), 422
    lock = attempt_store._is_current_subject_allowed(a, subject, time.time())
    if lock:
        return jsonify(error=lock), 409
    try:
        attempt_store.apply_mark(a, subject, index, marked)
    except ValueError as e:
        return jsonify(error=str(e)), 422
    return _save_and_view(a)


@bp.post("/<aid>/visit")
def visit(aid):
    a, err = _prepare_mutation(aid)
    if err:
        return err
    body = request.get_json(silent=True) or {}
    subject = body.get("subject")
    index = body.get("index")
    spent = body.get("spent", 0)
    if not isinstance(subject, str) or not isinstance(index, int):
        return jsonify(error="subject/index required"), 422
    lock = attempt_store._is_current_subject_allowed(a, subject, time.time())
    if lock:
        return jsonify(error=lock), 409
    try:
        attempt_store.apply_visit(a, subject, index, spent)
    except ValueError as e:
        return jsonify(error=str(e)), 422
    return _save_and_view(a)


@bp.post("/<aid>/submit")
def submit(aid):
    a, err = _get_or_404(aid)
    if err:
        return err
    if a.get("status") == "submitted":
        return jsonify(error="already_submitted",
                       attempt=attempt_store.client_view(a, strip_answers=False)), 409
    reason = "time_up" if timer.is_over(a) else "user"
    attempt_store.finalize(a, reason)
    with attempt_store._LOCK:
        attempt_store.save(a)
    return jsonify(attempt_store.client_view(a, strip_answers=False))