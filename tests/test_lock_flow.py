"""End-to-end lock flow: per-Q and per-subject locks.

Regression for:
- answer/mark/visit on locked Q must return 409 (not 422) with `next` target
- after 409, server-side `current` advances to that target; a second call to
  the SAME locked Q returns the SAME next (idempotent, no re-bounce)
- all-locked attempt auto-finalizes on next GET
- mutual-exclusivity in template validation
"""
import time
import unittest

import config
from core import attempt_store, template_store, timer
from tests._base import TempDataCase

Q = [
    {"q": "q1", "options": ["a", "b"], "answer": "A"},
    {"q": "q2", "options": ["a", "b"], "answer": "A"},
    {"q": "q3", "options": ["a", "b"], "answer": "A"},
]

class LockFlow(TempDataCase):
    def _make(self, lock_mode="question", per_q=5, subj_min=1):
        sub = {"name": "S", "questions": 3, "marks": 4, "negative": 1,
               "lock_mode": lock_mode}
        if lock_mode == "question":
            sub["per_question_seconds"] = per_q
        elif lock_mode == "subject":
            sub["subject_minutes"] = subj_min
        tpl = {"name": "T", "timer_mode": "total", "total_minutes": 60,
               "subjects": [sub]}
        clean, errs = template_store.validate_template(tpl)
        assert not errs, errs
        return clean

    def _attempt(self, clean):
        test = {"name": "t", "subjects": {"S": [dict(q) for q in Q]}}
        return attempt_store.create_attempt(clean, test, "t")

    # ---------- per-question ----------

    def test_q_locked_blocks_answer(self):
        a = self._attempt(self._make("question", per_q=5))
        a["responses"]["S"][0]["q_started_at"] = time.time() - 10
        self.assertTrue(timer.question_is_locked(a, "S", 0))
        self.assertFalse(timer.question_is_locked(a, "S", 1))
        with self.assertRaises(ValueError) as cm:
            attempt_store.apply_answer(a, "S", 0, "B")
        self.assertEqual(str(cm.exception), "question_locked")

    def test_q_locked_blocks_mark_and_visit(self):
        a = self._attempt(self._make("question", per_q=5))
        a["responses"]["S"][0]["q_started_at"] = time.time() - 10
        with self.assertRaises(ValueError):
            attempt_store.apply_mark(a, "S", 0, True)
        # apply_visit itself doesn't check lock (route does) - just verify
        # that the client_view reports it locked
        v = attempt_store.client_view(a)
        self.assertTrue(v["locks"]["S"]["questions"][0]["locked"])
        self.assertFalse(v["locks"]["S"]["questions"][1]["locked"])

    # ---------- HTTP flow via route helpers ----------

    def test_locked_response_advances_current(self):
        """_locked_response must move server-side `current` to next unlocked
        so the follow-up client refresh doesn't bounce back."""
        from core.routes_attempt import _locked_response
        from app import create_app
        a = self._attempt(self._make("question", per_q=5))
        a["responses"]["S"][0]["q_started_at"] = time.time() - 10
        a["responses"]["S"][1]["q_started_at"] = time.time() - 10
        a["current"] = {"subject": "S", "index": 0}

        with create_app().test_request_context("/"):
            resp, code = _locked_response(a, "question_locked")
        self.assertEqual(code, 409)
        body = resp.get_json()
        self.assertEqual(body["error"], "question_locked")
        self.assertEqual(body["next"], {"subject": "S", "index": 2})
        self.assertEqual(a["current"], {"subject": "S", "index": 2})

        # persisted on disk
        saved = attempt_store.load(a["id"])
        self.assertEqual(saved["current"], {"subject": "S", "index": 2})
        self.assertIsNotNone(saved["responses"]["S"][2]["q_started_at"])

    def test_locked_response_idempotent(self):
        """Calling it again for the same locked Q returns the same next."""
        from core.routes_attempt import _locked_response
        from app import create_app
        a = self._attempt(self._make("question", per_q=5))
        a["responses"]["S"][0]["q_started_at"] = time.time() - 10
        a["current"] = {"subject": "S", "index": 0}
        with create_app().test_request_context("/"):
            r1, _ = _locked_response(a, "question_locked")
            n1 = r1.get_json()["next"]
            # simulate client landing on locked Q again (stale state)
            a["current"] = {"subject": "S", "index": 0}
            r2, _ = _locked_response(a, "question_locked")
            n2 = r2.get_json()["next"]
        self.assertEqual(n1, n2)
        self.assertEqual(n1, {"subject": "S", "index": 1})

    # ---------- per-subject ----------

    def test_subject_locked_blocks_all(self):
        a = self._attempt(self._make("subject", subj_min=1))
        a["subject_started_at"]["S"] = time.time() - 120
        self.assertTrue(timer.subject_is_locked(a, "S"))
        for i in range(3):
            self.assertTrue(timer.question_is_locked(a, "S", i))

    # ---------- all-locked auto submit ----------

    def test_all_locked_auto_submits(self):
        a = self._attempt(self._make("question", per_q=5))
        now = time.time()
        for i in range(3):
            a["responses"]["S"][i]["q_started_at"] = now - 10
        self.assertTrue(timer.all_questions_locked(a))
        a2, just = attempt_store.ensure_finalized(a)
        self.assertTrue(just)
        self.assertEqual(a2["status"], "submitted")
        self.assertEqual(a2["submit_reason"], "all_locked")

    # ---------- validation ----------

    def test_mutual_exclusive_lock_rejected(self):
        sub = {"name": "S", "questions": 3, "marks": 4, "negative": 1,
               "lock_mode": "question", "per_question_seconds": 30,
               "subject_minutes": 10}
        tpl = {"name": "T", "timer_mode": "total", "total_minutes": 60,
               "subjects": [sub]}
        _, errs = template_store.validate_template(tpl)
        self.assertTrue(any("dono ek saath" in e for e in errs), errs)


if __name__ == "__main__":
    unittest.main()