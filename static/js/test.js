// Test screen. state.attempt (server view) + testCtl (timing) ka use karta hai.
// All actions callback se jaate hain -> main.js server pe call karke refresh karta hai.

const testScreen = (() => {

  // ---------- Navigation helpers (pure) ----------
  function subjectsOf(a) { return Object.keys(a.questions); }

  function hasPrev(a) {
    if (a.current.index > 0) return true;
    return subjectsOf(a).indexOf(a.current.subject) > 0;
  }

  function hasNext(a) {
    const qs = a.questions[a.current.subject] || [];
    if (a.current.index < qs.length - 1) return true;
    return subjectsOf(a).indexOf(a.current.subject) < subjectsOf(a).length - 1;
  }

  function prevTarget(a) {
    if (a.current.index > 0) return { subject: a.current.subject, index: a.current.index - 1 };
    const subs = subjectsOf(a);
    const si = subs.indexOf(a.current.subject);
    if (si > 0) {
      const ns = subs[si - 1];
      return { subject: ns, index: (a.questions[ns] || []).length - 1 };
    }
    return null;
  }

  function nextTarget(a) {
    const qs = a.questions[a.current.subject] || [];
    if (a.current.index < qs.length - 1) return { subject: a.current.subject, index: a.current.index + 1 };
    const subs = subjectsOf(a);
    const si = subs.indexOf(a.current.subject);
    if (si < subs.length - 1) {
      const ns = subs[si + 1];
      return { subject: ns, index: 0 };
    }
    return null;
  }

  function formatTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return [h, m, s].map(x => String(x).padStart(2, '0')).join(':');
  }

  function lockedSubjects(a, timing) {
    const set = new Set();
    if (timing && timing.mode === 'subject') {
      (timing.locked_subjects || []).forEach(s => set.add(s));
      if (timing.subject) {
        const subs = subjectsOf(a);
        const ci = timing.subject.index;
        subs.forEach((s, i) => { if (i !== ci) set.add(s); });
      }
    }
    // per-subject lock (from attempt.locks)
    if (a && a.locks) {
      Object.entries(a.locks).forEach(([subj, info]) => {
        if (info && info.subject_locked) set.add(subj);
      });
    }
    return set;
  }

  // ---------- Render ----------
  function qLockRemaining(a, subj, idx, nowMs) {
    const ts = (a.template && a.template.subjects || []).find(s => s.name === subj);
    if (!ts || ts.lock_mode !== 'question' || !ts.per_question_seconds) return null;
    const r = (a.responses[subj] || [])[idx];
    if (!r || r.q_started_at == null) return null;
    return Math.max(0, r.q_started_at + ts.per_question_seconds - nowMs / 1000);
  }
  function sLockRemaining(a, subj, nowMs) {
    const ts = (a.template && a.template.subjects || []).find(s => s.name === subj);
    if (!ts || ts.lock_mode !== 'subject' || !ts.subject_minutes) return null;
    const started = (a.subject_started_at || {})[subj];
    if (started == null) return null;
    return Math.max(0, started + ts.subject_minutes * 60 - nowMs / 1000);
  }

  function render(a, opts) {
    // opts: {onChange(action), onOpenPalette(), onSubmit(), remainingSeconds, timing, onSubjectTab(subj)}
    const root = el('div', 'test-screen');
    const timing = opts.timing || a.timing;
    const locked = lockedSubjects(a, timing);
    const isSubjectMode = timing && timing.mode === 'subject';
    const nowMs = performance.now() + 0; // just for initial render

    // Timer bar
    const timerBar = el('div', 'test-timer-bar');
    const timerLeft = el('div', 'timer-left');
    timerLeft.append(el('span', 'timer', '⏱ ' + formatTime(opts.remainingSeconds ?? 0)));
    if (isSubjectMode && timing.subject) {
      timerLeft.append(el('span', 'subj-timer-label', ' | ' + timing.subject.name + ' '));
      timerLeft.append(el('span', 'subj-timer', formatTime(timing.subject.remaining_seconds)));
    }
    // Per-subject / per-Q lock timer (client-side from timestamps)
    const curSubj0 = a.current.subject;
    const curIdx0 = a.current.index;
    const sRem0 = sLockRemaining(a, curSubj0, Date.now());
    if (sRem0 != null) {
      timerLeft.append(el('span', 'subj-timer-label', ' | 🔒 ' + curSubj0 + ' '));
      timerLeft.append(el('span', 'lock-timer subj-lock', formatTime(sRem0)));
    }
    const qRem0 = qLockRemaining(a, curSubj0, curIdx0, Date.now());
    if (qRem0 != null) {
      timerLeft.append(el('span', 'subj-timer-label', ' | 🔒 Q '));
      timerLeft.append(el('span', 'lock-timer q-lock', formatTime(qRem0)));
    }
    timerBar.append(timerLeft);

    const rightSide = el('div', 'timer-right');
    const palBtn = el('button', 'btn ghost small', '⊞ Palette');
    palBtn.type = 'button';
    palBtn.addEventListener('click', () => opts.onOpenPalette && opts.onOpenPalette());
    rightSide.append(palBtn);
    const submitBtn = el('button', 'btn small submit-btn', 'Submit');
    submitBtn.type = 'button';
    submitBtn.addEventListener('click', () => opts.onSubmit && opts.onSubmit());
    rightSide.append(submitBtn);
    timerBar.append(rightSide);
    root.append(timerBar);

    // Subject tabs
    const tabs = el('div', 'subject-tabs');
    subjectsOf(a).forEach(subj => {
      const lk = locked.has(subj);
      const cls = 'subj-tab' + (subj === a.current.subject ? ' active' : '') + (lk ? ' locked' : '');
      const b = el('button', cls, subj + (lk ? ' 🔒' : ''));
      b.type = 'button';
      b.disabled = lk;
      b.addEventListener('click', () => {
        if (lk || subj === a.current.subject) return;
        opts.onSubjectTab && opts.onSubjectTab(subj);
      });
      tabs.append(b);
    });
    root.append(tabs);

    // Question
    const subj = a.current.subject;
    const idx = a.current.index;
    const q = (a.questions[subj] || [])[idx];
    const r = (a.responses[subj] || [])[idx];

    const curSubjLockRem = sLockRemaining(a, subj, Date.now());
    const curQLockRem = qLockRemaining(a, subj, idx, Date.now());
    const qLocked = (curSubjLockRem != null && curSubjLockRem <= 0)
                 || (curQLockRem != null && curQLockRem <= 0);

    if (!q) {
      root.append(el('p', 'error', 'Question missing'));
    } else {
      const qCard = renderQuestion(q, idx + 1, {
        showSolution: false,
        choice: r ? r.choice : null,
        onSelect: qLocked ? null : (letter) => {
          if (r && r.choice === letter) return;
          opts.onChange && opts.onChange({ type: 'answer', subject: subj, index: idx, choice: letter });
        },
      });
      if (r && r.marked) qCard.classList.add('marked-q');
      if (qLocked) {
        qCard.classList.add('locked-q');
        qCard.append(el('div', 'locked-banner', '🔒 Yeh question lock ho chuka hai'));
      }
      root.append(qCard);

      const info = el('div', 'qinfo');
      info.append(el('span', 'qinfo-count', `Q${idx + 1} / ${(a.questions[subj] || []).length}`));
      if (r && r.marked) info.append(el('span', 'chip marked-chip', 'Marked'));
      if (r && r.choice) info.append(el('span', 'chip ans-chip', 'Answered'));
      root.append(info);
    }

    // Bottom nav
    const bar = el('div', 'bottom-nav');
    const prevBtn = el('button', 'nav-btn', '← Prev');
    prevBtn.type = 'button';
    prevBtn.disabled = !hasPrev(a);
    prevBtn.addEventListener('click', () => {
      const t = prevTarget(a);
      if (t) opts.onChange && opts.onChange({ type: 'navigate', subject: t.subject, index: t.index });
    });

    const markBtn = el('button', 'nav-btn' + (r && r.marked ? ' active' : ''),
                        r && r.marked ? 'Unmark' : 'Mark');
    markBtn.type = 'button';
    markBtn.disabled = qLocked;
    markBtn.addEventListener('click', () => {
      if (!r || qLocked) return;
      opts.onChange && opts.onChange({ type: 'mark', subject: subj, index: idx, marked: !r.marked });
    });

    const clearBtn = el('button', 'nav-btn', 'Clear');
    clearBtn.type = 'button';
    clearBtn.disabled = !(r && r.choice) || qLocked;
    clearBtn.addEventListener('click', () => {
      if (!r || qLocked) return;
      opts.onChange && opts.onChange({ type: 'clear', subject: subj, index: idx });
    });

    const nextBtn = el('button', 'nav-btn primary', 'Next →');
    nextBtn.type = 'button';
    nextBtn.disabled = !hasNext(a);
    nextBtn.addEventListener('click', () => {
      const t = nextTarget(a);
      if (t) opts.onChange && opts.onChange({ type: 'navigate', subject: t.subject, index: t.index });
    });

    bar.append(prevBtn, markBtn, clearBtn, nextBtn);
    root.append(bar);

    return root;
  }

  return { render, formatTime, subjectsOf, prevTarget, nextTarget, lockedSubjects };
})();