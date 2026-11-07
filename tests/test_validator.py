"""Test validator + /api/tests/<id>/validate route."""
import json
import unittest

import config
from tests._base import TempDataCase


GOOD_SVG = "<svg viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'><circle cx='50' cy='50' r='40' stroke='currentColor' fill='none'/></svg>"


def good_test(subjects=None):
    if subjects is None:
        subjects = {
            "Physics": [
                {"q": "Q1", "options": ["A", "B", "C", "D"], "answer": "A", "solution": "S"},
                {"q": "Q2", "options": ["A", "B"], "answer": "B", "solution": "S"},
            ],
            "Chemistry": [
                {"q": "C1", "options": ["A", "B", "C"], "answer": "C", "solution": "S"},
            ],
        }
    return {"name": "T", "subjects": subjects}


def template(needed=None):
    needed = needed or {"Physics": 2, "Chemistry": 1}
    return {
        "name": "T", "timer_mode": "total", "total_minutes": 60,
        "subjects": [
            {"name": n, "questions": q, "marks": 4, "negative": 1, "minutes": None}
            for n, q in needed.items()
        ],
    }


class ValidatorTest(unittest.TestCase):
    def v(self, test, tmpl=None):
        from core.test_loader import validate_test
        return validate_test(test, tmpl)

    def test_good_no_template(self):
        r = self.v(good_test())
        self.assertEqual(r["errors"], [])

    def test_good_with_template(self):
        r = self.v(good_test(), template())
        self.assertEqual(r["errors"], [])

    def test_missing_subject(self):
        t = good_test()
        del t["subjects"]["Chemistry"]
        r = self.v(t, template())
        self.assertTrue(any("Chemistry" in e and "missing" in e for e in r["errors"]))

    def test_too_few_questions(self):
        t = good_test()
        t["subjects"]["Physics"] = t["subjects"]["Physics"][:1]
        r = self.v(t, template())
        self.assertTrue(any("Physics" in e and "2 chahiye" in e for e in r["errors"]))

    def test_extra_questions_warning(self):
        t = good_test()
        t["subjects"]["Physics"].append(
            {"q": "Q3", "options": ["A", "B"], "answer": "A", "solution": "S"})
        r = self.v(t, template())
        self.assertEqual(r["errors"], [])
        self.assertTrue(any("extra ignore" in w for w in r["warnings"]))

    def test_empty_q(self):
        t = good_test()
        t["subjects"]["Physics"][0]["q"] = ""
        r = self.v(t)
        self.assertTrue(any("Q1" in e and "khali" in e for e in r["errors"]))

    def test_too_few_options(self):
        t = good_test()
        t["subjects"]["Physics"][0]["options"] = ["A"]
        r = self.v(t)
        self.assertTrue(any("2 se 6" in e for e in r["errors"]))

    def test_too_many_options(self):
        t = good_test()
        t["subjects"]["Physics"][0]["options"] = ["A", "B", "C", "D", "E", "F", "G"]
        r = self.v(t)
        self.assertTrue(any("2 se 6" in e for e in r["errors"]))

    def test_option_not_string(self):
        t = good_test()
        t["subjects"]["Physics"][0]["options"] = ["A", 5]
        r = self.v(t)
        self.assertTrue(any("string nahi" in e for e in r["errors"]))

    def test_answer_missing(self):
        t = good_test()
        del t["subjects"]["Physics"][0]["answer"]
        r = self.v(t)
        self.assertTrue(any("answer" in e for e in r["errors"]))

    def test_answer_out_of_range(self):
        t = good_test()
        t["subjects"]["Physics"][0]["options"] = ["A", "B", "C"]
        t["subjects"]["Physics"][0]["answer"] = "E"
        r = self.v(t)
        self.assertTrue(any("bahar" in e for e in r["errors"]))

    def test_svg_bad_parse(self):
        t = good_test()
        t["subjects"]["Physics"][0]["svg"] = "<svg><broken></svg>"
        r = self.v(t)
        self.assertTrue(any("SVG" in e for e in r["errors"]))

    def test_svg_missing_viewbox(self):
        t = good_test()
        t["subjects"]["Physics"][0]["svg"] = "<svg xmlns='http://www.w3.org/2000/svg'><rect/></svg>"
        r = self.v(t)
        self.assertTrue(any("viewBox" in e for e in r["errors"]))

    def test_svg_ok(self):
        t = good_test()
        t["subjects"]["Physics"][0]["svg"] = GOOD_SVG
        r = self.v(t)
        self.assertEqual(r["errors"], [])

    def test_missing_solution_warning(self):
        t = good_test()
        del t["subjects"]["Physics"][0]["solution"]
        r = self.v(t)
        self.assertTrue(any("solution" in w for w in r["warnings"]))
        self.assertEqual(r["errors"], [])

    def test_extra_subject_warning(self):
        t = good_test()
        t["subjects"]["Extra"] = [{"q": "E", "options": ["A", "B"], "answer": "A", "solution": "S"}]
        r = self.v(t, template())
        self.assertTrue(any("Extra" in w and "ignore" in w for w in r["warnings"]))

    def test_bad_subjects(self):
        r = self.v({"name": "T"})
        self.assertTrue(r["errors"])
        r = self.v({"name": "T", "subjects": {}})
        self.assertTrue(r["errors"])
        r = self.v({"name": "T", "subjects": {"P": "not a list"}})
        self.assertTrue(any("list" in e for e in r["errors"]))


class ValidateRouteTest(TempDataCase):
    def setUp(self):
        super().setUp()
        import app
        self.c = app.create_app().test_client()
        # sample test likho
        self._write("good_test", good_test())
        # kharab JSON
        (config.TESTS_DIR / "broken.json").write_text("{not valid json", encoding="utf-8")

    def _write(self, tid, obj):
        p = config.TESTS_DIR / f"{tid}.json"
        with open(p, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False)

    def test_validate_no_template(self):
        r = self.c.get("/api/tests/good_test/validate")
        self.assertEqual(r.status_code, 200)
        d = r.get_json()
        self.assertEqual(d["errors"], [])

    def test_validate_with_template(self):
        tmpl = template()
        r = self.c.put("/api/templates/new", json=tmpl)
        tid = r.get_json()["id"]
        r2 = self.c.get(f"/api/tests/good_test/validate?template={tid}")
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(r2.get_json()["errors"], [])

    def test_validate_broken_json(self):
        r = self.c.get("/api/tests/broken/validate")
        self.assertEqual(r.status_code, 422)
        self.assertIn("JSON", r.get_json()["errors"][0])

    def test_validate_unknown_test(self):
        r = self.c.get("/api/tests/nope/validate")
        self.assertEqual(r.status_code, 404)

    def test_validate_unknown_template(self):
        r = self.c.get("/api/tests/good_test/validate?template=nope")
        self.assertEqual(r.status_code, 404)

    def test_list_surfaces_broken(self):
        r = self.c.get("/api/tests")
        arr = r.get_json()
        broken = [x for x in arr if x["id"] == "broken"]
        self.assertTrue(broken and "error" in broken[0])


ANALYSIS_TEST = {
    "name": "Analysis Test",
    "subjects": {
        "Physics": [
            {"q": "q1", "options": ["A", "B"], "answer": "A",
             "chapter": "Kinematics", "topic": "Motion", "difficulty": "easy"},
            {"q": "q2", "options": ["A", "B"], "answer": "A",
             "chapter": "Kinematics", "topic": "Graphs", "difficulty": "hard"},
            {"q": "q3", "options": ["A", "B"], "answer": "A",
             "chapter": "Optics", "topic": "Lenses", "difficulty": "medium"},
        ],
        "Chemistry": [
            {"q": "c1", "options": ["A", "B"], "answer": "A"},
        ],
    },
}


class AnalysisAndPasteTest(TempDataCase):
    def setUp(self):
        super().setUp()
        import app
        self.c = app.create_app().test_client()
        with open(config.TESTS_DIR / "analysis.json", "w", encoding="utf-8") as f:
            json.dump(ANALYSIS_TEST, f)

    def _entry(self, tid="analysis"):
        arr = self.c.get("/api/tests").get_json()
        return next(x for x in arr if x["id"] == tid)

    def test_list_includes_analysis_summary(self):
        a = self._entry()["analysis"]
        self.assertEqual(a["total"], 4)
        self.assertEqual(a["difficulty"],
                         {"easy": 1, "medium": 1, "hard": 1, "unknown": 1})
        self.assertEqual(a["difficulty_percent"]["easy"], 25.0)
        self.assertEqual(a["chapter_count"], 3)   # Kinematics, Optics, Unknown
        self.assertEqual(a["topic_count"], 4)

    def test_analysis_chapters_and_topics(self):
        a = self._entry()["analysis"]
        phys = a["subjects"][0]
        self.assertEqual(phys["name"], "Physics")
        self.assertEqual(phys["questions"], 3)
        self.assertEqual([c["name"] for c in phys["chapters"]], ["Kinematics", "Optics"])
        topics = {t["name"]: t["questions"] for t in phys["chapters"][0]["topics"]}
        self.assertEqual(topics, {"Motion": 1, "Graphs": 1})

    def test_paste_saves_test(self):
        r = self.c.post("/api/tests/paste", json={"json": json.dumps(ANALYSIS_TEST)})
        self.assertEqual(r.status_code, 201)
        d = r.get_json()
        self.assertEqual(d["test_name"], "Analysis Test")
        self.assertTrue((config.TESTS_DIR / f"{d['test_id']}.json").is_file())
        entry = self._entry(d["test_id"])
        self.assertEqual(entry["subjects"], {"Physics": 3, "Chemistry": 1})

    def test_paste_custom_name(self):
        r = self.c.post("/api/tests/paste",
                        json={"json": json.dumps(ANALYSIS_TEST), "name": "My Test"})
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.get_json()["test_name"], "My Test")

    def test_paste_fenced_json(self):
        text = "Here is the JSON:\n```json\n" + json.dumps(ANALYSIS_TEST) + "\n```"
        r = self.c.post("/api/tests/paste", json={"json": text})
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.get_json()["total"], 4)

    def test_paste_bad_json_422(self):
        r = self.c.post("/api/tests/paste", json={"json": "{not json"})
        self.assertEqual(r.status_code, 422)
        self.assertIn("JSON", r.get_json()["error"])

    def test_paste_empty_422(self):
        r = self.c.post("/api/tests/paste", json={"json": "  "})
        self.assertEqual(r.status_code, 422)

    def test_paste_without_valid_questions_422(self):
        r = self.c.post("/api/tests/paste",
                        json={"json": json.dumps({"name": "X", "subjects": {"P": []}})})
        self.assertEqual(r.status_code, 422)


if __name__ == "__main__":
    unittest.main()