"""Progress API (read-only): GET /api/progress."""
from flask import Blueprint, jsonify

from core import progress

bp = Blueprint("progress", __name__, url_prefix="/api/progress")


@bp.get("")
def get_progress():
    return jsonify(progress.build())