# CBT Simulator

Customisable CBT (computer-based test) simulator — Flask backend + plain JS frontend, mobile-first, Termux friendly.

## Run

    python app.py                # http://127.0.0.1:8080
    python app.py 3000           # custom port
    python app.py --host 0.0.0.0 # LAN pe kholna

Open http://127.0.0.1:8080 on phone browser.

## Progress

- [x] Step 1 — Flask scaffold, test loader, preview UI
- [x] Step 2 — Exam Template Builder + Settings (theme)
- [ ] Step 3 — Test validator + Setup screen
- [ ] Step 4 — Test screen (UI)
- [ ] Step 5 — Server-side attempts + timer + submit
- [ ] Step 6 — Scoring + Result
- [ ] Step 7 — AI_PROMPT.md

## Layout

    app.py / config.py / requirements.txt
    core/
      storage.py            # read_json + write_json_atomic (temp -> fsync -> replace)
      test_loader.py        # list_tests, load_test  (Step 3: validate_test)
      template_store.py     # CRUD + validation
      routes_tests.py       # GET /api/tests, /api/tests/<id>
      routes_templates.py   # GET/PUT/DELETE /api/templates
      routes_settings.py    # GET/PUT /api/settings
      attempt_store.py, routes_attempt.py, timer.py, scoring.py  (stubs)
    data/{templates,tests,attempts}/   # JSON files
    static/{css,js,vendor}/            # vendor/MathJax only
    templates/index.html
    tests/                             # unittest + Flask test_client

## Tests

    python -m unittest discover -s tests

## Hard rules

- No browser storage (state in JS memory only; persistence goes to data/).
- Atomic JSON writes; attempt writes under a lock.
- Only flask as dependency. No npm, no CDN.
- Plain script tag JS, textContent only for user text, SVG via sanitizeSvg(), LaTeX via typeset().
- IDs = filename slugs ^[A-Za-z0-9_\\-]+$.
- Mobile-first at 390px, light + dark (system + user override).