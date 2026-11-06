// Result screen. attempt.result (server) ka use. Filters + expandable rows.

const resultScreen = (() => {

  function render(a, opts) {
    // opts: {onBack}
    const r = a.result;
    if (!r) return el('p', 'error', 'Result missing');

    const root = el('div', 'stack result-screen');

    // ---- Top summary ----
    const top = el('div', 'card result-top');
    const score = el('div', 'result-score');
    score.append(el('span', 'score-num', String(r.total.score)));
    score.append(el('span', 'score-max', ` / ${r.total.max}`));
    top.append(score);
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
    root.append(top);

    // ---- Subject breakdown cards ----
    root.append(el('h2', 'section-title', 'Subject wise'));
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
      root.append(card);
    });

    // ---- Filters + per-question list ----
    root.append(el('h2', 'section-title', 'Questions'));
    const filterBar = el('div', 'filter-bar');
    let filter = 'all';
    const filterBtn = (key, label) => {
      const b = el('button', 'filter-btn' + (filter === key ? ' active' : ''), label);
      b.type = 'button';
      b.addEventListener('click', () => { filter = key; refreshRows(); });
      return b;
    };

    const rowsWrap = el('div', 'rows-wrap');

    function refreshRows() {
      filterBar.replaceChildren(
        filterBtn('all', 'All'),
        filterBtn('correct', 'Correct'),
        filterBtn('wrong', 'Wrong'),
        filterBtn('blank', 'Blank'),
      );
      rowsWrap.replaceChildren();
      (r.subjects || []).forEach(s => {
        const qs = a.questions[s.name] || [];
        s.rows.forEach((row, i) => {
          if (filter !== 'all' && row.status !== filter) return;
          rowsWrap.append(renderRow(a, s, row, qs[i], i));
        });
      });
      if (!rowsWrap.children.length) {
        rowsWrap.append(el('p', 'muted center', 'Is filter me koi question nahi.'));
      }
    }
    filterBar.replaceChildren(
      filterBtn('all', 'All'),
      filterBtn('correct', 'Correct'),
      filterBtn('wrong', 'Wrong'),
      filterBtn('blank', 'Blank'),
    );
    root.append(filterBar);
    root.append(rowsWrap);
    refreshRows();

    // ---- Back button ----
    const back = el('button', 'btn wide', 'Home');
    back.type = 'button';
    back.addEventListener('click', () => { location.hash = '#/home'; });
    root.append(back);

    return root;
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

  function renderRow(a, subj, row, q, index) {
    const wrap = el('div', 'card result-row ' + row.status);
    const head = el('div', 'row-head');
    const badge = row.status === 'correct' ? '✓'
                : row.status === 'wrong' ? '✗'
                : '—';
    head.append(el('span', 'row-badge ' + row.status, badge));
    head.append(el('span', 'row-title', `${subj.name} Q${index + 1}`));
    const metaBits = [];
    if (row.choice) metaBits.push(`Tum: ${row.choice}`);
    if (row.answer) metaBits.push(`Sahi: ${row.answer}`);
    if (row.time_spent) metaBits.push(`${formatDuration(row.time_spent)}`);
    head.append(el('span', 'row-meta', metaBits.join(' • ')));
    const toggle = el('button', 'icon-btn', '▾');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    head.append(toggle);
    wrap.append(head);

    const body = el('div', 'row-body');
    body.hidden = true;

    // Render full question with solution
    const qCard = renderQuestion(q, index + 1, { showSolution: true });
    body.append(qCard);

    // Extra answers line
    const ansLine = el('div', 'ans-line');
    ansLine.append(el('span', 'kv-label', 'Tumhara answer: '),
                   el('span', '', row.choice || '—'));
    ansLine.append(el('span', 'kv-label', ' | Sahi answer: '),
                   el('span', '', row.answer || '—'));
    if (row.marked) ansLine.append(el('span', 'chip marked-chip', 'Marked'));
    body.append(ansLine);

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