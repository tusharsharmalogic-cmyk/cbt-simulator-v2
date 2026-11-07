"""Tests (data/tests/*.json) padhna + validate karna.

Step 3: validate_test(test, template) -> {errors, warnings}.
Errors = test start block karte hain, warnings = allowed but helpful.
"""
import json
import re
import xml.etree.ElementTree as ET

import config

# Test id = filename (bina .json). Sirf safe characters, taaki path traversal na ho.
_ID_RE = re.compile(r"^[A-Za-z0-9_\-]+$")

# Question ki optional difficulty ki allowed values
DIFFICULTIES = ("easy", "medium", "hard")


def _path_for(test_id):
    if not _ID_RE.match(test_id or ""):
        return None
    return config.TESTS_DIR / f"{test_id}.json"


def load_test(test_id):
    """Pura test dict return karta hai, ya None agar nahi mila.
    Kharab JSON pe json.JSONDecodeError raise hota hai (caller decide kare)."""
    p = _path_for(test_id)
    if p is None or not p.is_file():
        return None
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def load_test_safe(test_id):
    """(test_or_None, error_msg_or_None). Human-friendly error, JSONDecodeError
    ki line/col bhi dikhta hai."""
    p = _path_for(test_id)
    if p is None:
        return None, "Invalid test id"
    if not p.is_file():
        return None, "Test nahi mila"
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f), None
    except json.JSONDecodeError as e:
        return None, f"JSON kharab hai: line {e.lineno}, col {e.colno}: {e.msg}"
    except OSError as e:
        return None, f"File padh nahi paye: {e}"


def list_tests():
    """Har test ka chhota summary: id, name, subject-wise question count.
    Kharab file poori list na tode — us entry me 'error' key aata hai."""
    out = []
    for p in sorted(config.TESTS_DIR.glob("*.json")):
        if p.name.startswith(".tmp_"):
            continue
        try:
            mtime = p.stat().st_mtime
        except OSError:
            mtime = None
        try:
            with open(p, encoding="utf-8") as f:
                t = json.load(f)
            subjects = {name: len(qs) for name, qs in t.get("subjects", {}).items()}
            out.append({"id": p.stem, "name": t.get("name", p.stem),
                        "subjects": subjects, "created_at": mtime})
        except json.JSONDecodeError as e:
            out.append({"id": p.stem, "name": p.stem, "created_at": mtime,
                        "error": f"JSON kharab: line {e.lineno} col {e.colno}"})
        except (OSError, AttributeError, TypeError) as e:
            out.append({"id": p.stem, "name": p.stem, "created_at": mtime,
                        "error": f"File padh nahi paye: {e}"})
    return out


# ---------- validation ----------

def validate_test(test, template=None, strict_counts=True):
    """Test ko template ke hisaab se check karo.

    template=None -> saare questions check karo.
    template diya -> sirf first N questions per subject check (jo use honge).
    strict_counts=False -> "fewer than needed" error mat do (import flow ke liye,
                          template se kam questions allowed).
    Returns: {"errors": [str], "warnings": [str]}
    """
    errors, warnings = [], []

    if not isinstance(test, dict):
        return {"errors": ["Test ek JSON object hona chahiye"], "warnings": []}

    tsubs = test.get("subjects")
    if not isinstance(tsubs, dict) or not tsubs:
        return {"errors": ["subjects field missing ya khali hai"], "warnings": []}

    tmpl_subjs = {}
    if template is not None:
        for s in template.get("subjects", []):
            name = s.get("name", "")
            if name:
                tmpl_subjs[name] = s

    # template me jo subject hai par test me nahi:
    # strict_counts=True  -> error (import/validate screen ke liye purana behaviour)
    # strict_counts=False -> warning (attempt start ke liye, 0-Q subject skip ho jayega)
    if template is not None:
        for name in tmpl_subjs:
            if name not in tsubs:
                if strict_counts:
                    errors.append(f"'{name}' subject test me missing hai (template ko chahiye)")
                else:
                    warnings.append(f"'{name}' subject me 0 questions — skip hoga")

    # test me jo extra subject hai -> warning
    if template is not None:
        for name in tsubs:
            if name not in tmpl_subjs:
                warnings.append(f"'{name}' subject test me hai par template me nahi (ignore hoga)")

    # per-subject
    for subj_name, qs in tsubs.items():
        if not isinstance(qs, list):
            errors.append(f"{subj_name}: questions ek list honi chahiye")
            continue

        if template is not None and subj_name in tmpl_subjs:
            needed = tmpl_subjs[subj_name].get("questions", 0)
            if len(qs) < needed:
                if strict_counts:
                    errors.append(f"{subj_name}: test me {len(qs)} questions hain, template ko {needed} chahiye")
                to_check = qs
            elif len(qs) > needed:
                if strict_counts:
                    warnings.append(f"{subj_name}: test me {len(qs)} questions hain, template sirf {needed} lega (extra ignore)")
                to_check = qs[:needed]
            else:
                to_check = qs
        else:
            to_check = qs

        for i, q in enumerate(to_check, start=1):
            prefix = f"{subj_name} Q{i}"
            if not isinstance(q, dict):
                errors.append(f"{prefix}: question object nahi hai")
                continue
            _validate_question(q, prefix, errors, warnings)

    return {"errors": errors, "warnings": warnings}


def _validate_question(q, prefix, errors, warnings):
    # q text
    if not isinstance(q.get("q"), str) or not q["q"].strip():
        errors.append(f"{prefix}: question text khali hai")

    # options
    opts = q.get("options")
    if not isinstance(opts, list):
        errors.append(f"{prefix}: options list nahi hai")
    else:
        if len(opts) < 2 or len(opts) > 6:
            errors.append(f"{prefix}: options 2 se 6 ke beech hone chahiye (mila: {len(opts)})")
        for i, o in enumerate(opts):
            if not isinstance(o, str):
                errors.append(f"{prefix}: option {chr(65 + i)} string nahi hai")

    # answer
    answer = q.get("answer")
    if not isinstance(answer, str) or len(answer) != 1:
        errors.append(f"{prefix}: answer missing ya single letter nahi")
    else:
        a = answer.upper()
        if not ("A" <= a <= "Z"):
            errors.append(f"{prefix}: answer '{answer}' valid letter nahi")
        elif isinstance(opts, list) and (ord(a) - ord("A")) >= len(opts):
            errors.append(f"{prefix}: answer '{a}' option se bahar hai (options {len(opts)})")

    # svg (agar diya hai to valid hona chahiye)
    svg = q.get("svg")
    if svg is not None and svg != "":
        err = _check_svg(svg)
        if err:
            errors.append(f"{prefix}: SVG kharab — {err}")

    # solution warning
    if not q.get("solution"):
        warnings.append(f"{prefix}: solution missing (allowed but helpful)")

    # analysis fields (optional): chapter, topic, difficulty
    for key in ("chapter", "topic"):
        v = q.get(key)
        if v is None:
            continue
        if not isinstance(v, str) or not v.strip():
            warnings.append(f"{prefix}: {key} khali ya string nahi — analysis me 'Unknown' ginega")
    diff = q.get("difficulty")
    if diff is not None:
        if not isinstance(diff, str) or diff.strip().lower() not in DIFFICULTIES:
            warnings.append(f"{prefix}: difficulty '{diff}' valid nahi (easy/medium/hard) — 'Unknown' ginega")


def _check_svg(svg):
    if not isinstance(svg, str) or not svg.strip():
        return "khali string"
    try:
        root = ET.fromstring(svg)
    except ET.ParseError as e:
        return f"parse fail ({e})"
    tag = root.tag.split("}")[-1].lower()
    if tag != "svg":
        return f"root element <svg> nahi hai (mila <{tag}>)"
    if not root.attrib.get("viewBox"):
        return "viewBox missing (mobile scaling ke liye zaroori)"
    return None