"""GET /api/tests, GET /api/tests/<id>, GET /api/tests/<id>/validate?template=<tid>,
POST /api/tests/import (multipart: files[]=@f1 files[]=@f2 template_id=<tid> [name=..]),
POST /api/tests/paste ({json: "...", name?: "..."}) — pasted JSON ko seedha test bana kar save"""
import json

from flask import Blueprint, jsonify, request

from core import importer, template_store, test_loader

bp = Blueprint("tests", __name__, url_prefix="/api/tests")

_MAX_FILE_BYTES = 5 * 1024 * 1024   # 5 MB per file
_MAX_FILES = 50


@bp.get("")
def list_tests():
    return jsonify(test_loader.list_tests())


@bp.get("/<test_id>")
def get_test(test_id):
    t, err = test_loader.load_test_safe(test_id)
    if err:
        code = 404 if err == "Test nahi mila" or err == "Invalid test id" else 422
        return jsonify(error=err), code
    return jsonify(t)

@bp.delete("/<test_id>")
def delete_test(test_id):
    import config
    from core.test_loader import _path_for
    p = _path_for(test_id)
    if p is None:
        return jsonify(error="Invalid test id"), 422
    if not p.is_file():
        return jsonify(error="Test nahi mila"), 404
    try:
        p.unlink()
    except OSError as e:
        return jsonify(error=f"Delete fail: {e}"), 500
    try:
        from core.routes_schedule import remove_entry
        remove_entry(test_id)
    except Exception:
        pass
    try:
        from core.routes_testtpl import remove_entry as remove_tpl
        remove_tpl(test_id)
    except Exception:
        pass
    return jsonify(ok=True)

@bp.post("/merge")
def merge_tests():
    """Body: {"test_ids": ["id1", "id2"], "name": "New Test Name"}.

    Multiple tests ko merge karke ek naya test banata hai (subjects case-insensitive
    merge hote hain, questions dedupe hote hain). Naya test save hone ke baad
    purane test delete kar diye jaate hain.
    """
    body = request.get_json(silent=True) or {}
    test_ids = body.get("test_ids")
    name = (body.get("name") or "").strip()

    if not isinstance(test_ids, list) or len(test_ids) < 2:
        return jsonify(error="Kam se kam 2 tests select karo"), 422
    if not name:
        return jsonify(error="Naye test ka naam chahiye"), 422

    files = []
    for tid in test_ids:
        t, err = test_loader.load_test_safe(tid)
        if err:
            return jsonify(error=f"Test '{tid}' load nahi hua: {err}"), 404
        files.append((f"{tid}.json", json.dumps(t).encode("utf-8")))

    result = importer.import_files(files, None)
    if result["errors"]:
        return jsonify(errors=result["errors"]), 422

    new_id, saved_name = importer.save_imported_test(result["subjects"], name)

    # Purane tests delete karo
    from core.test_loader import _path_for
    for tid in test_ids:
        p = _path_for(tid)
        if p and p.is_file():
            try:
                p.unlink()
            except OSError:
                pass
    try:
        from core.routes_testtpl import remove_entry as remove_tpl
        for tid in test_ids:
            remove_tpl(tid)
    except Exception:
        pass

    return jsonify({"ok": True, "test_id": new_id, "test_name": saved_name})

@bp.post("/<test_id>/split")
def split_test(test_id):
    """Body: {"questions": [{"subject": "Physics", "index": 0}, ...]}.

    Selected questions ko (subject, chapter, topic) ke hisaab se group karke
    har group ka alag test banata hai. Original test delete NAHI hota.
    Name = "<Subject> - <Chapter> - <Topic>".
    """
    t, err = test_loader.load_test_safe(test_id)
    if err:
        code = 404 if err in ("Test nahi mila", "Invalid test id") else 422
        return jsonify(error=err), code

    body = request.get_json(silent=True) or {}

    # Custom groups: {"groups": [{"name": "...", "questions": [{"subject","index"}, ...]}]}
    # Ek group = ek naya test (kai topics/chapters ek saath ho sakte hain).
    custom = body.get("groups")
    if isinstance(custom, list) and custom:
        csubs = t.get("subjects") or {}
        made = []
        for g in custom:
            if not isinstance(g, dict):
                continue
            gname = g.get("name") if isinstance(g.get("name"), str) else ""
            gname = gname.strip()
            grefs = g.get("questions")
            if not isinstance(grefs, list):
                continue
            by_subj = {}
            for r in grefs:
                if not isinstance(r, dict):
                    continue
                sname = r.get("subject")
                idx = r.get("index")
                if not isinstance(sname, str) or not isinstance(idx, int) or isinstance(idx, bool):
                    continue
                cq = csubs.get(sname) or []
                if not (0 <= idx < len(cq)):
                    continue
                by_subj.setdefault(sname, []).append(cq[idx])
            if not by_subj:
                continue
            if not gname:
                gname = " + ".join(by_subj.keys())
            new_id, saved = importer.save_imported_test(by_subj, gname)
            made.append({
                "id": new_id, "name": saved,
                "count": sum(len(v) for v in by_subj.values()),
            })
        if not made:
            return jsonify(error="Split karne layak questions nahi mile"), 422
        return jsonify(ok=True, count=len(made), created=made)

    refs = body.get("questions")
    if not isinstance(refs, list) or not refs:
        return jsonify(error="questions list (non-empty) chahiye"), 422

    subs = t.get("subjects") or {}
    groups = {}
    for r in refs:
        if not isinstance(r, dict):
            continue
        sname = r.get("subject")
        idx = r.get("index")
        if not isinstance(sname, str) or not isinstance(idx, int) or isinstance(idx, bool):
            continue
        qs = subs.get(sname) or []
        if not (0 <= idx < len(qs)):
            continue
        q = qs[idx]
        ch_raw = q.get("chapter") if isinstance(q.get("chapter"), str) else ""
        tp_raw = q.get("topic") if isinstance(q.get("topic"), str) else ""
        ch = ch_raw.strip() or "Unknown"
        tp = tp_raw.strip() or "Unknown"
        groups.setdefault((sname, ch, tp), []).append(q)

    if not groups:
        return jsonify(error="Split karne layak questions nahi mile"), 422

    created = []
    for (sname, ch, tp), qs in groups.items():
        name = f"{sname} - {ch} - {tp}"
        new_id, saved = importer.save_imported_test({sname: qs}, name)
        created.append({
            "id": new_id, "name": saved, "subject": sname,
            "chapter": ch, "topic": tp, "count": len(qs),
        })

    return jsonify(ok=True, count=len(created), created=created)

@bp.post("/<test_id>/remove_question")
def remove_question(test_id):
    """Body: {"subject": "Physics", "index": 3}. Ek question hata kar test save.

    Index 0-based hai (JSON me subject array ka position). Save atomic hoti hai
    (`write_json_atomic`), isliye mid-write crash se file corrupt nahi hoti.
    """
    body = request.get_json(silent=True) or {}
    subject = body.get("subject")
    index = body.get("index")
    if not isinstance(subject, str) or not subject.strip():
        return jsonify(error="subject (non-empty string) chahiye"), 422
    if not isinstance(index, int) or isinstance(index, bool) or index < 0:
        return jsonify(error="index (>= 0 integer) chahiye"), 422

    t, err = test_loader.load_test_safe(test_id)
    if err:
        code = 404 if err in ("Test nahi mila", "Invalid test id") else 422
        return jsonify(error=err), code

    subs = t.get("subjects") if isinstance(t, dict) else None
    if not isinstance(subs, dict):
        return jsonify(error="Test me subjects valid nahi hain"), 422
    qs = subs.get(subject)
    if not isinstance(qs, list):
        return jsonify(error=f"Subject '{subject}' test me nahi mila"), 404
    if not (0 <= index < len(qs)):
        return jsonify(error=f"Index {index} out of range (0-{len(qs) - 1})"), 422

    from core.storage import write_json_atomic
    from core.test_loader import _path_for
    removed = qs.pop(index)
    write_json_atomic(_path_for(test_id), t)
    return jsonify(
        ok=True,
        subject=subject,
        removed_q=(removed or {}).get("q", ""),
        remaining=len(qs),
    )


@bp.get("/<test_id>/validate")
def validate(test_id):
    test, err = test_loader.load_test_safe(test_id)
    if err:
        code = 404 if err in ("Test nahi mila", "Invalid test id") else 422
        return jsonify(errors=[err], warnings=[]), code

    template = None
    tid = request.args.get("template")
    if tid:
        template = template_store.get_template(tid)
        if template is None:
            return jsonify(errors=[f"Template '{tid}' nahi mila"], warnings=[]), 404

    result = test_loader.validate_test(test, template)
    return jsonify(result)


@bp.post("/import")
def import_tests():
    """Multipart: files[]=... template_id=<tid> [name=<custom name>]

    Merge multiple JSONs, group by subject (ci), cap by template count,
    dedupe, save. Return summary + new test id so frontend can Start."""
    template_id = request.form.get("template_id")
    custom_name = (request.form.get("name") or "").strip()
    uploads = request.files.getlist("files[]") or request.files.getlist("files")

    if not uploads:
        return jsonify(error="Koi .json file select nahi ki"), 422
    if len(uploads) > _MAX_FILES:
        return jsonify(error=f"Max {_MAX_FILES} files ek baar me"), 422

    template = None
    if template_id:
        template = template_store.get_template(template_id)
        if template is None:
            return jsonify(error="Template nahi mila"), 404

    files = []
    rejected_names = []
    for f in uploads:
        fname = f.filename or "upload.json"
        if not fname.lower().endswith(".json"):
            rejected_names.append(fname)
            continue
        raw = f.read(_MAX_FILE_BYTES + 1)
        if len(raw) > _MAX_FILE_BYTES:
            rejected_names.append(fname + " (5MB se bada)")
            continue
        files.append((fname, raw))

    if not files:
        return jsonify(error="Sirf .json files allowed", rejected=rejected_names), 422

    derived = template is None
    result = importer.import_files(files, template)
    if template is None:
        template = {"name": importer._derive_template(files).get("name")
                    or files[0][0].rsplit(".", 1)[0]}
    if result["errors"]:
        return jsonify(errors=result["errors"], skipped=result.get("skipped", {}),
                       counts=result.get("counts", {}), needed=result.get("needed", {})), 422

    if derived:
        default_name = template.get("name") or "Imported"
    else:
        default_name = f"{(template.get('name') or 'Imported')} — {time_str()}"
    final_name = custom_name or default_name
    test_id, saved_name = importer.save_imported_test(result["subjects"], final_name)

    return jsonify({
        "test_id": test_id,
        "test_name": saved_name,
        "counts": result["counts"],
        "used": result["used"],
        "needed": result["needed"],
        "total": result["total"],
        "skipped": result.get("skipped", {}),
        "rejected": rejected_names,
    })


@bp.post("/paste")
def paste_test():
    """JSON text paste karke test save karo (file upload ki zaroorat nahi).

    Body: {"json": "<test json text>", "name": "optional"}
    Test ka naam: body.name > JSON ka "name" > "Pasted Test".
    """
    body = request.get_json(silent=True) or {}
    text = body.get("json")
    if not isinstance(text, str) or not text.strip():
        return jsonify(error="JSON text khali hai"), 422
    if len(text.encode("utf-8")) > _MAX_FILE_BYTES:
        return jsonify(error="JSON 5MB se bada hai"), 422
    try:
        doc = importer.parse_json_text(text)
    except json.JSONDecodeError as e:
        return jsonify(error=f"JSON kharab hai: line {e.lineno}, col {e.colno}: {e.msg}"), 422

    name = (body.get("name") or "").strip()
    if not name and isinstance(doc, dict) and isinstance(doc.get("name"), str):
        name = doc["name"].strip()

    raw = json.dumps(doc, ensure_ascii=False).encode("utf-8")
    result = importer.import_files([("pasted.json", raw)], None)
    if result["errors"]:
        return jsonify(errors=result["errors"], skipped=result.get("skipped", {})), 422

    test_id, saved_name = importer.save_imported_test(result["subjects"], name or "Pasted Test")
    return jsonify({
        "test_id": test_id,
        "test_name": saved_name,
        "counts": result["counts"],
        "used": result["used"],
        "total": result["total"],
        "skipped": result.get("skipped", {}),
    }), 201


def time_str():
    import time
    return time.strftime("%Y-%m-%d %H:%M")

# ---------- custom test from ALL available tests (filters) ----------

_DIFFS = ("easy", "medium", "hard")

def _diff_of(q):
    d = q.get("difficulty")
    d = d.strip().lower() if isinstance(d, str) else ""
    return d if d in _DIFFS else "unknown"

def _lab(v):
    return v.strip() if isinstance(v, str) and v.strip() else "Unknown"

def _collect_pool():
    """Saare tests ke questions (subject case-insensitive merge, duplicates hata ke).
    Returns list of (subject, question)."""
    seen = set()
    canon = {}      # ci subject -> first-seen display name
    out = []
    for item in test_loader.list_tests():
        if item.get("error"):
            continue
        t, err = test_loader.load_test_safe(item["id"])
        if err or not isinstance(t, dict):
            continue
        for sname, qs in (t.get("subjects") or {}).items():
            if not isinstance(qs, list):
                continue
            disp = canon.setdefault(importer._ci_key(sname), sname)
            for q in qs:
                if not isinstance(q, dict):
                    continue
                k = (importer._ci_key(disp), importer._dedupe_key(q))
                if k in seen:
                    continue
                seen.add(k)
                out.append((disp, q))
    return out

@bp.get("/pool")
def pool():
    """Filters ke liye compact list: [{s, c, t, d}, ...] saare tests se."""
    items = [{"s": s, "c": _lab(q.get("chapter")), "t": _lab(q.get("topic")),
              "d": _diff_of(q)} for s, q in _collect_pool()]
    return jsonify(items=items)

@bp.post("/custom")
def custom_test():
    """Body: {"subjects": [], "chapters": [], "topics": [], "difficulties": [], "name": ""}.
    Khaali list = us filter pe koi restriction nahi. Match hue questions se naya test save."""
    body = request.get_json(silent=True) or {}

    def lst(k):
        v = body.get(k)
        return {x for x in v if isinstance(x, str)} if isinstance(v, list) else set()

    sS, cS, tS, dS = lst("subjects"), lst("chapters"), lst("topics"), lst("difficulties")
    by_subj = {}
    for s, q in _collect_pool():
        if sS and s not in sS:
            continue
        if cS and _lab(q.get("chapter")) not in cS:
            continue
        if tS and _lab(q.get("topic")) not in tS:
            continue
        if dS and _diff_of(q) not in dS:
            continue
        by_subj.setdefault(s, []).append(q)

    if not by_subj:
        return jsonify(error="Is filter se koi question nahi mila"), 422

    name = body.get("name") if isinstance(body.get("name"), str) else ""
    name = name.strip()[:80] or ("Custom - " + " + ".join(by_subj.keys()))
    new_id, saved = importer.save_imported_test(by_subj, name)
    return jsonify(ok=True, test_id=new_id, test_name=saved,
                   total=sum(len(v) for v in by_subj.values()))