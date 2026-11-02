"""Scoring edge cases per spec Step 6."""
import unittest


def _attempt(tmpl_subjects, qs_by_subj, responses_by_subj):
    return {
        "template": {"subjects": tmpl_subjects},
        "questions": qs_by_subj,
        "responses": responses_by_subj,
    }


def mk_q(*answers):
    return [{"answer": a} for a in answers]


def mk_r(*choices):
    return [{"choice": c, "time_spent": 1.5} for c in choices]


class ScoringEdge(unittest.TestCase):
    def score(self, a):
        from core.scoring import compute
        return compute(a)

    def test_mixed_marks_and_negative_decimals(self):
        a = _attempt(
            [
                {"name": "P", "marks": 4, "negative": 1},
                {"name": "C", "marks": 1, "negative": 0.25},
            ],
            {"P": mk_q("A", "B"), "C": mk_q("A", "A")},
            {"P": mk_r("A", "B"), "C": mk_r("B", "A")},
        )
        r = self.score(a)
        self.assertEqual(r["subjects"][0]["score"], 8.0)  # 2*4 - 0*1
        self.assertEqual(r["subjects"][1]["score"], 0.75)  # 1*1 - 1*0.25
        self.assertEqual(r["total"]["score"], 8.75)
        self.assertEqual(r["total"]["max"], 2 * 4 + 2 * 1)

    def test_all_blank(self):
        a = _attempt(
            [{"name": "P", "marks": 4, "negative": 1}],
            {"P": mk_q("A", "B", "C")},
            {"P": mk_r(None, None, None)},
        )
        r = self.score(a)
        self.assertEqual(r["total"]["score"], 0)
        self.assertEqual(r["total"]["blank"], 3)
        self.assertEqual(r["subjects"][0]["accuracy"], 0.0)

    def test_all_correct(self):
        a = _attempt(
            [{"name": "P", "marks": 4, "negative": 1}],
            {"P": mk_q("A", "B", "C")},
            {"P": mk_r("A", "B", "C")},
        )
        r = self.score(a)
        self.assertEqual(r["total"]["score"], 12.0)
        self.assertEqual(r["total"]["accuracy"], 1.0)

    def test_all_wrong(self):
        a = _attempt(
            [{"name": "P", "marks": 4, "negative": 1}],
            {"P": mk_q("A", "B")},
            {"P": mk_r("B", "A")},
        )
        r = self.score(a)
        self.assertEqual(r["total"]["score"], -2.0)
        self.assertEqual(r["total"]["wrong"], 2)

    def test_marked_but_answered_counts_as_answered(self):
        # marked doesn't change scoring; choice decides
        a = _attempt(
            [{"name": "P", "marks": 4, "negative": 1}],
            {"P": mk_q("A")},
            {"P": [{"choice": "A", "marked": True, "time_spent": 2}]},
        )
        r = self.score(a)
        self.assertEqual(r["subjects"][0]["correct"], 1)
        self.assertEqual(r["subjects"][0]["wrong"], 0)

    def test_time_spent_sums(self):
        a = _attempt(
            [{"name": "P", "marks": 4, "negative": 1}],
            {"P": mk_q("A", "B")},
            {"P": [
                {"choice": None, "time_spent": 2.5},
                {"choice": None, "time_spent": 3.5},
            ]},
        )
        r = self.score(a)
        self.assertEqual(r["subjects"][0]["time_spent"], 6.0)

    def test_rounding_two_decimals(self):
        # 0.1*0.3 style floating-point trap
        a = _attempt(
            [{"name": "P", "marks": 0.1, "negative": 0.3}],
            {"P": mk_q("A", "B", "C")},
            {"P": mk_r("A", "C", "B")},  # 1 correct, 2 wrong
        )
        r = self.score(a)
        # 0.1 - 0.3*2 = -0.5
        self.assertEqual(r["subjects"][0]["score"], -0.5)

    def test_rows_have_expected_shape(self):
        a = _attempt(
            [{"name": "P", "marks": 4, "negative": 1}],
            {"P": mk_q("A")},
            {"P": [{"choice": "A", "marked": True, "time_spent": 1.2}]},
        )
        r = self.score(a)
        row = r["subjects"][0]["rows"][0]
        self.assertEqual(row["status"], "correct")
        self.assertEqual(row["choice"], "A")
        self.assertEqual(row["answer"], "A")
        self.assertEqual(row["marked"], True)
        self.assertAlmostEqual(row["time_spent"], 1.2)

    def test_sample_expected_by_hand(self):
        # Physics: Q0=A(correct), Q1=C(answer B -> wrong)
        # Chemistry: Q0 unset (answer B) -> blank
        # Maths: Q0 unset (answer B) -> blank
        a = _attempt(
            [
                {"name": "Physics", "marks": 4, "negative": 1},
                {"name": "Chemistry", "marks": 4, "negative": 1},
                {"name": "Maths", "marks": 4, "negative": 1},
            ],
            {
                "Physics": mk_q("A", "B"),
                "Chemistry": mk_q("B"),
                "Maths": mk_q("B"),
            },
            {
                "Physics": mk_r("A", "C"),
                "Chemistry": mk_r(None),
                "Maths": mk_r(None),
            },
        )
        r = self.score(a)
        self.assertEqual(r["total"]["score"], 4 - 1)  # 3
        self.assertEqual(r["total"]["correct"], 1)
        self.assertEqual(r["total"]["wrong"], 1)
        self.assertEqual(r["total"]["blank"], 2)
        self.assertEqual(r["total"]["max"], 16.0)


if __name__ == "__main__":
    unittest.main()