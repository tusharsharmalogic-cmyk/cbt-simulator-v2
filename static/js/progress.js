// Progress screen: trend graphs across all completed (non-retry) tests.
// Data comes from GET /api/progress (core/progress.py). Plain SVG, no libraries.
// Every test gets a paper level (Easy / Medium / Hard) from its question tags, so
// trends can be compared like with like (level chips) and read in context (E/M/H dots).

const progressScreen = (() => {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MIN_SAMPLE = 3;          // fewer questions than this -> left out of a trend
  const LEVELS = ['easy', 'medium', 'hard', 'unknown'];
  const LEVEL_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard', unknown: 'Unknown' };
  const LEVEL_LETTER = { easy: 'E', medium: 'M', hard: 'H', unknown: '?' };
  const DIFFS = ['easy', 'medium', 'hard'];
  const SUBJ_CLS = ['pg-s0', 'pg-s1', 'pg-s2', 'pg-s3', 'pg-s4', 'pg-s5'];

  const isNum = v => typeof v === 'number' && isFinite(v);
  const r1 = x => Math.round(x * 10) / 10;
  const tot = a => (a && a.total) || {};

  function nameOf(a) {
    return a && typeof a.test_name === 'string' && a.test_name.trim() ? a.test_name.trim() : 'Test';
  }

  function levelOf(a) {
    const k = a && a.level && a.level.key;
    return LEVELS.includes(k) ? k : 'unknown';
  }

  function fmtTime(sec) {
    sec = Math.max(0, Math.round(Number(sec) || 0));
    const m = Math.floor(sec / 60);
    return m ? `${m}m ${sec % 60}s` : `${sec}s`;
  }

  function svg(tag, attrs, cls, text) {
    const n = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(k => n.setAttribute(k, String(attrs[k])));
    if (cls) n.setAttribute('class', cls);
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function niceMax(m) {
    if (!(m > 0)) return 1;
    const pow = Math.pow(10, Math.floor(Math.log10(m)));
    const f = m / pow;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
  }

  // items: chronological attempts. series: [{name, cls, values: [number|null per item]}]
  // opts: {yMax, unit, time, levels, onPoint, label}
  function lineChart(items, series, opts) {
    opts = opts || {};
    const W = 320, H = 180, L = 36, R = 12, T = 18, B = 26;
    const n = items.length;
    const vals = [];
    series.forEach(s => s.values.forEach(v => { if (isNum(v)) vals.push(v); }));
    const yMax = isNum(opts.yMax) ? opts.yMax : niceMax(vals.length ? Math.max.apply(null, vals) : 0);
    const x = i => (n === 1 ? L + (W - L - R) / 2 : L + (i * (W - L - R)) / (n - 1));
    const y = v => T + (1 - Math.min(Math.max(v, 0), yMax) / yMax) * (H - T - B);
    const fmtY = v => (opts.time ? fmtTime(v) : String(Math.round(v)) + (opts.unit || ''));
    const fmtV = v => (opts.time ? fmtTime(v) : r1(v) + (opts.unit || ''));

    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opts.label || 'Trend chart' });
    [0, 0.5, 1].forEach(f => {
      const v = yMax * f;
      root.append(svg('line', { x1: L, x2: W - R, y1: y(v), y2: y(v) }, 'pg-grid'));
      root.append(svg('text', { x: L - 4, y: y(v) + 3, 'text-anchor': 'end' }, 'pg-tick', fmtY(v)));
    });
    const step = Math.ceil(n / 8);
    items.forEach((a, i) => {
      if (i % step === 0 || i === n - 1) {
        root.append(svg('text', { x: x(i), y: H - 8, 'text-anchor': 'middle' }, 'pg-tick', 'T' + a._n));
      }
    });

    series.forEach(s => {
      let seg = [];
      const flush = () => {
        if (seg.length > 1) {
          const d = seg.map((p, j) => (j ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
          root.append(svg('path', { d }, 'pg-line ' + s.cls));
        }
        seg = [];
      };
      s.values.forEach((v, i) => { if (isNum(v)) seg.push([x(i), y(v)]); else flush(); });
      flush();
    });

    series.forEach(s => s.values.forEach((v, i) => {
      if (!isNum(v)) return;
      const c = svg('circle', { cx: x(i), cy: y(v), r: 3.5 }, 'pg-dot ' + s.cls);
      c.append(svg('title', {}, '', `T${items[i]._n} • ${nameOf(items[i])} • ${s.name}: ${fmtV(v)}`));
      if (opts.onPoint) c.addEventListener('click', () => opts.onPoint(items[i]));
      root.append(c);
    }));

    if (opts.levels && series[0]) {
      series[0].values.forEach((v, i) => {
        if (!isNum(v)) return;
        const lv = levelOf(items[i]);
        root.append(svg('text', { x: x(i), y: y(v) - 7, 'text-anchor': 'middle' }, 'pg-lv lv-' + lv, LEVEL_LETTER[lv]));
      });
    }
    return root;
  }

  function chartBlock(items, series, opts) {
    const wrap = el('div', 'pg-chart');
    wrap.append(lineChart(items, series, opts));
    if (series.length > 1) {
      const lg = el('div', 'pg-legend');
      series.forEach(s => {
        const k = el('span', 'pg-leg');
        k.append(el('span', 'pg-key ' + s.cls), el('span', '', s.name));
        lg.append(k);
      });
      wrap.append(lg);
    }
    return wrap;
  }

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

  function emptyCard(text) {
    const c = el('div', 'card');
    c.append(el('p', 'muted center', text));
    return c;
  }

  function levelBadge(a) {
    const lv = levelOf(a);
    return el('span', 'an-badge lv-' + lv, LEVEL_LABEL[lv]);
  }

  // change = cur - prev. upGood: is a rise a good thing?
  function delta(cur, prev, kind, upGood) {
    if (!isNum(cur) || !isNum(prev)) return { text: '', cls: 'pg-flat' };
    const d = cur - prev;
    if (Math.abs(d) < (kind === 'time' ? 1 : 0.05)) return { text: 'no change', cls: 'pg-flat' };
    const up = d > 0;
    const body = kind === 'time' ? fmtTime(Math.abs(d)) : r1(Math.abs(d)) + ' pts';
    return { text: `${up ? '+' : '−'}${body} ${up ? '↑' : '↓'}`, cls: up === upGood ? 'pg-up' : 'pg-down' };
  }

  function cmpRow(label, cur, prev, kind, upGood) {
    const fmt = v => (!isNum(v) ? '—' : kind === 'time' ? fmtTime(v) : r1(v) + '%');
    const d = delta(cur, prev, kind, upGood);
    const row = el('div', 'mb-row');
    const left = el('div', 'mb-left');
    left.append(el('div', 'mb-label', label));
    left.append(el('div', 'muted small', `Previous: ${fmt(prev)}`));
    const right = el('div', 'mb-val');
    right.append(el('div', '', fmt(cur)));
    if (d.text) right.append(el('div', 'small ' + d.cls, d.text));
    row.append(left, right);
    return row;
  }

  function enough(body, items, level) {
    if (items.length >= 2) return true;
    body.append(emptyCard('Need at least 2 completed tests' + (level === 'all' ? '' : ' at this level') + ' to show a trend.'));
    return false;
  }

  function open(a) { location.hash = '#/attempt/' + a.id; }

  // ---------- sections ----------
  function buildCompare(body, items, level) {
    if (!enough(body, items, level)) return;
    const cur = items[items.length - 1];
    const prev = items[items.length - 2];
    const card = el('div', 'card');
    card.append(el('h3', '', `T${cur._n} vs T${prev._n}`));
    const l1 = el('div', 'muted small');
    l1.textContent = `${nameOf(cur)} (${LEVEL_LABEL[levelOf(cur)]}) compared with ${nameOf(prev)} (${LEVEL_LABEL[levelOf(prev)]})`;
    card.append(l1);
    card.append(cmpRow('Score', tot(cur).pct, tot(prev).pct, 'pct', true));
    card.append(cmpRow('Accuracy', tot(cur).accuracy, tot(prev).accuracy, 'pct', true));
    card.append(cmpRow('Average time per question', tot(cur).avg_time, tot(prev).avg_time, 'time', false));
    body.append(card);
    const a = levelOf(cur), b = levelOf(prev);
    if (a !== b && a !== 'unknown' && b !== 'unknown') {
      body.append(el('div', 'muted small',
        'These two papers have different levels, so a drop in score may not mean you got worse. ' +
        'Use the level chips above to compare papers of the same level.'));
    }
  }

  function buildScore(body, items, level) {
    if (!enough(body, items, level)) return;
    const card = el('div', 'card');
    card.append(chartBlock(items, [{ name: 'Score %', cls: 'pg-s0', values: items.map(a => tot(a).pct) }],
      { yMax: 100, unit: '%', levels: true, onPoint: open, label: 'Score trend' }));
    card.append(el('div', 'muted small', 'E / M / H above a point is that paper\'s level. Tap a point to open that test.'));
    body.append(card);
  }

  function buildAccuracy(body, items, level) {
    if (!enough(body, items, level)) return;
    const c1 = el('div', 'card');
    c1.append(el('h3', '', 'Accuracy'));
    c1.append(chartBlock(items, [{ name: 'Accuracy %', cls: 'pg-s1', values: items.map(a => tot(a).accuracy) }],
      { yMax: 100, unit: '%', levels: true, onPoint: open, label: 'Accuracy trend' }));
    c1.append(el('div', 'muted small', 'Accuracy = correct out of attempted questions.'));
    body.append(c1);
    const c2 = el('div', 'card');
    c2.append(el('h3', '', 'Average time per question'));
    c2.append(chartBlock(items, [{ name: 'Avg time', cls: 'pg-s2', values: items.map(a => tot(a).avg_time) }],
      { time: true, levels: true, onPoint: open, label: 'Time per question trend' }));
    body.append(c2);
  }

  function buildDifficulty(body, items, level) {
    if (!enough(body, items, level)) return;
    const series = DIFFS.map(d => ({
      name: LEVEL_LABEL[d], cls: 'pg-' + d,
      values: items.map(a => {
        const st = a.difficulty && a.difficulty[d];
        if (!st || st.total < MIN_SAMPLE) return null;
        const att = st.correct + st.wrong;
        return att ? r1((st.correct * 100) / att) : null;
      }),
    }));
    if (!series.some(s => s.values.some(isNum))) {
      body.append(emptyCard(`Not enough tagged questions per difficulty (need ${MIN_SAMPLE}+ in a test).`));
      return;
    }
    const card = el('div', 'card');
    card.append(chartBlock(items, series, { yMax: 100, unit: '%', onPoint: open, label: 'Accuracy by question difficulty' }));
    card.append(el('div', 'muted small',
      `Accuracy on Easy, Medium and Hard questions separately. This shows real progress even when the papers differ in difficulty. ` +
      `Tests with fewer than ${MIN_SAMPLE} questions of a difficulty are left out of that line.`));
    body.append(card);
  }

  function buildSubjects(body, items, level) {
    if (!enough(body, items, level)) return;
    const names = [];
    items.forEach(a => (a.subjects || []).forEach(s => { if (!names.includes(s.name)) names.push(s.name); }));
    const series = names.map((n, i) => ({
      name: n, cls: SUBJ_CLS[i % SUBJ_CLS.length],
      values: items.map(a => {
        const s = (a.subjects || []).find(x => x.name === n);
        return s && isNum(s.pct) ? s.pct : null;
      }),
    }));
    if (!series.length) { body.append(emptyCard('No subject data.')); return; }
    const card = el('div', 'card');
    card.append(chartBlock(items, series, { yMax: 100, unit: '%', onPoint: open, label: 'Subject-wise score trend' }));
    body.append(card);
  }

  function chapterRow(r, multi) {
    const row = el('div', 'an-row');
    const top = el('div', 'an-top');
    top.append(el('div', 'an-label', r.name + (multi ? ` (${r.subject})` : '')));
    const d = delta(r.last.acc, r.first.acc, 'pct', true);
    top.append(el('div', 'pg-chg ' + d.cls, d.text));
    row.append(top);
    const low = r.first.total < MIN_SAMPLE || r.last.total < MIN_SAMPLE;
    row.append(el('div', 'muted small',
      `${r1(r.first.acc)}% → ${r1(r.last.acc)}% correct • T${r.first.n} → T${r.last.n}` + (low ? ' • low data' : '')));
    return row;
  }

  function buildChapters(body, items, level) {
    if (!enough(body, items, level)) return;
    const map = new Map();
    items.forEach(a => (a.chapters || []).forEach(c => {
      if (c.name === 'Unknown' || !c.total) return;
      const k = c.subject + '|' + c.name;
      let e = map.get(k);
      if (!e) { e = { subject: c.subject, name: c.name, pts: [] }; map.set(k, e); }
      e.pts.push({ n: a._n, acc: (c.correct * 100) / c.total, total: c.total });
    }));
    const rows = [...map.values()].filter(e => e.pts.length >= 2).map(e => {
      const first = e.pts[0], last = e.pts[e.pts.length - 1];
      return Object.assign({}, e, { first, last, d: last.acc - first.acc });
    });
    if (!rows.length) { body.append(emptyCard('No chapter appears in 2 or more tests yet.')); return; }
    const multi = new Set(rows.map(r => r.subject)).size > 1;
    const up = rows.filter(r => r.d > 0.5).sort((x, y) => y.d - x.d).slice(0, 5);
    const down = rows.filter(r => r.d < -0.5).sort((x, y) => x.d - y.d).slice(0, 5);
    const same = rows.length - rows.filter(r => r.d > 0.5).length - rows.filter(r => r.d < -0.5).length;

    const mkCard = (title, list, emptyText) => {
      const c = el('div', 'card');
      c.append(el('h3', '', title));
      if (!list.length) c.append(el('p', 'muted center', emptyText));
      list.forEach(r => c.append(chapterRow(r, multi)));
      return c;
    };
    body.append(el('div', 'muted small',
      'Compares each chapter\'s share of correct answers in the first test it appeared in with the latest one.'));
    body.append(mkCard('Improved', up, 'No chapter has improved yet.'));
    body.append(mkCard('Needs attention', down, 'No chapter has dropped.'));
    if (same > 0) body.append(el('div', 'muted small', `${same} chapter${same === 1 ? '' : 's'} with no real change.`));
  }

  function buildTests(body, items) {
    const card = el('div', 'card');
    [...items].reverse().forEach(a => {
      const row = el('div', 'pg-test');
      row.append(el('div', 'pg-test-n', 'T' + a._n));
      const main = el('div', 'pg-test-main');
      main.append(el('div', 'pg-test-name', nameOf(a)));
      const meta = [];
      if (isNum(a.submitted_at)) meta.push(new Date(a.submitted_at * 1000).toLocaleDateString());
      meta.push(`${(tot(a).total || 0)} questions`);
      main.append(el('div', 'muted small', meta.join(' • ')));
      row.append(main, levelBadge(a));
      row.append(el('div', 'pg-test-score', isNum(tot(a).pct) ? r1(tot(a).pct) + '%' : '—'));
      row.addEventListener('click', () => open(a));
      card.append(row);
    });
    body.append(card);
  }

  // ---------- screen ----------
  function render(data) {
    const all = ((data && data.attempts) || []).map((a, i) => Object.assign({ _n: i + 1 }, a));
    const root = el('div', 'stack progress-screen');
    if (!all.length) {
      root.append(emptyCard('No completed tests yet. Finish a test to see your progress here.'));
      return root;
    }

    const rule = (data && data.level_rule) || {};
    const lo = isNum(rule.easy_below) ? rule.easy_below : 1.67;
    const hi = isNum(rule.hard_above) ? rule.hard_above : 2.33;
    const mt = Math.round((isNum(rule.min_tagged) ? rule.min_tagged : 0.7) * 100);
    const ex = (data && data.excluded_retries) || 0;
    root.append(el('div', 'muted small',
      `Each paper gets a level from the Easy / Medium / Hard tags of its questions ` +
      `(Easy = 1, Medium = 2, Hard = 3; average below ${lo} is an Easy paper, above ${hi} is a Hard paper, otherwise Medium). ` +
      `Papers with fewer than ${mt}% tagged questions are Unknown. ` +
      `Retry attempts are not counted${ex ? ` (${ex} left out)` : ''}.`));

    const view = { level: 'all', open: {} };
    const chips = el('div', 'filter-bar an-chips');
    const content = el('div', 'stack an-content');

    const draw = () => {
      chips.replaceChildren();
      const present = LEVELS.filter(l => all.some(a => levelOf(a) === l));
      const mk = (label, key) => {
        const b = el('button', 'filter-btn' + (view.level === key ? ' active' : ''), label);
        b.type = 'button';
        b.addEventListener('click', () => { view.level = key; draw(); });
        return b;
      };
      chips.append(mk(`All (${all.length})`, 'all'));
      present.forEach(l => chips.append(mk(`${LEVEL_LABEL[l]} papers (${all.filter(a => levelOf(a) === l).length})`, l)));
      chips.hidden = present.length < 2;

      const items = view.level === 'all' ? all : all.filter(a => levelOf(a) === view.level);
      const lv = view.level;
      content.replaceChildren(
        section('Latest vs previous', 'cmp', view.open, b => buildCompare(b, items, lv)),
        section('Score trend', 'score', view.open, b => buildScore(b, items, lv)),
        section('Accuracy and speed', 'acc', view.open, b => buildAccuracy(b, items, lv)),
        section('Difficulty-wise accuracy', 'diff', view.open, b => buildDifficulty(b, items, lv)),
        section('Subject-wise score', 'subj', view.open, b => buildSubjects(b, items, lv)),
        section('Chapter-wise change', 'chap', view.open, b => buildChapters(b, items, lv)),
        section('Tests compared', 'tests', view.open, b => buildTests(b, items)),
      );
    };

    draw();
    root.append(chips, content);
    return root;
  }

  return { render };
})();