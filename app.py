"""Flask entry point.

Chalane ke liye:
    python app.py              # http://127.0.0.1:8080
    python app.py 3000         # custom port
    python app.py --host 0.0.0.0
"""
import argparse

from flask import Flask, jsonify, render_template

import config
from core.routes_attempt import bp as attempts_bp
from core.routes_progress import bp as progress_bp
from core.routes_prompt import bp as prompt_bp
from core.routes_schedule import bp as schedule_bp
from core.routes_settings import bp as settings_bp
from core.routes_templates import bp as templates_bp
from core.routes_testtpl import bp as testtpl_bp
from core.routes_tests import bp as tests_bp


def create_app():
    config.ensure_dirs()
    app = Flask(__name__, static_folder="static", template_folder="templates")
    # Dev: static files ko browser cache na kare (CSS/JS changes turant dikhein)
    app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0
    app.config['TEMPLATES_AUTO_RELOAD'] = True
    app.json.sort_keys = False      # subjects ka user wala order (Physics, Chem, ...) bana rahe
    app.json.ensure_ascii = False   # Hindi/unicode as-is

    app.register_blueprint(tests_bp)
    app.register_blueprint(templates_bp)
    app.register_blueprint(settings_bp)
    app.register_blueprint(attempts_bp)
    app.register_blueprint(progress_bp)
    app.register_blueprint(prompt_bp)
    app.register_blueprint(schedule_bp)
    app.register_blueprint(testtpl_bp)

    @app.route("/")
    def index():
        return render_template("index.html")

    @app.route("/api/health")
    def health():
        return jsonify(ok=True)

    return app


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("port", nargs="?", type=int, default=config.PORT)
    ap.add_argument("--host", default=config.HOST)
    args = ap.parse_args()
    create_app().run(host=args.host, port=args.port, debug=False)
