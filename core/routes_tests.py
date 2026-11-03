"""GET /api/tests, GET /api/tests/<id>, GET /api/tests/<id>/validate?template=<tid>,
POST /api/tests/import (multipart: files[]=@f1 files[]=@f2 template_id=<tid> [name=..])"""
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

    if not template_id:
        return jsonify(error="template_id chahiye"), 422
    if not uploads:
        return jsonify(error="Koi .json file select nahi ki"), 422
    if len(uploads) > _MAX_FILES:
        return jsonify(error=f"Max {_MAX_FILES} files ek baar me"), 422

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

    result = importer.import_files(files, template)
    if result["errors"]:
        return jsonify(errors=result["errors"], skipped=result.get("skipped", {}),
                       counts=result.get("counts", {}), needed=result.get("needed", {})), 422

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


def time_str():
    import time
    return time.strftime("%Y-%m-%d %H:%M")