"""GET/PUT/DELETE /api/prompt/<key> — AI prompts (Setting me dikhte hain).
key: photos (AI_PROMPT.md) | generate (AI_PROMPT_GENERATE.md). /api/prompt = photos.

User edit save kare to data/<same name> me jaata hai (default file kabhi nahi badalti). DELETE = user edit hatao, default pe wapas.
"""
import os
import tempfile

from flask import Blueprint, jsonify, request

import config

bp = Blueprint("prompt", __name__, url_prefix="/api/prompt")

_MAX_CHARS = 100_000


def _files(key):
    return config.PROMPTS.get(key)


def _read_default(key):
    try:
        return _files(key)[0].read_text(encoding="utf-8")
    except OSError:
        return ""


def _read_user(key):
    try:
        return _files(key)[1].read_text(encoding="utf-8")
    except OSError:
        return None


def _write_atomic(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".tmp_", suffix=".md")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
            f.flush()
            try:
                os.fsync(f.fileno())
            except OSError:
                pass
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _view(key):
    user = _read_user(key)
    return {"key": key, "text": user if user is not None else _read_default(key),
            "edited": user is not None}


def _bad_key():
    return jsonify(error="Unknown prompt"), 404


@bp.get("", defaults={"key": "photos"})
@bp.get("/<key>")
def get_prompt(key):
    if _files(key) is None:
        return _bad_key()
    return jsonify(_view(key))


@bp.put("", defaults={"key": "photos"})
@bp.put("/<key>")
def put_prompt(key):
    if _files(key) is None:
        return _bad_key()
    body = request.get_json(silent=True) or {}
    text = body.get("text")
    if not isinstance(text, str) or not text.strip():
        return jsonify(error="Prompt khali nahi ho sakta"), 422
    if len(text) > _MAX_CHARS:
        return jsonify(error="Prompt bahut lamba hai"), 422
    _write_atomic(_files(key)[1], text)
    return jsonify(_view(key))


@bp.delete("", defaults={"key": "photos"})
@bp.delete("/<key>")
def reset_prompt(key):
    if _files(key) is None:
        return _bad_key()
    try:
        _files(key)[1].unlink()
    except FileNotFoundError:
        pass
    return jsonify(_view(key))
