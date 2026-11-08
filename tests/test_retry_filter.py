"""Retry with filter: chapter/topic/difficulty practice from the attempt's own snapshot."""
import json

import config
from tests._base import TempDataCase

TPL = {
    "name": "F", "timer_mode": "total", "total_minutes": 10,
    "subjects": [
        {"name": "P", "questions": 4, "marks": 4, "negative": 1, "minutes": None},
        {"name": "C", "questions": 2, "marks": 4, "negative": 1, "minutes": None},
    ],
}


def _q(text, ans, chapter=None, topic=None, diff=None):
    q = {"q": text, "options": ["A", "B", "C"], "answer": ans, "solution": "s"}
    if chapter is not None:
        q["chapter"] = chapter
    if topic is not None:
        q["topic"] = topic
    if diff is not None:
        q["difficulty"] = diff
    return q


TEST = {
    "name": "T", "subjects": {
        "P": [
            _q("p1", "A", "Motion", "Kin", "easy"),    # answered right
            _q("p2", "B", "Motion", "Kin", "hard"),    # answered wrong
            _q("p3", "A", "Heat", "Cal", "easy"),      # answered wrong
            _q("p4", "A"),                             # blank, no chapter/topic/difficulty
        ],
        "C": [
            _q("c1", "A", "Atoms", "Sub", "easy"),     # answered wrong
            _q("c2", "A", "Atoms", "Sub", "medium"),   # blank
        ],
    },
}


class RetryFilterTest(TempDataCase):
    def setUp(self):
        super().setUp()
        import app
        self.c = app.create_app().test_client()
        with open(config.TESTS_DIR / "t.json", "w", encoding="utf-8") as f:
            json.dump(TEST, f)
        tid = self.c.put("/api/templates/new", json=TPL).get_json()["id"]
        self.aid = self.c.post("/api/attempts", json={"template_id": tid, "test_id": "t"}).get_json()["id"]
        for subj, idx, choice in [("P", 0, "A"), ("P", 1, "C"), ("P", 2, "B"), ("C", 0, "B")]:
            self.c.post(f"/api/attempts/{self.aid}/answer",
                        json={"subject": subj, "index": idx, "choice": choice})
        r = self.c.post(f"/api/attempts/{self.aid}/submit")
        self.assertEqual(r.status_code, 200)

    def retry(self, body):
        return self.c.post(f"/api/attempts/{self.aid}/retry", json=body)

    def qs(self, resp):
        n = resp.get_json()
        return {s: [q["q"] for q in v] for s, v in n["questions"].items()}

    def test_chapter_keeps_only_wrong_and_blank_of_that_chapter(self):
        r = self.retry({"mode": "wrong", "filter": {"subject": "P", "chapter": "Motion"}})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.qs(r), {"P": ["p2"]})          # p1 was correct -> not included
        self.assertIn("Motion", r.get_json()["test_name"])
        self.assertIn("Wrong + Blank", r.get_json()["test_name"])

    def test_topic_filter(self):
        r = self.retry({"mode": "wrong", "filter": {"subject": "C", "chapter": "Atoms", "topic": "Sub"}})
        self.assertEqual(self.qs(r), {"C": ["c1", "c2"]})

    def test_easy_wrong_only_across_subjects(self):
        r = self.retry({"mode": "wrong", "filter": {"difficulty": "easy", "statuses": ["wrong"]}})
        self.assertEqual(self.qs(r), {"P": ["p3"], "C": ["c1"]})

    def test_statuses_blank_only(self):
        r = self.retry({"mode": "wrong", "filter": {"subject": "P", "statuses": ["blank"]}})
        self.assertEqual(self.qs(r), {"P": ["p4"]})

    def test_unknown_chapter_matches_missing_chapter(self):
        r = self.retry({"mode": "wrong", "filter": {"chapter": "Unknown"}})
        self.assertEqual(self.qs(r), {"P": ["p4"]})

    def test_unknown_difficulty_matches_missing(self):
        r = self.retry({"mode": "wrong", "filter": {"difficulty": "unknown"}})
        self.assertEqual(self.qs(r), {"P": ["p4"]})

    def test_subject_filter_only(self):
        r = self.retry({"mode": "wrong", "filter": {"subject": "C"}})
        self.assertEqual(self.qs(r), {"C": ["c1", "c2"]})

    def test_empty_filter_equals_plain_wrong(self):
        plain = self.qs(self.retry({"mode": "wrong"}))
        r = self.retry({"mode": "wrong", "filter": {}})
        self.assertEqual(self.qs(r), plain)
        self.assertEqual(plain, {"P": ["p2", "p3", "p4"], "C": ["c1", "c2"]})
        self.assertNotIn("(", r.get_json()["test_name"].replace("(Wrong + Blank)", ""))

    def test_no_match_422(self):
        r = self.retry({"mode": "wrong", "filter": {"chapter": "Nope"}})
        self.assertEqual(r.status_code, 422)

    def test_all_correct_chapter_422(self):
        # Motion has p1 (right) + p2 (wrong); Heat has only p3 (wrong). A chapter with
        # nothing wrong/blank must give 422: easy + blank only -> none in the data.
        r = self.retry({"mode": "wrong", "filter": {"difficulty": "easy", "statuses": ["blank"]}})
        self.assertEqual(r.status_code, 422)

    def test_time_scales_with_kept_questions(self):
        r = self.retry({"mode": "wrong", "filter": {"chapter": "Motion"}})
        self.assertEqual(r.get_json()["template"]["total_minutes"], 2)   # 10 * 1/6 -> 1.67 -> 2
        self.assertEqual(r.get_json()["template"]["subjects"][0]["questions"], 1)

    def test_filter_with_full_mode_rejected(self):
        self.assertEqual(self.retry({"mode": "full", "filter": {"chapter": "Motion"}}).status_code, 422)

    def test_bad_filter_shapes_rejected(self):
        self.assertEqual(self.retry({"mode": "wrong", "filter": "Motion"}).status_code, 422)
        self.assertEqual(self.retry({"mode": "wrong", "filter": {"chapter": 5}}).status_code, 422)
        self.assertEqual(self.retry({"mode": "wrong", "filter": {"statuses": ["correct"]}}).status_code, 422)
        self.assertEqual(self.retry({"mode": "wrong", "filter": {"statuses": []}}).status_code, 422)

    def test_answers_stripped_and_source_untouched(self):
        before = sorted(p.name for p in config.TESTS_DIR.glob("*.json"))
        n = self.retry({"mode": "wrong", "filter": {"chapter": "Motion"}}).get_json()
        for qs in n["questions"].values():
            for q in qs:
                self.assertNotIn("answer", q)
        self.assertEqual(n["retry_of"], self.aid)
        self.assertEqual(n["retry_mode"], "wrong")
        self.c.post(f"/api/attempts/{n['id']}/submit")
        self.assertEqual(before, sorted(p.name for p in config.TESTS_DIR.glob("*.json")))
        # original attempt still has all 6 questions
        orig = self.c.get(f"/api/attempts/{self.aid}").get_json()
        self.assertEqual(sum(len(v) for v in orig["questions"].values()), 6)