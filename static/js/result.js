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
    const tabs = [
      { key: 'overview', label: 'Overview', pane: renderOverview(a, r, opts) },
      { key: 'analysis', label: 'Analysis', pane: renderAnalysis(a, r) },
      { key: 'review', label: 'Review', pane: renderReview(a, r) },
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
  function emptyStat() { return { total: 0, correct: 0, wrong: 0, blank: 0 }; }

  function addRow(st, status) {
    st.total++;
    if (status === 'correct') st.correct++;
    else if (status === 'wrong') st.wrong++;
    else st.blank++;
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

  function renderAnalysis(a, r) {
    const pane = el('div', 'stack result-pane');

    // Rows ko (subject, question) ke saath jodo
    const subjects = (r.subjects || []).map(s => {
      const qs = (a.questions && a.questions[s.name]) || [];
      return { name: s.name, items: (s.rows || []).map((row, i) => ({ row, q: qs[i] || {} })) };
    });

    // ---- Difficulty (overall) ----
    const diffStats = {};
    DIFFS.forEach(d => { diffStats[d] = emptyStat(); });
    subjects.forEach(s => s.items.forEach(it => addRow(diffStats[diffOf(it.q)], it.row.status)));

    pane.append(el('h2', 'section-title', 'Difficulty wise'));
    const diffCard = el('div', 'card');
    let anyDiff = false;
    DIFFS.forEach(d => {
      const st = diffStats[d];
      if (!st.total) return;
      anyDiff = true;
      diffCard.append(analysisRow(`${DIFF_LABEL[d]} (${st.total})`, st));
    });
    if (!anyDiff) diffCard.append(el('p', 'muted center', 'Koi question nahi.'));
    pane.append(diffCard);

    // ---- Chapter / topic (subject ke andar) ----
    pane.append(el('h2', 'section-title', 'Chapter wise'));
    pane.append(el('div', 'muted small', 'Kamzor chapter pehle. Chapter pe tap karo to topics dikhenge.'));
    subjects.forEach(s => {
      const chapters = new Map();
      s.items.forEach(it => {
        const ch = labelOf(it.q.chapter);
        const tp = labelOf(it.q.topic);
        let c = chapters.get(ch);
        if (!c) { c = { name: ch, st: emptyStat(), topics: new Map() }; chapters.set(ch, c); }
        addRow(c.st, it.row.status);
        let t = c.topics.get(tp);
        if (!t) { t = { name: tp, st: emptyStat() }; c.topics.set(tp, t); }
        addRow(t.st, it.row.status);
      });
      const card = el('div', 'card');
      card.append(el('h3', '', s.name));
      // sort: correct/total ascending (kamzor pehle)
      const list = [...chapters.values()].sort((x, y) =>
        (x.st.correct / x.st.total) - (y.st.correct / y.st.total) || y.st.total - x.st.total);
      list.forEach(c => {
        const wrap = el('div', 'an-chapter');
        const head = analysisRow(`${c.name} (${c.st.total})`, c.st);
        head.classList.add('tappable');
        const sub = el('div', 'an-topics');
        sub.hidden = true;
        [...c.topics.values()]
          .sort((x, y) => (x.st.correct / x.st.total) - (y.st.correct / y.st.total))
          .forEach(t => sub.append(analysisRow(`${t.name} (${t.st.total})`, t.st)));
        head.addEventListener('click', () => {
          sub.hidden = !sub.hidden;
          head.classList.toggle('open', !sub.hidden);
        });
        wrap.append(head, sub);
        card.append(wrap);
      });
      pane.append(card);
    });

    return pane;
  }

  function analysisRow(label, st) {
    const row = el('div', 'an-row');
    row.append(el('div', 'an-label', label));
    row.append(statBar(st));
    row.append(el('div', 'muted small', statLine(st)));
    return row;
  }

  // ---------- Tab 3: Review ----------
  function renderReview(a, r) {
    const pane = el('div', 'result-pane');
    const subjects = r.subjects || [];

    const f = { status: 'all', subject: 'all', marked: false };

    const statusBar = el('div', 'filter-bar');
    const subjBar = el('div', 'filter-bar');
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
      if (subjects.length > 1) {
        const items = [mk('All subjects', f.subject === 'all', () => { f.subject = 'all'; refresh(); })];
        subjects.forEach(s => items.push(
          mk(s.name, f.subject === s.name, () => { f.subject = s.name; refresh(); })));
        subjBar.replaceChildren(...items);
      }
      rowsWrap.replaceChildren();
      subjects.forEach(s => {
        if (f.subject !== 'all' && f.subject !== s.name) return;
        const qs = a.questions[s.name] || [];
        // Subject ka max time (filter se independent) — bar isi ke relative
        const maxT = (s.rows || []).reduce((m, rw) => Math.max(m, rw.time_spent || 0), 0);
        // Touched (answer ya time > 0) upar, untouched (blank + 0s) neeche; dono me original order
        const idx = (s.rows || []).map((_, i) => i);
        const touched = i => { const rw = s.rows[i]; return !!rw.choice || (rw.time_spent || 0) > 0; };
        [...idx.filter(touched), ...idx.filter(i => !touched(i))].forEach(i => {
          const row = s.rows[i];
          if (f.status !== 'all' && row.status !== f.status) return;
          if (f.marked && !row.marked) return;
          rowsWrap.append(renderRow(a, s, row, qs[i], i, maxT));
        });
      });
      if (!rowsWrap.children.length) {
        rowsWrap.append(el('p', 'muted center', 'Is filter me koi question nahi.'));
      }
    }

    pane.append(statusBar);
    if (subjects.length > 1) pane.append(subjBar);
    pane.append(rowsWrap);
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