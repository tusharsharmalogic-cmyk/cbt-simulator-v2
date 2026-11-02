"""Empty-subject skip + fewer-than-needed allowed + subject-mode timer shrink."""
import json
import time
import unittest

import config
from tests._base import TempDataCase


def write_test_file(path, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f)


class SkipEmptyTest(TempDataCase):
    def setUp(self):
        super().setUp()
        import app
        self.c = app.create_app().test_client()

    def _mk_template(self, subjects, mode="total", total_minutes=60):
        r = self.c.put("/api/templates/new", json={
            "name": "T", "timer_mode": mode,
            "total_minutes": total_minutes if mode == "total" else None,
            "subjects": subjects,
        })
        return r.get_json()["id"]

    def _mk_test(self, subjects):
        write_test_file(config.TESTS_DIR / "t.json", {"name": "T", "subjects": subjects})
        return "t"

    def test_fewer_than_needed_allowed(self):
        tid = self._mk_template([
            {"name": "P", "questions": 50, "marks": 4, "negative": 1, "minutes": None},
        ])
        self._mk_test({"P": [
            {"q": f"q{i}", "options": ["A", "B"], "answer": "A"} for i in range(5)
        ]})
        r = self.c.post("/api/attempts", json={"template_id": tid, "test_id": "t"})
        self.assertEqual(r.status_code, 200, r.get_json())
        body = r.get_json()
        self.assertEqual(len(body["questions"]["P"]), 5)

    def test_missing_subject_skipped(self):
        tid = self._mk_template([
            {"name": "P", "questions": 5, "marks": 4, "negative": 1, "minutes": None},
            {"name": "C", "questions": 5, "marks": 4, "negative": 1, "minutes": None},
            {"name": "M", "questions": 5, "marks": 4, "negative": 1, "minutes": None},
        ])
        # only P + C have questions
        self._mk_test({
            "P": [{"q": "p1", "options": ["A", "B"], "answer": "A"}],
            "C": [{"q": "c1", "options": ["A", "B"], "answer": "A"}],
        })
        r = self.c.post("/api/attempts", json={"template_id": tid, "test_id": "t"})
        self.assertEqual(r.status_code, 200, r.get_json())
        body = r.get_json()
        # M subject strip ho gaya
        self.assertIn("P", body["questions"])
        self.assertIn("C", body["questions"])
        self.assertNotIn("M", body["questions"])
        # template snapshot me bhi M nahi
        subj_names = [s["name"] for s in body["template"]["subjects"]]
        self.assertEqual(subj_names, ["P", "C"])

    def test_all_empty_fails(self):
        tid = self._mk_template([
            {"name": "P", "questions": 5, "marks": 4, "negative": 1, "minutes": None},
        ])
        self._mk_test({"P": []})
        r = self.c.post("/api/attempts", json={"template_id": tid, "test_id": "t"})
        self.assertEqual(r.status_code, 422)

    def test_subject_mode_timer_shrinks(self):
        # 3 subjects, but M has 0 questions — its 20 min should disappear
        tid = self._mk_template([
            {"name": "P", "questions": 5, "marks": 4, "negative": 1, "minutes": 10},
            {"name": "C", "questions": 5, "marks": 4, "negative": 1, "minutes": 15},
            {"name": "M", "questions": 5, "marks": 4, "negative": 1, "minutes": 20},
        ], mode="subject")
        self._mk_test({
            "P": [{"q": "p1", "options": ["A", "B"], "answer": "A"}],
            "C": [{"q": "c1", "options": ["A", "B"], "answer": "A"}],
            # M absent
        })
        r = self.c.post("/api/attempts", json={"template_id": tid, "test_id": "t"})
        self.assertEqual(r.status_code, 200, r.get_json())
        body = r.get_json()
        # total_minutes = 10+15 = 25
        self.assertEqual(body["template"]["total_minutes"], 25.0)
        # timing deadline = start + 25 min
        remaining = body["timing"]["remaining_seconds"]
        self.assertAlmostEqual(remaining, 25 * 60, delta=2)

    def test_subject_mode_first_current_is_active(self):
        tid = self._mk_template([
            {"name": "P", "questions": 5, "marks": 4, "negative": 1, "minutes": 10},
            {"name": "C", "questions": 5, "marks": 4, "negative": 1, "minutes": 10},
        ], mode="subject")
        # only C has questions — P skip hoga, current C hona chahiye
        self._mk_test({"C": [{"q": "c1", "options": ["A", "B"], "answer": "A"}]})
        r = self.c.post("/api/attempts", json={"template_id": tid, "test_id": "t"})
        self.assertEqual(r.status_code, 200)
        body = r.get_json()
        self.assertEqual(body["current"]["subject"], "C")

    def test_single_question_subject_keeps_full_window(self):
        tid = self._mk_template([
            {"name": "P", "questions": 1, "marks": 4, "negative": 1, "minutes": 5},
        ], mode="subject")
        self._mk_test({"P": [{"q": "p1", "options": ["A", "B"], "answer": "A"}]})
        r = self.c.post("/api/attempts", json={"template_id": tid, "test_id": "t"})
        body = r.get_json()
        # 5 min window for 1 Q
        self.assertAlmostEqual(body["timing"]["subject"]["remaining_seconds"], 5 * 60, delta=2)


if __name__ == "__main__":
    unittest.main()