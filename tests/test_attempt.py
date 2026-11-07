"""Attempt API + timer + answer stripping."""
import json
import time
import unittest

import config
from core import attempt_store
from tests._base import TempDataCase


SAMPLE = {
    "name": "Mini", "timer_mode": "total", "total_minutes": 10,
    "subjects": [
        {"name": "P", "questions": 2, "marks": 4, "negative": 1, "minutes": None},
        {"name": "C", "questions": 1, "marks": 4, "negative": 1, "minutes": None},
    ],
}
TEST = {
    "name": "T", "subjects": {
        "P": [
            {"q": "p1", "options": ["A", "B", "C"], "answer": "A", "solution": "s1"},
            {"q": "p2", "options": ["A", "B", "C"], "answer": "B", "solution": "s2"},
        ],
        "C": [
            {"q": "c1", "options": ["A", "B"], "answer": "A", "solution": "s"},
        ],
    },
}


def subject_mode():
    return {
        "name": "S", "timer_mode": "subject", "total_minutes": None,
        "subjects": [
            {"name": "P", "questions": 1, "marks": 4, "negative": 1, "minutes": 2},
            {"name": "C", "questions": 1, "marks": 4, "negative": 1, "minutes": 2},
        ],
    }


class Base(TempDataCase):
    def setUp(self):
        super().setUp()
        import app
        self.c = app.create_app().test_client()
        # write test file
        with open(config.TESTS_DIR / "t.json", "w", encoding="utf-8") as f:
            json.dump(TEST, f)

    def create(self, tmpl=SAMPLE):
        r = self.c.put("/api/templates/new", json=tmpl)
        tid = r.get_json()["id"]
        r2 = self.c.post("/api/attempts", json={"template_id": tid, "test_id": "t"})
        return r2

    def _patch_file(self, aid, **kw):
        p = config.ATTEMPTS_DIR / f"{aid}.json"
        with open(p, encoding="utf-8") as f:
            a = json.load(f)
        a.update(kw)
        with open(p, "w", encoding="utf-8") as f:
            json.dump(a, f)


class CreateAndStripTest(Base):
    def test_create_returns_client_view_no_answers(self):
        r = self.create()
        self.assertEqual(r.status_code, 200)
        body = r.get_json()
        self.assertTrue(body.get("id"))
        self.assertEqual(body.get("status"), "in_progress")
        self.assertIn("timing", body)
        self.assertEqual(body["timing"]["mode"], "total")
        # answers/solutions stripped
        for subj, qs in body["questions"].items():
            for q in qs:
                self.assertNotIn("answer", q)
                self.assertNotIn("solution", q)
        # questions per subject limited
        self.assertEqual(len(body["questions"]["P"]), 2)
        self.assertEqual(len(body["questions"]["C"]), 1)

    def test_get_strips_while_in_progress(self):
        aid = self.create().get_json()["id"]
        r = self.c.get(f"/api/attempts/{aid}")
        body = r.get_json()
        for qs in body["questions"].values():
            for q in qs:
                self.assertNotIn("answer", q)

    def test_after_submit_answers_visible(self):
        aid = self.create().get_json()["id"]
        r = self.c.post(f"/api/attempts/{aid}/submit")
        self.assertEqual(r.status_code, 200)
        body = r.get_json()
        self.assertEqual(body["status"], "submitted")
        for qs in body["questions"].values():
            for q in qs:
                self.assertIn("answer", q)


class MutationTest(Base):
    def test_answer_mark_visit(self):
        aid = self.create().get_json()["id"]
        r = self.c.post(f"/api/attempts/{aid}/answer",
                        json={"subject": "P", "index": 0, "choice": "B"})
        self.assertEqual(r.status_code, 200)
        r = self.c.post(f"/api/attempts/{aid}/mark",
                        json={"subject": "P", "index": 1, "marked": True})
        self.assertEqual(r.status_code, 200)
        r = self.c.post(f"/api/attempts/{aid}/visit",
                        json={"subject": "C", "index": 0, "spent": 5})
        self.assertEqual(r.status_code, 200)
        body = r.get_json()
        self.assertEqual(body["responses"]["P"][0]["choice"], "B")
        self.assertTrue(body["responses"]["P"][1]["marked"])
        self.assertEqual(body["responses"]["C"][0]["time_spent"], 5)
        self.assertEqual(body["current"], {"subject": "C", "index": 0})

    def test_bad_choice(self):
        aid = self.create().get_json()["id"]
        r = self.c.post(f"/api/attempts/{aid}/answer",
                        json={"subject": "P", "index": 0, "choice": "Z"})
        self.assertEqual(r.status_code, 422)

    def test_out_of_range(self):
        aid = self.create().get_json()["id"]
        r = self.c.post(f"/api/attempts/{aid}/answer",
                        json={"subject": "P", "index": 99, "choice": "A"})
        self.assertEqual(r.status_code, 422)

    def test_visit_time_clamped(self):
        aid = self.create().get_json()["id"]
        r = self.c.post(f"/api/attempts/{aid}/visit",
                        json={"subject": "P", "index": 0, "spent": 999999})
        self.assertEqual(r.get_json()["responses"]["P"][0]["time_spent"], 600)

    def test_answer_after_submit_409(self):
        aid = self.create().get_json()["id"]
        self.c.post(f"/api/attempts/{aid}/submit")
        r = self.c.post(f"/api/attempts/{aid}/answer",
                        json={"subject": "P", "index": 0, "choice": "A"})
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.get_json()["error"], "already_submitted")


class TimeAccuracyTest(Base):
    """Har question ka time usi question me jaye — navigation, lock aur submit par bhi."""

    def _create(self, tmpl):
        tid = self.c.put("/api/templates/new", json=tmpl).get_json()["id"]
        return self.c.post("/api/attempts",
                           json={"template_id": tid, "test_id": "t"}).get_json()["id"]

    def test_time_credited_to_previous_question(self):
        aid = self._create(SAMPLE)
        r = self.c.post(f"/api/attempts/{aid}/visit",
                        json={"subject": "P", "index": 1, "spent": 7,
                              "from_subject": "P", "from_index": 0})
        self.assertEqual(r.status_code, 200)
        body = r.get_json()
        self.assertEqual(body["responses"]["P"][0]["time_spent"], 7)
        self.assertEqual(body["responses"]["P"][1]["time_spent"], 0)
        self.assertEqual(body["current"], {"subject": "P", "index": 1})

    def test_locked_question_still_gets_its_time(self):
        tmpl = {
            "name": "LockQ", "timer_mode": "total", "total_minutes": 10,
            "subjects": [{"name": "P", "questions": 2, "marks": 4, "negative": 1,
                          "lock_mode": "question", "per_question_seconds": 20}],
        }
        aid = self._create(tmpl)
        a = attempt_store.load(aid)
        a["responses"]["P"][0]["q_started_at"] = time.time() - 21
        attempt_store.save(a)
        r = self.c.post(f"/api/attempts/{aid}/visit",
                        json={"subject": "P", "index": 0, "spent": 19.5,
                              "from_subject": "P", "from_index": 0})
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.get_json()["error"], "question_locked")
        self.assertEqual(r.get_json()["next"], {"subject": "P", "index": 1})
        saved = attempt_store.load(aid)
        self.assertEqual(saved["responses"]["P"][0]["time_spent"], 19.5)

    def test_time_up_visit_flushes_last_chunk(self):
        aid = self._create(SAMPLE)
        self._patch_file(aid, start_time=time.time() - 7200)
        r = self.c.post(f"/api/attempts/{aid}/visit",
                        json={"subject": "P", "index": 0, "spent": 9,
                              "from_subject": "P", "from_index": 0})
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.get_json()["error"], "time_up")
        saved = attempt_store.load(aid)
        self.assertEqual(saved["status"], "submitted")
        self.assertEqual(saved["responses"]["P"][0]["time_spent"], 9)
        self.assertEqual(saved["result"]["subjects"][0]["rows"][0]["time_spent"], 9)

    def test_visit_after_submit_leaves_result_untouched(self):
        aid = self._create(SAMPLE)
        self.c.post(f"/api/attempts/{aid}/submit")
        r = self.c.post(f"/api/attempts/{aid}/visit",
                        json={"subject": "P", "index": 1, "spent": 5,
                              "from_subject": "P", "from_index": 0})
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.get_json()["error"], "already_submitted")
        self.assertEqual(attempt_store.load(aid)["responses"]["P"][0]["time_spent"], 0)

    def test_submit_flushes_current_question_time(self):
        aid = self._create(SAMPLE)
        r = self.c.post(f"/api/attempts/{aid}/submit",
                        json={"subject": "P", "index": 0, "spent": 12})
        self.assertEqual(r.status_code, 200)
        body = r.get_json()
        self.assertEqual(body["status"], "submitted")
        self.assertEqual(body["responses"]["P"][0]["time_spent"], 12)


class AutoSubmitTest(Base):
    def test_time_up_auto_submit_on_get(self):
        aid = self.create().get_json()["id"]
        # rewind start_time 2 hours
        self._patch_file(aid, start_time=time.time() - 7200)
        r = self.c.get(f"/api/attempts/{aid}")
        body = r.get_json()
        self.assertEqual(body["status"], "submitted")
        self.assertEqual(body["submit_reason"], "time_up")
        self.assertIsNotNone(body["result"])
        # answers now visible
        self.assertIn("answer", body["questions"]["P"][0])

    def test_time_up_blocks_mutations(self):
        aid = self.create().get_json()["id"]
        self._patch_file(aid, start_time=time.time() - 7200)
        r = self.c.post(f"/api/attempts/{aid}/answer",
                        json={"subject": "P", "index": 0, "choice": "A"})
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.get_json()["error"], "time_up")


class SubjectModeTest(Base):
    def test_locked_subject_rejected(self):
        r = self.create(tmpl=subject_mode())
        aid = r.get_json()["id"]
        # C is not open (P window is 0..120s, C is 120..240)
        r = self.c.post(f"/api/attempts/{aid}/answer",
                        json={"subject": "C", "index": 0, "choice": "A"})
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.get_json()["error"], "subject_locked")

    def test_current_subject_ok(self):
        aid = self.create(tmpl=subject_mode()).get_json()["id"]
        r = self.c.post(f"/api/attempts/{aid}/answer",
                        json={"subject": "P", "index": 0, "choice": "A"})
        self.assertEqual(r.status_code, 200)

    def test_previous_subject_locked_after_window(self):
        aid = self.create(tmpl=subject_mode()).get_json()["id"]
        # rewind to simulate P window expired; C current
        self._patch_file(aid, start_time=time.time() - 150)
        r = self.c.post(f"/api/attempts/{aid}/answer",
                        json={"subject": "P", "index": 0, "choice": "A"})
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.get_json()["error"], "subject_locked")
        # C is now current
        r = self.c.post(f"/api/attempts/{aid}/answer",
                        json={"subject": "C", "index": 0, "choice": "A"})
        self.assertEqual(r.status_code, 200)


class TimerTest(unittest.TestCase):
    def test_total_mode(self):
        from core import timer
        a = {"template": {"timer_mode": "total", "total_minutes": 10},
             "start_time": 1000.0}
        t = timer.timing(a, now=1060.0)
        self.assertEqual(t["mode"], "total")
        self.assertAlmostEqual(t["remaining_seconds"], 540.0, places=1)
        self.assertEqual(t["deadline"], 1000.0 + 600.0)

    def test_subject_mode_current(self):
        from core import timer
        tmpl = {"timer_mode": "subject", "subjects": [
            {"name": "A", "minutes": 2}, {"name": "B", "minutes": 3}]}
        a = {"template": tmpl, "start_time": 100.0}
        t = timer.timing(a, now=200.0)  # 100s in, A window (0..120)
        self.assertEqual(t["subject"]["name"], "A")
        self.assertAlmostEqual(t["subject"]["remaining_seconds"], 20.0, places=1)
        self.assertEqual(t["locked_subjects"], [])

        t = timer.timing(a, now=250.0)  # in B window (120..300)
        self.assertEqual(t["subject"]["name"], "B")
        self.assertEqual(t["locked_subjects"], ["A"])

        t = timer.timing(a, now=400.0)  # over
        self.assertEqual(t["remaining_seconds"], 0)
        self.assertEqual(t["locked_subjects"], ["A", "B"])


class ListAndDeleteTest(Base):
    def test_list_and_delete(self):
        aid = self.create().get_json()["id"]
        r = self.c.get("/api/attempts")
        arr = r.get_json()
        self.assertEqual(len(arr), 1)
        self.assertEqual(arr[0]["id"], aid)
        r = self.c.delete(f"/api/attempts/{aid}")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(self.c.get("/api/attempts").get_json()), 0)


class RetryTest(Base):
    def _submit(self, aid):
        r = self.c.post(f"/api/attempts/{aid}/submit")
        self.assertEqual(r.status_code, 200)
        return r.get_json()

    def test_full_retry_copies_all_questions(self):
        aid = self.create().get_json()["id"]
        self._submit(aid)
        r = self.c.post(f"/api/attempts/{aid}/retry", json={"mode": "full"})
        self.assertEqual(r.status_code, 200)
        n = r.get_json()
        self.assertNotEqual(n["id"], aid)
        self.assertEqual(n["status"], "in_progress")
        self.assertEqual(len(n["questions"]["P"]), 2)
        self.assertEqual(len(n["questions"]["C"]), 1)
        self.assertEqual(n["test_name"], "T")
        self.assertEqual(n["retry_of"], aid)
        self.assertEqual(n["template"]["total_minutes"], 10)
        # naye attempt me answers phir se chhupaye gaye
        for qs in n["questions"].values():
            for q in qs:
                self.assertNotIn("answer", q)

    def test_wrong_retry_keeps_only_wrong_and_blank(self):
        aid = self.create().get_json()["id"]
        self.c.post(f"/api/attempts/{aid}/answer",
                    json={"subject": "P", "index": 0, "choice": "A"})  # sahi
        self.c.post(f"/api/attempts/{aid}/answer",
                    json={"subject": "C", "index": 0, "choice": "B"})  # galat
        self._submit(aid)  # P1 blank
        r = self.c.post(f"/api/attempts/{aid}/retry", json={"mode": "wrong"})
        self.assertEqual(r.status_code, 200)
        n = r.get_json()
        self.assertEqual([q["q"] for q in n["questions"]["P"]], ["p2"])
        self.assertEqual([q["q"] for q in n["questions"]["C"]], ["c1"])
        self.assertEqual(n["template"]["total_minutes"], 7)  # 10 * 2/3
        self.assertIn("Wrong + Blank", n["test_name"])

    def test_wrong_retry_with_no_wrong_blank_422(self):
        aid = self.create().get_json()["id"]
        for subj, idx, choice in [("P", 0, "A"), ("P", 1, "B"), ("C", 0, "A")]:
            self.c.post(f"/api/attempts/{aid}/answer",
                        json={"subject": subj, "index": idx, "choice": choice})
        self._submit(aid)
        r = self.c.post(f"/api/attempts/{aid}/retry", json={"mode": "wrong"})
        self.assertEqual(r.status_code, 422)

    def test_retry_before_submit_409(self):
        aid = self.create().get_json()["id"]
        r = self.c.post(f"/api/attempts/{aid}/retry", json={"mode": "full"})
        self.assertEqual(r.status_code, 409)

    def test_retry_submit_leaves_tests_dir_untouched(self):
        aid = self.create().get_json()["id"]
        self.c.post(f"/api/attempts/{aid}/answer",
                    json={"subject": "P", "index": 0, "choice": "A"})
        self._submit(aid)
        before = sorted(p.name for p in config.TESTS_DIR.glob("*.json"))
        n = self.c.post(f"/api/attempts/{aid}/retry", json={"mode": "full"}).get_json()
        self.c.post(f"/api/attempts/{n['id']}/submit")
        after = sorted(p.name for p in config.TESTS_DIR.glob("*.json"))
        self.assertEqual(before, after)


class ScoringTest(unittest.TestCase):
    def test_mixed_template(self):
        from core import scoring
        a = {
            "template": {"subjects": [
                {"name": "P", "marks": 4, "negative": 1},
                {"name": "C", "marks": 1, "negative": 0.25},
            ]},
            "questions": {
                "P": [{"answer": "A"}, {"answer": "B"}, {"answer": "C"}],
                "C": [{"answer": "A"}, {"answer": "A"}],
            },
            "responses": {
                "P": [{"choice": "A"}, {"choice": "C"}, {"choice": None}],
                "C": [{"choice": "A"}, {"choice": None}],
            },
        }
        r = scoring.compute(a)
        self.assertEqual(r["subjects"][0]["correct"], 1)
        self.assertEqual(r["subjects"][0]["wrong"], 1)
        self.assertEqual(r["subjects"][0]["blank"], 1)
        self.assertEqual(r["subjects"][0]["score"], 4 - 1)
        self.assertEqual(r["subjects"][1]["score"], 1.0)
        self.assertAlmostEqual(r["total"]["score"], 4.0)
        self.assertEqual(r["total"]["max"], 3 * 4 + 2 * 1)

    def test_all_blank(self):
        from core import scoring
        a = {"template": {"subjects": [{"name": "P", "marks": 4, "negative": 1}]},
             "questions": {"P": [{"answer": "A"}, {"answer": "B"}]},
             "responses": {"P": [{"choice": None}, {"choice": None}]}}
        r = scoring.compute(a)
        self.assertEqual(r["total"]["score"], 0)
        self.assertEqual(r["subjects"][0]["blank"], 2)

    def test_decimal_negative(self):
        from core import scoring
        a = {"template": {"subjects": [{"name": "P", "marks": 1, "negative": 0.25}]},
             "questions": {"P": [{"answer": "A"}, {"answer": "B"}]},
             "responses": {"P": [{"choice": "C"}, {"choice": "C"}]}}
        r = scoring.compute(a)
        self.assertEqual(r["subjects"][0]["score"], -0.5)


if __name__ == "__main__":
    unittest.main()