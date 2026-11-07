"""Importer: merge, group (ci), cap, dedupe, reject."""
import json
import unittest

import config
from tests._base import TempDataCase


def tmpl(subjects):
    return {
        "name": "T", "timer_mode": "total", "total_minutes": 60,
        "subjects": [
            {"name": n, "questions": q, "marks": 4, "negative": 1, "minutes": None}
            for n, q in subjects.items()
        ],
    }


def jb(obj):
    return (json.dumps(obj), "utf-8")


def f(name, obj_or_bytes):
    if isinstance(obj_or_bytes, bytes):
        return (name, obj_or_bytes)
    return (name, json.dumps(obj_or_bytes).encode("utf-8"))


class ImporterTest(unittest.TestCase):
    def imp(self, files, tpl):
        from core.importer import import_files
        return import_files(files, tpl)

    def test_merge_and_case_insensitive(self):
        files = [
            f("a.json", {"subjects": {"Physics": [
                {"q": "P1", "options": ["A", "B"], "answer": "A"},
                {"q": "P2", "options": ["A", "B"], "answer": "B"},
            ]}}),
            f("b.json", {"subjects": {"physics": [
                {"q": "P3", "options": ["A", "B"], "answer": "A"},
            ]}}),
        ]
        r = self.imp(files, tmpl({"Physics": 5}))
        self.assertEqual(r["counts"]["Physics"], 3)
        self.assertEqual(r["used"]["Physics"], 3)

    def test_cap_to_template(self):
        files = [f("a.json", {"subjects": {"P": [
            {"q": f"q{i}", "options": ["A", "B"], "answer": "A"} for i in range(10)
        ]}})]
        r = self.imp(files, tmpl({"P": 3}))
        self.assertEqual(r["counts"]["P"], 10)
        self.assertEqual(r["used"]["P"], 3)
        self.assertEqual(len(r["subjects"]["P"]), 3)

    def test_fewer_than_needed_ok_no_error(self):
        files = [f("a.json", {"subjects": {"P": [
            {"q": "q1", "options": ["A", "B"], "answer": "A"},
        ]}})]
        r = self.imp(files, tmpl({"P": 50}))
        self.assertEqual(r["errors"], [])
        self.assertEqual(r["used"]["P"], 1)
        self.assertEqual(r["needed"]["P"], 50)

    def test_dedupe_same_q_and_options(self):
        files = [
            f("a.json", {"subjects": {"P": [
                {"q": "same", "options": ["A", "B"], "answer": "A"},
            ]}}),
            f("b.json", {"subjects": {"P": [
                {"q": "same", "options": ["A", "B"], "answer": "A"},
            ]}}),
        ]
        r = self.imp(files, tmpl({"P": 5}))
        self.assertEqual(r["counts"]["P"], 1)

    def test_same_q_different_options_not_deduped(self):
        files = [
            f("a.json", {"subjects": {"P": [
                {"q": "same", "options": ["A", "B"], "answer": "A"},
            ]}}),
            f("b.json", {"subjects": {"P": [
                {"q": "same", "options": ["A", "B", "C"], "answer": "A"},
            ]}}),
        ]
        r = self.imp(files, tmpl({"P": 5}))
        self.assertEqual(r["counts"]["P"], 2)

    def test_empty_q_rejected(self):
        files = [f("a.json", {"subjects": {"P": [
            {"q": "  ", "options": ["A", "B"], "answer": "A"},
        ]}})]
        r = self.imp(files, tmpl({"P": 5}))
        self.assertEqual(r["counts"]["P"], 0)
        self.assertTrue(any("khali" in m for m in r["skipped"]["a.json"]))

    def test_bad_answer_rejected(self):
        files = [f("a.json", {"subjects": {"P": [
            {"q": "q", "options": ["A", "B"], "answer": "Z"},
        ]}})]
        r = self.imp(files, tmpl({"P": 5}))
        self.assertEqual(r["counts"]["P"], 0)

    def test_unknown_subject_skipped(self):
        files = [f("a.json", {"subjects": {"History": [
            {"q": "q", "options": ["A", "B"], "answer": "A"},
        ]}})]
        r = self.imp(files, tmpl({"P": 5}))
        self.assertTrue(any("History" in m for m in r["skipped"]["a.json"]))

    def test_no_valid_questions_error(self):
        r = self.imp([f("a.json", b"not json")], tmpl({"P": 5}))
        self.assertTrue(r["errors"])

    def test_accepts_top_level_array(self):
        # array of single-test objects
        files = [f("a.json", [
            {"subjects": {"P": [{"q": "q1", "options": ["A", "B"], "answer": "A"}]}},
            {"subjects": {"P": [{"q": "q2", "options": ["A", "B"], "answer": "B"}]}},
        ])]
        r = self.imp(files, tmpl({"P": 5}))
        self.assertEqual(r["counts"]["P"], 2)

    def test_accepts_plain_subject_map(self):
        files = [f("a.json", {"P": [
            {"q": "q", "options": ["A", "B"], "answer": "A"},
        ]})]
        r = self.imp(files, tmpl({"P": 5}))
        self.assertEqual(r["counts"]["P"], 1)


class AiOutputRepairTest(unittest.TestCase):
    """AI ke output me aane wali common JSON galtiyan import ko nahi rokti."""

    def imp(self, text):
        from core.importer import import_files
        return import_files([("a.json", text.encode("utf-8"))], None)

    def q(self, **kw):
        q = {"q": "q", "options": ["A", "B", "C"], "answer": "A"}
        q.update(kw)
        return q

    def test_fenced_json_with_chat_text(self):
        doc = {"name": "T", "subjects": {"P": [self.q()]}}
        text = "Here is the JSON:\n```json\n" + json.dumps(doc) + "\n```\nThanks"
        r = self.imp(text)
        self.assertEqual(r["errors"], [])
        self.assertEqual(r["used"]["P"], 1)

    def test_single_backslash_latex_repaired(self):
        text = ('{"name":"T","subjects":{"P":[{"q":"$\\sqrt{2}$ and '
                '$\\frac{1}{2}$","options":["a","b"],"answer":"A"}]}}')
        r = self.imp(text)
        self.assertEqual(r["errors"], [])
        self.assertEqual(r["subjects"]["P"][0]["q"], "$\\sqrt{2}$ and $\\frac{1}{2}$")

    def test_real_newline_inside_string(self):
        text = '{"subjects":{"P":[{"q":"line1\nline2","options":["a","b"],"answer":"A"}]}}'
        r = self.imp(text)
        self.assertEqual(r["subjects"]["P"][0]["q"], "line1\nline2")

    def test_trailing_comma(self):
        text = '{"name":"T","subjects":{"P":[{"q":"a","options":["a","b"],"answer":"A",},]}}'
        r = self.imp(text)
        self.assertEqual(r["errors"], [])
        self.assertEqual(r["used"]["P"], 1)

    def test_subjects_array_shape(self):
        doc = {"name": "T", "subjects": [{"name": "P", "questions": [self.q()]}]}
        r = self.imp(json.dumps(doc))
        self.assertEqual(r["errors"], [])
        self.assertEqual(r["used"]["P"], 1)

    def test_single_subject_object(self):
        doc = {"subjects": {"P": self.q()}}
        r = self.imp(json.dumps(doc))
        self.assertEqual(r["used"]["P"], 1)

    def test_options_object_and_answer_label(self):
        doc = {"subjects": {"P": [{"q": "q", "options": {"A": "x", "B": "y"},
                                  "answer": "Option B"}]}}
        r = self.imp(json.dumps(doc))
        self.assertEqual(r["used"]["P"], 1)
        self.assertEqual(r["subjects"]["P"][0]["options"], ["x", "y"])
        self.assertEqual(r["subjects"]["P"][0]["answer"], "B")

    def test_answer_variants(self):
        for a in ("(b)", "B)", "option c", "c"):
            r = self.imp(json.dumps({"subjects": {"P": [self.q(answer=a)]}}))
            self.assertEqual(r["used"]["P"], 1, a)

    def test_bad_json_message_has_location(self):
        r = self.imp('{"subjects": {"P": [}}')
        self.assertTrue(r["errors"])
        self.assertIn("line", r["skipped"]["a.json"][0])


class ImportRouteTest(TempDataCase):
    def setUp(self):
        super().setUp()
        import app
        self.c = app.create_app().test_client()
        # template
        r = self.c.put("/api/templates/new", json=tmpl({"P": 3, "C": 2}))
        self.tid = r.get_json()["id"]

    def _upload(self, files_objs, name=None):
        import io
        data = {"template_id": self.tid, "files[]": []}
        if name:
            data["name"] = name
        files = []
        for fname, obj in files_objs:
            raw = json.dumps(obj).encode("utf-8") if not isinstance(obj, bytes) else obj
            files.append((io.BytesIO(raw), fname))
        data["files[]"] = files
        return self.c.post("/api/tests/import", data=data,
                           content_type="multipart/form-data")

    def test_import_creates_file(self):
        r = self._upload([
            ("a.json", {"subjects": {"P": [
                {"q": "q1", "options": ["A", "B"], "answer": "A"},
            ]}}),
        ], name="Test A")
        self.assertEqual(r.status_code, 200)
        body = r.get_json()
        self.assertTrue(body["test_id"])
        # file exists and reloadable
        r2 = self.c.get(f"/api/tests/{body['test_id']}")
        self.assertEqual(r2.status_code, 200)
        self.assertIn("P", r2.get_json()["subjects"])

    def test_reject_non_json(self):
        r = self._upload([("notes.txt", b"hi")], name="X")
        self.assertEqual(r.status_code, 422)

    def test_missing_template(self):
        import io
        r = self.c.post("/api/tests/import", data={
            "template_id": "does_not_exist",
            "files[]": [(io.BytesIO(b'{"subjects":{}}'), "a.json")],
        }, content_type="multipart/form-data")
        self.assertEqual(r.status_code, 404)

    def test_no_files(self):
        r = self.c.post("/api/tests/import", data={"template_id": self.tid},
                        content_type="multipart/form-data")
        self.assertEqual(r.status_code, 422)


if __name__ == "__main__":
    unittest.main()