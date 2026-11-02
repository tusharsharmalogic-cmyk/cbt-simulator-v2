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