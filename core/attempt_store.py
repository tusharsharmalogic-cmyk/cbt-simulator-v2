"""data/attempts/<id>.json atomic CRUD + client view (answers stripped while in progress).

id = uuid4().hex[:12]. Writes locked.
"""
import copy
import threading
import time
import uuid

import config
from core import scoring, timer
from core.storage import read_json, write_json_atomic

_LOCK = threading.RLock()


def _path(tid):
    # attempt ids are hex, no need for full regex but keep safe
    if not tid or not isinstance(tid, str):
        return None
    import re
    if not re.match(r"^[A-Za-z0-9_\-]+$", tid):
        return None
    return config.ATTEMPTS_DIR / f"{tid}.json"


def load(attempt_id):
    p = _path(attempt_id)
    if p is None or not p.is_file():
        return None
    return read_json(p)


def save(attempt):
    p = _path(attempt.get("id"))
    if p is None:
        raise ValueError("Invalid attempt id")
    write_json_atomic(p, attempt)


def delete(attempt_id):
    p = _path(attempt_id)
    if p is None or not p.is_file():
        return False
    p.unlink()
    return True


def list_attempts():
    out = []
    for p in sorted(config.ATTEMPTS_DIR.glob("*.json")):
        if p.name.startswith(".tmp_"):
            continue
        try:
            a = read_json(p)
        except Exception:
            continue
        res = a.get("result") or {}
        tot = (res.get("total") or {}) if res else {}
        out.append({
            "id": a.get("id"),
            "test_name": a.get("test_name"),
            "template_name": (a.get("template") or {}).get("name"),
            "status": a.get("status"),
            "created_at": a.get("created_at"),
            "submitted_at": a.get("submitted_at"),
            "score": tot.get("score"),
            "max": tot.get("max"),
        })
    out.sort(key=lambda x: x.get("created_at") or 0, reverse=True)
    return out


# ---------- create ----------

def create_attempt(template, test, test_id, test_ids=None):
    """template: full template dict (already validated).
    test: full test dict.
    test_id: source test id (for trace)."""
    tpl = copy.deepcopy(template)
    questions = {}
    responses = {}
    # 0-question subjects attempt me hi nahi jaate (test start fir bhi chalega)
    # subject-mode timer bhi sirf active subjects ke windows compute karega.
    active_subjects = []
    for s in tpl.get("subjects") or []:
        subj = s.get("name")
        need = int(s.get("questions") or 0)
        pool = (test.get("subjects") or {}).get(subj) or []
        chunk = pool[:need]
        if not chunk:
            continue  # skip empty subject
        questions[subj] = [copy.deepcopy(q) for q in chunk]
        responses[subj] = [
            {"choice": None, "marked": False, "visited": False, "time_spent": 0,
             "q_started_at": None}
            for _ in chunk
        ]
        active_subjects.append(dict(s))
    # template ki copy me sirf active subjects rakho (client view + timer isi pe chalega)
    tpl["subjects"] = active_subjects
    if tpl.get("timer_mode") == "subject":
        # subject-mode me total_minutes = active subjects ke minutes ka sum
        tpl["total_minutes"] = sum(float(s.get("minutes") or 0) for s in active_subjects)

    now = time.time()
    first = (tpl.get("subjects") or [{}])[0].get("name")
    # Start timers for the first subject + its first question right away
    subject_started_at = {}
    if first in responses:
        subject_started_at[first] = now
        if responses[first]:
            responses[first][0]["q_started_at"] = now
    attempt = {
        "id": uuid.uuid4().hex[:12],
        "status": "in_progress",
        "created_at": now,
        "start_time": now,
        "template": tpl,
        "test_id": test_id,
        "test_ids": list(test_ids) if test_ids else [test_id],
        "test_name": test.get("name", test_id),
        "questions": questions,
        "responses": responses,
        "subject_started_at": subject_started_at,
        "current": {"subject": first, "index": 0},
        "submitted_at": None,
        "submit_reason": None,
        "result": None,
    }
    with _LOCK:
        save(attempt)
    return attempt


# ---------- mutate ----------

def _subject_in_template(attempt, subject):
    for s in attempt.get("template", {}).get("subjects") or []:
        if s.get("name") == subject:
            return True
    return False


def _is_current_subject_allowed(attempt, subject, now):
    """Subject mode: only current window's subject allowed."""
    tmpl = attempt.get("template") or {}
    if tmpl.get("timer_mode") != "subject":
        return None  # ok in total mode
    t = timer.timing(attempt, now)
    if not t["subject"]:
        return "subject_locked"
    if t["subject"]["name"] != subject:
        return "subject_locked"
    return None


def _recycle_test(attempt):
    """Delete original test JSON(s). If any questions were unanswered,
    save them to a new <test_id>_unanswered.json for future use.
    Multi-test attempt me saare source tests delete hote hain aur ek hi
    merged unanswered test banta hai."""
    test_id = attempt.get("test_id")
    if not test_id:
        return
    ids = attempt.get("test_ids") or [test_id]
    paths = [config.TESTS_DIR / f"{tid}.json" for tid in ids]
    paths = [p for p in paths if p.exists()]
    if not paths:
        return

    unanswered = {}
    for subj, qs in (attempt.get("questions") or {}).items():
        resp = (attempt.get("responses") or {}).get(subj) or []
        for i, q in enumerate(qs):
            choice = resp[i].get("choice") if i < len(resp) else None
            if choice is None:
                unanswered.setdefault(subj, []).append(q)

    names = []
    for p in paths:
        try:
            names.append(read_json(p).get("name", p.stem))
        except Exception:
            names.append(p.stem)
    orig_name = " + ".join(names) if len(names) > 1 else names[0]

    # Delete originals
    for p in paths:
        try:
            p.unlink()
        except OSError:
            pass

    if unanswered:
        new_id_base = f"{test_id}_unanswered"
        new_id = new_id_base
        i = 2
        while (config.TESTS_DIR / f"{new_id}.json").exists():
            new_id = f"{new_id_base}_{i}"
            i += 1
        new_name = f"{orig_name} (Unanswered)"
        doc = {"name": new_name, "subjects": unanswered}
        write_json_atomic(config.TESTS_DIR / f"{new_id}.json", doc)


def finalize(attempt, reason, now=None):
    """Compute result and mark submitted. Idempotent."""
    if attempt.get("status") == "submitted":
        return attempt
    if now is None:
        now = time.time()
    attempt["status"] = "submitted"
    attempt["submitted_at"] = now
    attempt["submit_reason"] = reason
    attempt["result"] = scoring.compute(attempt)
    # NEW: recycle unanswered questions
    _recycle_test(attempt)
    return attempt


def ensure_finalized(attempt):
    """If time is over OR all questions locked, auto-submit.
    Returns (attempt, was_just_finalized)."""
    if attempt.get("status") == "submitted":
        return attempt, False
    if timer.is_over(attempt):
        finalize(attempt, "time_up")
        with _LOCK:
            save(attempt)
        return attempt, True
    if timer.all_questions_locked(attempt):
        finalize(attempt, "all_locked")
        with _LOCK:
            save(attempt)
        return attempt, True
    return attempt, False


# ---------- client view ----------

def client_view(attempt, strip_answers=True):
    """Strip answer/solution while in_progress. Always include timing + lock info."""
    a = copy.deepcopy(attempt)
    if strip_answers and a.get("status") == "in_progress":
        for subj, qs in (a.get("questions") or {}).items():
            for q in qs:
                q.pop("answer", None)
                q.pop("solution", None)
    a["timing"] = timer.timing(attempt)
    if a.get("status") == "in_progress":
        now = time.time()
        locks = {}
        for subj, qs in (a.get("questions") or {}).items():
            s_locked = timer.subject_is_locked(attempt, subj, now)
            s_rem = timer.subject_lock_remaining(attempt, subj, now)
            qlocks = []
            for i in range(len(qs)):
                qlocks.append({
                    "locked": timer.question_is_locked(attempt, subj, i, now),
                    "remaining": timer.question_lock_remaining(attempt, subj, i, now),
                })
            locks[subj] = {"subject_locked": s_locked,
                           "subject_remaining": s_rem, "questions": qlocks}
        a["locks"] = locks
    return a


# ---------- mutations ----------

def _ensure_subject_started(attempt, subject, now=None):
    """Record first-entry timestamp for subject-level lock tracking."""
    if now is None:
        now = time.time()
    ss = attempt.setdefault("subject_started_at", {})
    if subject not in ss:
        ss[subject] = now

def _ensure_question_started(attempt, subject, index, now=None):
    """Record first-entry timestamp for per-question lock tracking."""
    if now is None:
        now = time.time()
    rs = attempt["responses"].get(subject) or []
    if 0 <= index < len(rs) and rs[index].get("q_started_at") is None:
        rs[index]["q_started_at"] = now

def apply_answer(attempt, subject, index, choice):
    if not _subject_in_template(attempt, subject):
        raise ValueError("subject not found")
    rs = attempt["responses"].get(subject) or []
    if not (0 <= index < len(rs)):
        raise ValueError("index out of range")
    now = time.time()
    if timer.question_is_locked(attempt, subject, index, now):
        raise ValueError("question_locked")
    if choice is not None:
        qs = attempt["questions"].get(subject) or []
        if not (0 <= index < len(qs)):
            raise ValueError("index out of range")
        n_opts = len(qs[index].get("options") or [])
        if choice not in [chr(65 + i) for i in range(n_opts)]:
            raise ValueError("invalid choice")
    rs[index]["choice"] = choice
    rs[index]["visited"] = True
    _ensure_subject_started(attempt, subject, now)
    _ensure_question_started(attempt, subject, index, now)
    return attempt


def apply_mark(attempt, subject, index, marked):
    if not _subject_in_template(attempt, subject):
        raise ValueError("subject not found")
    rs = attempt["responses"].get(subject) or []
    if not (0 <= index < len(rs)):
        raise ValueError("index out of range")
    if timer.question_is_locked(attempt, subject, index):
        raise ValueError("question_locked")
    rs[index]["marked"] = bool(marked)
    rs[index]["visited"] = True
    return attempt


def apply_visit(attempt, subject, index, spent):
    if not _subject_in_template(attempt, subject):
        raise ValueError("subject not found")
    rs = attempt["responses"].get(subject) or []
    if not (0 <= index < len(rs)):
        raise ValueError("index out of range")
    # clamp
    try:
        spent = float(spent or 0)
    except (TypeError, ValueError):
        spent = 0
    spent = max(0.0, min(600.0, spent))
    if spent:
        rs[index]["time_spent"] = float(rs[index].get("time_spent") or 0) + spent
    rs[index]["visited"] = True
    attempt["current"] = {"subject": subject, "index": index}
    # lock tracking: mark first entry (safe even if already started)
    _ensure_subject_started(attempt, subject)
    _ensure_question_started(attempt, subject, index)
    return attempt