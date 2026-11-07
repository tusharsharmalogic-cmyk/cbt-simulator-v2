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