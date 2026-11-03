"""Server-side remaining time. Sirf start_time + now se compute — no threads.

Total mode: deadline = start + total_minutes*60. Sab subjects free.
Subject mode: har subject ka window [start+sum(prev)*60, start+sum+this*60].
Current subject = jis window me now hai. Earlier = locked. Later = not open yet.
"""
import time


def timing(attempt, now=None):
    if now is None:
        now = time.time()
    tmpl = attempt.get("template") or {}
    mode = tmpl.get("timer_mode", "total")
    try:
        start = float(attempt.get("start_time") or now)
    except (TypeError, ValueError):
        start = now

    if mode == "subject":
        subjects = tmpl.get("subjects") or []
        windows = []
        t = start
        for s in subjects:
            dur = (float(s.get("minutes") or 0)) * 60
            windows.append((t, t + dur, s.get("name")))
            t += dur
        deadline = t
        remaining = max(0.0, deadline - now)

        current_idx = None
        current_remaining = 0.0
        locked = []
        for i, (ws, we, name) in enumerate(windows):
            if we <= now:
                locked.append(name)
            elif ws <= now < we and current_idx is None:
                current_idx = i
                current_remaining = we - now

        subject_block = None
        if current_idx is not None:
            subject_block = {
                "index": current_idx,
                "name": windows[current_idx][2],
                "remaining_seconds": round(current_remaining, 2),
            }

        return {
            "mode": "subject",
            "server_now": now,
            "remaining_seconds": round(remaining, 2),
            "deadline": deadline,
            "subject": subject_block,
            "locked_subjects": locked,
        }

    total_min = float(tmpl.get("total_minutes") or 0)
    deadline = start + total_min * 60
    remaining = max(0.0, deadline - now)
    return {
        "mode": "total",
        "server_now": now,
        "remaining_seconds": round(remaining, 2),
        "deadline": deadline,
        "subject": None,
        "locked_subjects": [],
    }


def is_over(attempt, now=None):
    return timing(attempt, now)["remaining_seconds"] <= 0

# ---------- per-subject / per-question lock helpers ----------

def _tmpl_subject(attempt, subject):
    for s in (attempt.get("template") or {}).get("subjects") or []:
        if s.get("name") == subject:
            return s
    return None

def question_lock_remaining(attempt, subject, index, now=None):
    """None if per-question lock not configured for this subject or Q not started.
    Else float seconds remaining (>= 0)."""
    if now is None:
        now = time.time()
    s = _tmpl_subject(attempt, subject)
    if not s or s.get("lock_mode") != "question":
        return None
    pqs = s.get("per_question_seconds")
    if not pqs:
        return None
    rs = (attempt.get("responses") or {}).get(subject) or []
    if not (0 <= index < len(rs)):
        return None
    started = rs[index].get("q_started_at")
    if started is None:
        return None
    return max(0.0, float(started) + float(pqs) - now)

def subject_lock_remaining(attempt, subject, now=None):
    """None if per-subject lock not configured. Else float seconds remaining."""
    if now is None:
        now = time.time()
    s = _tmpl_subject(attempt, subject)
    if not s or s.get("lock_mode") != "subject":
        return None
    sm = s.get("subject_minutes")
    if not sm:
        return None
    started = (attempt.get("subject_started_at") or {}).get(subject)
    if started is None:
        return None
    return max(0.0, float(started) + float(sm) * 60.0 - now)

def subject_is_locked(attempt, subject, now=None):
    r = subject_lock_remaining(attempt, subject, now)
    return r is not None and r <= 0

def question_is_locked(attempt, subject, index, now=None):
    """Locked if per-Q timer up, or its subject is locked."""
    if now is None:
        now = time.time()
    if subject_is_locked(attempt, subject, now):
        return True
    r = question_lock_remaining(attempt, subject, index, now)
    return r is not None and r <= 0

def all_questions_locked(attempt, now=None):
    """True if every question in the attempt is locked (per-Q or via subject)."""
    if now is None:
        now = time.time()
    qs = attempt.get("questions") or {}
    any_q = False
    for subj, lst in qs.items():
        if subject_is_locked(attempt, subj, now):
            any_q = any_q or bool(lst)
            continue
        for i in range(len(lst)):
            any_q = True
            if not question_is_locked(attempt, subj, i, now):
                return False
    return any_q