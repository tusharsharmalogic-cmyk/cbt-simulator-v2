// Result screen. attempt.result (server) ka use. Tabs: Overview / Analysis / Review.
// Analysis client pe a.questions (snapshot) + result rows se banta hai — backend change nahi.

const resultScreen = (() => {

  const DIFFS = ['easy', 'medium', 'hard', 'unknown'];
  const DIFF_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard', unknown: 'Unknown' };

  function render(a, opts) {
    // opts: {onRetry}
    const r = a.result;
    if (!r) return el('p', 'error', 'Result missing');

    const root = el('div', 'stack result-screen');
    root.append(renderTop(a, r));

    // ---- Tabs ----
    const reviewPane = renderReview(a, r);
    const tabs = [
      { key: 'overview', label: 'Overview', pane: renderOverview(a, r, opts) },
      { key: 'analysis', label: 'Analysis', pane: renderAnalysis(a, r, {
        onReview: (flt) => {
          reviewPane.applyFilter(flt);
          show('review');
          if (typeof window !== 'undefined' && window.scrollTo) window.scrollTo(0, 0);
        },
      }) },
      { key: 'review', label: 'Review', pane: reviewPane },
    ];
    const tabBar = el('div', 'result-tabs');
    const btns = {};
    const show = (key) => {
      tabs.forEach(t => {
        t.pane.hidden = t.key !== key;
        btns[t.key].classList.toggle('active', t.key === key);
      });
    };
    tabs.forEach(t => {
      const b = el('button', 'result-tab', t.label);
      b.type = 'button';
      b.addEventListener('click', () => show(t.key));
      btns[t.key] = b;
      tabBar.append(b);
    });
    root.append(tabBar);
    tabs.forEach(t => root.append(t.pane));
    show('overview');

    const back = el('button', 'btn wide', 'Home');
    back.type = 'button';
    back.addEventListener('click', () => { location.hash = '#/home'; });
    root.append(back);

    return root;
  }

  // ---------- Top summary ----------
  function renderTop(a, r) {
    const top = el('div', 'card result-top');
    const score = el('div', 'result-score');
    score.append(el('span', 'score-num', String(r.total.score)));
    score.append(el('span', 'score-max', ` / ${r.total.max}`));
    top.append(score);
    if (r.total.max > 0) {
      const pct = Math.round((r.total.score / r.total.max) * 1000) / 10;
      top.append(el('div', 'score-pct center', `${pct}%`));
    }
    top.append(el('div', 'muted center', `${(a.template && a.template.name) || ''} • ${a.test_name || ''}`));

    const cwb = el('div', 'result-cwb');
    cwb.append(chip('✓', r.total.correct, 'ok'));
    cwb.append(chip('✗', r.total.wrong, 'bad'));
    cwb.append(chip('—', r.total.blank, 'muted'));
    if (typeof r.total.accuracy === 'number') {
      cwb.append(chip('Acc', `${Math.round(r.total.accuracy * 100)}%`, 'info'));
    }
    top.append(cwb);

    if (a.submit_reason === 'time_up') {
      top.append(el('div', 'muted center small-gap', '⏱ Time up — auto-submitted'));
    } else if (a.submitted_at) {
      top.append(el('div', 'muted center small-gap', formatDate(a.submitted_at)));
    }
    return top;
  }

  // ---------- Tab 1: Overview ----------
  function renderOverview(a, r, opts) {
    const pane = el('div', 'stack result-pane');

    pane.append(el('h2', 'section-title', 'Subject wise'));
    (r.subjects || []).forEach(s => {
      const card = el('div', 'card');
      card.append(el('h3', '', s.name));
      const grid = el('div', 'subj-grid');
      grid.append(kv('Score', `${s.score} / ${s.max}`));
      grid.append(kv('Correct', s.correct));
      grid.append(kv('Wrong', s.wrong));
      grid.append(kv('Blank', s.blank));
      grid.append(kv('Accuracy', `${Math.round((s.accuracy || 0) * 100)}%`));
      grid.append(kv('Time', formatDuration(s.time_spent)));
      card.append(grid);
      pane.append(card);
    });

    // ---- Retry (snapshot se naya attempt) ----
    const retryCard = el('div', 'card retry-card');
    retryCard.append(el('h3', '', 'Practice again'));
    retryCard.append(el('div', 'muted small', 'Isi test ke questions se naya attempt banao — purana result safe rehta hai.'));
    const retryRow = el('div', 'actions-row');
    const retryMsg = el('div', 'muted small', '');
    const weak = (r.total.wrong || 0) + (r.total.blank || 0);
    const fullBtn = el('button', 'btn', '↻ Retry full test');
    const wrongBtn = el('button', 'btn ghost', `↻ Wrong + blank (${weak})`);
    const sendRetry = (mode, label) => {
      retryRow.querySelectorAll('button').forEach(b => { b.disabled = true; });
      retryMsg.textContent = 'Naya attempt ban raha hai...';
      if (opts && opts.onRetry) opts.onRetry(mode, label)
        .catch(e => {
          retryMsg.textContent = 'Retry fail: ' + ((e && e.message) || 'unknown');
          retryRow.querySelectorAll('button').forEach(b => { b.disabled = b === wrongBtn && weak === 0; });
        });
    };
    fullBtn.type = 'button';
    fullBtn.addEventListener('click', () => sendRetry('full', 'full'));
    retryRow.append(fullBtn);
    wrongBtn.type = 'button';
    wrongBtn.disabled = weak === 0;
    wrongBtn.addEventListener('click', () => sendRetry('wrong', 'wrong'));
    retryRow.append(wrongBtn);
    retryCard.append(retryRow, retryMsg);
    pane.append(retryCard);

    return pane;
  }

  // ---------- Tab 2: Analysis ----------
  const MIN_SAMPLE = 3;      // fewer questions than this -> "Low data"
  const STRONG_AT = 0.75;    // correct / total
  const WEAK_BELOW = 0.4;
  const MIN_ATTEMPTED = 5;   // min attempted questions in a subject for the blank-estimate
  const SORTS = [['weak', 'Weakest'], ['lost', 'Most marks lost'], ['time', 'Most time']];

  function emptyStat() { return { total: 0, correct: 0, wrong: 0, blank: 0, time: 0, lost: 0 }; }

  // time / marks / neg are optional (difficulty rows do not need them).
  // lost = marks not earned: blank -> marks, wrong -> marks + negative.
  function addRow(st, status, time, marks, neg) {
    const m = Number(marks) || 0;
    const n = Number(neg) || 0;
    st.total++;
    st.time += Number(time) || 0;
    if (status === 'correct') st.correct++;
    else if (status === 'wrong') { st.wrong++; st.lost += m + n; }
    else { st.blank++; st.lost += m; }
  }

  function labelOf(v) {
    return (typeof v === 'string' && v.trim()) ? v.trim() : 'Unknown';
  }

  function diffOf(q) {
    const d = q && typeof q.difficulty === 'string' ? q.difficulty.trim().toLowerCase() : '';
    return DIFFS.includes(d) && d !== 'unknown' ? d : 'unknown';
  }

  function accPct(st) {
    const att = st.correct + st.wrong;
    return att ? Math.round((st.correct / att) * 100) : null;
  }

  function statBar(st) {
    const bar = el('div', 'stat-bar');
    const seg = (cls, n) => {
      if (!n) return;
      const s = el('span', 'stat-seg ' + cls);
      s.style.width = `${(n / st.total) * 100}%`;
      bar.append(s);
    };
    seg('ok', st.correct);
    seg('bad', st.wrong);
    seg('blank', st.blank);
    return bar;
  }

  function statLine(st) {
    const acc = accPct(st);
    return `✓ ${st.correct} • ✗ ${st.wrong} • — ${st.blank} • Acc ${acc === null ? '—' : acc + '%'}`;
  }

  function strengthOf(st) {
    if (st.total < MIN_SAMPLE) return { key: 'low', label: 'Low data' };
    const p = st.correct / st.total;
    if (p >= STRONG_AT) return { key: 'strong', label: 'Strong' };
    if (p >= WEAK_BELOW) return { key: 'avg', label: 'Average' };
    return { key: 'weak', label: 'Weak' };
  }

  function round2(x) { return Math.round(x * 100) / 100; }

  // Comparator for {name, st} entries. "Weakest" keeps Low-data entries at the bottom.
  function compareBy(mode) {
    return (x, y) => {
      if (mode === 'lost') return y.st.lost - x.st.lost || y.st.total - x.st.total;
      if (mode === 'time') return y.st.time - x.st.time || y.st.total - x.st.total;
      const lx = x.st.total < MIN_SAMPLE ? 1 : 0;
      const ly = y.st.total < MIN_SAMPLE ? 1 : 0;
      return lx - ly
        || (x.st.correct / x.st.total) - (y.st.correct / y.st.total)
        || y.st.total - x.st.total;
    };
  }

  // Collapsible section (native <details>). Open/closed state is kept in
  // openState so it survives subject switches.
  function section(title, key, openState, build) {
    const d = document.createElement('details');
    d.className = 'an-section';
    d.open = openState[key] !== false;
    d.addEventListener('toggle', () => { openState[key] = d.open; });
    d.append(el('summary', 'an-summary', title));
    const body = el('div', 'an-section-body');
    build(body);
    d.append(body);
    return d;
  }

  function buildDifficulty(body, subjects) {
    const diffStats = {};
    DIFFS.forEach(d => { diffStats[d] = emptyStat(); });
    subjects.forEach(s => s.items.forEach(it => addRow(diffStats[diffOf(it.q)], it.row.status)));

    const card = el('div', 'card');
    let any = false;
    DIFFS.forEach(d => {
      const st = diffStats[d];
      if (!st.total) return;
      any = true;
      card.append(analysisRow(`${DIFF_LABEL[d]} (${st.total})`, st));
    });
    if (!any) card.append(el('p', 'muted center', 'No questions.'));
    body.append(card);
  }

  // Chapter / topic row: strength badge + marks lost + average time per question.
  function detailRow(label, st) {
    const s = strengthOf(st);
    const avg = st.total ? st.time / st.total : 0;
    return analysisRow(label, st, {
      badge: el('span', 'an-badge ' + s.key, s.label),
      extra: `Marks lost ${round2(st.lost)} • Avg time/Q ${formatDuration(avg)}`,
    });
  }

  function buildChapters(body, subjects, sortMode, onSort) {
    const sortBar = el('div', 'filter-bar an-sort');
    SORTS.forEach(([key, label]) => {
      const b = el('button', 'filter-btn' + (sortMode === key ? ' active' : ''), label);
      b.type = 'button';
      b.addEventListener('click', () => onSort(key));
      sortBar.append(b);
    });
    body.append(el('div', 'muted small', 'Sort by'), sortBar);

    const hi = Math.round(STRONG_AT * 100);
    const lo = Math.round(WEAK_BELOW * 100);
    body.append(el('div', 'muted small',
      `Strong: ${hi}%+ correct • Average: ${lo}–${hi - 1}% • Weak: below ${lo}% • ` +
      `Low data: under ${MIN_SAMPLE} questions. Marks lost = full marks minus marks scored. ` +
      'Tap a chapter to see its topics.'));

    const cmp = compareBy(sortMode);
    subjects.forEach(s => {
      const chapters = new Map();
      s.items.forEach(it => {
        const ch = labelOf(it.q.chapter);
        const tp = labelOf(it.q.topic);
        let c = chapters.get(ch);
        if (!c) { c = { name: ch, st: emptyStat(), topics: new Map() }; chapters.set(ch, c); }
        addRow(c.st, it.row.status, it.row.time_spent, s.marks, s.neg);
        let t = c.topics.get(tp);
        if (!t) { t = { name: tp, st: emptyStat() }; c.topics.set(tp, t); }
        addRow(t.st, it.row.status, it.row.time_spent, s.marks, s.neg);
      });
      const card = el('div', 'card');
      card.append(el('h3', '', s.name));
      [...chapters.values()].sort(cmp).forEach(c => {
        const wrap = el('div', 'an-chapter');
        const head = detailRow(`${c.name} (${c.st.total})`, c.st);
        head.classList.add('tappable');
        const sub = el('div', 'an-topics');
        sub.hidden = true;
        [...c.topics.values()].sort(cmp)
          .forEach(t => sub.append(detailRow(`${t.name} (${t.st.total})`, t.st)));
        head.addEventListener('click', () => {
          sub.hidden = !sub.hidden;
          head.classList.toggle('open', !sub.hidden);
        });
        wrap.append(head, sub);
        card.append(wrap);
      });
      body.append(card);
    });
  }

  function signed(x) { return (x < 0 ? '−' : '+') + round2(Math.abs(x)); }
  function loss(x) { return x > 0 ? '−' + round2(x) : '0'; }

  // One label/value line. cls: 'neg' (red value) | 'dim' (grey value) | 'total' (bold, divider)
  function mbRow(label, value, cls, sub) {
    const row = el('div', 'mb-row' + (cls === 'total' ? ' total' : ''));
    const left = el('div', 'mb-left');
    left.append(el('div', 'mb-label', label));
    if (sub) left.append(el('div', 'muted small', sub));
    row.append(left, el('div', 'mb-val' + (cls ? ' ' + cls : ''), value));
    return row;
  }

  function buildMarks(body, subjects) {
    const per = subjects.map(s => {
      const st = emptyStat();
      s.items.forEach(it => addRow(st, it.row.status));
      return { name: s.name, st, m: Number(s.marks) || 0, n: Number(s.neg) || 0 };
    });
    if (!per.some(p => p.st.total)) {
      const empty = el('div', 'card');
      empty.append(el('p', 'muted center', 'No questions.'));
      body.append(empty);
      return;
    }

    let max = 0, earned = 0, penalty = 0, missedOnWrong = 0, blankLost = 0, wrongN = 0, blankN = 0;
    per.forEach(p => {
      max += p.st.total * p.m;
      earned += p.st.correct * p.m;
      penalty += p.st.wrong * p.n;
      missedOnWrong += p.st.wrong * p.m;
      blankLost += p.st.blank * p.m;
      wrongN += p.st.wrong;
      blankN += p.st.blank;
    });
    const wrongLost = missedOnWrong + penalty;   // marks missed + negative marking
    const score = earned - penalty;              // == max - wrongLost - blankLost

    // ---- Card 1: where the marks went ----
    const card = el('div', 'card');
    card.append(el('h3', '', 'Where your marks went'));
    if (max > 0) {
      const bar = el('div', 'stat-bar');
      const seg = (cls, v) => {
        if (!(v > 0)) return;
        const s = el('span', 'stat-seg ' + cls);
        s.style.width = `${(v / max) * 100}%`;
        bar.append(s);
      };
      seg('ok', earned);
      seg('bad', missedOnWrong);
      seg('blank', blankLost);
      card.append(bar);
      card.append(el('div', 'muted small',
        `Full marks split by result: correct ${round2(earned)} • wrong ${round2(missedOnWrong)} • blank ${round2(blankLost)}`));
    }
    card.append(mbRow('Full marks', String(round2(max))));
    card.append(mbRow('Lost on wrong answers', loss(wrongLost), 'neg',
      `${wrongN} wrong: ${round2(missedOnWrong)} missed + ${round2(penalty)} negative marking`));
    card.append(mbRow('Left blank', loss(blankLost), 'dim', `${blankN} blank`));
    const pct = max > 0 ? ` (${Math.round((score / max) * 1000) / 10}%)` : '';
    card.append(mbRow('Your score', `${round2(score)} / ${round2(max)}${pct}`, 'total'));
    body.append(card);

    // ---- Card 2: smart attempting ----
    const sm = el('div', 'card');
    sm.append(el('h3', '', 'Smart attempting'));

    // Expected extra marks if blanks were attempted at the student's own accuracy
    let extra = 0, usedBlank = 0, skipped = 0;
    per.forEach(p => {
      if (!p.st.blank) return;
      const att = p.st.correct + p.st.wrong;
      if (att < MIN_ATTEMPTED) { skipped++; return; }
      const acc = p.st.correct / att;
      extra += p.st.blank * (acc * p.m - (1 - acc) * p.n);
      usedBlank += p.st.blank;
    });
    const qs = usedBlank === 1 ? 'question' : 'questions';
    let msg;
    if (!blankN) {
      msg = 'You attempted every question, so nothing was left on the table.';
    } else if (!usedBlank) {
      msg = `Not enough attempted questions to estimate (need ${MIN_ATTEMPTED}+ in a subject).`;
    } else if (extra > 0) {
      msg = `If you had attempted the ${usedBlank} blank ${qs} at your own accuracy, ` +
            `you could expect about +${round2(extra)} more marks (an estimate, not a guarantee).`;
    } else {
      msg = `At your current accuracy, attempting the ${usedBlank} blank ${qs} ` +
            `would not have added marks (expected ${signed(extra)}).`;
    }
    if (usedBlank && skipped) {
      msg += ` Subjects with fewer than ${MIN_ATTEMPTED} attempted questions were left out.`;
    }
    sm.append(el('div', 'an-line', msg));

    sm.append(el('div', 'an-sub', 'Break-even accuracy'));
    sm.append(el('div', 'muted small',
      'Below this accuracy, attempting a question loses marks on average.'));
    per.forEach(p => {
      if (!p.st.total) return;
      let line;
      if (p.n <= 0) {
        line = `${p.name}: no negative marking, so attempting never costs marks.`;
      } else {
        const att = p.st.correct + p.st.wrong;
        const be = Math.round((p.n / (p.m + p.n)) * 1000) / 10;
        const acc = att ? Math.round((p.st.correct / att) * 1000) / 10 : null;
        const net = p.st.correct * p.m - p.st.wrong * p.n;
        line = `${p.name}: break-even ${be}% • your accuracy ${acc === null ? '—' : acc + '%'} • ` +
               `attempted questions netted ${signed(net)} marks`;
      }
      sm.append(el('div', 'an-line', line));
    });
    body.append(sm);
  }

  // Rule-based "what to improve" items. Each: {tag, cls, text, filter}
  function focusItems(subjects) {
    const multi = subjects.length > 1;
    const scope = subjects.length === 1 ? subjects[0].name : null;
    const pct1 = x => Math.round(x * 1000) / 10;
    const pl = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

    const per = [];
    const chapters = [];
    let easyWrong = 0, wrongLost = 0, penalty = 0, blankLost = 0, wrongN = 0, blankN = 0;
    subjects.forEach(s => {
      const m = Number(s.marks) || 0;
      const n = Number(s.neg) || 0;
      const st = emptyStat();
      const chMap = new Map();
      s.items.forEach(it => {
        addRow(st, it.row.status);
        const ch = labelOf(it.q.chapter);
        let c = chMap.get(ch);
        if (!c) { c = { subject: s.name, name: ch, st: emptyStat() }; chMap.set(ch, c); }
        addRow(c.st, it.row.status, it.row.time_spent, m, n);
        if (it.row.status === 'wrong' && diffOf(it.q) === 'easy') easyWrong++;
      });
      per.push({ name: s.name, st, m, n });
      chMap.forEach(c => chapters.push(c));
      wrongN += st.wrong;
      blankN += st.blank;
      penalty += st.wrong * n;
      wrongLost += st.wrong * (m + n);
      blankLost += st.blank * m;
    });

    const items = [];

    // A) accuracy below break-even (worst gap only)
    let guess = null;
    per.forEach(p => {
      const att = p.st.correct + p.st.wrong;
      if (p.n <= 0 || att < MIN_ATTEMPTED) return;
      const acc = p.st.correct / att;
      const be = p.n / (p.m + p.n);
      if (acc < be && (!guess || be - acc > guess.gap)) guess = { p, acc, be, gap: be - acc };
    });
    if (guess) {
      items.push({
        tag: 'Guessing', cls: 'weak',
        text: `${guess.p.name}: your accuracy (${pct1(guess.acc)}%) is below the break-even ` +
              `(${pct1(guess.be)}%). Skip questions you are unsure about instead of guessing.`,
        filter: { subject: guess.p.name, status: 'wrong' },
      });
    }

    // B) weakest chapters (enough data, named chapters only)
    const named = chapters.filter(c => c.name !== 'Unknown' && c.st.total >= MIN_SAMPLE);
    named
      .filter(c => c.st.correct / c.st.total < WEAK_BELOW)
      .sort((x, y) => (x.st.correct / x.st.total) - (y.st.correct / y.st.total) || y.st.lost - x.st.lost)
      .slice(0, 2)
      .forEach(c => items.push({
        tag: 'Weak chapter', cls: 'weak',
        text: `${c.name}${multi ? ` (${c.subject})` : ''}: only ${c.st.correct} of ${c.st.total} correct, ` +
              `${round2(c.st.lost)} marks lost. Revise this chapter first.`,
        filter: { subject: c.subject, chapter: c.name },
      }));

    // C) easy questions answered wrong
    if (easyWrong > 0) {
      items.push({
        tag: 'Easy misses', cls: 'avg',
        text: `${pl(easyWrong, 'Easy question')} answered wrong. These are the quickest marks to win back.`,
        filter: { subject: scope, difficulty: 'easy', status: 'wrong' },
      });
    }

    // D) biggest marks leak: blank vs wrong
    const lostTotal = wrongLost + blankLost;
    if (lostTotal > 0) {
      if (blankLost >= wrongLost) {
        items.push({
          tag: 'Blank', cls: 'avg',
          text: `${pl(blankN, 'blank question')} cost ${round2(blankLost)} marks ` +
                `(${Math.round((blankLost / lostTotal) * 100)}% of the marks you lost). ` +
                'Try to attempt more of the questions you can solve.',
          filter: { subject: scope, status: 'blank' },
        });
      } else {
        items.push({
          tag: 'Wrong answers', cls: 'avg',
          text: `Wrong answers cost ${round2(wrongLost)} marks, including ${round2(penalty)} from ` +
                'negative marking. Double-check before you answer.',
          filter: { subject: scope, status: 'wrong' },
        });
      }
    }

    // E) strongest chapter (positive note)
    const best = named
      .filter(c => c.st.correct / c.st.total >= STRONG_AT)
      .sort((x, y) => (y.st.correct / y.st.total) - (x.st.correct / x.st.total) || y.st.total - x.st.total)[0];
    if (best) {
      items.push({
        tag: 'Strength', cls: 'strong',
        text: `${best.name}${multi ? ` (${best.subject})` : ''}: ${best.st.correct} of ${best.st.total} correct. Keep it up.`,
        filter: { subject: best.subject, chapter: best.name },
      });
    }

    return items.slice(0, 5);
  }

  function buildFocus(body, subjects, onReview) {
    const items = focusItems(subjects);
    const card = el('div', 'card');
    if (!items.length) {
      card.append(el('p', 'muted center', 'No clear focus areas found. Attempt more questions to get specific advice.'));
      body.append(card);
      return;
    }
    if (onReview) card.append(el('div', 'muted small', 'Tap an item to see those questions in Review.'));
    items.forEach(it => {
      const row = el('div', 'fa-item' + (onReview ? ' tappable' : ''));
      row.append(el('span', 'an-badge ' + it.cls, it.tag));
      row.append(el('div', 'fa-text', it.text));
      if (onReview) {
        row.append(el('div', 'fa-go muted small', 'View questions →'));
        row.addEventListener('click', () => onReview(it.filter));
      }
      card.append(row);
    });
    body.append(card);
  }

  function renderAnalysis(a, r, hooks) {
    const pane = el('div', 'stack result-pane');

    // Pair every result row with its question snapshot (+ marking scheme)
    const all = (r.subjects || []).map(s => {
      const qs = (a.questions && a.questions[s.name]) || [];
      return {
        name: s.name,
        marks: s.marks,
        neg: s.negative,
        items: (s.rows || []).map((row, i) => ({ row, q: qs[i] || {} })),
      };
    });

    const view = { subject: 'all', open: {}, sort: 'weak' };
    const chips = el('div', 'filter-bar an-chips');
    const content = el('div', 'stack an-content');

    const draw = () => {
      // Subject chips (only useful when there is more than one subject)
      chips.replaceChildren();
      if (all.length > 1) {
        const mk = (label, key) => {
          const b = el('button', 'filter-btn' + (view.subject === key ? ' active' : ''), label);
          b.type = 'button';
          b.addEventListener('click', () => { view.subject = key; draw(); });
          return b;
        };
        chips.append(mk('All', 'all'));
        all.forEach(s => chips.append(mk(s.name, s.name)));
      }
      chips.hidden = all.length < 2;

      const subjects = view.subject === 'all' ? all : all.filter(s => s.name === view.subject);
      content.replaceChildren(
        section('Focus areas', 'focus', view.open,
          body => buildFocus(body, subjects, hooks && hooks.onReview)),
        section('Marks breakdown', 'marks', view.open, body => buildMarks(body, subjects)),
        section('Chapter wise', 'chap', view.open,
          body => buildChapters(body, subjects, view.sort, key => { view.sort = key; draw(); })),
        section('Difficulty', 'diff', view.open, body => buildDifficulty(body, subjects)),
      );
    };

    draw();
    pane.append(chips, content);
    return pane;
  }

  // opts (optional): {badge: Node, extra: string}
  function analysisRow(label, st, opts) {
    const row = el('div', 'an-row');
    const top = el('div', 'an-top');
    top.append(el('div', 'an-label', label));
    if (opts && opts.badge) top.append(opts.badge);
    row.append(top);
    row.append(statBar(st));
    row.append(el('div', 'muted small', statLine(st)));
    if (opts && opts.extra) row.append(el('div', 'muted small', opts.extra));
    return row;
  }

  // ---------- Tab 3: Review ----------
  function renderReview(a, r) {
    const pane = el('div', 'result-pane');
    const subjects = r.subjects || [];
    const f = { status: 'all', marked: false };
    const cap = d => d.charAt(0).toUpperCase() + d.slice(1);
    const uniq = arr => Array.from(new Set(arr)).sort();

    // Flat pool: har question ka subject/chapter/topic/difficulty
    const pool = [];
    subjects.forEach(s => {
      const qs = (a.questions && a.questions[s.name]) || [];
      (s.rows || []).forEach((row, i) => {
        const q = qs[i] || {};
        pool.push({ s: s.name, c: labelOf(q.chapter), t: labelOf(q.topic), d: cap(diffOf(q)) });
      });
    });
    const ok = (it, S, C, T, D) =>
      (!S.length || S.includes(it.s)) && (!C.length || C.includes(it.c)) &&
      (!T.length || T.includes(it.t)) && (!D.length || D.includes(it.d));

    const subjF = makeMultiSelect('Subjects', () => { refreshOpts(); refresh(); });
    const chapF = makeMultiSelect('Chapters', () => { refreshOpts(); refresh(); });
    const topicF = makeMultiSelect('Topics', () => refresh());
    const diffF = makeMultiSelect('Difficulty', () => { refreshOpts(); refresh(); });
    const filterWrap = el('div', 'preview-filters');
    filterWrap.append(subjF.wrap, chapF.wrap, topicF.wrap, diffF.wrap);

    function refreshOpts() {
      const S = subjF.getSelected(), D = diffF.getSelected();
      chapF.setItems(uniq(pool.filter(it => ok(it, S, [], [], D)).map(it => it.c)));
      const C2 = chapF.getSelected();
      topicF.setItems(uniq(pool.filter(it => ok(it, S, C2, [], D)).map(it => it.t)));
    }

    const statusBar = el('div', 'filter-bar');
    const rowsWrap = el('div', 'rows-wrap');

    const mk = (label, active, onClick) => {
      const b = el('button', 'filter-btn' + (active ? ' active' : ''), label);
      b.type = 'button';
      b.addEventListener('click', onClick);
      return b;
    };

    function refresh() {
      statusBar.replaceChildren(
        mk('All', f.status === 'all', () => { f.status = 'all'; refresh(); }),
        mk('Correct', f.status === 'correct', () => { f.status = 'correct'; refresh(); }),
        mk('Wrong', f.status === 'wrong', () => { f.status = 'wrong'; refresh(); }),
        mk('Blank', f.status === 'blank', () => { f.status = 'blank'; refresh(); }),
        mk('★ Marked', f.marked, () => { f.marked = !f.marked; refresh(); }),
      );
      const S = subjF.getSelected(), C = chapF.getSelected(), T = topicF.getSelected(), D = diffF.getSelected();
      rowsWrap.replaceChildren();
      subjects.forEach(s => {
        const qs = a.questions[s.name] || [];
        // Subject ka max time (filter se independent) — bar isi ke relative
        const maxT = (s.rows || []).reduce((m, rw) => Math.max(m, rw.time_spent || 0), 0);
        // Touched (answer ya time > 0) upar, untouched (blank + 0s) neeche; dono me original order
        const idx = (s.rows || []).map((_, i) => i);
        const touched = i => { const rw = s.rows[i]; return !!rw.choice || (rw.time_spent || 0) > 0; };
        [...idx.filter(touched), ...idx.filter(i => !touched(i))].forEach(i => {
          const row = s.rows[i];
          const q = qs[i] || {};
          if (f.status !== 'all' && row.status !== f.status) return;
          if (f.marked && !row.marked) return;
          if (!ok({ s: s.name, c: labelOf(q.chapter), t: labelOf(q.topic), d: cap(diffOf(q)) }, S, C, T, D)) return;
          rowsWrap.append(renderRow(a, s, row, q, i, maxT));
        });
      });
      if (!rowsWrap.children.length) {
        rowsWrap.append(el('p', 'muted center', 'Is filter me koi question nahi.'));
      }
    }

    subjF.setItems(uniq(pool.map(it => it.s)));
    diffF.setItems(['Easy', 'Medium', 'Hard', 'Unknown'].filter(d => pool.some(it => it.d === d)));
    refreshOpts();

    pane.append(filterWrap, statusBar, rowsWrap);

    // Deep link from Analysis. flt: {status, subject, chapter, topic, difficulty} (all optional)
    pane.applyFilter = (flt) => {
      flt = flt || {};
      f.status = ['correct', 'wrong', 'blank'].includes(flt.status) ? flt.status : 'all';
      f.marked = false;
      subjF.setSelected(flt.subject ? [flt.subject] : []);
      diffF.setSelected(flt.difficulty ? [cap(flt.difficulty)] : []);
      refreshOpts();
      chapF.setSelected(flt.chapter ? [flt.chapter] : []);
      refreshOpts();
      topicF.setSelected(flt.topic ? [flt.topic] : []);
      refresh();
    };

    refresh();
    return pane;
  }

  function chip(sym, val, cls) {
    const c = el('div', 'cwb-chip ' + cls);
    c.append(el('span', 'cwb-sym', sym), el('span', 'cwb-val', String(val)));
    return c;
  }

  function kv(label, val) {
    const d = el('div', 'kv');
    d.append(el('span', 'kv-label', label), el('span', 'kv-val', String(val)));
    return d;
  }

  function renderRow(a, subj, row, q, index, maxT) {
    const wrap = el('div', 'card result-row ' + row.status);
    const head = el('div', 'row-head');
    const badge = row.status === 'correct' ? '✓'
                : row.status === 'wrong' ? '✗'
                : '—';
    head.append(el('span', 'row-badge ' + row.status, badge));
    head.append(el('span', 'row-title', `${subj.name} Q${index + 1}`));
    const metaBits = [];
    if (row.time_spent) metaBits.push(`${formatDuration(row.time_spent)}`);
    head.append(el('span', 'row-meta', metaBits.join(' • ')));
    const toggle = el('button', 'icon-btn', '▾');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    head.append(toggle);
    wrap.append(head);

    // Time bar: subject ke max time ke relative (0 sec pe bar nahi)
    if (row.time_spent > 0 && maxT > 0) {
      const track = el('div', 'time-bar');
      const fill = el('span', 'time-bar-fill ' + row.status);
      fill.style.width = `${Math.max(2, Math.round((row.time_spent / maxT) * 100))}%`;
      track.append(fill);
      wrap.append(track);
    }

    const body = el('div', 'row-body');
    body.hidden = true;

    // Render full question with solution
    const qCard = renderQuestion(q, index + 1, {
      showSolution: true,
      showMarks: true,
      choice: row.choice,
      answer: row.answer,
    });
    body.append(qCard);

    if (row.marked) {
      const ansLine = el('div', 'ans-line');
      ansLine.append(el('span', 'chip marked-chip', 'Marked'));
      body.append(ansLine);
    }

    wrap.append(body);

    head.addEventListener('click', () => {
      body.hidden = !body.hidden;
      toggle.textContent = body.hidden ? '▾' : '▴';
      toggle.setAttribute('aria-expanded', String(!body.hidden));
      if (!body.hidden) typeset(body);
    });

    return wrap;
  }

  function formatDuration(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m >= 60) {
      const h = Math.floor(m / 60);
      return `${h}h ${m % 60}m`;
    }
    return `${m}m ${s}s`;
  }

  function formatDate(epoch) {
    try {
      const d = new Date(epoch * 1000);
      return d.toLocaleString();
    } catch { return ''; }
  }

  return { render };
})();