"""Subject-wise scoring. Pure function — Step 5 ka auto-submit isko call karta hai.

per subject: correct, wrong, blank, score = correct*marks - wrong*negative, max = q*marks
per question: {status, choice, answer, time_spent}
totals: score, max, correct, wrong, blank, accuracy
"""


def compute(attempt):
    tmpl = attempt.get("template") or {}
    responses = attempt.get("responses") or {}
    questions = attempt.get("questions") or {}

    subjects_out = []
    total_score = 0.0
    total_max = 0.0
    total_correct = total_wrong = total_blank = 0

    for s in tmpl.get("subjects") or []:
        name = s.get("name")
        if not name:
            continue
        marks = float(s.get("marks") or 0)
        neg = float(s.get("negative") or 0)

        qs = questions.get(name) or []
        rs = responses.get(name) or []

        correct = wrong = blank = 0
        rows = []
        time_spent = 0.0
        for i, q in enumerate(qs):
            r = rs[i] if i < len(rs) else {}
            choice = r.get("choice")
            answer = q.get("answer")
            ts = float(r.get("time_spent") or 0)
            time_spent += ts
            if not choice:
                blank += 1
                status = "blank"
            elif choice == answer:
                correct += 1
                status = "correct"
            else:
                wrong += 1
                status = "wrong"
            rows.append({
                "status": status,
                "choice": choice,
                "answer": answer,
                "time_spent": round(ts, 2),
                "marked": bool(r.get("marked")),
            })

        score = correct * marks - wrong * neg
        max_score = len(qs) * marks
        subj = {
            "name": name,
            "questions": len(qs),
            "correct": correct,
            "wrong": wrong,
            "blank": blank,
            "score": round(score, 2),
            "max": round(max_score, 2),
            "marks": marks,
            "negative": neg,
            "accuracy": round(correct / (correct + wrong), 4) if (correct + wrong) else 0.0,
            "time_spent": round(time_spent, 2),
            "rows": rows,
        }
        subjects_out.append(subj)
        total_score += score
        total_max += max_score
        total_correct += correct
        total_wrong += wrong
        total_blank += blank

    return {
        "subjects": subjects_out,
        "total": {
            "score": round(total_score, 2),
            "max": round(total_max, 2),
            "correct": total_correct,
            "wrong": total_wrong,
            "blank": total_blank,
            "accuracy": round(total_correct / (total_correct + total_wrong), 4) if (total_correct + total_wrong) else 0.0,
        },
    }