// Test screen (UI only, Step 4). State.attempt ke saath kaam karta hai.
// Step 5 me source state ko server se load karega, baaki UI same rahega.

const testScreen = (() => {

  // ---------- Attempt factory ----------
  function makeAttempt(template, test) {
    const questions = {};
    const responses = {};
    (template.subjects || []).forEach(s => {
      const subj = s.name;
      const pool = (test.subjects && test.subjects[subj]) || [];
      const qs = pool.slice(0, s.questions).map(q => ({
        q: q.q,
        svg: q.svg,
        options: [...(q.options || [])],
        answer: q.answer,
        solution: q.solution,
      }));
      questions[subj] = qs;
      responses[subj] = qs.map(() => ({ choice: null, marked: false, visited: false, time_spent: 0 }));
    });
    const firstSubj = template.subjects && template.subjects[0] ? template.subjects[0].name : null;
    return {
      id: 'local_' + Date.now(),
      status: 'in_progress',
      created_at: Date.now() / 1000,
      start_time: Date.now() / 1000,
      template: JSON.parse(JSON.stringify(template)),
      test_id: test.id || null,
      test_name: test.name || 'Test',
      questions,
      responses,
      current: { subject: firstSubj, index: 0 },
      submitted_at: null,
      submit_reason: null,
      result: null,
    };
  }

  // ---------- Navigation helpers ----------
  function subjectsOf(a) { return Object.keys(a.questions); }

  function visitCurrent(a) {
    const { subject, index } = a.current;
    const r = a.responses[subject] && a.responses[subject][index];
    if (r) r.visited = true;
  }

  function hasPrev(a) {
    if (a.current.index > 0) return true;
    const subs = subjectsOf(a);
    return subs.indexOf(a.current.subject) > 0;
  }

  function hasNext(a) {
    const qs = a.questions[a.current.subject] || [];
    if (a.current.index < qs.length - 1) return true;
    const subs = subjectsOf(a);
    return subs.indexOf(a.current.subject) < subs.length - 1;
  }

  function goPrev(a) {
    if (a.current.index > 0) {
      a.current.index--;
    } else {
      const subs = subjectsOf(a);
      const si = subs.indexOf(a.current.subject);
      if (si > 0) {
        const newSubj = subs[si - 1];
        a.current = { subject: newSubj, index: (a.questions[newSubj] || []).length - 1 };
      }
    }
    visitCurrent(a);
  }

  function goNext(a) {
    const qs = a.questions[a.current.subject] || [];
    if (a.current.index < qs.length - 1) {
      a.current.index++;
    } else {
      const subs = subjectsOf(a);
      const si = subs.indexOf(a.current.subject);
      if (si < subs.length - 1) {
        const newSubj = subs[si + 1];
        a.current = { subject: newSubj, index: 0 };
      }
    }
    visitCurrent(a);
  }

  function jumpTo(a, subject, index) {
    a.current = { subject, index };
    visitCurrent(a);
  }

  // ---------- Format ----------
  function formatTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return [h, m, s].map(x => String(x).padStart(2, '0')).join(':');
  }

  // ---------- Render ----------
  function render(a, opts) {
    // opts: {onChange, onOpenPalette}
    const root = el('div', 'test-screen');

    // Timer bar (static in Step 4)
    const timerBar = el('div', 'test-timer-bar');
    const totalMin = (a.template && a.template.total_minutes) || 0;
    const timerText = totalMin ? formatTime(totalMin * 60) : '—';
    timerBar.append(el('span', 'timer', '⏱ ' + timerText));
    const palBtn = el('button', 'btn ghost small', '⊞ Palette');
    palBtn.type = 'button';
    palBtn.addEventListener('click', () => opts.onOpenPalette && opts.onOpenPalette());
    timerBar.append(palBtn);
    root.append(timerBar);

    // Subject tabs
    const tabs = el('div', 'subject-tabs');
    subjectsOf(a).forEach(subj => {
      const b = el('button', 'subj-tab' + (subj === a.current.subject ? ' active' : ''), subj);
      b.type = 'button';
      b.addEventListener('click', () => {
        if (subj === a.current.subject) return;
        jumpTo(a, subj, 0);
        opts.onChange && opts.onChange();
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
          if (!r) return;
          r.choice = letter;   // same letter tap = no-op (use Clear)
          opts.onChange && opts.onChange();
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
    prevBtn.addEventListener('click', () => { goPrev(a); opts.onChange && opts.onChange(); });

    const markBtn = el('button', 'nav-btn' + (r && r.marked ? ' active' : ''),
                        r && r.marked ? 'Unmark' : 'Mark');
    markBtn.type = 'button';
    markBtn.addEventListener('click', () => {
      if (!r) return;
      r.marked = !r.marked;
      opts.onChange && opts.onChange();
    });

    const clearBtn = el('button', 'nav-btn', 'Clear');
    clearBtn.type = 'button';
    clearBtn.disabled = !(r && r.choice);
    clearBtn.addEventListener('click', () => {
      if (!r) return;
      r.choice = null;
      opts.onChange && opts.onChange();
    });

    const nextBtn = el('button', 'nav-btn primary', 'Next →');
    nextBtn.type = 'button';
    nextBtn.disabled = !hasNext(a);
    nextBtn.addEventListener('click', () => { goNext(a); opts.onChange && opts.onChange(); });

    bar.append(prevBtn, markBtn, clearBtn, nextBtn);
    root.append(bar);

    return root;
  }

  return { makeAttempt, render, formatTime, visitCurrent, jumpTo, subjectsOf };
})();