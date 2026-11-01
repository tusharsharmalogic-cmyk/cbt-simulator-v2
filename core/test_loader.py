"""Tests (data/tests/*.json) padhna.

Step 1: sirf list + load. Validator (count mismatch, bina answer wala question,
kharab SVG) step 3 me aayega.
"""
import json
import re

import config

# Test id = filename (bina .json). Sirf safe characters, taaki path traversal na ho.
_ID_RE = re.compile(r"^[A-Za-z0-9_\-]+$")


def _path_for(test_id):
    if not _ID_RE.match(test_id or ""):
        return None
    return config.TESTS_DIR / f"{test_id}.json"


def load_test(test_id):
    """Pura test dict return karta hai, ya None agar nahi mila."""
    p = _path_for(test_id)
    if p is None or not p.is_file():
        return None
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def list_tests():
    """Har test ka chhota summary: id, name, subject-wise question count."""
    out = []
    for p in sorted(config.TESTS_DIR.glob("*.json")):
        try:
            with open(p, encoding="utf-8") as f:
                t = json.load(f)
            subjects = {name: len(qs) for name, qs in t.get("subjects", {}).items()}
            out.append({"id": p.stem, "name": t.get("name", p.stem), "subjects": subjects})
        except (json.JSONDecodeError, OSError, AttributeError) as e:
            # Kharab file poori list na tode; error dikha do (step 3 me detailed hoga)
            out.append({"id": p.stem, "name": p.stem, "error": f"File padh nahi paye: {e}"})
    return out
