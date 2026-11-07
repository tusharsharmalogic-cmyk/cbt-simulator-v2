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


# LaTeX commands jo JSON me aksar single backslash ke saath aate hain. `\f`
# (formfeed), `\t` (tab), `\n` (newline) valid JSON escapes hain — isliye
# sirf in known names ko double karte hain, warna `\n` wale real line breaks
# galat ho jayenge.
_LATEX_WORDS = frozenset(
    "frac forall frown beta because begin bar binom big bmatrix bullet bmod "
    "sqrt sum sin sinh sec sgn "
    "theta tan tanh tau text tfrac triangle therefore top to times "
    "neq notin nabla nu natural nearrow newcommand "
    "right rho rangle rvert rceil lfloor lceil "
    "alpha approx angle "
    "nabla partial pm pi "
    "vec overline omega "
    "left lambda lim log ln "
    "int infty "
    "gamma ge "
    "mu mathrm mathbf "
    "cdot circ cos cosh cot csc "
    "delta degree "
    "epsilon eta "
    "sigma "
    "kappa "
    "upsilon "
    "phi "
    "chi psi "
    "iota zeta"
    .split()
)


def _strip_fences(text):
    """Markdown ```json fence aur aage-piche ka text hatao."""
    t = (text or "").lstrip("\ufeff").strip()
    i = t.find("```")
    if i != -1:
        body = t[i + 3:]
        nl = body.find("\n")
        body = body[nl + 1:] if nl != -1 else ""
        j = body.rfind("```")
        if j != -1:
            body = body[:j]
        t = body.strip()
    return t


def _trim_to_json(t):
    """Pehle {/[ se aakhri }/] tak ka hissa (AI ka extra text hatao)."""
    starts = [p for p in (t.find("{"), t.find("[")) if p != -1]
    if not starts:
        return t
    s = min(starts)
    e = max(t.rfind("}"), t.rfind("]"))
    return t[s:e + 1] if e > s else t[s:]


def _repair_strings(t):
    """String ke andar: single-backslash LaTeX double karo, real newline/tab
    ko \\n/\\t banao. Bahar ke text ko chhua nahi jaata."""
    out = []
    in_str = False
    i = 0
    n = len(t)
    while i < n:
        c = t[i]
        if not in_str:
            if c == '"':
                in_str = True
            out.append(c)
            i += 1
            continue
        if c == '"':
            in_str = False
            out.append(c)
            i += 1
            continue
        if c == "\n":
            out.append("\\n")
            i += 1
            continue
        if c == "\r":
            i += 1
            continue
        if c == "\t":
            out.append("\\t")
            i += 1
            continue
        if c != "\\":
            out.append(c)
            i += 1
            continue

        nxt = t[i + 1] if i + 1 < n else ""
        word_m = re.match(r"[A-Za-z]+", t[i + 1:])
        word = word_m.group(0) if word_m else ""
        if nxt in ('"', "\\", "/"):            # JSON escape — as-is
            out.append(t[i:i + 2])
            i += 2
            continue
        if nxt == "u" and re.fullmatch(r"[0-9a-fA-F]{4}", t[i + 2:i + 6] or ""):
            out.append(t[i:i + 6])                # \uXXXX
            i += 6
            continue
        if nxt in "bfnrt" and len(word) > 1 and word not in _LATEX_WORDS:
            out.append(t[i:i + 2])                # asli \n, \t aadi
            i += 2
            continue
        # LaTeX command ya invalid escape — backslash double karo
        out.append("\\\\")
        i += 1
    return "".join(out)


def _drop_trailing_commas(t):
    """`},]` / `},}` jaisi trailing comma hatao (strings ke andar nahi)."""
    out = []
    in_str = False
    i = 0
    n = len(t)
    while i < n:
        c = t[i]
        if in_str:
            if c == "\\" and i + 1 < n:
                out.append(t[i:i + 2])
                i += 2
                continue
            if c == '"':
                in_str = False
            out.append(c)
            i += 1
            continue
        if c == '"':
            in_str = True
            out.append(c)
            i += 1
            continue
        if c == ",":
            j = i + 1
            while j < n and t[j] in " \t\r\n":
                j += 1
            if j < n and t[j] in "}]":
                i += 1
                continue
        out.append(c)
        i += 1
    return "".join(out)


def parse_json_text(text):
    """AI ke output ko JSON me parse karo — markdown fence, aage-piche ka text,
    trailing comma aur single-backslash LaTeX jaisi common galtiyan sudhaar kar.
    """
    cleaned = _trim_to_json(_strip_fences(text))
    # Repairs hamesha chalao: `\frac` JSON me valid \f escape ban kar silently
    # corrupt hota hai, isliye parse fail hone ka intezaar nahi karte.
    fixed = _drop_trailing_commas(_repair_strings(cleaned))
    return json.loads(fixed)


def _as_question_list(arr):
    """Subject ki value list honi chahiye; {questions:[...]} ya single question
    object bhi accept karo."""
    if isinstance(arr, list):
        return arr
    if isinstance(arr, dict):
        if isinstance(arr.get("questions"), list):
            return arr["questions"]
        if "q" in arr or "options" in arr:
            return [arr]
    return None


def _normalise_subjects(doc):
    """subjects ko {name: [...]} me badlo. Array shape
    [{"name": "Physics", "questions": [...]}] bhi chalega."""
    subj = doc.get("subjects")
    if isinstance(subj, dict):
        return subj, None
    if isinstance(subj, list):
        out = {}
        for item in subj:
            if not isinstance(item, dict):
                continue
            name = item.get("name")
            qs = item.get("questions")
            if isinstance(name, str) and name.strip() and isinstance(qs, list):
                out[name] = qs
        if out:
            return out, None
        return None, ("subjects array me {name, questions: [...]} shape chahiye")
    return None, "subjects object nahi hai"


def _answer_letter(a, opts):
    """'B', 'b', 'B)', '(B)', 'Option B' ya poora option text -> 'B'."""
    if not isinstance(a, str):
        return None
    s = a.strip()
    m = re.fullmatch(r"(?:option\s*)?[\(\[]?([A-Za-z])[\)\].,:]?", s, re.IGNORECASE)
    if m:
        return m.group(1).upper()
    for i, o in enumerate(opts):
        if isinstance(o, str) and s and s == o.strip():
            return chr(65 + i)
    return None


def _prepare_question(q):
    """Question ko import-ready banao. Returns (qn, None) ya (None, reason)."""
    if not isinstance(q, dict):
        return None, "question object nahi hai"
    if not isinstance(q.get("q"), str) or not q["q"].strip():
        return None, "question text khali hai"
    qn = dict(q)

    opts = qn.get("options")
    if isinstance(opts, dict):              # {"A": "...", "B": "..."}
        opts = list(opts.values())
    if not isinstance(opts, list) or not (2 <= len(opts) <= 6):
        return None, "options list of strings nahi hai (2-6 chahiye)"
    if not all(isinstance(o, str) for o in opts):
        return None, "option string nahi hai"
    qn["options"] = opts

    letter = _answer_letter(qn.get("answer"), opts)
    if letter is None:
        return None, "answer single letter nahi hai (jaise \"B\")"
    if (ord(letter) - ord("A")) >= len(opts):
        return None, f"answer '{letter}' options ({len(opts)}) se bahar hai"
    qn["answer"] = letter
    return qn, None


def _derive_template(files):
    """Template nahi diya -> files me jitne subjects hain sab, bina cap ke."""
    names, doc_name = [], None
    for fname, raw in files:
        try:
            doc = parse_json_text(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            continue
        items = doc if isinstance(doc, list) else [doc]
        for it in items:
            if not isinstance(it, dict):
                continue
            if "subjects" in it:
                if doc_name is None and isinstance(it.get("name"), str):
                    doc_name = it["name"].strip() or None
                sm, _err = _normalise_subjects(it)
                if sm is None:
                    continue
            else:
                sm = it
            for k in sm:
                if k != "name" and k not in names:
                    names.append(k)
    return {"name": doc_name, "subjects": [{"name": n, "questions": 10**6} for n in names]}


def import_files(files, template=None):
    """files: list of (filename, bytes) tuples.
    template: full template dict (already validated).
    Returns dict: {test_id, name, counts:{subject:N}, used:{subject:N},
                   needed:{subject:N}, skipped: {file: [msgs]}, total, errors:[..]}
    """
    if template is None:
        template = _derive_template(files)
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
            doc = parse_json_text(text)
        except (UnicodeDecodeError, json.JSONDecodeError) as e:
            where = (f" line {e.lineno}, col {e.colno}"
                     if isinstance(e, json.JSONDecodeError) else "")
            skipped.setdefault(fname, []).append(f"JSON kharab:{where} — {e}")
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
            subj_map, shape_err = _normalise_subjects(d)
            if shape_err:
                skipped.setdefault(fname, []).append(shape_err)
                continue
            for sname, arr in subj_map.items():
                k = _ci_key(sname)
                if k not in pools:
                    skipped.setdefault(fname, []).append(f"'{sname}' subject template me nahi")
                    continue
                qs = _as_question_list(arr)
                if qs is None:
                    skipped.setdefault(fname, []).append(
                        f"{sname}: questions list nahi (list ya {{questions: [...]}} do)")
                    continue
                for i, q in enumerate(qs):
                    qn, why = _prepare_question(q)
                    if why:
                        skipped.setdefault(fname, []).append(f"{sname} Q{i + 1}: {why}")
                        continue
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