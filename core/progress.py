"""Progress (read-only): har completed attempt ka chhota, chronological summary.

Progress screen ke trend graphs isi se bante hain. Kuch delete/modify nahi hota.
Retry attempts (retry_of / retry_mode) shamil nahi: unme sirf kamzor questions
hote hain, to unka score pehle ke tests se compare karna galat hoga.

Paper level = tagged questions ka average difficulty index
(easy = 1, medium = 2, hard = 3):
  index <  EASY_BELOW                 -> "easy"
  EASY_BELOW <= index <= HARD_ABOVE   -> "medium"
  index >  HARD_ABOVE                 -> "hard"
Agar MIN_TAGGED se kam questions par difficulty tag hai -> "unknown".
"""
import math

import config
from core.storage import read_json

DIFFS = ("easy", "medium", "hard", "unknown")
WEIGHT = {"easy": 1, "medium": 2, "hard": 3}
EASY_BELOW = 5 / 3      # 1.67
HARD_ABOVE = 7 / 3      # 2.33
MIN_TAGGED = 0.7        # kam se kam itne questions par difficulty tag chahiye


def _num(x):
    try:
        v = float(x)
    except (TypeError, ValueError):
        return 0.0
    return v if math.isfinite(v) else 0.0


def _diff(q):
    d = q.get("difficulty") if isinstance(q, dict) else None
    d = d.strip().lower() if isinstance(d, str) else ""
    return d if d in WEIGHT else "unknown"


def _label(v):
    return v.strip() if isinstance(v, str) and v.strip() else "Unknown"


def _empty():
    return {"total": 0, "correct": 0, "wrong": 0, "blank": 0, "time": 0.0}


def _add(st, status, t):
    st["total"] += 1
    st["time"] += t
    if status == "correct":
        st["correct"] += 1
    elif status == "wrong":
        st["wrong"] += 1
    else:
        st["blank"] += 1


def _public(st):
    out = dict(st)
    out["time"] = round(st["time"], 1)
    return out


def paper_level(mix):
    total = sum(mix.values())
    tagged = sum(mix.get(d, 0) for d in WEIGHT)
    if not total or tagged / total < MIN_TAGGED:
        return {"key": "unknown", "index": None, "tagged": tagged, "total": total}
    index = sum(WEIGHT[d] * mix.get(d, 0) for d in WEIGHT) / tagged
    if index < EASY_BELOW:
        key = "easy"
    elif index > HARD_ABOVE:
        key = "hard"
    else:
        key = "medium"
    return {"key": key, "index": round(index, 2), "tagged": tagged, "total": total}


def summarize(a):
    """Ek submitted attempt ka compact summary, ya None (result nahi / 0 questions)."""
    if not isinstance(a, dict) or a.get("status") != "submitted":
        return None
    res = a.get("result")
    if not isinstance(res, dict):
        return None
    qs_by = a.get("questions") or {}

    diff_stats = {d: _empty() for d in DIFFS}
    chapters = {}
    subjects = []
    tot = _empty()
    score = 0.0
    max_score = 0.0

    for s in res.get("subjects") or []:
        if not isinstance(s, dict):
            continue
        name = s.get("name")
        rows = s.get("rows") or []
        qs = qs_by.get(name) or []
        st = _empty()
        for i, row in enumerate(rows):
            row = row if isinstance(row, dict) else {}
            q = qs[i] if i < len(qs) else {}
            status = row.get("status")
            t = _num(row.get("time_spent"))
            _add(st, status, t)
            _add(tot, status, t)
            _add(diff_stats[_diff(q)], status, t)
            ch = _label(q.get("chapter") if isinstance(q, dict) else None)
            _add(chapters.setdefault((name, ch), _empty()), status, t)
        if not st["total"]:
            continue
        sc, mx = _num(s.get("score")), _num(s.get("max"))
        score += sc
        max_score += mx
        att = st["correct"] + st["wrong"]
        subjects.append({
            "name": name, "score": round(sc, 2), "max": round(mx, 2),
            "pct": round(sc * 100 / mx, 1) if mx > 0 else None,
            "accuracy": round(st["correct"] * 100 / att, 1) if att else None,
            "avg_time": round(st["time"] / st["total"], 1),
            **_public(st),
        })

    if not tot["total"]:
        return None

    mix = {d: diff_stats[d]["total"] for d in DIFFS}
    att = tot["correct"] + tot["wrong"]
    submitted = a.get("submitted_at") or a.get("created_at")
    return {
        "id": a.get("id"),
        "test_name": a.get("test_name") or "Test",
        "template_name": (a.get("template") or {}).get("name"),
        "submitted_at": submitted if isinstance(submitted, (int, float)) else None,
        "total": {
            "score": round(score, 2), "max": round(max_score, 2),
            "pct": round(score * 100 / max_score, 1) if max_score > 0 else None,
            "accuracy": round(tot["correct"] * 100 / att, 1) if att else None,
            "avg_time": round(tot["time"] / tot["total"], 1),
            **_public(tot),
        },
        "level": paper_level(mix),
        "mix": mix,
        "difficulty": {d: _public(diff_stats[d]) for d in DIFFS},
        "subjects": subjects,
        "chapters": [
            {"subject": k[0], "name": k[1], **_public(v)} for k, v in chapters.items()
        ],
    }


def build():
    """Saare submitted (non-retry) attempts, purane se naye order me."""
    items, retries = [], 0
    for p in sorted(config.ATTEMPTS_DIR.glob("*.json")):
        if p.name.startswith(".tmp_"):
            continue
        try:
            a = read_json(p)
        except Exception:
            continue
        if not isinstance(a, dict) or a.get("status") != "submitted":
            continue
        if a.get("retry_of") or a.get("retry_mode"):
            retries += 1
            continue
        try:
            s = summarize(a)
        except Exception:
            s = None        # ek kharab attempt poori Progress screen na tode
        if s:
            items.append(s)
    items.sort(key=lambda x: (_num(x.get("submitted_at")), str(x.get("id"))))
    return {
        "attempts": items,
        "excluded_retries": retries,
        "level_rule": {
            "easy_below": round(EASY_BELOW, 2),
            "hard_above": round(HARD_ABOVE, 2),
            "min_tagged": MIN_TAGGED,
        },
    }