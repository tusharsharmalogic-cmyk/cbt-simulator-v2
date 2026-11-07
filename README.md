# CBT Simulator

Customisable CBT (computer-based test) simulator — Flask backend + plain JS frontend, mobile-first, Termux friendly.

Single user, no login, no database: saara data `data/` folder me JSON files ke roop me rehta hai.

## Run

    python app.py                # http://127.0.0.1:8080
    python app.py 3000           # custom port
    python app.py --host 0.0.0.0 # LAN pe kholna

Open http://127.0.0.1:8080 on phone browser. Sirf `flask` chahiye (`pip install -r requirements.txt`), Python 3.1x.

## Features

**Templates (exam pattern)**
- Subject-wise question count, `+marks` / `−negative`, total minutes.
- Per-subject optional time lock — ya to per-question seconds, ya subject ke minutes (dono ek saath nahi).
- Save/delete/edit, slug id auto-generate (clash pe `_2`, `_3`), strict server-side validation.

**Tests (question banks)**
- Koi bhi `.json` test import karo — ek ya multiple files, subject match case-insensitive ("Physics" = "physics").
- Merge + dedupe (same `q` + same options), template ke count se cap, skip-report (kaunsa question kyun chhoda).
- Available Tests screen: search, accordion detail, per-test preview (LaTeX/SVG render check), delete.
- Import do jagah se: Setup screen (template ke saath, capped) aur Available Tests (bina template — subjects file se derive hote hain).

**Attempts (test lena)**
- Setup pe ek template + ek ya zyada tests chuno; multiple tests subject-wise merge hote hain.
- Attempt server pe banta hai: questions ka snapshot, timer start, answers server-side.
- Timer **server-authoritative** hai; client sirf countdown dikhata hai, har 30 s aur tab-focus pe resync.
- In-progress test home pe "Resume Test" chip se khulta hai, discard button se delete hota hai.
- Per-question / per-subject locks server pe enforce hote hain: locked question pe 409 + agla unlocked question (auto-jump). Sab locked ho jaye to auto-submit (`all_locked`), time khatam to `time_up`.
- Answers/marks/visited/time-spent server pe save; time usi question me jaata hai jis par kharch hua (navigate, lock-expiry aur submit par flush hota hai). In-progress view me `answer`/`solution` client ko bheje hi nahi jaate.

**Exam UI**
- Question palette (bottom sheet): subject-wise grid, answered / not answered / marked / not visited / locked states, jump-to-question.
- Prev / Next / Mark / Clear / Submit confirmation (answered-marked-blank counts ke saath).
- SVG diagrams sanitize hoke render hote hain; LaTeX MathJax (local vendor, CDN nahi).

**Result**
- Total + subject-wise score, max, correct/wrong/blank, accuracy, time spent.
- All/Correct/Wrong/Blank filter, expandable per-question review with solution.
- Time-up aur all-locked auto-submit reason dikhte hain.

**Settings**
- Theme: system / light / dark (server pe save, reload ke baad bhi).
- Do editable AI prompts — photos se test JSON banane wala aur bina photo ke naye questions banane wala. Edit `data/` me save hota hai, default file kabhi overwrite nahi hoti; reset se default wapas.

## Layout

    app.py                  # create_app(), blueprints, /, /api/health, CLI (port, --host)
    config.py               # paths, data dirs, default host/port, prompt file mapping
    requirements.txt        # flask (only dependency)

    core/
      storage.py            # read_json + write_json_atomic (temp -> fsync -> replace)
      test_loader.py        # list/load tests + validate_test(test, template)
      template_store.py     # template CRUD, validation, slug ids, lock-mode rules
      importer.py           # multi-file import: merge, dedupe, cap, derive template
      attempt_store.py      # attempt create/save/finalize, client view (answers stripped)
      timer.py              # total/subject windows + per-question/subject locks (pure)
      scoring.py            # subject-wise scoring + per-question rows (pure)
      routes_tests.py       # /api/tests ...
      routes_templates.py   # /api/templates ...
      routes_settings.py    # /api/settings ...
      routes_attempt.py     # /api/attempts ... (answer/mark/visit/submit, 409 handling)
      routes_prompt.py      # /api/prompt/<key> (view/edit/reset)

    data/
      templates/<id>.json   # exam patterns
      tests/<id>.json       # question banks
      attempts/<id>.json    # created at test start
      settings.json
      AI_PROMPT.md, AI_PROMPT_GENERATE.md   # only if user edited them

    static/
      css/                  # base.css, layout.css, components.css (mobile-first, light+dark)
      js/                   # api, state, svg, question, builder, setup, palette,
                            # test, result, main (hash router), mathjax-config
      vendor/mathjax/tex-svg.js
    templates/index.html    # single page shell
    tests/                  # unittest + Flask test_client

Runtime JSON, settings aur edited prompts gitignored hain — repo me sirf `.gitkeep` rehta hai.

## Data formats

Test (`data/tests/<id>.json`):

    {
      "name": "IMU-CET Mock Test 1",
      "subjects": {
        "Physics": [
          {"q": "SI unit of force?", "options": ["Joule", "Newton", "Watt", "Pascal"],
           "answer": "B", "solution": "Force ka SI unit newton hai.",
           "svg": "<svg viewBox='0 0 100 60'>...</svg>"}
        ]
      }
    }

Rules: `q` non-empty, 2–6 string options, `answer` ek capital letter options ke andar, `solution` optional (warning), `svg` optional but valid `<svg>` with `viewBox`. Template (`data/templates/<id>.json`) me `name`, `timer_mode`, `total_minutes`, aur per subject `name`, `questions`, `marks`, `negative`, plus optional `lock_mode` / `per_question_seconds` / `subject_minutes`.

## API

| Method | Path | Kaam |
|---|---|---|
| GET | `/api/health` | `{ok: true}` |
| GET | `/api/tests` | summaries (broken file pe `error` key) |
| GET | `/api/tests/<id>` | pura test |
| DELETE | `/api/tests/<id>` | test delete |
| GET | `/api/tests/<id>/validate?template=<tid>` | `{errors, warnings}` |
| POST | `/api/tests/import` | multipart `files[]`, optional `template_id`, `name` |
| GET | `/api/templates` | summaries |
| GET/PUT/DELETE | `/api/templates/<id>` | `PUT` me `id="new"` = create |
| GET/PUT | `/api/settings` | `{theme}` |
| GET | `/api/attempts` | summaries (newest first) |
| POST | `/api/attempts` | `{template_id, test_ids: []}` |
| GET/DELETE | `/api/attempts/<id>` | GET time-up/all-locked auto-finalize karta hai |
| POST | `/api/attempts/<id>/answer` | `{subject, index, choice}` (`choice: null` = clear) |
| POST | `/api/attempts/<id>/mark` | `{subject, index, marked}` |
| POST | `/api/attempts/<id>/visit` | `{subject, index, spent, from_subject?, from_index?}` — `spent` pichhle question ka, naya `subject/index` visit hota hai (0–600 s clamp) |
| POST | `/api/attempts/<id>/submit` | optional `{subject, index, spent}` flush + finalize + scoring |
| GET/PUT/DELETE | `/api/prompt` / `/api/prompt/<key>` | `photos` (default) ya `generate` |

Mutation errors: `409` submitted / time_up / subject_locked / question_locked (locked response me `next` aur fresh `view` bhi hota hai), `422` validation.

## Tests

    python -m unittest discover -s tests

102 tests (0.9 s) — importer, validator, templates + settings routes, scoring, attempt lifecycle (strip/auto-submit/timer/subject mode), time attribution, lock flow, skip-empty. Tests temp data dir use karte hain, real `data/` touch nahi hota.

## Hard rules

- No browser storage (state in JS memory only; persistence goes to `data/`).
- Atomic JSON writes; attempt writes under a lock (single process).
- Only flask as dependency. No npm, no CDN.
- Plain script tag JS, `textContent` only for user text, SVG via `sanitizeSvg()`, LaTeX via `typeset()`.
- IDs = filename slugs `^[A-Za-z0-9_\-]+$` (path traversal blocked).
- Mobile-first at 390px, light + dark (system + user override).
- CSS/JS change karne ke baad `index.html` ke `?v=` cache-bust number badhao, warna phone browser purana file cache kar sakta hai.

## Known behaviour / limitations

- Single user, no auth. Default bind `127.0.0.1`; `--host 0.0.0.0` karte hi tests/attempts network pe accessible ho jaate hain.
- Locks `threading.Lock` hain — sirf ek Flask process ke andar safe, multi-worker deployment ke liye nahi.
- Submit pe source test JSON file(s) **delete** ho jaati hain; unanswered questions se `<test_id>_unanswered.json` ban jaata hai. Wahi test dobara dene ke liye file wapas import karni padegi.
- UI sirf total timer aur per-subject lock modes deta hai; backend `timer_mode: "subject"` (global subject-wise windows) bhi support karta hai.
- AI prompts me hi question generation ke rules hain — app khud koi AI call nahi karta.
