"""Import multiple test JSON files, group by subject (case-insensitive), cap per
template subject count, dedupe (same q + options), save as data/tests/<slug>.json.

Rules per user:
- Subject match: case-insensitive. Template 'Physics' = JSON 'physics'.
- Cap: use first N questions from merged pool (N = template subject.questions).
- Fewer than needed: allowed, no warning shown to user (summary shows count).
- Only questions with non-empty q AND non-empty answer accepted. Options sanity
  checked (2-6 strings, answer within range).
- Dedupe: same q + same options tuple -> only first kept.
- File format: only .json accepted (enforced by frontend, defence here too).
"""
import hashlib
import json
import re
import time

import config
from core.storage import write_json_atomic

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slug(s):
    return _SLUG_RE.sub("_", (s or "").lower()).strip("_") or "imported"


def _ci_key(name):
    return (name or "").strip().lower()


def _dedupe_key(q):
    opts = tuple(q.get("options") or [])
    return (q.get("q") or "").strip(), opts


def _basic_check(q):
    """Return None if ok, else reason string (short, user visible)."""
    if not isinstance(q, dict):
        return "question object nahi hai"
    if not isinstance(q.get("q"), str) or not q["q"].strip():
        return "question text khali hai"
    opts = q.get("options")
    if not isinstance(opts, list) or not (2 <= len(opts) <= 6):
        return "options 2-6 ke beech nahi"
    if not all(isinstance(o, str) for o in opts):
        return "option string nahi hai"
    a = q.get("answer")
    if not isinstance(a, str) or len(a) != 1 or not ("A" <= a.upper() <= "Z"):
        return "answer missing ya single letter nahi"
    if (ord(a.upper()) - ord("A")) >= len(opts):
        return "answer option se bahar hai"
    return None


def import_files(files, template):
    """files: list of (filename, bytes) tuples.
    template: full template dict (already validated).
    Returns dict: {test_id, name, counts:{subject:N}, used:{subject:N},
                   needed:{subject:N}, skipped: {file: [msgs]}, total, errors:[..]}
    """
    # template subjects map (ci) -> {name, questions}
    tmpl = {}
    order = []
    for s in template.get("subjects") or []:
        name = s.get("name")
        if not name:
            continue
        tmpl[_ci_key(name)] = {"name": name, "questions": int(s.get("questions") or 0)}
        order.append(_ci_key(name))

    # pools per template subject
    pools = {k: [] for k in order}
    seen = {k: set() for k in order}
    skipped = {}
    total_valid = 0
    errors = []

    for fname, raw in files:
        # JSON parse
        try:
            text = raw.decode("utf-8")
            doc = json.loads(text)
        except (UnicodeDecodeError, json.JSONDecodeError) as e:
            skipped.setdefault(fname, []).append(f"JSON kharab: {e}")
            continue

        # file may be one test object (with .subjects) or an array of such, or a
        # plain subject map
        docs = []
        if isinstance(doc, dict) and "subjects" in doc:
            docs.append(doc)
        elif isinstance(doc, list):
            for item in doc:
                if isinstance(item, dict) and "subjects" in item:
                    docs.append(item)
                elif isinstance(item, dict):
                    docs.append({"subjects": item})
        elif isinstance(doc, dict):
            docs.append({"subjects": doc})
        else:
            skipped.setdefault(fname, []).append("top-level object/list expected")
            continue

        for d in docs:
            subj_map = d.get("subjects") or {}
            if not isinstance(subj_map, dict):
                skipped.setdefault(fname, []).append("subjects object nahi hai")
                continue
            for sname, arr in subj_map.items():
                k = _ci_key(sname)
                if k not in pools:
                    skipped.setdefault(fname, []).append(f"'{sname}' subject template me nahi")
                    continue
                if not isinstance(arr, list):
                    skipped.setdefault(fname, []).append(f"{sname}: questions list nahi")
                    continue
                for i, q in enumerate(arr):
                    why = _basic_check(q)
                    if why:
                        skipped.setdefault(fname, []).append(f"{sname} Q{i + 1}: {why}")
                        continue
                    # normalise answer uppercase, options kept
                    qn = dict(q)
                    qn["answer"] = q["answer"].upper()
                    dk = _dedupe_key(qn)
                    if dk in seen[k]:
                        continue  # duplicate — silently skip
                    seen[k].add(dk)
                    pools[k].append(qn)
                    total_valid += 1

    # cap by template
    used = {}
    final_subjects = {}
    for k in order:
        info = tmpl[k]
        pool = pools[k]
        take = pool[:info["questions"]]
        used[info["name"]] = len(take)
        if take:
            final_subjects[info["name"]] = take

    counts = {info["name"]: 0 for info in tmpl.values()}
    for k in order:
        counts[tmpl[k]["name"]] = len(pools[k])

    if not final_subjects:
        return {
            "errors": ["Koi bhi valid question import nahi hua"],
            "skipped": skipped,
            "counts": counts,
            "used": used,
            "needed": {v["name"]: v["questions"] for v in tmpl.values()},
            "total": 0,
        }

    return {
        "errors": [],
        "skipped": skipped,
        "counts": counts,           # pool size per subject (before cap)
        "used": used,               # final questions per subject (after cap)
        "needed": {v["name"]: v["questions"] for v in tmpl.values()},
        "total": sum(used.values()),
        "subjects": final_subjects,
    }


def save_imported_test(merged, name):
    """Write merged test JSON to data/tests/<slug>.json. Returns (test_id, name)."""
    base = _slug(name)
    tid = base
    i = 2
    while (config.TESTS_DIR / f"{tid}.json").exists():
        tid = f"{base}_{i}"
        i += 1
    doc = {"name": name, "subjects": merged}
    write_json_atomic(config.TESTS_DIR / f"{tid}.json", doc)
    return tid, name