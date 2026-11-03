"""Exam templates: data/templates/<id>.json.

Validation rules (spec 4.1):
- name 1-60 chars
- >= 1 subject
- subject names non-empty, unique (case-insensitive), <= 40 chars
- questions int 1-500
- marks > 0, negative >= 0 (both numbers, decimals allowed)
- timer_mode "total": total_minutes > 0; per-subject minutes = null
- timer_mode "subject": har subject ke minutes > 0; total_minutes = sum
- id = slug of name, lowercase, non-alnum -> _, dedupe with _2, _3
"""
import re
import threading
import time

import config
from core.storage import read_json, write_json_atomic

_LOCK = threading.Lock()
_ID_RE = re.compile(r"^[A-Za-z0-9_\-]+$")


# ---------- id / slug ----------

def _slug(name):
    s = re.sub(r"[^a-z0-9]+", "_", (name or "").lower()).strip("_")
    return s or "template"


def _validate_id(tid):
    return bool(tid and _ID_RE.match(tid))


def _path_for(tid):
    if not _validate_id(tid):
        return None
    return config.TEMPLATES_DIR / f"{tid}.json"


def _unique_id(base):
    """existing files ke saath clash ho to _2, _3 ... lagao."""
    if not _validate_id(base):
        base = _slug(base)
    if not (config.TEMPLATES_DIR / f"{base}.json").exists():
        return base
    i = 2
    while (config.TEMPLATES_DIR / f"{base}_{i}.json").exists():
        i += 1
    return f"{base}_{i}"


# ---------- validation ----------

def _is_number(v):
    # bool int ka subclass hai — usko number na maano
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _is_int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def validate_template(data):
    """Validate + normalize. (clean, errors) return karta hai.
    clean me server-side computed fields hote hain (total_minutes etc)."""
    errors = []
    if not isinstance(data, dict):
        return None, ["Template ek object hona chahiye"]

    name = (data.get("name") or "").strip() if isinstance(data.get("name"), str) else ""
    if not (1 <= len(name) <= 60):
        errors.append("Template name 1-60 characters ka hona chahiye")

    mode = data.get("timer_mode")
    if mode not in ("total", "subject"):
        errors.append("timer_mode 'total' ya 'subject' hona chahiye")
        mode = "total"

    subjects_in = data.get("subjects")
    if not isinstance(subjects_in, list) or len(subjects_in) == 0:
        errors.append("Kam se kam ek subject chahiye")
        subjects_in = []

    clean_subjects = []
    seen = set()
    for i, s in enumerate(subjects_in, start=1):
        if not isinstance(s, dict):
            errors.append(f"Subject {i}: object hona chahiye")
            continue
        sname = (s.get("name") or "").strip() if isinstance(s.get("name"), str) else ""
        if not sname:
            errors.append(f"Subject {i}: naam khali nahi ho sakta")
        elif len(sname) > 40:
            errors.append(f"Subject {i}: naam 40 characters se chhota hona chahiye")
        else:
            key = sname.lower()
            if key in seen:
                errors.append(f"Subject '{sname}': naam duplicate hai")
            seen.add(key)

        q = s.get("questions")
        if not _is_int(q) or not (1 <= q <= 500):
            errors.append(f"Subject '{sname or i}': questions 1-500 ke beech integer hona chahiye")

        marks = s.get("marks")
        if not _is_number(marks) or marks <= 0:
            errors.append(f"Subject '{sname or i}': +marks > 0 hona chahiye")

        neg = s.get("negative")
        if not _is_number(neg) or neg < 0:
            errors.append(f"Subject '{sname or i}': -negative >= 0 hona chahiye (positive number, e.g. 1)")

        minutes = s.get("minutes")
        if mode == "subject":
            if not _is_number(minutes) or minutes <= 0:
                errors.append(f"Subject '{sname or i}': minutes > 0 hona chahiye (subject timer mode)")
        else:
            minutes = None

        # NEW: per-subject lock mode (mutually exclusive: question XOR subject)
        lock_mode = s.get("lock_mode") or "none"
        if lock_mode not in ("none", "question", "subject"):
            errors.append(f"Subject '{sname or i}': lock_mode 'none'/'question'/'subject' hona chahiye")
            lock_mode = "none"
        pqs = s.get("per_question_seconds")
        sm = s.get("subject_minutes")
        if lock_mode == "question":
            if not _is_number(pqs) or pqs <= 0:
                errors.append(f"Subject '{sname or i}': per_question_seconds > 0 hona chahiye (question lock)")
                pqs = None
            if _is_number(sm) and sm > 0:
                errors.append(f"Subject '{sname or i}': per-question aur subject-max dono ek saath on nahi ho sakte")
            sm = None
        elif lock_mode == "subject":
            if not _is_number(sm) or sm <= 0:
                errors.append(f"Subject '{sname or i}': subject_minutes > 0 hona chahiye (subject lock)")
                sm = None
            if _is_number(pqs) and pqs > 0:
                errors.append(f"Subject '{sname or i}': per-question aur subject-max dono ek saath on nahi ho sakte")
            pqs = None
        else:
            pqs = None
            sm = None

        clean_subjects.append({
            "name": sname,
            "questions": q if _is_int(q) else 0,
            "marks": float(marks) if _is_number(marks) else 0,
            "negative": float(neg) if _is_number(neg) else 0,
            "minutes": minutes if _is_number(minutes) else None,
            "lock_mode": lock_mode,
            "per_question_seconds": float(pqs) if _is_number(pqs) and pqs > 0 else None,
            "subject_minutes": float(sm) if _is_number(sm) and sm > 0 else None,
        })

    total_minutes = None
    if mode == "total":
        tm = data.get("total_minutes")
        if not _is_number(tm) or tm <= 0:
            errors.append("total_minutes > 0 hona chahiye (total timer mode)")
        else:
            total_minutes = float(tm)
    else:
        # subject mode: server sum compute karta hai
        if all(isinstance(s.get("minutes"), (int, float)) and s.get("minutes") > 0 for s in clean_subjects) and clean_subjects:
            total_minutes = float(sum(s["minutes"] for s in clean_subjects))

    if errors:
        return None, errors

    clean = {
        "name": name,
        "timer_mode": mode,
        "total_minutes": total_minutes,
        "subjects": clean_subjects,
    }
    return clean, []


# ---------- CRUD ----------

def _summary(tid, t):
    return {
        "id": tid,
        "name": t.get("name", tid),
        "timer_mode": t.get("timer_mode", "total"),
        "total_minutes": t.get("total_minutes"),
        "subjects": [
            {"name": s.get("name", ""), "questions": s.get("questions", 0)}
            for s in t.get("subjects", [])
        ],
    }


def list_templates():
    out = []
    for p in sorted(config.TEMPLATES_DIR.glob("*.json")):
        if p.name.startswith(".tmp_"):
            continue
        try:
            t = read_json(p)
        except Exception:
            continue
        out.append(_summary(p.stem, t))
    return out


def get_template(tid):
    p = _path_for(tid)
    if p is None or not p.is_file():
        return None
    t = read_json(p)
    t["id"] = tid
    return t


def save_template(tid, data):
    """tid == "new" -> naya id generate hota hai.
    Returns: (saved_id, clean_template) ya (None, errors)."""
    clean, errors = validate_template(data)
    if errors:
        return None, errors

    with _LOCK:
        if tid == "new":
            new_id = _unique_id(_slug(clean["name"]))
        else:
            if not _validate_id(tid):
                return None, ["Invalid template id"]
            new_id = tid

        path = config.TEMPLATES_DIR / f"{new_id}.json"
        # created_at ko preserve karo agar edit hai
        if path.exists():
            try:
                old = read_json(path)
                clean["created_at"] = old.get("created_at", time.time())
            except Exception:
                clean["created_at"] = time.time()
        else:
            clean["created_at"] = time.time()
        clean["updated_at"] = time.time()
        write_json_atomic(path, clean)
    return new_id, clean


def delete_template(tid):
    p = _path_for(tid)
    if p is None or not p.is_file():
        return False
    p.unlink()
    return True