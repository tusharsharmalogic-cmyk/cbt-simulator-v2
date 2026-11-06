You are an expert exam-question writer. Create NEW multiple-choice questions for my CBT simulator app and give them to me as ONE valid JSON file in the exact format below.

## Question quality rules

1. Write original questions in the style and level of the exam named above. Do not copy questions word-for-word from any book or paper.
2. Every question must have exactly ONE correct option. Double-check the answer by solving it step by step before you write it. If you are not sure about a question, replace it with one you are sure about.
3. Wrong options (distractors) must be believable: common mistakes, wrong signs, wrong units, or close values. Avoid joke options.
4. Do not use "All of the above" or "None of the above" by default. Use either only when it is genuinely necessary and naturally fits the question.
5. Spread the correct answers evenly across A, B, C and D. Do not put the correct answer in the same position repeatedly.
6. Cover the given topics evenly and do not repeat the same idea or the same question twice.
7. Numerical questions: use clean values, state units, and make sure the options are clearly different from each other.
8. Facts, constants and formulas must be correct and standard. Do not invent data, names or references.
9. Add a `solution` for every question:
   - For simple questions, keep it short (usually one to three lines) and show the key step.
   - If a solution needs more explanation, explain the main concept first, then show clear step-by-step calculations or reasoning.
   - Do not forcefully shorten an explanation or skip necessary steps just to meet a line limit.
   - Avoid unnecessary derivations and lengthy explanations; include only what is needed to understand why the answer is correct.

## Output rules

1. Reply with ONLY the JSON. No explanation, no markdown fences, no text before or after it.
2. If the output is too long, stop at a clean question boundary and I will ask you to continue. Never cut a question in half.
3. The JSON must be 100% valid: double quotes only, no trailing commas, no comments.

## JSON format

```
{
  "name": "Test name",
  "subjects": {
    "Physics": [
      {
        "q": "Question text",
        "options": ["Option 1", "Option 2", "Option 3", "Option 4"],
        "answer": "B",
        "solution": "Short explanation",
        "svg": "<svg viewBox='0 0 100 60'>...</svg>"
      }
    ],
    "Chemistry": [ ... ]
  }
}
```

Field rules:

- `q` (required): the question text only. Do NOT write the question number ("Q1.", "1)") — the app adds it.
- `options` (required): a list of 2 to 6 strings (normally 4). Do NOT write the letters ("A)", "(b)") inside options — the app adds them.
- `answer` (required): ONE capital letter matching the position of the correct option: "A" = first option, "B" = second, and so on. Single-correct MCQ only.
- `solution` (preferred): required for every question. Keep simple solutions to one to three lines. For questions needing more explanation, give the main concept first, then clear necessary steps; do not forcefully shorten or omit important reasoning.
- `svg` (optional): only when the question truly needs a diagram — see SVG rules.
- Every subject in `subjects` is a list of question objects. Keep each subject's questions under that subject only.

## Maths, formulas and symbols (LaTeX)

- Write every formula in LaTeX: inline between single dollars `$...$`, big/standalone formulas between double dollars `$$...$$`. This works in `q`, `options` and `solution`.
- Inside JSON every backslash must be doubled. Write `\\frac{1}{2}`, `\\sin\\theta`, `\\int_0^1 x^2\\,dx`, `\\sqrt{x}`, `\\text{m/s}`. A single backslash will break the JSON.
- Use LaTeX for powers, subscripts, Greek letters, vectors, units and chemical formulas too: `$x^2$`, `$v_0$`, `$\\alpha$`, `$\\vec{F}$`, `$\\mathrm{H_2SO_4}$`.
- A literal dollar sign (currency) must be written as `\\$`.
- Line breaks inside text: use `\n` (never a real new line inside a string).

## Diagrams (SVG)

- Use a diagram only when the question cannot be understood without it (geometry, circuits, ray diagrams, graphs). Most questions need none.
- Diagrams go ONLY in the `svg` field of that question, as one inline SVG string. No image files, no .jpg/.png, no URLs, no base64.
- The root must be `<svg viewBox='0 0 W H'>` — `viewBox` is mandatory. Do not set `width` or `height`.
- Use single quotes for all attributes inside the SVG (so the JSON needs no extra escaping).
- Allowed: `line`, `polyline`, `polygon`, `rect`, `circle`, `ellipse`, `path`, `text`, `g`, `defs`, `marker`. Not allowed: `script`, `foreignObject`, `image`, event attributes (onclick etc.), external links.
- Colours: use `currentColor` for strokes and text (and `none` or `currentColor` for fills) so the diagram works in both light and dark theme. Use `stroke-width='2'` for main lines and `font-size='12'` for labels.
- Keep it clean and simple, with every label and value that the question text refers to. The diagram must match the question exactly.
- If a diagram would be too complex to draw correctly, change the question so it does not need one.
- Options that are diagrams are not supported.

## Example (valid, copy this style)

{"name":"Sample Test","subjects":{"Maths":[{"q":"Evaluate: $$\\int_0^1 x^2\\,dx$$","options":["$\\frac{1}{2}$","$\\frac{1}{3}$","$\\frac{1}{4}$","$1$"],"answer":"B","solution":"$\\left[\\frac{x^3}{3}\\right]_0^1=\\frac{1}{3}$"},{"q":"A triangle has sides $3, 4, 5$. Find its area.","svg":"<svg viewBox='0 0 120 100'><polygon points='10,80 110,80 10,20' fill='none' stroke='currentColor' stroke-width='2'/><text x='55' y='95' font-size='12' fill='currentColor'>4</text><text x='0' y='55' font-size='12' fill='currentColor'>3</text><text x='65' y='45' font-size='12' fill='currentColor'>5</text></svg>","options":["$6$","$12$","$10$","$8$"],"answer":"A","solution":"Right triangle: area $=\\frac{1}{2}\\times3\\times4=6$"}],"Physics":[{"q":"SI unit of force?","options":["Joule","Newton","Watt","Pascal"],"answer":"B","solution":"Force $F=ma$, so unit is kg m/s$^2$ = newton."}]}}

## Before you reply, check

- JSON is valid and every backslash is doubled.
- Each subject has exactly the number of questions I asked for.
- Every `answer` is one capital letter within the number of options, and you re-solved it.
- Correct answers are spread across A, B, C, D.
- "All of the above" / "None of the above" are used only when genuinely necessary.
- Every question has a solution that is concise when possible but includes all necessary reasoning.
- No question numbers or option letters inside `q` / `options`.
- Only the JSON is in the reply.

---

## Test details (edit these)

- Test name: [e.g. JEE Mock Test 3]
- Exam / syllabus: [e.g. JEE Main, class 11-12 NCERT level]
- Subjects and number of questions (use these exact subject names as keys):
  - [Physics: 25]
  - [Chemistry: 25]
  - [Maths: 25]
- Chapters / topics to cover: [e.g. Kinematics, Thermodynamics, Organic basics, Integrals — or "all chapters"]
- Difficulty: [easy / medium / hard / mixed (30% easy, 50% medium, 20% hard)]
- Language: [English / Hindi / Hinglish]
