"""Template store + settings routes."""
import json
import unittest

import config
from tests._base import TempDataCase


JEE = {
    "name": "JEE Mains", "timer_mode": "total", "total_minutes": 180,
    "subjects": [
        {"name": "Physics", "questions": 25, "marks": 4, "negative": 1, "minutes": None},
        {"name": "Chemistry", "questions": 25, "marks": 4, "negative": 1, "minutes": None},
        {"name": "Maths", "questions": 25, "marks": 4, "negative": 1, "minutes": None},
    ],
}

SUBJ = {
    "name": "NEET Subject Timer", "timer_mode": "subject", "total_minutes": None,
    "subjects": [
        {"name": "Bio", "questions": 10, "marks": 4, "negative": 1, "minutes": 30},
        {"name": "Physics", "questions": 10, "marks": 4, "negative": 1, "minutes": 20},
    ],
}


class TemplateStoreTest(TempDataCase):

    def _save(self, data, tid="new"):
        from core.template_store import save_template
        return save_template(tid, data)

    def test_create_total(self):
        sid, clean = self._save(JEE)
        self.assertEqual(sid, "jee_mains")
        self.assertEqual(clean["total_minutes"], 180)
        self.assertEqual([s["name"] for s in clean["subjects"]], ["Physics", "Chemistry", "Maths"])
        # File valid JSON
        p = config.TEMPLATES_DIR / f"{sid}.json"
        with open(p, encoding="utf-8") as f:
            on_disk = json.load(f)
        self.assertEqual(on_disk["name"], "JEE Mains")

    def test_create_subject_mode_sums_total(self):
        sid, clean = self._save(SUBJ)
        self.assertIsNotNone(sid)
        self.assertEqual(clean["total_minutes"], 50)

    def test_duplicate_subject(self):
        bad = {**JEE, "subjects": [
            {"name": "Physics", "questions": 10, "marks": 4, "negative": 1, "minutes": None},
            {"name": "physics", "questions": 10, "marks": 4, "negative": 1, "minutes": None},
        ]}
        sid, errs = self._save(bad)
        self.assertIsNone(sid)
        self.assertTrue(any("duplicate" in e for e in errs))

    def test_zero_questions_rejected(self):
        bad = {**JEE, "subjects": [
            {"name": "P", "questions": 0, "marks": 4, "negative": 1, "minutes": None},
        ]}
        sid, errs = self._save(bad)
        self.assertIsNone(sid)

    def test_subject_mode_missing_minutes(self):
        bad = {**SUBJ, "subjects": [
            {"name": "P", "questions": 10, "marks": 4, "negative": 1, "minutes": None},
        ]}
        sid, errs = self._save(bad)
        self.assertIsNone(sid)
        self.assertTrue(any("minutes" in e for e in errs))

    def test_decimal_marks(self):
        ok = {**JEE, "subjects": [
            {"name": "P", "questions": 10, "marks": 1, "negative": 0.25, "minutes": None},
        ]}
        sid, clean = self._save(ok)
        self.assertIsNotNone(sid)
        self.assertEqual(clean["subjects"][0]["negative"], 0.25)

    def test_unique_id_dedup(self):
        sid1, _ = self._save(JEE)
        sid2, _ = self._save({**JEE, "name": "JEE Mains"})
        self.assertEqual(sid1, "jee_mains")
        self.assertEqual(sid2, "jee_mains_2")

    def test_delete(self):
        from core.template_store import delete_template, get_template
        sid, _ = self._save(JEE)
        self.assertTrue(delete_template(sid))
        self.assertIsNone(get_template(sid))
        self.assertFalse(delete_template(sid))

    def test_path_traversal_rejected(self):
        from core.template_store import get_template
        self.assertIsNone(get_template("../app"))
        self.assertIsNone(get_template("..%2Fapp"))

    def test_bad_timer_mode(self):
        sid, errs = self._save({**JEE, "timer_mode": "weird"})
        self.assertIsNone(sid)


class SettingsRouteTest(TempDataCase):
    def setUp(self):
        super().setUp()
        import app
        self.c = app.create_app().test_client()

    def test_default(self):
        r = self.c.get("/api/settings")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json(), {"theme": "system"})

    def test_put_and_persist(self):
        r = self.c.put("/api/settings", json={"theme": "dark"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json()["theme"], "dark")
        # file exists and valid
        with open(config.SETTINGS_FILE, encoding="utf-8") as f:
            on_disk = json.load(f)
        self.assertEqual(on_disk["theme"], "dark")

    def test_bad_theme(self):
        r = self.c.put("/api/settings", json={"theme": "purple"})
        self.assertEqual(r.status_code, 422)


class TemplatesRouteTest(TempDataCase):
    def setUp(self):
        super().setUp()
        import app
        self.c = app.create_app().test_client()

    def test_create_via_put(self):
        r = self.c.put("/api/templates/new", json=JEE)
        self.assertEqual(r.status_code, 200)
        body = r.get_json()
        self.assertEqual(body["id"], "jee_mains")

        r2 = self.c.get("/api/templates/jee_mains")
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(r2.get_json()["name"], "JEE Mains")

    def test_422_errors(self):
        r = self.c.put("/api/templates/new", json={
            **JEE, "subjects": [
                {"name": "P", "questions": 0, "marks": 4, "negative": 1, "minutes": None},
            ]
        })
        self.assertEqual(r.status_code, 422)
        self.assertIn("errors", r.get_json())

    def test_list(self):
        self.c.put("/api/templates/new", json=JEE)
        r = self.c.get("/api/templates")
        self.assertEqual(r.status_code, 200)
        arr = r.get_json()
        self.assertEqual(len(arr), 1)
        self.assertEqual(arr[0]["id"], "jee_mains")
        self.assertEqual(arr[0]["subjects"][0]["name"], "Physics")

    def test_bad_id_404(self):
        r = self.c.get("/api/templates/..%2Fapp")
        self.assertEqual(r.status_code, 404)

    def test_delete_route(self):
        self.c.put("/api/templates/new", json=JEE)
        r = self.c.delete("/api/templates/jee_mains")
        self.assertEqual(r.status_code, 200)
        r2 = self.c.delete("/api/templates/jee_mains")
        self.assertEqual(r2.status_code, 404)


if __name__ == "__main__":
    unittest.main()