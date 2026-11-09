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
        onRetry: opts && opts.onRetry,
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
    top.append(copyButtonRow(a, r));
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
  const SLOW_FACTOR = 1.5;   // "slow" = at least this many times the subject's median time
  const MIN_SLOW_SEC = 15;   // ...but never below this many seconds
  const GAVE_UP_SEC = 5;     // blank with at least this much time = tried, then left blank
  const TYPES = [
    { key: 'fast_ok', label: 'Quick & correct', cls: 'strong', desc: 'You know these well.' },
    { key: 'slow_ok', label: 'Slow but correct', cls: 'avg', desc: 'Right answer, but it took long. Practise for speed.' },
    { key: 'fast_bad', label: 'Quick & wrong', cls: 'weak', desc: 'Likely careless mistakes or guesses. Read the question and options again.' },
    { key: 'slow_bad', label: 'Slow & wrong', cls: 'weak', desc: 'Time spent and still wrong. Probably a concept gap, so revise the theory.' },
    { key: 'gave_up', label: 'Blank after trying', cls: 'avg', desc: 'You spent time and then left it blank. Learn the method, or decide sooner to skip.' },
    { key: 'skipped', label: 'Skipped / not reached', cls: 'low', desc: 'Blank with almost no time spent. You may have run out of time or skipped on sight.' },
  ];
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

  // Practice button: builds a new attempt from THIS attempt's own wrong/blank
  // questions, narrowed by filter ({subject, chapter, topic, difficulty, statuses}).
  function practiceBtn(count, filter, onRetry, label) {
    const wrap = el('div', 'practice-wrap');
    const name = label || 'Practice';
    const b = el('button', 'btn ghost small', `↻ ${name} (${count})`);
    b.type = 'button';
    const msg = el('div', 'muted small', '');
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (b.disabled) return;
      b.disabled = true;
      msg.textContent = 'Creating attempt...';
      new Promise(res => res(onRetry('wrong', name, filter))).catch(err => {
        b.disabled = false;
        msg.textContent = 'Retry failed: ' + ((err && err.message) || 'unknown');
      });
    });
    wrap.addEventListener('click', e => e.stopPropagation());
    wrap.append(b, msg);
    return wrap;
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

  function buildChapters(body, subjects, sortMode, onSort, onRetry) {
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
        const cw = c.st.wrong + c.st.blank;
        if (onRetry && cw > 0) {
          sub.append(practiceBtn(cw, { subject: s.name, chapter: c.name }, onRetry, 'Practice chapter'));
        }
        [...c.topics.values()].sort(cmp).forEach(t => {
          sub.append(detailRow(`${t.name} (${t.st.total})`, t.st));
          const tw = t.st.wrong + t.st.blank;
          if (onRetry && tw > 0) {
            sub.append(practiceBtn(tw, { subject: s.name, chapter: c.name, topic: t.name }, onRetry, 'Practice topic'));
          }
        });
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
        retry: { count: c.st.wrong + c.st.blank, filter: { subject: c.subject, chapter: c.name }, label: 'Practice chapter' },
      }));

    // C) easy questions answered wrong
    if (easyWrong > 0) {
      items.push({
        tag: 'Easy misses', cls: 'avg',
        text: `${pl(easyWrong, 'Easy question')} answered wrong. These are the quickest marks to win back.`,
        filter: { subject: scope, difficulty: 'easy', status: 'wrong' },
        retry: {
          count: easyWrong,
          filter: { subject: scope, difficulty: 'easy', statuses: ['wrong'] },
          label: 'Retry Easy misses',
        },
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

  function buildFocus(body, subjects, onReview, onRetry) {
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
      if (onRetry && it.retry && it.retry.count > 0) {
        row.append(practiceBtn(it.retry.count, it.retry.filter, onRetry, it.retry.label));
      }
      card.append(row);
    });
    body.append(card);
  }

  function medianOf(arr) {
    const s = [...arr].sort((x, y) => x - y);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  // Seconds at or above which a question counts as "slow" in this subject.
  function slowThreshold(s, a) {
    const times = s.items.map(it => Number(it.row.time_spent) || 0).filter(t => t > 0);
    if (times.length >= 3) {
      return { sec: Math.max(MIN_SLOW_SEC, SLOW_FACTOR * medianOf(times)), basis: `${SLOW_FACTOR}x your median time` };
    }
    const tq = Object.values((a && a.questions) || {}).reduce((n, v) => n + v.length, 0);
    const mins = Number(a && a.template && a.template.total_minutes) || 0;
    if (tq > 0 && mins > 0) {
      return { sec: Math.max(MIN_SLOW_SEC, (mins * 60) / tq), basis: 'test time per question' };
    }
    return { sec: 60, basis: 'default 60s' };
  }

  function classifyQ(row, slowAt) {
    const t = Number(row.time_spent) || 0;
    if (row.status === 'correct') return t >= slowAt ? 'slow_ok' : 'fast_ok';
    if (row.status === 'wrong') return t >= slowAt ? 'slow_bad' : 'fast_bad';
    return t >= GAVE_UP_SEC ? 'gave_up' : 'skipped';
  }

  function buildTypes(body, subjects, onReview, a) {
    const groups = {};
    TYPES.forEach(t => { groups[t.key] = []; });
    const notes = [];
    subjects.forEach(s => {
      const th = slowThreshold(s, a);
      notes.push(`${s.name}: slow = ${formatDuration(th.sec)} or more (${th.basis})`);
      s.items.forEach(it => groups[classifyQ(it.row, th.sec)].push(`${s.name}|${it.i}`));
    });
    const total = TYPES.reduce((n, t) => n + groups[t.key].length, 0);

    const card = el('div', 'card');
    if (!total) {
      card.append(el('p', 'muted center', 'No questions.'));
      body.append(card);
      return;
    }

    const bar = el('div', 'stat-bar');
    TYPES.forEach(t => {
      const n = groups[t.key].length;
      if (!n) return;
      const seg = el('span', 'stat-seg type-' + t.key.replace('_', '-'));
      seg.style.width = `${(n / total) * 100}%`;
      bar.append(seg);
    });
    card.append(bar);
    if (onReview) card.append(el('div', 'muted small', 'Tap a group to see those questions in Review.'));

    TYPES.forEach(t => {
      const keys = groups[t.key];
      if (!keys.length) return;
      const row = el('div', 'qt-row' + (onReview ? ' tappable' : ''));
      const top = el('div', 'an-top');
      const left = el('div', 'qt-left');
      left.append(el('span', 'qt-dot type-' + t.key.replace('_', '-')), el('span', 'an-badge ' + t.cls, t.label));
      top.append(left, el('div', 'qt-count', `${keys.length} (${Math.round((keys.length / total) * 100)}%)`));
      row.append(top, el('div', 'fa-text', t.desc));
      if (onReview) {
        row.append(el('div', 'fa-go muted small', 'View questions →'));
        row.addEventListener('click', () => onReview({ only: keys, label: `${t.label} (${keys.length})` }));
      }
      card.append(row);
    });

    notes.forEach(n => card.append(el('div', 'muted small', n)));
    card.append(el('div', 'muted small',
      `Blank questions with ${GAVE_UP_SEC}s or more spent are counted as Blank after trying.`));
    body.append(card);
  }

  // ---------- Time analysis ----------
  function avgOf(st) { return st.total ? st.time / st.total : 0; }

  function statusOf(row) {
    return row && row.status === 'correct' ? 'correct' : row && row.status === 'wrong' ? 'wrong' : 'blank';
  }

  // One row with a time bar. fill: bar colour class (correct | wrong | blank | neutral).
  function timeRow(label, avg, max, fill, extra, badge) {
    const row = el('div', 'an-row');
    const top = el('div', 'an-top');
    top.append(el('div', 'an-label', label));
    if (badge) top.append(badge);
    row.append(top);
    if (max > 0 && avg > 0) {
      const track = el('div', 'time-bar');
      const f = el('span', 'time-bar-fill ' + fill);
      f.style.width = `${Math.max(2, Math.round((avg / max) * 100))}%`;
      track.append(f);
      row.append(track);
    }
    if (extra) row.append(el('div', 'muted small', extra));
    return row;
  }

  function buildTime(body, subjects, onReview) {
    const T = it => Number(it.row.time_spent) || 0;
    let totalTime = 0, totalQ = 0;
    subjects.forEach(s => s.items.forEach(it => { totalTime += T(it); totalQ++; }));
    if (!totalQ || !(totalTime > 0)) {
      const empty = el('div', 'card');
      empty.append(el('p', 'muted center', 'No time data recorded.'));
      body.append(empty);
      return;
    }

    body.append(el('div', 'muted small',
      'Averages count every question in the group, including unattempted ones with 0s.'));

    // ---- A) average time per subject ----
    const subjStats = subjects.map(s => {
      const st = emptyStat();
      s.items.forEach(it => addRow(st, it.row.status, it.row.time_spent));
      return { name: s.name, st };
    }).filter(p => p.st.total);
    const maxSubj = subjStats.reduce((m, p) => Math.max(m, avgOf(p.st)), 0);
    const cardA = el('div', 'card');
    cardA.append(el('h3', '', 'Average time per subject'));
    subjStats.forEach(p => {
      cardA.append(timeRow(`${p.name} (${p.st.total})`, avgOf(p.st), maxSubj, 'neutral',
        `Avg ${formatDuration(avgOf(p.st))}/Q • Total ${formatDuration(p.st.time)}`));
    });
    body.append(cardA);

    // ---- B) correct vs wrong vs blank ----
    const byStatus = { correct: emptyStat(), wrong: emptyStat(), blank: emptyStat() };
    subjects.forEach(s => s.items.forEach(it => addRow(byStatus[statusOf(it.row)], it.row.status, it.row.time_spent)));
    const maxStatus = Math.max(avgOf(byStatus.correct), avgOf(byStatus.wrong), avgOf(byStatus.blank));
    const cardB = el('div', 'card');
    cardB.append(el('h3', '', 'Correct vs wrong'));
    [['correct', 'Correct'], ['wrong', 'Wrong'], ['blank', 'Blank']].forEach(([k, label]) => {
      const st = byStatus[k];
      if (!st.total) return;
      cardB.append(timeRow(`${label} (${st.total})`, avgOf(st), maxStatus, k,
        `Avg ${formatDuration(avgOf(st))}/Q • Total ${formatDuration(st.time)}`));
    });
    const ac = avgOf(byStatus.correct), aw = avgOf(byStatus.wrong);
    if (byStatus.correct.total && byStatus.wrong.total && ac > 0 && aw > 0) {
      if (aw >= ac * 1.2) {
        cardB.append(el('div', 'an-line',
          'You spend more time on wrong answers than on correct ones. Long struggles often end in a miss, so consider skipping and coming back.'));
      } else if (aw <= ac * 0.8) {
        cardB.append(el('div', 'an-line',
          'Your wrong answers took less time than the correct ones. You may be rushing, so read the question and options again.'));
      } else {
        cardB.append(el('div', 'an-line', 'Correct and wrong answers took a similar amount of time.'));
      }
    }
    body.append(cardB);

    // ---- C) top 5 time sinks ----
    const sinks = [];
    subjects.forEach(s => s.items.forEach(it => {
      const t = T(it);
      if (t > 0) sinks.push({ s: s.name, i: it.i, t, status: statusOf(it.row), q: it.q });
    }));
    sinks.sort((x, y) => y.t - x.t || x.s.localeCompare(y.s) || x.i - y.i);
    const top5 = sinks.slice(0, 5);
    const cardC = el('div', 'card');
    cardC.append(el('h3', '', 'Top 5 time sinks'));
    if (onReview) cardC.append(el('div', 'muted small', 'Tap a question to open it in Review.'));
    const STATUS_BADGE = {
      correct: { cls: 'strong', label: 'Correct' },
      wrong: { cls: 'weak', label: 'Wrong' },
      blank: { cls: 'avg', label: 'Blank' },
    };
    top5.forEach(x => {
      const b = STATUS_BADGE[x.status];
      const where = [x.q && x.q.chapter, x.q && x.q.topic]
        .map(v => (typeof v === 'string' ? v.trim() : ''))
        .filter(Boolean).join(' • ');
      const extra = `${formatDuration(x.t)}${where ? ' • ' + where : ''}`;
      const row = timeRow(`${x.s} Q${x.i + 1}`, x.t, top5[0].t, x.status, extra,
        el('span', 'an-badge ' + b.cls, b.label));
      if (onReview) {
        row.classList.add('tappable', 'ts-go');
        row.addEventListener('click', () => onReview({ only: [`${x.s}|${x.i}`], label: `${x.s} Q${x.i + 1}` }));
      }
      cardC.append(row);
    });
    body.append(cardC);

    // ---- D) chapter-wise time ----
    const perSubj = subjects.map(s => {
      const chapters = new Map();
      s.items.forEach(it => {
        const ch = labelOf(it.q.chapter);
        let st = chapters.get(ch);
        if (!st) { st = emptyStat(); chapters.set(ch, st); }
        addRow(st, it.row.status, it.row.time_spent);
      });
      const list = [...chapters.entries()].map(([name, st]) => ({ name, st }))
        .sort((x, y) => avgOf(y.st) - avgOf(x.st) || y.st.total - x.st.total);
      return { name: s.name, list };
    }).filter(p => p.list.length);
    const maxCh = perSubj.reduce((m, p) => p.list.reduce((mm, c) => Math.max(mm, avgOf(c.st)), m), 0);
    const cardD = el('div', 'card');
    cardD.append(el('h3', '', 'Chapter-wise time'));
    cardD.append(el('div', 'muted small', 'Slowest chapters first.'));
    perSubj.forEach(p => {
      if (perSubj.length > 1) cardD.append(el('div', 'an-sub', p.name));
      p.list.forEach(c => {
        cardD.append(timeRow(`${c.name} (${c.st.total})`, avgOf(c.st), maxCh, 'neutral',
          `Avg ${formatDuration(avgOf(c.st))}/Q • Total ${formatDuration(c.st.time)}`));
      });
    });
    body.append(cardD);

    // ---- E) difficulty-wise time ----
    const diffStats = {};
    DIFFS.forEach(d => { diffStats[d] = emptyStat(); });
    subjects.forEach(s => s.items.forEach(it => addRow(diffStats[diffOf(it.q)], it.row.status, it.row.time_spent)));
    const maxDiff = DIFFS.reduce((m, d) => Math.max(m, avgOf(diffStats[d])), 0);
    const cardE = el('div', 'card');
    cardE.append(el('h3', '', 'Difficulty-wise time'));
    DIFFS.forEach(d => {
      const st = diffStats[d];
      if (!st.total) return;
      cardE.append(timeRow(`${DIFF_LABEL[d]} (${st.total})`, avgOf(st), maxDiff, 'neutral',
        `Avg ${formatDuration(avgOf(st))}/Q • Total ${formatDuration(st.time)}`));
    });
    body.append(cardE);
  }

  // ---------- Marked for review ----------
  const MARK_TYPES = [
    { key: 'mc', label: 'Marked + correct', cls: 'strong', seg: 'ok',
      desc: 'You doubted these but got them right. Your instinct is better than you think.' },
    { key: 'mw', label: 'Marked + wrong', cls: 'weak', seg: 'bad',
      desc: 'Your doubt was justified. Revise the concepts behind these.' },
    { key: 'mb', label: 'Marked + blank', cls: 'avg', seg: 'blank',
      desc: 'Marked to revisit but never answered. Keep some time at the end to return to marked questions.' },
  ];

  function buildMarked(body, subjects, onReview) {
    const groups = { mc: [], mw: [], mb: [] };
    const plain = emptyStat();       // not marked
    const plainWrong = [];
    let total = 0;
    subjects.forEach(s => s.items.forEach(it => {
      total++;
      const key = `${s.name}|${it.i}`;
      const st = statusOf(it.row);
      if (it.row.marked) {
        groups[st === 'correct' ? 'mc' : st === 'wrong' ? 'mw' : 'mb'].push(key);
      } else {
        addRow(plain, st);
        if (st === 'wrong') plainWrong.push(key);
      }
    }));
    const markedN = groups.mc.length + groups.mw.length + groups.mb.length;

    const card = el('div', 'card');
    if (!total) {
      card.append(el('p', 'muted center', 'No questions.'));
      body.append(card);
      return;
    }
    if (!markedN) {
      card.append(el('p', 'muted center', 'No questions were marked for review in this attempt.'));
      body.append(card);
      return;
    }

    // ---- distribution of marked questions ----
    card.append(el('h3', '', `Marked for review (${markedN})`));
    const bar = el('div', 'stat-bar');
    MARK_TYPES.forEach(t => {
      const n = groups[t.key].length;
      if (!n) return;
      const seg = el('span', 'stat-seg ' + t.seg);
      seg.style.width = `${(n / markedN) * 100}%`;
      bar.append(seg);
    });
    card.append(bar);
    if (onReview) card.append(el('div', 'muted small', 'Tap a group to see those questions in Review.'));
    MARK_TYPES.forEach(t => {
      const keys = groups[t.key];
      if (!keys.length) return;
      const row = el('div', 'qt-row' + (onReview ? ' tappable' : ''));
      const top = el('div', 'an-top');
      const left = el('div', 'qt-left');
      left.append(el('span', 'an-badge ' + t.cls, t.label));
      top.append(left, el('div', 'qt-count', `${keys.length} (${Math.round((keys.length / markedN) * 100)}%)`));
      row.append(top, el('div', 'fa-text', t.desc));
      if (onReview) {
        row.append(el('div', 'fa-go muted small', 'View questions →'));
        row.addEventListener('click', () => onReview({ only: keys, label: `${t.label} (${keys.length})` }));
      }
      card.append(row);
    });
    body.append(card);

    // ---- confidence insights ----
    const ins = el('div', 'card');
    ins.append(el('h3', '', 'Confidence insights'));
    const mAtt = groups.mc.length + groups.mw.length;
    const uAtt = plain.correct + plain.wrong;
    const mAcc = mAtt ? Math.round((groups.mc.length / mAtt) * 100) : null;
    const uAcc = uAtt ? Math.round((plain.correct / uAtt) * 100) : null;
    ins.append(el('div', 'an-line',
      `Accuracy on marked questions: ${mAcc === null ? '—' : mAcc + '%'} (${mAtt} attempted) • ` +
      `on unmarked: ${uAcc === null ? '—' : uAcc + '%'} (${uAtt} attempted)`));
    if (mAtt >= MIN_SAMPLE && uAtt >= MIN_SAMPLE) {
      ins.append(el('div', 'an-line', mAcc >= uAcc
        ? 'Marked questions did as well as the rest, so some of your doubts were unnecessary. Trust your first instinct a little more.'
        : 'Your doubt was a good signal: marked questions were answered less accurately than the rest.'));
    } else if (mAtt && uAtt) {
      ins.append(el('div', 'muted small', `Too few questions for a reliable comparison (need ${MIN_SAMPLE}+ on each side).`));
    }
    if (plainWrong.length) {
      const share = uAtt ? Math.round((plainWrong.length / uAtt) * 100) : 0;
      const row = el('div', 'fa-item' + (onReview ? ' tappable' : ''));
      row.append(el('span', 'an-badge weak', 'Sure but wrong'));
      row.append(el('div', 'fa-text',
        `${plainWrong.length} wrong ${plainWrong.length === 1 ? 'answer was' : 'answers were'} not marked ` +
        `(${share}% of your unmarked attempts). You felt sure and were still wrong, so double-check even the answers you feel confident about.`));
      if (onReview) {
        row.append(el('div', 'fa-go muted small', 'View questions →'));
        row.addEventListener('click', () =>
          onReview({ only: plainWrong, label: `Wrong, not marked (${plainWrong.length})` }));
      }
      ins.append(row);
    } else if (uAtt) {
      ins.append(el('div', 'an-line', 'None of your unmarked answers was wrong. Your confidence matched your results.'));
    }
    body.append(ins);
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
        items: (s.rows || []).map((row, i) => ({ row, q: qs[i] || {}, i })),
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
          body => buildFocus(body, subjects, hooks && hooks.onReview, hooks && hooks.onRetry)),
        section('Marks breakdown', 'marks', view.open, body => buildMarks(body, subjects)),
        section('Chapter wise', 'chap', view.open,
          body => buildChapters(body, subjects, view.sort, key => { view.sort = key; draw(); },
            hooks && hooks.onRetry)),
        section('Question types', 'types', view.open,
          body => buildTypes(body, subjects, hooks && hooks.onReview, a)),
        section('Time analysis', 'time', view.open,
          body => buildTime(body, subjects, hooks && hooks.onReview)),
        section('Marked for review', 'marked', view.open,
          body => buildMarked(body, subjects, hooks && hooks.onReview)),
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

  // ---------- Copy the full analysis as plain text ----------
  // The text is built from the same Analysis sections the screen shows (rendered
  // fresh with every subject and no buttons), so the copy never drifts from the UI.
  const REPORT_SKIP_CLS = ['an-chips', 'an-sort', 'fa-go', 'stat-bar', 'time-bar', 'practice-wrap'];
  const REPORT_JOIN_CLS = ['an-top', 'row-head'];

  function rpTag(n) { return String((n && (n.tagName || n.tag)) || '').toLowerCase(); }
  function rpSquash(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function rpHas(n, c) { return !!(n && n.classList && n.classList.contains(c)); }
  function rpKids(n) { return Array.from((n && n.childNodes) || []).filter(c => c.nodeType === 1); }
  function rpBlank(out) { if (out.length && out[out.length - 1] !== '') out.push(''); }

  function rpSkip(n) {
    if (!n || n.nodeType !== 1) return false;
    const t = rpTag(n);
    return t === 'button' || t === 'svg' || REPORT_SKIP_CLS.some(c => rpHas(n, c));
  }

  // All visible text under a node as one line.
  function rpFlat(n) {
    if (!n) return '';
    if (n.nodeType === 3) return rpSquash(n.textContent);
    if (rpSkip(n)) return '';
    if (!n.childNodes || !n.childNodes.length) return rpSquash(n.textContent);
    return rpSquash(Array.from(n.childNodes).map(rpFlat).filter(Boolean).join(' '));
  }

  function rpWalk(n, out, indent) {
    if (!n || n.nodeType !== 1 || rpSkip(n)) return;
    const t = rpTag(n);
    const pad = '  '.repeat(indent);
    const kids = rpKids(n);

    if (t === 'details') {
      const sum = kids.find(c => rpTag(c) === 'summary');
      rpBlank(out);
      out.push('## ' + rpFlat(sum));
      kids.forEach(c => { if (c !== sum) rpWalk(c, out, indent); });
      rpBlank(out);
      return;
    }
    if (t === 'h2' || t === 'h3') {
      const s = rpFlat(n);
      if (s) out.push(pad + '### ' + s);
      return;
    }
    if (rpHas(n, 'mb-row')) {
      const lk = kids[0] ? rpKids(kids[0]) : [];
      const label = rpFlat(lk[0]);
      const sub = rpFlat(lk[1]);
      const val = rpFlat(kids[1]);
      out.push(pad + label + (val ? ': ' + val : '') + (sub ? ' (' + sub + ')' : ''));
      return;
    }
    if (rpHas(n, 'fa-item')) {
      const badge = kids.find(k => rpHas(k, 'an-badge'));
      const rest = kids.filter(k => k !== badge).map(rpFlat).filter(Boolean).join(' ');
      out.push(pad + (badge ? '[' + rpFlat(badge) + '] ' : '') + rest);
      return;
    }
    if (REPORT_JOIN_CLS.some(c => rpHas(n, c))) {
      const s = kids.map(rpFlat).filter(Boolean).join(' — ');
      if (s) out.push(pad + s);
      return;
    }
    if (!kids.length) {
      const s = rpFlat(n);
      if (s && s !== 'Sort by') out.push(pad + s);
      return;
    }
    const ind = rpHas(n, 'an-topics') ? indent + 1 : indent;
    kids.forEach(c => rpWalk(c, out, ind));
    if (rpHas(n, 'card')) rpBlank(out);
  }

  function buildReport(a, r) {
    const out = [];
    const tt = r.total || {};
    const pct = tt.max > 0 ? ` (${Math.round((tt.score / tt.max) * 1000) / 10}%)` : '';
    out.push('CBT TEST ANALYSIS');
    const head = [a.test_name, a.template && a.template.name].filter(Boolean).join(' | ');
    if (head) out.push(head);
    if (a.submitted_at) out.push('Date: ' + formatDate(a.submitted_at));
    if (a.submit_reason === 'time_up') out.push('Submitted automatically: time up');
    out.push(`Score: ${tt.score} / ${tt.max}${pct}`);
    const acc = typeof tt.accuracy === 'number' ? ` • Accuracy ${Math.round(tt.accuracy * 100)}%` : '';
    out.push(`Correct ${tt.correct} • Wrong ${tt.wrong} • Blank ${tt.blank}${acc}`);
    out.push('', '## Subject wise');
    (r.subjects || []).forEach(s => {
      out.push(`${s.name}: Score ${s.score} / ${s.max} • Correct ${s.correct} • Wrong ${s.wrong} • ` +
        `Blank ${s.blank} • Accuracy ${Math.round((s.accuracy || 0) * 100)}% • Time ${formatDuration(s.time_spent)}`);
    });
    const body = [];
    rpWalk(renderAnalysis(a, r, {}), body, 0);
    while (body.length && body[0] === '') body.shift();
    out.push('', ...body);
    return out.join('\n')
      .replace(/ Tap a chapter to see its topics\./g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim() + '\n';
  }

  async function copyToClipboard(text) {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* fall back to the older way below */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      if (ta.setSelectionRange) ta.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return !!ok;
    } catch (e) { return false; }
  }

  function copyButtonRow(a, r) {
    const row = el('div', 'copy-row');
    const btn = el('button', 'btn ghost small', '📋 Copy analysis');
    btn.type = 'button';
    const msg = el('div', 'muted small', '');
    msg.hidden = true;
    let reset = null;
    let fallback = null;
    const say = (t) => { msg.textContent = t; msg.hidden = !t; };
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      say('');
      let text = '';
      try { text = buildReport(a, r); } catch (e) { text = ''; }
      if (!text) {
        say('Could not build the analysis text.');
        btn.disabled = false;
        return;
      }
      const lines = text.split('\n').length;
      const ok = await copyToClipboard(text);
      btn.disabled = false;
      if (ok) {
        btn.textContent = '✓ Copied';
        say(`Whole analysis copied (${lines} lines). Paste it anywhere.`);
        if (reset) clearTimeout(reset);
        reset = setTimeout(() => { btn.textContent = '📋 Copy analysis'; }, 2500);
      } else {
        say('The browser blocked copying. Select the text below and copy it manually.');
        if (!fallback) {
          fallback = el('textarea', 'copy-fallback');
          fallback.readOnly = true;
          row.append(fallback);
        }
        fallback.value = text;
        if (fallback.focus) fallback.focus();
        if (fallback.select) fallback.select();
      }
    });
    row.append(btn, msg);
    return row;
  }

  // ---------- Tab 3: Review ----------
  function renderReview(a, r) {
    const pane = el('div', 'result-pane');
    const subjects = r.subjects || [];
    const f = { status: 'all', marked: false, only: null, onlyLabel: '' };
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
    const noteBar = el('div', 'filter-note');
    noteBar.hidden = true;

    const mk = (label, active, onClick) => {
      const b = el('button', 'filter-btn' + (active ? ' active' : ''), label);
      b.type = 'button';
      b.addEventListener('click', onClick);
      return b;
    };

    function refresh() {
      noteBar.replaceChildren();
      noteBar.hidden = !f.only;
      if (f.only) {
        noteBar.append(el('span', 'fn-text', `Showing: ${f.onlyLabel || 'selected questions'}`));
        const clr = el('button', 'btn ghost small', 'Clear');
        clr.type = 'button';
        clr.addEventListener('click', () => { f.only = null; f.onlyLabel = ''; refresh(); });
        noteBar.append(clr);
      }
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
          if (f.only && !f.only.has(s.name + '|' + i)) return;
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

    pane.append(filterWrap, noteBar, statusBar, rowsWrap);

    // Deep link from Analysis. flt: {status, subject, chapter, topic, difficulty} (all optional)
    pane.applyFilter = (flt) => {
      flt = flt || {};
      f.status = ['correct', 'wrong', 'blank'].includes(flt.status) ? flt.status : 'all';
      f.marked = false;
      f.only = Array.isArray(flt.only) ? new Set(flt.only) : null;
      f.onlyLabel = flt.label || '';
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