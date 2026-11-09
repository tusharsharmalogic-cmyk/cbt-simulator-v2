"""Progress summary: paper level, per-difficulty numbers, retry exclusion, ordering."""
import json

import config
from core import attempt_store, progress
from tests._base import TempDataCase


def row(status, t=10):
    return {"status": status, "choice": None if status == "blank" else "A",
            "answer": "A", "time_spent": t, "marked": False}


def make_attempt(aid, submitted_at, subjects, **extra):
    """subjects: {name: [(difficulty, chapter, status, time), ...]} (marks 4, neg 1)."""
    questions, res_subj = {}, []
    for name, items in subjects.items():
        questions[name] = [{"difficulty": d, "chapter": c} for d, c, _, _ in items]
        rows = [row(s, t) for _, _, s, t in items]
        c = sum(1 for r in rows if r["status"] == "correct")
        w = sum(1 for r in rows if r["status"] == "wrong")
        res_subj.append({"name": name, "rows": rows, "score": c * 4 - w, "max": len(rows) * 4})
    a = {"id": aid, "status": "submitted", "submitted_at": submitted_at, "created_at": submitted_at - 100,
         "test_name": f"Test {aid}", "template": {"name": "Tpl"}, "questions": questions,
         "result": {"subjects": res_subj}}
    a.update(extra)
    return a


class PaperLevelTest(TempDataCase):
    def lvl(self, **mix):
        return progress.paper_level(mix)["key"]

    def test_levels(self):
        self.assertEqual(self.lvl(easy=10), "easy")
        self.assertEqual(self.lvl(easy=5, medium=5), "easy")            # 1.5
        self.assertEqual(self.lvl(medium=10), "medium")
        self.assertEqual(self.lvl(easy=2, medium=5, hard=3), "medium")  # 2.1
        self.assertEqual(self.lvl(medium=4, hard=6), "hard")            # 2.6
        self.assertEqual(self.lvl(hard=10), "hard")

    def test_boundaries_are_medium(self):
        self.assertEqual(self.lvl(easy=1, medium=2), "medium")   # exactly 5/3
        self.assertEqual(self.lvl(medium=2, hard=1), "medium")   # exactly 7/3
        self.assertEqual(self.lvl(easy=1, hard=1), "medium")     # 2.0

    def test_unknown_when_too_few_tags(self):
        self.assertEqual(self.lvl(easy=6, unknown=4), "unknown")   # 60% tagged
        self.assertEqual(self.lvl(easy=7, unknown=3), "easy")      # exactly 70% is enough
        self.assertEqual(self.lvl(unknown=5), "unknown")
        self.assertEqual(progress.paper_level({})["key"], "unknown")
        self.assertIsNone(progress.paper_level({"unknown": 3})["index"])

    def test_tag_is_case_and_space_insensitive(self):
        self.assertEqual(progress._diff({"difficulty": "  HaRd "}), "hard")
        self.assertEqual(progress._diff({"difficulty": "tough"}), "unknown")
        self.assertEqual(progress._diff({"difficulty": None}), "unknown")
        self.assertEqual(progress._diff({}), "unknown")


class SummarizeTest(TempDataCase):
    def test_numbers(self):
        a = make_attempt("a1", 1000, {
            "P": [("easy", "Motion", "correct", 10), ("hard", "Motion", "wrong", 60),
                  ("hard", "Heat", "blank", 0), ("medium", "Heat", "correct", 20)],
            "M": [("hard", "Sets", "correct", 30), ("hard", "Sets", "wrong", 40)],
        })
        s = progress.summarize(a)
        self.assertEqual(s["total"]["total"], 6)
        self.assertEqual((s["total"]["correct"], s["total"]["wrong"], s["total"]["blank"]), (3, 2, 1))
        self.assertEqual(s["total"]["score"], 3 * 4 - 2)        # 10
        self.assertEqual(s["total"]["max"], 24)
        self.assertEqual(s["total"]["pct"], round(10 * 100 / 24, 1))
        self.assertEqual(s["total"]["accuracy"], 60.0)           # 3 / 5 attempted
        self.assertEqual(s["total"]["avg_time"], round(160 / 6, 1))
        self.assertEqual(s["mix"], {"easy": 1, "medium": 1, "hard": 4, "unknown": 0})
        self.assertEqual(s["level"]["key"], "hard")              # (1+2+12)/6 = 2.5
        self.assertEqual(s["difficulty"]["hard"]["total"], 4)
        self.assertEqual(s["difficulty"]["hard"]["correct"], 1)
        self.assertEqual(s["difficulty"]["hard"]["wrong"], 2)
        self.assertEqual(s["difficulty"]["hard"]["blank"], 1)
        self.assertEqual([x["name"] for x in s["subjects"]], ["P", "M"])
        ch = {(c["subject"], c["name"]): c for c in s["chapters"]}
        self.assertEqual(ch[("P", "Motion")]["total"], 2)
        self.assertEqual(ch[("M", "Sets")]["correct"], 1)

    def test_missing_and_bad_values_are_safe(self):
        a = make_attempt("a2", 1000, {"S": [("easy", "C", "correct", 5), ("easy", "C", "wrong", 5), ("easy", "C", "blank", 0)]})
        a["result"]["subjects"][0]["rows"][0]["time_spent"] = None
        a["result"]["subjects"][0]["rows"][1]["time_spent"] = "abc"
        a["result"]["subjects"][0]["rows"][2].pop("time_spent")
        a["questions"]["S"][0].pop("chapter")
        a["questions"]["S"][1]["chapter"] = ""
        s = progress.summarize(a)
        self.assertEqual(s["total"]["avg_time"], 0.0)
        self.assertEqual(sorted(c["name"] for c in s["chapters"]), ["C", "Unknown"])
        self.assertEqual(next(c for c in s["chapters"] if c["name"] == "Unknown")["total"], 2)
        self.assertNotIn("nan", json.dumps(s).lower())

    def test_all_blank_has_no_accuracy_and_zero_max_has_no_pct(self):
        a = make_attempt("a3", 1000, {"S": [("easy", "C", "blank", 0), ("easy", "C", "blank", 0)]})
        s = progress.summarize(a)
        self.assertIsNone(s["total"]["accuracy"])
        a["result"]["subjects"][0]["max"] = 0
        self.assertIsNone(progress.summarize(a)["total"]["pct"])

    def test_not_submitted_or_no_result_or_empty(self):
        a = make_attempt("a4", 1000, {"S": [("easy", "C", "correct", 5)]})
        a["status"] = "in_progress"
        self.assertIsNone(progress.summarize(a))
        a["status"] = "submitted"
        a["result"] = None
        self.assertIsNone(progress.summarize(a))
        self.assertIsNone(progress.summarize(make_attempt("a5", 1000, {"S": []})))
        self.assertIsNone(progress.summarize(None))

    def test_untagged_paper_is_unknown_level(self):
        a = make_attempt("a6", 1000, {"S": [(None, "C", "correct", 5)] * 4})
        s = progress.summarize(a)
        self.assertEqual(s["level"]["key"], "unknown")
        self.assertEqual(s["difficulty"]["unknown"]["total"], 4)


class BuildAndApiTest(TempDataCase):
    def setUp(self):
        super().setUp()
        import app
        self.c = app.create_app().test_client()

    def put(self, a):
        attempt_store.save(a)

    def test_empty(self):
        r = self.c.get("/api/progress")
        self.assertEqual(r.status_code, 200)
        j = r.get_json()
        self.assertEqual(j["attempts"], [])
        self.assertEqual(j["excluded_retries"], 0)
        self.assertEqual(j["level_rule"]["min_tagged"], 0.7)

    def test_order_filters_and_corrupt_file(self):
        base = {"S": [("easy", "C", "correct", 5), ("easy", "C", "wrong", 5)]}
        self.put(make_attempt("late", 3000, base))
        self.put(make_attempt("early", 1000, base))
        self.put(make_attempt("mid", 2000, base))
        self.put(make_attempt("retry1", 2500, base, retry_of="early", retry_mode="wrong"))
        ip = make_attempt("inprog", 4000, base)
        ip["status"] = "in_progress"
        self.put(ip)
        (config.ATTEMPTS_DIR / "garbage.json").write_text("{not json", encoding="utf-8")
        (config.ATTEMPTS_DIR / ".tmp_x.json").write_text("{}", encoding="utf-8")
        j = self.c.get("/api/progress").get_json()
        self.assertEqual([x["id"] for x in j["attempts"]], ["early", "mid", "late"])
        self.assertEqual(j["excluded_retries"], 1)

    def test_one_bad_attempt_does_not_break_others(self):
        self.put(make_attempt("good", 1000, {"S": [("easy", "C", "correct", 5)]}))
        bad = make_attempt("bad", 2000, {"S": [("easy", "C", "correct", 5)]})
        bad["result"]["subjects"] = "oops"
        self.put(bad)
        j = self.c.get("/api/progress").get_json()
        self.assertEqual([x["id"] for x in j["attempts"]], ["good"])