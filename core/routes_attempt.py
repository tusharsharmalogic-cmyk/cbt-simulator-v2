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
    test_ids = body.get("test_ids")
    if not test_ids and body.get("test_id"):
        test_ids = [body.get("test_id")]
    if (not isinstance(test_ids, list) or not test_ids
            or not all(isinstance(t, str) for t in test_ids)):
        test_ids = None
    if not template_id or not test_ids:
        return jsonify(error="template_id aur kam se kam ek test chahiye"), 422
    test_ids = list(dict.fromkeys(test_ids))  # duplicates hatao, order rakho

    template = template_store.get_template(template_id)
    if template is None:
        return jsonify(error="Template nahi mila"), 404

    # Saare chune hue tests load karo; subject-wise questions merge honge.
    tests = []
    for tid in test_ids:
        t, t_err = test_loader.load_test_safe(tid)
        if t_err:
            return jsonify(error=f"{tid}: {t_err}"), 422
        tests.append(t)
    if len(tests) == 1:
        test = tests[0]
    else:
        merged = {}
        for t in tests:
            for subj, qs in (t.get("subjects") or {}).items():
                if isinstance(qs, list):
                    merged.setdefault(subj, []).extend(qs)
                else:
                    merged.setdefault(subj, qs)  # validate_test error dega
        test = {"name": " + ".join(str(t.get("name", tid)) for t, tid in zip(tests, test_ids)),
                "subjects": merged}
    test_id = test_ids[0]

    # strict_counts=False: fewer-than-needed allowed; 0-Q subjects skip ho jayenge.
    # Sirf real errors (bad JSON, missing answer, etc.) block karte hain.
    v = test_loader.validate_test(test, template, strict_counts=False)
    if v["errors"]:
        return jsonify(errors=v["errors"], warnings=v["warnings"]), 422

    # Pehle check — koi valid question nahi to attempt save hi mat karo
    has_any = any(
        len(((test.get("subjects") or {}).get(s.get("name") or "")) or []) > 0
        for s in template.get("subjects") or []
    )
    if not has_any:
        return jsonify(error="Koi bhi subject me valid question nahi mila"), 422

    a = attempt_store.create_attempt(template, test, test_id, test_ids)
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
    now = time.time()
    lock = attempt_store._is_current_subject_allowed(a, subject, now)
    if lock:
        return _locked_response(a, lock, now)
    if timer.subject_is_locked(a, subject, now):
        return _locked_response(a, "subject_locked", now)
    try:
        attempt_store.apply_mark(a, subject, index, marked)
    except ValueError as e:
        if str(e) == "question_locked":
            return _locked_response(a, "question_locked", now)
        return jsonify(error=str(e)), 422
    return _save_and_view(a)


def _find_next_unlocked(a, now=None):
    """Current subject ki list + baaki subjects, order me pehla unlocked Q dhoondo.
    Returns {subject, index} or None."""
    if now is None:
        now = time.time()
    if timer.all_questions_locked(a, now):
        return None
    qs = a.get("questions") or {}
    cur_subj = a.get("current", {}).get("subject")
    cur_idx = a.get("current", {}).get("index", 0)
    subs = list(qs.keys())
    # cur subject ke baad se start karo, phir wrap
    start_i = subs.index(cur_subj) if cur_subj in subs else 0
    for off in range(len(subs)):
        subj = subs[(start_i + off) % len(subs)]
        if timer.subject_is_locked(a, subj, now):
            continue
        lst = qs[subj]
        begin = cur_idx + 1 if subj == cur_subj else 0
        for i in list(range(begin, len(lst))) + list(range(0, begin)):
            if not timer.question_is_locked(a, subj, i, now):
                return {"subject": subj, "index": i}
    return None

def _locked_response(a, reason, now=None):
    """Build a 409 with the next unlocked target. Server-side current is also
    advanced to that target (and its timers started + persisted) so the client
    view doesn't bounce back to the old locked question."""
    if now is None:
        now = time.time()
    nxt = _find_next_unlocked(a, now)
    if nxt:
        a["current"] = nxt
        attempt_store._ensure_subject_started(a, nxt["subject"], now)
        attempt_store._ensure_question_started(a, nxt["subject"], nxt["index"], now)
        with attempt_store._LOCK:
            attempt_store.save(a)
    return jsonify(error=reason, next=nxt,
                   view=attempt_store.client_view(a, strip_answers=True)), 409

@bp.post("/<aid>/visit")
def visit(aid):
    a, err = _get_or_404(aid)
    if err:
        return err
    if a.get("status") == "submitted":
        return jsonify(error="already_submitted"), 409
    body = request.get_json(silent=True) or {}
    subject = body.get("subject")
    index = body.get("index")
    spent = body.get("spent", 0)
    if not isinstance(subject, str) or not isinstance(index, int):
        return jsonify(error="subject/index required"), 422
    # Client time kisi question par kharch hua tha; apne aap se usi ko credit karo.
    # `from_*` pichhla question batata hai, `subject/index` naya question.
    from_subject = body.get("from_subject")
    from_index = body.get("from_index")
    has_from = attempt_store.valid_slot(a, from_subject, from_index)
    if has_from:
        attempt_store.add_time_spent(a, from_subject, from_index, spent)

    a, gone = _finalize_if_over(a)
    if gone:
        # Time-up / all-locked par bhi aakhri chunk save ho.
        if has_from:
            with attempt_store._LOCK:
                attempt_store.save(a)
        return jsonify(error=gone), 409

    now = time.time()
    lock = attempt_store._is_current_subject_allowed(a, subject, now)
    if lock:
        return _locked_response(a, lock, now)
    if timer.subject_is_locked(a, subject, now):
        return _locked_response(a, "subject_locked", now)
    if timer.question_is_locked(a, subject, index, now):
        # Locked question chhodte waqt bhi uska time already credit ho chuka hai.
        return _locked_response(a, "question_locked", now)
    try:
        attempt_store.apply_visit(a, subject, index, 0 if has_from else spent)
    except ValueError as e:
        return jsonify(error=str(e)), 422
    return _save_and_view(a)


@bp.post("/<aid>/retry")
def retry(aid):
    """Submitted attempt ke snapshot se naya attempt (full ya wrong+blank)."""
    a, err = _get_or_404(aid)
    if err:
        return err
    if a.get("status") != "submitted":
        return jsonify(error="Attempt abhi submit nahi hua"), 409
    if not a.get("result"):
        return jsonify(error="Result missing"), 422
    body = request.get_json(silent=True) or {}
    mode = body.get("mode") or "full"
    if mode not in ("full", "wrong"):
        return jsonify(error="mode 'full' ya 'wrong' hona chahiye"), 422
    n = attempt_store.create_retry(a, mode)
    if n is None:
        return jsonify(error="Retry ke liye koi question nahi mila"), 422
    return jsonify(attempt_store.client_view(n, strip_answers=True))


@bp.post("/<aid>/submit")
def submit(aid):
    a, err = _get_or_404(aid)
    if err:
        return err
    if a.get("status") == "submitted":
        return jsonify(error="already_submitted",
                       attempt=attempt_store.client_view(a, strip_answers=False)), 409
    body = request.get_json(silent=True) or {}
    subject = body.get("subject")
    index = body.get("index")
    if attempt_store.valid_slot(a, subject, index):
        attempt_store.add_time_spent(a, subject, index, body.get("spent", 0))
    reason = "time_up" if timer.is_over(a) else "user"
    attempt_store.finalize(a, reason)
    with attempt_store._LOCK:
        attempt_store.save(a)
    return jsonify(attempt_store.client_view(a, strip_answers=False))