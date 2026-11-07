# AI Prompt — Book photos se CBT test JSON banane ke liye

(Is poore text ko AI ko do, saath me apni book/notes ki photos attach karo.
Neeche `[...]` wali jagah apne hisaab se badal lo.)

---

You are helping me build a multiple-choice test for my CBT simulator app. I will attach photos of pages from my book (questions, options, and sometimes diagrams). Read every question carefully and convert them into ONE valid JSON file in the exact format below.

## Test details (edit these)

- Test name: [e.g. IMU-CET Mock Test 1]
- Subjects in this batch: [e.g. Physics, Chemistry, Maths]  (use these exact subject names as keys)
- Language: keep the questions in the same language as the book.

## Output rules

1. Reply with ONLY the JSON. No explanation, no markdown fences, no text before or after it.
2. If the output is too long, stop at a clean question boundary and I will ask you to continue. Never cut a question in half.
3. The JSON must be 100% valid: double quotes only, no trailing commas, no comments.

## JSON format

The shape is fixed — copy it exactly:

- `subjects` is a JSON **object** (curly braces), keyed by subject name — never an array.
- Each subject's value is an **array** of question objects — never a single object.
- `options` is an **array of strings** — never an object like `{"A": "...", "B": "..."}`.
- `answer` is **one capital letter** pointing at the option position (`"A"` = first option). Never `"Option B"`, `"B)"`, `2`, or the option text.
- Do not wrap the document in `{"test": ...}` or `{"data": ...}`; the top level is `name` + `subjects`.

```
{
  "name": "Test name",
  "subjects": {
    "Physics": [
      {
        "q": "Question text",
        "options": ["Option 1", "Option 2", "Option 3", "Option 4"],
        "answer": "B",
        "solution": "Short explanation (optional but preferred)",
        "svg": "<svg viewBox='0 0 100 60'>...</svg>",
        "chapter": "Rotational Motion",
        "topic": "Moment of inertia",
        "difficulty": "medium"
      }
    ],
    "Chemistry": [ ... ]
  }
}
```

Field rules:

- `q` (required): the question text only. Do NOT write the question number ("Q1.", "1)") — the app adds it.
- `options` (required): a list of 2 to 6 strings (normally 4). Do NOT write the letters ("A)", "(b)") inside options — the app adds them.
- `answer` (required): ONE capital letter matching the position of the correct option: "A" = first option, "B" = second, and so on. Single-correct MCQ only. If the book gives an answer key, use it. If it does not, solve the question yourself carefully.
- `solution` (optional): one or two lines explaining the answer.
- `svg` (optional): only when the question has a diagram — see SVG rules.
- `chapter` (preferred): the chapter this question belongs to. Use the chapter name printed in the book (heading/page header); if it is not visible, use the standard syllabus chapter name. Spell it IDENTICALLY every time (always "Rotational Motion", never "Rotation" or "Rotational motion") — the app groups questions by exact text for chapter-wise analysis.
- `topic` (preferred): the specific topic inside that chapter, 2-4 words (e.g. "Moment of inertia", "Rolling motion"). Reuse the same topic name for similar questions so each topic gets several questions; do NOT invent a new unique topic for every question.
- `difficulty` (preferred): exactly one of `"easy"`, `"medium"`, `"hard"` (lowercase). Judge honestly: easy = direct formula/fact, medium = 2-3 steps, hard = multi-concept or lengthy calculation.
- Every subject in `subjects` is a list of question objects. Keep each subject's questions under that subject only.
- Do not repeat the same question twice.
- Skip a question if the photo is too blurry to read it with confidence. Do NOT guess or invent missing text, options or numbers.
- Numerical-answer, multi-correct, match-the-column and assertion-reason questions: convert them into single-correct MCQ only if the book already gives options; otherwise skip them.

## Maths, formulas and symbols (LaTeX)

- Write every formula in LaTeX: inline between single dollars `$...$`, big/standalone formulas between double dollars `$$...$$`. This works in `q`, `options` and `solution`.
- Inside JSON every backslash must be doubled. Write `\\frac{1}{2}`, `\\sin\\theta`, `\\int_0^1 x^2\\,dx`, `\\sqrt{x}`, `\\text{m/s}`. A single backslash will break the JSON.
- Use LaTeX for powers, subscripts, Greek letters, vectors, units and chemical formulas too: `$x^2$`, `$v_0$`, `$\\alpha$`, `$\\vec{F}$`, `$\\mathrm{H_2SO_4}$`.
- A literal dollar sign (currency) must be written as `\\$`.
- Line breaks inside text: use `\n` (never a real new line inside a string).

## Diagrams (SVG)

- Diagrams go ONLY in the `svg` field of that question, as one inline SVG string. No image files, no .jpg/.png, no URLs, no base64.
- The root must be `<svg viewBox='0 0 W H'>` — `viewBox` is mandatory. Do not set `width` or `height`.
- Use single quotes for all attributes inside the SVG (so the JSON needs no extra escaping).
- Allowed: `line`, `polyline`, `polygon`, `rect`, `circle`, `ellipse`, `path`, `text`, `g`, `defs`, `marker`. Not allowed: `script`, `foreignObject`, `image`, event attributes (onclick etc.), external links.
- Colours: use `currentColor` for strokes and text (and `none` or `currentColor` for fills) so the diagram works in both light and dark theme. Use `stroke-width='2'` for main lines and `font-size='12'` for labels.
- Keep it clean and simple: the same labels, values and proportions as the book. Do not add anything that is not in the original diagram.
- If a diagram is too complex to redraw faithfully, skip that question.
- Options that are diagrams are not supported; skip such questions.

## Example (valid, copy this style)

{"name":"Sample Test","subjects":{"Maths":[{"q":"Evaluate: $$\\int_0^1 x^2\\,dx$$","chapter":"Definite Integrals","topic":"Power rule","difficulty":"easy","options":["$\\frac{1}{2}$","$\\frac{1}{3}$","$\\frac{1}{4}$","$1$"],"answer":"B","solution":"$\\left[\\frac{x^3}{3}\\right]_0^1=\\frac{1}{3}$"},{"q":"A triangle has sides $3, 4, 5$. Find its area.","chapter":"Triangles","topic":"Area of right triangle","difficulty":"medium","svg":"<svg viewBox='0 0 120 100'><polygon points='10,80 110,80 10,20' fill='none' stroke='currentColor' stroke-width='2'/><text x='55' y='95' font-size='12' fill='currentColor'>4</text><text x='0' y='55' font-size='12' fill='currentColor'>3</text><text x='65' y='45' font-size='12' fill='currentColor'>5</text></svg>","options":["$6$","$12$","$10$","$8$"],"answer":"A","solution":"Right triangle: area $=\\frac{1}{2}\\times3\\times4=6$"}],"Physics":[{"q":"SI unit of force?","chapter":"Units and Dimensions","topic":"SI units","difficulty":"easy","options":["Joule","Newton","Watt","Pascal"],"answer":"B"}]}}

## Common mistakes that break the import (avoid all of these)

- **Markdown fence**: no code fence around the JSON (no backtick block), and no "Here is the JSON" line before it.
- **Single backslash in LaTeX**: write `"$\\sqrt{2}$"` (doubled) — a single `"$\sqrt{2}$"` breaks the JSON. Same for `\\frac`, `\\theta`, `\\times`, `\\vec`, `\\text`.
- **Trailing comma**: `{"answer": "B",}` is invalid — the last item never has a comma after it.
- **Real line break inside a string**: use `\\n`, never press Enter inside `"q"`, `"solution"` or an option.
- **`subjects` as array**: `{"subjects": [{"name": "Physics", ...}]}` is the wrong shape; use `{"subjects": {"Physics": [...]}}`.
- **`options` as object**: use `["...", "..."]`, not `{"A": "...", "B": "..."}`.
- **`answer` as number/label**: use `"B"`, not `1`, `"B)"`, `"Option B"` or the full option text.
- **Comments and single-quoted keys**: `// ...` and `'name':` are not valid JSON.
- **Placeholders**: never copy `...` from the format example into the real output.
- Use straight quotes `"` only — curly/smart quotes (`“ ”`) break the JSON.

## Before you reply, check

- Only JSON in the reply — no fence, no explanation.
- JSON is valid, every backslash is doubled, and there is no trailing comma.
- `subjects` is an object, each subject is an array, `options` is an array, `answer` is one letter.
- Every `answer` is one capital letter within the number of options.
- Every question has `chapter`, `topic` and `difficulty` (`easy` / `medium` / `hard`), and the same chapter/topic is spelled identically everywhere.
- No question numbers or option letters inside `q` / `options`.
- Subject names match the list I gave.
- Only the JSON is in the reply.
