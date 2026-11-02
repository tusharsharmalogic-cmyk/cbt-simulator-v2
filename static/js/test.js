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
    if (!timing || timing.mode !== 'subject') return new Set();
    const set = new Set(timing.locked_subjects || []);
    // future subjects bhi lock (jo current ke baad hain)
    if (timing.subject) {
      const subs = subjectsOf(a);
      const ci = timing.subject.index;
      subs.forEach((s, i) => { if (i !== ci) set.add(s); });
    }
    return set;
  }

  // ---------- Render ----------
  function render(a, opts) {
    // opts: {onChange(action), onOpenPalette(), onSubmit(), remainingSeconds, timing, onSubjectTab(subj)}
    const root = el('div', 'test-screen');
    const timing = opts.timing || a.timing;
    const locked = lockedSubjects(a, timing);
    const isSubjectMode = timing && timing.mode === 'subject';

    // Timer bar
    const timerBar = el('div', 'test-timer-bar');
    const timerLeft = el('div', 'timer-left');
    timerLeft.append(el('span', 'timer', '⏱ ' + formatTime(opts.remainingSeconds ?? 0)));
    if (isSubjectMode && timing.subject) {
      timerLeft.append(el('span', 'subj-timer-label', ' | ' + timing.subject.name + ' '));
      timerLeft.append(el('span', 'subj-timer', formatTime(timing.subject.remaining_seconds)));
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

    if (!q) {
      root.append(el('p', 'error', 'Question missing'));
    } else {
      const qCard = renderQuestion(q, idx + 1, {
        showSolution: false,
        choice: r ? r.choice : null,
        onSelect: (letter) => {
          if (r && r.choice === letter) return;
          opts.onChange && opts.onChange({ type: 'answer', subject: subj, index: idx, choice: letter });
        },
      });
      if (r && r.marked) qCard.classList.add('marked-q');
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
    markBtn.addEventListener('click', () => {
      if (!r) return;
      opts.onChange && opts.onChange({ type: 'mark', subject: subj, index: idx, marked: !r.marked });
    });

    const clearBtn = el('button', 'nav-btn', 'Clear');
    clearBtn.type = 'button';
    clearBtn.disabled = !(r && r.choice);
    clearBtn.addEventListener('click', () => {
      if (!r) return;
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