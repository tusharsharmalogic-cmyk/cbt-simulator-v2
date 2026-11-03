// Entry + hash router.
// Routes: #/home, #/templates/new, #/templates/<id>, #/preview/<id>, #/setup, #/test, #/attempt/<id>

const app = document.getElementById('app');
const backBtn = document.getElementById('back');
const titleEl = document.getElementById('title');
const themeBtn = document.getElementById('theme-toggle');

function show(title, ...nodes) {
  titleEl.textContent = title;
  app.replaceChildren(...nodes);
  backBtn.hidden = (state.screen === 'home' || state.screen === 'test');
  window.scrollTo(0, 0);
  typeset(app);
}

function applyTheme(theme) {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = theme;
  if (themeBtn) {
    themeBtn.textContent = theme === 'dark' ? '☾' : theme === 'light' ? '☀' : '◐';
    themeBtn.title = `Theme: ${theme}`;
  }
}

async function loadSettings() {
  try { state.settings = await api.settings(); } catch { state.settings = { theme: 'system' }; }
  applyTheme(state.settings.theme);
}

function cycleTheme() {
  const order = ['system', 'light', 'dark'];
  const next = order[(order.indexOf(state.settings.theme) + 1) % order.length];
  state.settings.theme = next;
  applyTheme(next);
  api.saveSettings(next).catch((e) => console.warn('theme save:', e.message));
}

// ========== Home ==========
async function showHome() {
  state.screen = 'home';
  const wrap = el('div', 'home-menu');
  wrap.append(el('div', 'home-title', 'CBT SIMULATOR'));

  let attempts = [];
  try { attempts = await api.attempts(); } catch {}
  const inprog = attempts.filter(a => a.status === 'in_progress');

  const items = [
    { icon: '▶', label: 'Start New Test', primary: true, hash: '#/setup' },
    { icon: '📋', label: 'Available Test', hash: '#/available' },
    { icon: '✅', label: 'Completed Test', hash: '#/completed' },
    { icon: '📄', label: 'Subject Templates', hash: '#/templates' },
    { icon: '⚙', label: 'Setting', hash: '#/settings' },
  ];
  items.forEach(it => {
    const b = el('button', 'menu-btn' + (it.primary ? ' primary' : ''));
    b.type = 'button';
    b.append(el('span', 'menu-icon', it.icon));
    b.append(el('span', 'menu-label', it.label));
    if (it.hash === '#/setup' && inprog.length) {
      b.append(el('span', 'chip', 'Resume'));
    }
    b.addEventListener('click', () => { location.hash = it.hash; });
    wrap.append(b);
  });

  wrap.append(el('div', 'home-footer', 'Prepare • Practice • Perform'));
  show('', wrap);
  backBtn.hidden = true;
}

// ========== Builder ==========
async function showBuilder(id) {
  state.screen = 'builder';
  let ed;
  if (id === 'new') ed = builder.blankEditor();
  else {
    show('Template', el('p', 'muted', 'Load ho raha hai...'));
    try { ed = builder.fromTemplate(await api.template(id)); }
    catch (e) { show('Error', el('p', 'error', e.message)); return; }
  }
  state.editor = ed;

  const rerender = () => { app.replaceChildren(renderBuilderScreen()); typeset(app); };

  function renderBuilderScreen() {
    return builder.render(ed, { onStructure: () => rerender(), onSave: save, onDelete: del });
  }

  async function save() {
    ed.errors = {};
    const body = {
      name: ed.name,
      timer_mode: ed.timer_mode,
      total_minutes: ed.timer_mode === 'total' ? ed.total_minutes : null,
      subjects: ed.subjects.map(s => ({
        name: s.name, questions: s.questions, marks: s.marks, negative: s.negative,
        minutes: ed.timer_mode === 'subject' ? s.minutes : null,
        lock_mode: s.lock_mode || 'none',
        per_question_seconds: s.lock_mode === 'question' ? s.per_question_seconds : null,
        subject_minutes: s.lock_mode === 'subject' ? s.subject_minutes : null,
      })),
    };
    try {
      const saved = await api.saveTemplate(ed.id, body);
      if (ed.id === 'new') { ed.id = saved.id; location.hash = `#/templates/${saved.id}`; }
      const note = el('div', 'toast', 'Saved');
      document.body.append(note);
      setTimeout(() => note.remove(), 1500);
    } catch (e) {
      if (e.status === 422 && e.errors) { ed.errors._global = e.errors; rerender(); window.scrollTo(0, document.body.scrollHeight); }
      else alert('Save fail: ' + e.message);
    }
  }

  async function del() {
    try { await api.deleteTemplate(ed.id); location.hash = '#/home'; }
    catch (e) { alert('Delete fail: ' + e.message); }
  }

  show(id === 'new' ? 'New Template' : 'Edit Template', renderBuilderScreen());
  typeset(app);
}

// ========== Setup: template + import JSONs + start ==========
async function showSetup() {
  state.screen = 'setup';
  show('Start New Test', el('p', 'muted', 'Load ho raha hai...'));
  let templates = [], tests = [];
  try { templates = await api.templates(); } catch {}
  try { tests = await api.tests(); } catch {}
  const s = setup.initialState(templates, tests);

  const opts = {
    onTemplateChange: (id) => {
      s.templateId = id;
      rerender();
    },
    onTestChange: (id) => {
      s.testId = id;
      const t = s.tests.find(x => x.id === id);
      if (t) s.testName = t.name;
      rerender();
    },
    onNameChange: (name) => { s.testName = name; },
    onFilesPicked: (files) => {
      s.files = files;
      s.importError = null;
      s.imported = null;
      rerender();
    },
    onToggleImport: () => { s.showImport = !s.showImport; rerender(); },
    onImport: doImport,
    onStart: start,
  };

  const rerender = () => {
    app.replaceChildren(setup.render(s, opts));
    typeset(app);
  };

  async function doImport() {
    if (!s.files.length) { alert('Koi file select karo'); return; }
    if (!s.templateId) { alert('Pehle template chuno'); return; }
    s.importing = true; s.importError = null; s.imported = null;
    rerender();
    try {
      const res = await api.importTests(s.files, s.templateId, s.testName);
      s.imported = res;
      // refresh tests + select newly imported
      try { s.tests = await api.tests(); } catch {}
      s.testId = res.test_id;
      s.testName = res.test_name;
      s.showImport = false;
    } catch (e) {
      s.importError = { message: e.message, skipped: e.skipped };
    } finally {
      s.importing = false;
      rerender();
    }
  }

  async function start() {
    if (!s.templateId || !s.testId) { alert('Template aur Test dono chuno'); return; }
    try {
      const a = await api.createAttempt(s.templateId, s.testId);
      location.hash = `#/attempt/${a.id}`;
    } catch (e) {
      alert('Start fail: ' + e.message);
    }
  }

  rerender();
  typeset(app);
  backBtn.hidden = false;
}

// ========== Test screen (Step 5: server-backed) ==========
const testCtl = {
  attemptId: null,
  deadline: 0,         // server epoch seconds
  serverAt: 0,         // performance.now() when deadline was received
  ticker: null,
  syncTimer: null,
  leaving: false,
  pendingSave: new Set(),
  lastVisit: null,     // {subject, index, at: performance.now()}
  submitting: false,
  bannerEl: null,
};

function setTimingFromServer(t) {
  testCtl.deadline = t.deadline;
  testCtl.remainingAtReceive = t.remaining_seconds;
  testCtl.serverAt = performance.now();
  testCtl.timing = t;
  testCtl.subjectEndAt = (t.subject && t.subject.remaining_seconds)
    ? performance.now() + t.subject.remaining_seconds * 1000
    : null;
  testCtl.subjectName = t.subject ? t.subject.name : null;
}

function remainingSeconds() {
  const elapsed = (performance.now() - testCtl.serverAt) / 1000;
  return Math.max(0, testCtl.remainingAtReceive - elapsed);
}

function showSaveBanner(msg) {
  if (!testCtl.bannerEl) {
    testCtl.bannerEl = el('div', 'save-banner', msg);
    document.body.append(testCtl.bannerEl);
  } else {
    testCtl.bannerEl.textContent = msg;
    testCtl.bannerEl.hidden = false;
  }
}
function hideSaveBanner() {
  if (testCtl.bannerEl) { testCtl.bannerEl.hidden = true; testCtl.bannerEl.remove(); testCtl.bannerEl = null; }
}

async function withRetry(fn, label) {
  let delay = 400;
  for (let i = 0; i < 5; i++) {
    try { return await fn(); }
    catch (e) {
      if (e.status === 409) throw e;
      showSaveBanner('Save nahi hua, retry ho raha hai…');
      await new Promise(r => setTimeout(r, delay));
      delay = Math.min(delay * 2, 5000);
    }
  }
  showSaveBanner(`Save fail (${label}) — network check karo`);
  throw new Error(`save failed: ${label}`);
}

// Returns {ok:true, view} on success, {ok:false, jumped:true} if 409 auto-jumped,
// {ok:false, error} otherwise. Callers MUST check .ok before overwriting state.current.
function sendVisit(nextSubject, nextIndex) {
  if (!testCtl.attemptId) return Promise.resolve({ ok: true });
  const prev = testCtl.lastVisit;
  let spent = 0;
  if (prev) spent = (performance.now() - prev.at) / 1000;
  testCtl.lastVisit = { subject: nextSubject, index: nextIndex, at: performance.now() };
  return withRetry(() => api.visit(testCtl.attemptId, nextSubject, nextIndex, spent), 'visit')
    .then(v => { if (v.timing) setTimingFromServer(v.timing); return { ok: true, view: v }; })
    .catch(e => {
      if (e.status === 409) { handle409(e); return { ok: false, jumped: true }; }
      return { ok: false, error: e };
    });
}

function handle409(e) {
  const code = e.data && e.data.error;
  if (code === 'time_up' || code === 'already_submitted') {
    // Force reload (server finalizes on GET)
    if (testCtl.attemptId) location.hash = `#/attempt/${testCtl.attemptId}`;
    return;
  }
  if (code === 'subject_locked' || code === 'question_locked') {
    const v = e.data && e.data.view;
    if (v) { state.attempt = v; setTimingFromServer(v.timing); }
    const nxt = e.data && e.data.next;
    if (nxt) {
      // auto-jump to next unlocked question
      testCtl.lastVisit = { subject: nxt.subject, index: nxt.index, at: performance.now() };
      state.attempt.current = { subject: nxt.subject, index: nxt.index };
      renderTest();
    } else {
      // no unlocked question left -> server will auto-submit on next GET
      refreshAttempt();
    }
    return;
  }
  // fallback
  if (testCtl.attemptId) refreshAttempt();
}

async function refreshAttempt() {
  try {
    const a = await api.attempt(testCtl.attemptId);
    state.attempt = a;
    setTimingFromServer(a.timing);
    renderTest();
  } catch (e) {
    if (e.status === 404) location.hash = '#/home';
  }
}

async function showAttempt(id) {
  state.screen = 'test';
  testCtl.attemptId = id;
  testCtl.leaving = false;
  show('Test', el('p', 'muted', 'Load ho raha hai...'));
  try {
    const a = await api.attempt(id);
    state.attempt = a;
    setTimingFromServer(a.timing);
    // mark visit for landing question (2 s min tap)
    testCtl.lastVisit = { subject: a.current.subject, index: a.current.index, at: performance.now() };
  } catch (e) {
    show('Error', el('p', 'error', e.message));
    return;
  }

  if (state.attempt.status === 'submitted') {
    // Step 6: full result screen
    stopTicker(); stopSync();
    titleEl.textContent = 'Result';
    backBtn.hidden = false;
    show('Result', resultScreen.render(state.attempt, {}));
    return;
  }

  renderTest();
  startTicker();
  startSync();
}

function startTicker() {
  stopTicker();
  testCtl.ticker = setInterval(() => {
    const t = remainingSeconds();
    const timerNode = document.querySelector('.test-timer-bar .timer');
    if (timerNode) timerNode.textContent = '⏱ ' + testScreen.formatTime(t);
    // subject timer (global timer_mode=subject)
    if (testCtl.subjectEndAt) {
      const sr = (testCtl.subjectEndAt - performance.now()) / 1000;
      const subjTimer = document.querySelector('.subj-timer');
      if (subjTimer) subjTimer.textContent = testScreen.formatTime(Math.max(0, sr));
      if (sr <= 0 && !testCtl.submitting) {
        testCtl.submitting = true;
        refreshAttempt().finally(() => { testCtl.submitting = false; });
      }
    }
    // per-Q / per-subject lock timers (client-side countdown from timestamps)
    const a = state.attempt;
    if (a) {
      const subj = a.current.subject, idx = a.current.index;
      const nowSec = Date.now() / 1000;
      const ts = (a.template && a.template.subjects || []).find(s => s.name === subj);
      const qNode = document.querySelector('.lock-timer.q-lock');
      let lockExpired = false;
      if (ts && ts.lock_mode === 'question' && ts.per_question_seconds) {
        const r = (a.responses[subj] || [])[idx];
        if (r && r.q_started_at != null) {
          const rem = Math.max(0, r.q_started_at + ts.per_question_seconds - nowSec);
          if (qNode) qNode.textContent = testScreen.formatTime(rem);
          if (rem <= 0) lockExpired = true;
        }
      }
      if (ts && ts.lock_mode === 'subject' && ts.subject_minutes) {
        const started = (a.subject_started_at || {})[subj];
        if (started != null) {
          const rem = Math.max(0, started + ts.subject_minutes * 60 - nowSec);
          const n2 = document.querySelector('.lock-timer.subj-lock');
          if (n2) n2.textContent = testScreen.formatTime(rem);
          if (rem <= 0) lockExpired = true;
        }
      }
      if (lockExpired && !testCtl.submitting) {
        testCtl.submitting = true;
        // Re-visit current Q: server detects lock, returns next unlocked target
        // (or auto-submits if everything is locked).
        api.visit(testCtl.attemptId, subj, idx, 0)
          .then(v => {
            state.attempt = v; setTimingFromServer(v.timing); renderTest();
          })
          .catch(e => {
            if (e.status === 409) handle409(e);
          })
          .finally(() => { testCtl.submitting = false; });
      }
    }
    if (t <= 0 && !testCtl.submitting) {
      testCtl.submitting = true;
      refreshAttempt().finally(() => {
        if (state.attempt && state.attempt.status === 'submitted') location.hash = `#/attempt/${testCtl.attemptId}`;
      });
    }
  }, 500);
}
function stopTicker() { if (testCtl.ticker) clearInterval(testCtl.ticker); testCtl.ticker = null; }

function startSync() {
  stopSync();
  // har 30 s aur tab focus pe server se resync
  testCtl.syncTimer = setInterval(() => refreshAttempt(), 30000);
  document.addEventListener('visibilitychange', onVisibility);
}
function stopSync() {
  if (testCtl.syncTimer) clearInterval(testCtl.syncTimer); testCtl.syncTimer = null;
  document.removeEventListener('visibilitychange', onVisibility);
}
function onVisibility() {
  if (document.visibilityState === 'visible' && state.screen === 'test') refreshAttempt();
}

function renderTest() {
  const a = state.attempt;
  if (!a || a.status !== 'in_progress') {
    if (a && a.status === 'submitted') {
      titleEl.textContent = 'Result';
      show('Result', resultScreen.render(a, {}));
    }
    return;
  }
  const root = testScreen.render(a, {
    onChange: (action) => handleAction(action),
    onOpenPalette: () => { paletteOpen = true; mountPalette(); },
    onSubmit: () => openSubmitConfirm(),
    remainingSeconds: remainingSeconds(),
    timing: testCtl.timing,
    onSubjectTab: (subj) => {
      // subject tab pe jump karo -> visit call
      if (a.current.subject === subj) return;
      const nextIdx = a.current.index;
      a.current = { subject: subj, index: 0 };
      sendVisit(subj, 0).then(() => { refreshAttempt(); });
    },
  });
  app.replaceChildren(root);
  titleEl.textContent = a.test_name || 'Test';
  backBtn.hidden = true;
  typeset(app);
}

function handleAction(action) {
  if (!action || !action.type) return;
  const a = state.attempt;
  if (!a) return;
  if (action.type === 'answer') {
    withRetry(() => api.answer(a.id, action.subject, action.index, action.choice), 'answer')
      .then(v => { state.attempt = v; setTimingFromServer(v.timing); renderTest(); })
      .catch(e => { if (e.status === 409) handle409(e); });
  } else if (action.type === 'mark') {
    withRetry(() => api.mark(a.id, action.subject, action.index, action.marked), 'mark')
      .then(v => { state.attempt = v; setTimingFromServer(v.timing); renderTest(); })
      .catch(e => { if (e.status === 409) handle409(e); });
  } else if (action.type === 'navigate') {
    // flush previous visit + navigate locally then refresh
    sendVisit(action.subject, action.index).then(() => {
      a.current = { subject: action.subject, index: action.index };
      refreshAttempt();
    });
  } else if (action.type === 'clear') {
    withRetry(() => api.answer(a.id, action.subject, action.index, null), 'clear')
      .then(v => { state.attempt = v; setTimingFromServer(v.timing); renderTest(); })
      .catch(e => { if (e.status === 409) handle409(e); });
  }
}

function openSubmitConfirm() {
  const a = state.attempt;
  const sheet = el('div', 'sheet');
  sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.remove(); });
  const panel = el('div', 'sheet-panel');
  panel.append(el('div', 'sheet-handle'));
  panel.append(el('h3', '', 'Submit karna hai?'));

  // counts across all subjects
  let total = 0, answered = 0, marked = 0;
  Object.entries(a.responses).forEach(([s, list]) => {
    total += list.length;
    list.forEach(r => { if (r.choice) answered++; if (r.marked) marked++; });
  });
  panel.append(el('p', 'muted', `Answered: ${answered} / ${total}  •  Marked: ${marked}  •  Not answered: ${total - answered}`));

  const row = el('div', 'actions-row');
  const cancel = el('button', 'btn ghost', 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', () => sheet.remove());
  const submit = el('button', 'btn', 'Submit');
  submit.type = 'button';
  submit.addEventListener('click', async () => {
    submit.disabled = true;
    try {
      const r = await api.submit(a.id);
      state.attempt = r;
      sheet.remove();
      stopTicker(); stopSync();
      location.hash = `#/attempt/${a.id}`;
    } catch (e) {
      alert('Submit fail: ' + e.message);
      submit.disabled = false;
    }
  });
  row.append(cancel, submit);
  panel.append(row);

  sheet.append(panel);
  document.body.append(sheet);
}

// palette (unchanged from Step 4)
let paletteOpen = false;
let paletteEl = null;
function mountPalette() {
  if (paletteEl) paletteEl.remove();
  if (!paletteOpen) return;
  paletteEl = palette.render(state.attempt, {
    onJump: (subj, idx) => {
      paletteOpen = false; unmountPalette();
      if (state.attempt.current.subject === subj && state.attempt.current.index === idx) return;
      sendVisit(subj, idx).then(r => { if (r.ok) refreshAttempt(); });
    },
    onClose: () => { paletteOpen = false; unmountPalette(); },
  });
  document.body.append(paletteEl);
}
function unmountPalette() { if (paletteEl) { paletteEl.remove(); paletteEl = null; } }

// ========== Preview ==========
async function showPreview(id) {
  state.screen = 'preview';
  try { state.test = await api.test(id); }
  catch (e) { show('Error', el('p', 'error', e.message)); return; }
  const wrap = el('div', 'stack');
  wrap.append(el('p', 'muted', 'Preview: LaTeX, SVG aur options render check.'));
  Object.entries(state.test.subjects).forEach(([subject, qs]) => {
    wrap.append(el('h2', 'subject-title', subject));
    qs.forEach((q, i) => wrap.append(renderQuestion(q, i + 1, { showSolution: true })));
  });
  show(state.test.name, wrap);
}

// ========== Router ==========
// ========== Templates list ==========
async function showTemplatesList() {
  state.screen = 'templates';
  show('Subject Templates', el('p', 'muted', 'Load ho raha hai...'));
  let templates = [];
  try { templates = await api.templates(); } catch {}
  state.templates = templates;

  const wrap = el('div', 'stack');
  if (!templates.length) {
    wrap.append(el('p', 'muted', 'Abhi koi template nahi. "New template" se banao.'));
  } else {
    templates.forEach((t) => {
      const card = el('div', 'card tap');
      card.append(el('h3', '', t.name));
      const meta = el('div', 'chips');
      meta.append(el('span', 'chip', t.timer_mode === 'subject' ? 'Subject timer' : `Total ${t.total_minutes || '?'} min`));
      (t.subjects || []).forEach(s => meta.append(el('span', 'chip', `${s.name}: ${s.questions}Q`)));
      card.append(meta);
      card.addEventListener('click', () => { location.hash = `#/templates/${t.id}`; });
      wrap.append(card);
    });
  }
  const newBtn = el('button', 'btn wide', '+ New template');
  newBtn.type = 'button';
  newBtn.addEventListener('click', () => { location.hash = '#/templates/new'; });
  wrap.append(newBtn);
  show('Subject Templates', wrap);
  backBtn.hidden = false;
}

// ========== Available tests (accordion) ==========
async function showAvailableTests() {
  state.screen = 'available';
  show('Available Tests', el('p', 'muted', 'Load ho raha hai...'));
  let tests = [];
  try { tests = await api.tests(); } catch {}

  const wrap = el('div', 'available-screen');

  // Search bar (fixed header area)
  const searchBar = el('div', 'search-bar');
  searchBar.append(el('span', '', '🔍'));
  const searchInput = document.createElement('input');
  searchInput.placeholder = 'Search tests...';
  searchInput.type = 'text';
  searchBar.append(searchInput);
  wrap.append(searchBar);

  // Scrollable list
  const listWrap = el('div', 'available-list');
  wrap.append(listWrap);

  function renderList(filter) {
    listWrap.replaceChildren();
    const q = (filter || '').toLowerCase().trim();
    const visible = tests.filter(t => !t.error && (!q || (t.name || '').toLowerCase().includes(q)));
    if (!visible.length) {
      listWrap.append(el('p', 'muted', tests.length ? 'Koi test is search se match nahi hua.' : 'Koi test nahi mila. Import karo.'));
      return;
    }
    visible.forEach(t => listWrap.append(testAccordion(t)));
  }
  searchInput.addEventListener('input', () => renderList(searchInput.value));

  function testAccordion(t) {
    const card = el('div', 'test-card');
    const head = el('div', 'test-card-head');
    head.append(el('span', 'tc-icon', '📄'));
    const main = el('div', 'tc-main');
    main.append(el('h3', '', t.name));
    const total = Object.values(t.subjects || {}).reduce((a, n) => a + n, 0);
    const dateStr = t.created_at
      ? new Date(t.created_at * 1000).toISOString().slice(0, 10)
      : '—';
    const meta = el('div', 'tc-meta');
    meta.append(el('span', '', '📅 ' + dateStr));
    meta.append(el('span', '', 'Total Q: ' + total));
    main.append(meta);
    head.append(main);
    const toggle = el('span', 'tc-toggle', '▾');
    head.append(toggle);
    head.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      card.classList.toggle('open');
    });
    card.append(head);

    const body = el('div', 'test-card-body');
    const subs = el('div', 'tc-subjects');
    Object.entries(t.subjects || {}).forEach(([sname, n]) => {
      const row = el('div', 'tc-subj-row');
      row.append(el('span', 'tc-subj-dot', '●'));
      row.append(el('span', '', `${sname} : ${n} Questions`));
      subs.append(row);
    });
    body.append(subs);

    const actions = el('div', 'tc-actions');
    const viewBtn = el('button', 'btn ghost', '👁 View');
    viewBtn.type = 'button';
    viewBtn.addEventListener('click', () => { location.hash = `#/preview/${t.id}`; });
    const delBtn = el('button', 'btn ghost danger', '🗑 Delete');
    delBtn.type = 'button';
    delBtn.addEventListener('click', async () => {
      if (!confirm(`"${t.name}" ko delete karna hai?`)) return;
      try {
        const r = await fetch('/api/tests/' + encodeURIComponent(t.id), { method: 'DELETE' });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error || ('HTTP ' + r.status));
        }
        showAvailableTests();
      } catch (e) { alert('Delete fail: ' + e.message); }
    });
    actions.append(viewBtn, delBtn);
    body.append(actions);
    card.append(body);
    return card;
  }

  renderList('');

  // Import CTA as footer of flex column (below scrollable list)
  const importBtn = el('button', 'import-cta', '⬆ Import Test from JSON');
  importBtn.type = 'button';
  importBtn.addEventListener('click', () => { location.hash = '#/setup'; });
  wrap.append(importBtn);

  show('Available Tests', wrap);
  backBtn.hidden = false;
}

// ========== Completed tests ==========
async function showCompletedTests() {
  state.screen = 'completed';
  show('Completed Test', el('p', 'muted', 'Load ho raha hai...'));
  let attempts = [];
  try { attempts = await api.attempts(); } catch {}
  const done = attempts.filter(a => a.status === 'submitted');

  const wrap = el('div', 'stack');
  if (!done.length) {
    wrap.append(el('p', 'muted', 'Abhi koi test complete nahi hua.'));
  } else {
    done.forEach(a => {
      const card = el('div', 'completed-card');
      card.append(el('span', 'cc-icon', '✅'));
      const main = el('div', 'cc-main');
      main.append(el('h3', '', a.test_name || 'Test'));
      const meta = el('div', 'cc-meta');
      meta.append(el('span', '', a.template_name || '—'));
      if (a.submitted_at) {
        meta.append(el('span', '', new Date(a.submitted_at * 1000).toLocaleString()));
      }
      main.append(meta);
      card.append(main);
      if (typeof a.score === 'number') {
        card.append(el('span', 'cc-score', `${a.score} / ${a.max}`));
      }
      const delBtn = el('button', 'btn ghost danger small', '🗑');
      delBtn.type = 'button';
      delBtn.title = 'Delete';
      delBtn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        if (!confirm('Is completed test ko delete karna hai?')) return;
        try { await api.deleteAttempt(a.id); showCompletedTests(); }
        catch (e) { alert('Delete fail: ' + e.message); }
      });
      card.append(delBtn);
      card.addEventListener('click', () => { location.hash = `#/attempt/${a.id}`; });
      wrap.append(card);
    });
  }
  show('Completed Test', wrap);
  backBtn.hidden = false;
}

// ========== Settings ==========
async function showSettings() {
  state.screen = 'settings';
  show('Setting', el('p', 'muted', 'Load ho raha hai...'));
  try { state.settings = await api.settings(); } catch { state.settings = { theme: 'system' }; }

  const wrap = el('div', 'stack');
  wrap.append(el('h2', 'section-title', 'Theme'));
  const themes = [
    ['system', 'System (auto)'],
    ['light', 'Light'],
    ['dark', 'Dark'],
  ];
  themes.forEach(([val, label]) => {
    const card = el('div', 'card tap');
    card.append(el('h3', '', label));
    if (state.settings.theme === val) card.append(el('span', 'chip', '✓ Active'));
    card.addEventListener('click', async () => {
      state.settings.theme = val;
      applyTheme(val);
      try { await api.saveSettings(val); } catch (e) { alert('Save fail: ' + e.message); }
      showSettings();
    });
    wrap.append(card);
  });

  show('Setting', wrap);
  backBtn.hidden = false;
}

async function route() {
  // leaving test screen → flush
  if (state.screen === 'test' && !location.hash.startsWith('#/attempt/')) {
    stopTicker(); stopSync();
  }
  // remove floating CTA if we're not on available tests anymore
  if (state._availCta) {
    const h = (location.hash || '#/home');
    if (!h.startsWith('#/available')) {
      state._availCta.remove();
      state._availCta = null;
    }
  }
  const hash = location.hash || '#/home';
  const parts = hash.replace(/^#\//, '').split('/');
  if (parts[0] === 'templates' && parts[1]) return showBuilder(parts[1]);
  if (parts[0] === 'templates') return showTemplatesList();
  if (parts[0] === 'preview' && parts[1]) return showPreview(parts[1]);
  if (parts[0] === 'setup') return showSetup();
  if (parts[0] === 'available') return showAvailableTests();
  if (parts[0] === 'completed') return showCompletedTests();
  if (parts[0] === 'settings') return showSettings();
  if (parts[0] === 'attempt' && parts[1]) return showAttempt(parts[1]);
  return showHome();
}

backBtn.addEventListener('click', () => { location.hash = '#/home'; });
if (themeBtn) themeBtn.addEventListener('click', cycleTheme);
window.addEventListener('hashchange', route);

(async () => {
  await loadSettings();
  route();
})();