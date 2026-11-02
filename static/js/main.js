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
  show('CBT Simulator', el('p', 'muted', 'Load ho raha hai...'));
  let templates = [], tests = [], attempts = [];
  try { templates = await api.templates(); } catch {}
  try { tests = await api.tests(); } catch {}
  try { attempts = await api.attempts(); } catch {}
  state.templates = templates;

  const wrap = el('div', 'stack');

  // Resume in-progress attempts first
  const inprog = attempts.filter(a => a.status === 'in_progress');
  if (inprog.length) {
    wrap.append(el('h2', 'section-title', 'Resume'));
    inprog.forEach(a => {
      const card = el('div', 'card');
      card.append(el('h3', '', a.test_name || 'Test'));
      const chips = el('div', 'chips');
      chips.append(el('span', 'chip', a.template_name || '—'));
      chips.append(el('span', 'chip', 'In progress'));
      card.append(chips);
      const row = el('div', 'actions-row');
      const resume = el('button', 'btn', 'Resume');
      resume.type = 'button';
      resume.addEventListener('click', () => { location.hash = `#/attempt/${a.id}`; });
      const del = el('button', 'btn ghost danger', 'Delete');
      del.type = 'button';
      del.addEventListener('click', async () => {
        if (!confirm('Is attempt ko delete karna hai?')) return;
        try { await api.deleteAttempt(a.id); showHome(); } catch (e) { alert('Delete fail: ' + e.message); }
      });
      row.append(resume, del);
      card.append(row);
      wrap.append(card);
    });
  }

  // Templates
  wrap.append(el('h2', 'section-title', 'Exam Templates'));
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

  // Setup button
  const hasTemplate = templates.some(t => !t.error);
  const hasTest = tests.some(t => !t.error);
  if (hasTemplate && hasTest) {
    const startBtn = el('button', 'btn wide', 'Start test \u2192');
    startBtn.type = 'button';
    startBtn.addEventListener('click', () => { location.hash = '#/setup'; });
    wrap.append(startBtn);
  }

  // Tests list
  wrap.append(el('h2', 'section-title', 'Tests'));
  if (!tests.length) {
    wrap.append(el('p', 'muted', 'data/tests/ me koi .json test nahi mila.'));
  } else {
    tests.forEach((t) => {
      const card = el('div', 'card tap');
      card.append(el('h3', '', t.name));
      if (t.error) card.append(el('p', 'error', t.error));
      else {
        const chips = el('div', 'chips');
        Object.entries(t.subjects).forEach(([s, n]) => chips.append(el('span', 'chip', `${s}: ${n} Q`)));
        card.append(chips);
        card.addEventListener('click', () => { location.hash = `#/preview/${t.id}`; });
      }
      wrap.append(card);
    });
  }

  // Finished attempts (Step 6 will link result; now just show scores)
  const done = attempts.filter(a => a.status === 'submitted');
  if (done.length) {
    wrap.append(el('h2', 'section-title', 'Finished'));
    done.forEach(a => {
      const card = el('div', 'card tap');
      card.append(el('h3', '', a.test_name || 'Test'));
      const chips = el('div', 'chips');
      chips.append(el('span', 'chip', a.template_name || '—'));
      if (typeof a.score === 'number') chips.append(el('span', 'chip', `${a.score} / ${a.max}`));
      card.append(chips);
      card.addEventListener('click', () => { location.hash = `#/attempt/${a.id}`; });
      wrap.append(card);
    });
  }

  show('CBT Simulator', wrap);
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
  show('Test shuru karo', el('p', 'muted', 'Load ho raha hai...'));
  let templates = [];
  try { templates = await api.templates(); } catch {}
  const s = setup.initialState(templates);

  const opts = {
    onTemplateChange: (id) => {
      s.templateId = id;
      // template change pe imported reset
      s.imported = null; s.importError = null;
      rerender();
    },
    onFilesPicked: (files) => {
      s.files = files;
      s.importError = null;
      s.imported = null;
      rerender();
    },
    onNameChange: (name) => { s.testName = name; },
    onImport: doImport,
    onStart: start,
    onRemoveImport: () => { s.imported = null; s.files = []; s.testName = ''; s.importError = null; rerender(); },
  };

  const rerender = () => {
    app.replaceChildren(setup.render(s, opts));
    typeset(app);
  };

  async function doImport() {
    if (!s.files.length) { alert('Koi file select karo'); return; }
    s.importing = true; s.importError = null; s.imported = null;
    rerender();
    try {
      const res = await api.importTests(s.files, s.templateId, s.testName);
      s.imported = res;
    } catch (e) {
      s.importError = { message: e.message, skipped: e.skipped };
    } finally {
      s.importing = false;
      rerender();
    }
  }

  async function start() {
    if (!s.imported || !s.imported.test_id) return;
    try {
      const a = await api.createAttempt(s.templateId, s.imported.test_id);
      location.hash = `#/attempt/${a.id}`;
    } catch (e) {
      alert('Start fail: ' + e.message);
    }
  }

  rerender();
  typeset(app);
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

function sendVisit(nextSubject, nextIndex) {
  // flushes time spent on lastVisit's question before switching
  if (!testCtl.attemptId) return Promise.resolve();
  const prev = testCtl.lastVisit;
  let spent = 0;
  if (prev) spent = (performance.now() - prev.at) / 1000;
  testCtl.lastVisit = { subject: nextSubject, index: nextIndex, at: performance.now() };
  return withRetry(() => api.visit(testCtl.attemptId, nextSubject, nextIndex, spent), 'visit')
    .then(v => { if (v.timing) setTimingFromServer(v.timing); })
    .catch(e => {
      if (e.status === 409) handle409(e);
    });
}

function handle409(e) {
  const code = e.data && e.data.error;
  if (code === 'time_up' || code === 'already_submitted') {
    // Force reload (server finalizes on GET)
    if (testCtl.attemptId) location.hash = `#/attempt/${testCtl.attemptId}`;
  } else if (code === 'subject_locked') {
    // Reload to let server tell us what's current
    if (testCtl.attemptId) refreshAttempt();
  }
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
    // subject timer
    if (testCtl.subjectEndAt) {
      const sr = (testCtl.subjectEndAt - performance.now()) / 1000;
      const subjTimer = document.querySelector('.subj-timer');
      if (subjTimer) subjTimer.textContent = testScreen.formatTime(Math.max(0, sr));
      // subject window just expired -> server ko pull karo (current subject change ho jayega)
      if (sr <= 0 && !testCtl.submitting) {
        testCtl.submitting = true;
        refreshAttempt().finally(() => { testCtl.submitting = false; });
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
      sendVisit(subj, idx).then(() => {
        state.attempt.current = { subject: subj, index: idx };
        refreshAttempt();
      });
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
async function route() {
  // leaving test screen → flush
  if (state.screen === 'test' && !location.hash.startsWith('#/attempt/')) {
    stopTicker(); stopSync();
  }
  const hash = location.hash || '#/home';
  const parts = hash.replace(/^#\//, '').split('/');
  if (parts[0] === 'templates' && parts[1]) return showBuilder(parts[1]);
  if (parts[0] === 'preview' && parts[1]) return showPreview(parts[1]);
  if (parts[0] === 'setup') return showSetup();
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