"""Test ke saath saved template + schedule me template skip."""
import json
import unittest

import config
from tests._base import TempDataCase

TPL = {
    "name": "Mini", "timer_mode": "total", "total_minutes": 10,
    "subjects": [{"name": "Physics", "questions": 1, "marks": 1, "negative": 0, "minutes": None}],
}
TEST = {"name": "T1", "subjects": {"Physics": [
    {"q": "x?", "options": ["a", "b"], "answer": "A", "solution": "s"}]}}


class TestTemplateRoutes(TempDataCase):
    def setUp(self):
        super().setUp()
        from app import create_app
        self.c = create_app().test_client()
        from core.template_store import save_template
        self.tid, _ = save_template("new", TPL)
        self.tid2, _ = save_template("new", dict(TPL, name="Other"))
        (config.TESTS_DIR / "t1.json").write_text(json.dumps(TEST), encoding="utf-8")

    def _items(self):
        return self.c.get("/api/test-template").get_json()["items"]

    def test_set_get_clear(self):
        self.assertEqual(self._items(), {})
        r = self.c.put("/api/test-template/t1", json={"template_id": self.tid})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self._items(), {"t1": self.tid})
        self.c.delete("/api/test-template/t1")
        self.assertEqual(self._items(), {})

    def test_validation(self):
        self.assertEqual(self.c.put("/api/test-template/nope", json={"template_id": self.tid}).status_code, 404)
        self.assertEqual(self.c.put("/api/test-template/t1", json={"template_id": "zzz"}).status_code, 422)
        self.assertEqual(self.c.put("/api/test-template/t1", json={}).status_code, 422)

    def test_schedule_needs_template_when_none_saved(self):
        r = self.c.put("/api/schedule/t1", json={"date": "2026-11-10"})
        self.assertEqual(r.status_code, 422)

    def test_schedule_uses_saved_template(self):
        self.c.put("/api/test-template/t1", json={"template_id": self.tid})
        r = self.c.put("/api/schedule/t1", json={"date": "2026-11-10"})
        self.assertEqual(r.status_code, 200)
        item = self.c.get("/api/schedule").get_json()["items"][0]
        self.assertEqual(item["template_id"], self.tid)

    def test_schedule_with_template_saves_it_on_test(self):
        r = self.c.put("/api/schedule/t1", json={"date": "2026-11-10", "template_id": self.tid})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self._items(), {"t1": self.tid})

    def test_changing_template_updates_schedule(self):
        self.c.put("/api/schedule/t1", json={"date": "2026-11-10", "template_id": self.tid})
        self.c.put("/api/test-template/t1", json={"template_id": self.tid2})
        item = self.c.get("/api/schedule").get_json()["items"][0]
        self.assertEqual(item["template_id"], self.tid2)

    def test_cleanup_on_test_and_template_delete(self):
        self.c.put("/api/test-template/t1", json={"template_id": self.tid})
        self.c.delete(f"/api/templates/{self.tid}")
        self.assertEqual(self._items(), {})
        self.c.put("/api/test-template/t1", json={"template_id": self.tid2})
        self.c.delete("/api/tests/t1")
        self.assertEqual(self._items(), {})

    def test_template_survives_attempt_start(self):
        self.c.put("/api/test-template/t1", json={"template_id": self.tid})
        self.c.put("/api/schedule/t1", json={"date": "2026-11-10"})
        r = self.c.post("/api/attempts", json={"template_id": self.tid, "test_ids": ["t1"]})
        self.assertEqual(r.status_code, 200)
        self.c.delete("/api/schedule/t1")
        self.assertEqual(self._items(), {"t1": self.tid})


if __name__ == "__main__":
    unittest.main()
