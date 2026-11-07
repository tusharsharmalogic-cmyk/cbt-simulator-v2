// Entry + hash router.
// Routes: #/home, #/templates/new, #/templates/<id>, #/preview/<id>, #/setup, #/test, #/attempt/<id>

const app = document.getElementById('app');
const backBtn = document.getElementById('back');
const titleEl = document.getElementById('title');
const themeBtn = document.getElementById('theme-toggle');

function show(title, ...nodes) {
  document.body.classList.remove('in-test');
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

  // Resume buttons: chalte test(s) seedhe wahin se khulte hain.
  // GET attempt server pe time-up check bhi karta hai; submitted nikle to skip.
  for (const ia of inprog.slice(0, 3)) {
    let v = null;
    try { v = await api.attempt(ia.id); } catch { continue; }
    if (!v || v.status !== 'in_progress') continue;
    const row = el('div', 'resume-row');

    const b = el('button', 'menu-btn resume');
    b.type = 'button';
    b.append(el('span', 'menu-icon', '▶'));
    const lab = el('span', 'menu-label');
    lab.append(el('div', '', 'Resume Test'));
    const rem = v.timing && typeof v.timing.remaining_seconds === 'number'
      ? '  •  ⏱ ' + testScreen.formatTime(v.timing.remaining_seconds) + ' bacha' : '';
    lab.append(el('div', 'resume-sub', (v.test_name || 'Test') + rem));
    b.append(lab);
    b.addEventListener('click', () => { location.hash = `#/attempt/${ia.id}`; });
    row.append(b);

    const del = el('button', 'menu-btn discard-btn');
    del.type = 'button';
    del.title = 'Discard this test';
    del.setAttribute('aria-label', 'Discard test');
    del.textContent = '🗑';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Is resume test ko discard karna hai? Answers permanently delete ho jayenge.')) return;
      del.disabled = true;
      try {
        await api.deleteAttempt(ia.id);
        row.remove();
      } catch (err) {
        alert('Discard fail: ' + (err && err.message ? err.message : 'unknown'));
        del.disabled = false;
      }
    });
    row.append(del);

    wrap.append(row);
  }

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
      timer_mode: 'total',
      total_minutes: ed.total_minutes,
      subjects: ed.subjects.map(s => ({
        name: s.name, questions: s.questions, marks: s.marks, negative: s.negative,
        minutes: null,
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
  if (state._pendingFiles && state._pendingFiles.length) {
    s.files = state._pendingFiles;
    s.showImport = true;
    state._pendingFiles = null;
  }

  const opts = {
    onTemplateChange: (id) => {
      s.templateId = id;
      rerender();
    },
    onTestToggle: (id) => {
      const i = s.testIds.indexOf(id);
      if (i >= 0) s.testIds.splice(i, 1); else s.testIds.push(id);
      const picked = s.tests.filter(x => s.testIds.includes(x.id));
      s.testName = picked.map(x => x.name).join(' + ');
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
      s.testIds = [res.test_id];
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
    if (!s.templateId || !s.testIds.length) { alert('Template aur kam se kam ek Test chuno'); return; }
    try {
      const a = await api.createAttempt(s.templateId, s.testIds);
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
  if (prev) spent = Math.max(0, (performance.now() - prev.at) / 1000);
  testCtl.lastVisit = { subject: nextSubject, index: nextIndex, at: performance.now() };
  // spent pichhle question ka hai — server use `from` wale slot me daalta hai.
  return withRetry(() => api.visit(testCtl.attemptId, nextSubject, nextIndex, spent, prev), 'visit')
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

// Submitted attempt ke snapshot se naya attempt (mode: 'full' | 'wrong').
function startRetry(attemptId, mode) {
  return api.retry(attemptId, mode).then(n => {
    location.hash = `#/attempt/${n.id}`;
    return n;
  });
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
    state.screen = 'result';
    show('Result', resultScreen.render(state.attempt, {
      onRetry: (mode) => startRetry(state.attempt.id, mode),
    }));
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
        // Lock lagne se pehle ka time flush karo; server 409 + next target deta hai
        // (ya sab locked hone par auto-submit).
        sendVisit(subj, idx)
          .then(r => {
            if (r.ok && r.view) { state.attempt = r.view; setTimingFromServer(r.view.timing); renderTest(); }
          })
          .finally(() => { testCtl.submitting = false; });
      }
    }
    if (t <= 0 && !testCtl.submitting) {
      testCtl.submitting = true;
      // Deadline tak current question par jo time gaya wo flush karo, phir finalize.
      const cur = state.attempt && state.attempt.current;
      const flush = cur ? sendVisit(cur.subject, cur.index) : Promise.resolve({ ok: false });
      flush.finally(() => {
        refreshAttempt().finally(() => {
          if (state.attempt && state.attempt.status === 'submitted') showAttempt(testCtl.attemptId);
        });
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
      state.screen = 'result';
      show('Result', resultScreen.render(a, {
        onRetry: (mode) => startRetry(a.id, mode),
      }));
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
  document.body.classList.add('in-test');   // top header hide (CSS)
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
      // Current question par bacha hua time submit se pehle bhej do.
      const prev = testCtl.lastVisit;
      const spent = prev ? Math.max(0, (performance.now() - prev.at) / 1000) : 0;
      const r = await api.submit(a.id, prev && prev.subject, prev && prev.index, spent);
      state.attempt = r;
      sheet.remove();
      stopTicker(); stopSync();
      showAttempt(a.id);
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
// Reusable multi-select widget. label = "Subjects"/"Chapters"/"Topics".
function makeMultiSelect(label, onChange) {
  const wrap = el('div', 'multi-select');
  const btn = el('button', 'input filter-select multi-btn', 'All ' + label);
  btn.type = 'button';
  const list = el('div', 'multi-list');
  list.hidden = true;
  const selected = new Set();

  btn.addEventListener('click', (e) => { e.stopPropagation(); list.hidden = !list.hidden; });
  document.addEventListener('click', () => { list.hidden = true; });
  wrap.addEventListener('click', (e) => e.stopPropagation());
  wrap.append(btn, list);

  function updateBtnText() {
    if (selected.size === 0) btn.textContent = 'All ' + label;
    else if (selected.size === 1) btn.textContent = Array.from(selected)[0];
    else btn.textContent = selected.size + ' ' + label + ' selected';
  }

  function setItems(items) {
    const valid = new Set(items);
    Array.from(selected).forEach(v => { if (!valid.has(v)) selected.delete(v); });
    list.replaceChildren();
    if (items.length === 0) {
      list.append(el('div', 'muted small', 'Koi ' + label.toLowerCase() + ' nahi'));
    } else {
      items.forEach(v => {
        const lab = el('label', 'multi-item');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = v;
        cb.checked = selected.has(v);
        cb.addEventListener('change', () => {
          if (cb.checked) selected.add(v); else selected.delete(v);
          updateBtnText();
          onChange();
        });
        lab.append(cb, document.createTextNode(' ' + v));
        list.append(lab);
      });
    }
    updateBtnText();
  }

  return {
    wrap, btn, list,
    getSelected: () => Array.from(selected),
    clear: () => { selected.clear(); list.querySelectorAll('input:checked').forEach(cb => cb.checked = false); updateBtnText(); },
    setItems,
  };
}

async function showPreview(id) {
  state.screen = 'preview';
  try { state.test = await api.test(id); }
  catch (e) { show('Error', el('p', 'error', e.message)); return; }
  state.previewId = id;

  const wrap = el('div', 'stack');

  // Filter Bar
  const filterWrap = el('div', 'preview-filters');
  
  const subjects = Object.keys(state.test.subjects);
  const DIFFICULTIES = ['Easy', 'Medium', 'Hard', 'Unknown'];

  function diffOf(q) {
    const d = typeof q.difficulty === 'string' ? q.difficulty.trim().toLowerCase() : '';
    if (d === 'easy') return 'Easy';
    if (d === 'medium') return 'Medium';
    if (d === 'hard') return 'Hard';
    return 'Unknown';
  }

  function collectChapters() {
    const subjSel = subjFilter.getSelected();
    const diffSel = diffFilter.getSelected();
    const set = new Set();
    const scan = (qs) => qs.forEach(q => {
      if (diffSel.length > 0 && !diffSel.includes(diffOf(q))) return;
      const c = typeof q.chapter === 'string' ? q.chapter.trim() : '';
      if (c) set.add(c);
    });
    if (subjSel.length === 0) subjects.forEach(s => scan(state.test.subjects[s] || []));
    else subjSel.forEach(s => scan(state.test.subjects[s] || []));
    return Array.from(set).sort();
  }

  function collectTopics() {
    const subjSel = subjFilter.getSelected();
    const chapSel = chapFilter.getSelected();
    const diffSel = diffFilter.getSelected();
    const set = new Set();
    const scan = (qs) => qs.forEach(q => {
      if (diffSel.length > 0 && !diffSel.includes(diffOf(q))) return;
      const c = typeof q.chapter === 'string' ? q.chapter.trim() : '';
      const t = typeof q.topic === 'string' ? q.topic.trim() : '';
      if (chapSel.length > 0 && !chapSel.includes(c)) return;
      if (t) set.add(t);
    });
    if (subjSel.length === 0) subjects.forEach(s => scan(state.test.subjects[s] || []));
    else subjSel.forEach(s => scan(state.test.subjects[s] || []));
    return Array.from(set).sort();
  }

  const subjFilter = makeMultiSelect('Subjects', () => {
    chapFilter.setItems(collectChapters());
    topicFilter.setItems(collectTopics());
    renderFilteredList();
  });
  const chapFilter = makeMultiSelect('Chapters', () => {
    topicFilter.setItems(collectTopics());
    renderFilteredList();
  });
  const topicFilter = makeMultiSelect('Topics', () => renderFilteredList());
  const diffFilter = makeMultiSelect('Difficulty', () => {
    chapFilter.setItems(collectChapters());
    topicFilter.setItems(collectTopics());
    renderFilteredList();
  });
  
  filterWrap.append(subjFilter.wrap, chapFilter.wrap, topicFilter.wrap, diffFilter.wrap);
  wrap.append(filterWrap);
  // Top action row: filtered count + Split button
  const actionRow = el('div', 'preview-actions');
  const countLbl = el('div', 'muted small', '');
  const splitBtn = el('button', 'btn ghost small', 'Split');
  splitBtn.type = 'button';
  splitBtn.disabled = true;
  splitBtn.addEventListener('click', openSplitDialog);
  actionRow.append(countLbl, splitBtn);
  wrap.append(actionRow);

  const listWrap = el('div', 'stack');
  wrap.append(listWrap);

  async function removeQuestion(subject, index) {
    const label = '"' + subject + '" Q' + (index + 1);
    if (!confirm(label + ' ko is test se hata dena hai? (JSON se permanently delete hoga)')) return;
    try {
      await api.removeQuestion(state.previewId, subject, index);
      await showPreview(state.previewId);
    } catch (e) { alert('Hata nahi paye: ' + e.message); }
  }

  let currentFiltered = [];

  function renderFilteredList() {
    listWrap.replaceChildren();
    const sSel = subjFilter.getSelected();
    const cSel = chapFilter.getSelected();
    const tSel = topicFilter.getSelected();
    const dSel = diffFilter.getSelected();
    let hasAny = false;
    currentFiltered = [];

    Object.entries(state.test.subjects).forEach(([subject, qs]) => {
      if (sSel.length > 0 && !sSel.includes(subject)) return;
      const filtered = qs.map((q, i) => ({ q, i })).filter(({ q }) => {
        const ch = typeof q.chapter === 'string' ? q.chapter.trim() : '';
        const tp = typeof q.topic === 'string' ? q.topic.trim() : '';
        if (cSel.length > 0 && !cSel.includes(ch)) return false;
        if (tSel.length > 0 && !tSel.includes(tp)) return false;
        if (dSel.length > 0 && !dSel.includes(diffOf(q))) return false;
        return true;
      });
      if (filtered.length === 0) return;
      hasAny = true;
      listWrap.append(el('h2', 'subject-title', subject + ' (' + filtered.length + ' Qs)'));
      filtered.forEach(({ q, i }) => {
        const ch = typeof q.chapter === 'string' ? q.chapter.trim() : '';
        const tp = typeof q.topic === 'string' ? q.topic.trim() : '';
        currentFiltered.push({ subject, index: i, chapter: ch, topic: tp });
        listWrap.append(renderQuestion(q, i + 1, {
          showSolution: true,
          meta: { subject, index: i, onRemove: removeQuestion },
        }));
      });
    });

    if (!hasAny) listWrap.append(el('p', 'muted', 'Is filter me koi question nahi mila.'));
    countLbl.textContent = currentFiltered.length + ' questions visible';
    splitBtn.disabled = currentFiltered.length === 0;
    if (window.typeset && listWrap.isConnected) typeset(listWrap);
  }

  function previewGroups() {
    const map = new Map();
    currentFiltered.forEach(it => {
      const ch = it.chapter || 'Unknown';
      const tp = it.topic || 'Unknown';
      const key = it.subject + '||' + ch + '||' + tp;
      if (!map.has(key)) map.set(key, { subject: it.subject, chapter: ch, topic: tp, count: 0 });
      map.get(key).count += 1;
    });
    return Array.from(map.values());
  }

  // Split dialog: default = har topic ka alag test. Kai topics tap karke
  // select karo -> "Combine" se unka ek hi test ban jata hai.
  function openSplitDialog() {
    if (currentFiltered.length === 0) return;
    const keyOf = (s, c, t) => s + '||' + c + '||' + t;
    const topicGroups = previewGroups().map(g => ({ ...g, key: keyOf(g.subject, g.chapter, g.topic) }));
    const custom = []; // { name, keys: Set, count }
    const picked = new Set();

    const sheet = el('div', 'sheet');
    sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.remove(); });
    const panel = el('div', 'sheet-panel');
    panel.append(el('div', 'sheet-handle'));
    panel.append(el('h3', '', 'Split ' + currentFiltered.length + ' questions'));
    panel.append(el('div', 'muted small', 'Default: har topic ka alag test. 2-4 topics ek test me chahiye to unhe tap karke select karo aur "Combine" dabao. Original test delete NAHI hoga.'));
    const heading = el('div', 'tc-section-title', '');
    panel.append(heading);
    const listBox = el('div', 'split-preview');
    panel.append(listBox);

    const nameInput = document.createElement('input');
    nameInput.className = 'input';
    nameInput.type = 'text';
    nameInput.placeholder = 'Combined test ka naam (optional)';
    const combineBtn = el('button', 'btn ghost', 'Combine');
    combineBtn.type = 'button';
    const combineRow = el('div', 'actions-row');
    combineRow.append(combineBtn);
    panel.append(nameInput, combineRow);

    const row2 = el('div', 'actions-row');
    const cancel = el('button', 'btn ghost', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => sheet.remove());
    const okBtn = el('button', 'btn', '');
    okBtn.type = 'button';
    row2.append(cancel, okBtn);
    panel.append(row2);

    const usedKeys = () => {
      const s = new Set();
      custom.forEach(c => c.keys.forEach(k => s.add(k)));
      return s;
    };

    function render() {
      listBox.replaceChildren();
      const used = usedKeys();
      custom.forEach((c, ci) => {
        const row = el('div', 'split-row');
        row.style.borderLeft = '3px solid var(--accent, #4a7dff)';
        const nm = el('div', 'split-name', '🔗 ' + c.name + ' (' + c.keys.size + ' topics)');
        row.append(nm, el('div', 'muted small', c.count + ' Q'));
        const x = el('button', 'btn ghost small', '✕');
        x.type = 'button';
        x.addEventListener('click', () => { custom.splice(ci, 1); render(); });
        row.append(x);
        listBox.append(row);
      });
      topicGroups.filter(g => !used.has(g.key)).forEach(g => {
        const row = el('div', 'split-row');
        row.style.cursor = 'pointer';
        const on = picked.has(g.key);
        row.style.background = on ? 'rgba(74,125,255,0.15)' : '';
        row.append(el('div', 'split-name', (on ? '☑ ' : '☐ ') + g.subject + ' - ' + g.chapter + ' - ' + g.topic));
        row.append(el('div', 'muted small', g.count + ' Q'));
        row.addEventListener('click', () => {
          if (picked.has(g.key)) picked.delete(g.key); else picked.add(g.key);
          render();
        });
        listBox.append(row);
      });
      const total = custom.length + topicGroups.filter(g => !used.has(g.key)).length;
      heading.textContent = total + ' naye tests banenge';
      okBtn.textContent = 'Create ' + total + ' tests';
      combineBtn.disabled = picked.size < 2;
      combineBtn.textContent = picked.size >= 2 ? 'Combine ' + picked.size + ' topics' : 'Combine (2+ topics select karo)';
    }

    combineBtn.addEventListener('click', () => {
      if (picked.size < 2) return;
      const sel = topicGroups.filter(g => picked.has(g.key));
      const name = nameInput.value.trim() || sel.map(g => g.topic).join(' + ');
      custom.push({ name, keys: new Set(picked), count: sel.reduce((a, g) => a + g.count, 0) });
      picked.clear();
      nameInput.value = '';
      render();
    });

    okBtn.addEventListener('click', async () => {
      const used = usedKeys();
      const groupsPayload = [];
      custom.forEach(c => {
        groupsPayload.push({
          name: c.name,
          questions: currentFiltered
            .filter(it => c.keys.has(keyOf(it.subject, it.chapter || 'Unknown', it.topic || 'Unknown')))
            .map(it => ({ subject: it.subject, index: it.index })),
        });
      });
      topicGroups.filter(g => !used.has(g.key)).forEach(g => {
        groupsPayload.push({
          name: g.subject + ' - ' + g.chapter + ' - ' + g.topic,
          questions: currentFiltered
            .filter(it => keyOf(it.subject, it.chapter || 'Unknown', it.topic || 'Unknown') === g.key)
            .map(it => ({ subject: it.subject, index: it.index })),
        });
      });
      const label = okBtn.textContent;
      okBtn.disabled = true;
      okBtn.textContent = 'Splitting...';
      try {
        const r = await api.splitTestGroups(state.previewId, groupsPayload);
        sheet.remove();
        alert(r.count + ' naye tests ban gaye. Available Tests screen pe check karo.');
        location.hash = '#/available';
      } catch (e) {
        alert('Split fail: ' + e.message);
        okBtn.disabled = false;
        okBtn.textContent = label;
      }
    });

    sheet.append(panel);
    document.body.append(sheet);
    render();
  }

  subjFilter.setItems(subjects);
  diffFilter.setItems(DIFFICULTIES);
  chapFilter.setItems(collectChapters());
  topicFilter.setItems(collectTopics());
  renderFilteredList();

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
      meta.append(el('span', 'chip', `Total ${t.total_minutes || '?'} min`));
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

  // Multi-select state
  const selectedIds = new Set();

  const topRow = el('div', 'avail-top');
  wrap.append(topRow);

  // Scrollable list
  const listWrap = el('div', 'available-list');
  wrap.append(listWrap);

  function renderList() {
    listWrap.replaceChildren();
    selectedIds.clear(); // Reset selection on fresh render
    updateMergeBtn();
    const visible = tests.filter(t => !t.error);
    if (!visible.length) {
      listWrap.append(el('p', 'muted', 'Koi test nahi hai. Import ya Paste karo.'));
      return;
    }
    visible.forEach(t => listWrap.append(testAccordion(t)));
  }

  // Paper ka overall difficulty level: har level ka count + % bar.
  function difficultyBlock(analysis) {
    const box = el('div', '');
    box.append(el('div', 'tc-section-title', 'Paper level'));
    const pct = analysis.difficulty_percent || {};
    const counts = analysis.difficulty || {};
    [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']].forEach(([key, label]) => {
      const row = el('div', 'diff-row');
      row.append(el('span', 'diff-name', label));
      const bar = el('div', 'diff-bar');
      const fill = el('div', 'diff-fill ' + key);
      fill.style.width = Math.max(0, Math.min(100, Number(pct[key]) || 0)) + '%';
      bar.append(fill);
      row.append(bar);
      row.append(el('span', 'diff-count', `${counts[key] || 0} Q · ${pct[key] || 0}%`));
      box.append(row);
    });
    if (counts.unknown) {
      box.append(el('div', 'muted small', `${counts.unknown} questions me difficulty tag nahi hai (Unknown)`));
    }
    return box;
  }

  // Ek subject: kitne questions + chapters (click par uske topics).
  function subjectBlock(s) {
    const box = el('div', 'tc-subj-block');
    const head = el('div', 'tc-subj-head');
    head.append(el('span', 'tc-subj-dot', '●'));
    head.append(el('span', 'tc-subj-name', s.name));
    head.append(el('span', 'tc-subj-count', `${s.questions} Q`));
    box.append(head);

    const chWrap = el('div', 'tc-chapters');
    (s.chapters || []).forEach((ch) => {
      const btn = el('button', 'tc-chapter');
      btn.type = 'button';
      btn.append(el('span', 'tc-ch-name', '📖 ' + ch.name));
      btn.append(el('span', 'tc-ch-count', `${ch.questions} Q`));
      btn.append(el('span', 'tc-ch-arrow', '▸'));
      const topics = el('div', 'tc-topics');
      topics.hidden = true;
      (ch.topics || []).forEach(tp => {
        topics.append(el('span', 'chip', `${tp.name} · ${tp.questions}Q`));
      });
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        topics.hidden = !topics.hidden;
        btn.classList.toggle('open', !topics.hidden);
      });
      chWrap.append(btn, topics);
    });
    if (!(s.chapters || []).length) {
      chWrap.append(el('div', 'muted small', 'Chapter metadata nahi hai.'));
    }
    box.append(chWrap);
    return box;
  }

  function testAccordion(t) {
    const card = el('div', 'test-card');
    const head = el('div', 'test-card-head');
    
    // Long-press (press & hold) se select; selection mode me tap se toggle
    const setSelected = (on) => {
      if (on) selectedIds.add(t.id);
      else selectedIds.delete(t.id);
      card.classList.toggle('selected', on);
      updateMergeBtn();
    };
    let pressTimer = null;
    let longPressed = false;
    let startX = 0, startY = 0;
    const cancelPress = () => { clearTimeout(pressTimer); pressTimer = null; };
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      longPressed = false;
      startX = e.clientX; startY = e.clientY;
      cancelPress();
      pressTimer = setTimeout(() => {
        pressTimer = null;
        longPressed = true;
        setSelected(!selectedIds.has(t.id));
        if (navigator.vibrate) { try { navigator.vibrate(30); } catch {} }
      }, 450);
    });
    head.addEventListener('pointermove', (e) => {
      if (pressTimer && (Math.abs(e.clientX - startX) > 10 || Math.abs(e.clientY - startY) > 10)) cancelPress();
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => head.addEventListener(ev, cancelPress));
    head.addEventListener('contextmenu', (e) => e.preventDefault());
    head.classList.add('tc-head-press');

    head.append(el('span', 'tc-icon', '📄'));
    const main = el('div', 'tc-main');
    main.append(el('h3', '', t.name));
    const total = Object.values(t.subjects || {}).reduce((a, n) => a + n, 0);
    const dateStr = t.created_at
      ? new Date(t.created_at * 1000).toISOString().slice(0, 10)
      : '—';
    const meta = el('div', 'tc-meta');
    meta.append(el('span', '', '📅 ' + dateStr));
    meta.append(el('span', '', 'Subjects: ' + Object.keys(t.subjects || {}).length));
    meta.append(el('span', '', 'Total Q: ' + total));
    main.append(meta);
    head.append(main);
    const toggle = el('span', 'tc-toggle', '▾');
    head.append(toggle);
    head.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      if (longPressed) { longPressed = false; return; } // long-press ke baad ka click ignore
      if (selectedIds.size > 0) { setSelected(!selectedIds.has(t.id)); return; } // selection mode: tap = toggle
      card.classList.toggle('open');
    });
    card.append(head);

    const body = el('div', 'test-card-body');
    const a = t.analysis;
    if (a) {
      const summary = el('div', 'tc-summary');
      summary.append(el('span', 'chip', `${a.subjects.length} subjects`));
      summary.append(el('span', 'chip', `${a.total} questions`));
      summary.append(el('span', 'chip', `${a.chapter_count} chapters`));
      summary.append(el('span', 'chip', `${a.topic_count} topics`));
      body.append(summary, difficultyBlock(a));
      body.append(el('div', 'tc-section-title', 'Subjects, chapters & topics'));
      a.subjects.forEach(s => body.append(subjectBlock(s)));
    } else {
      const subs = el('div', 'tc-subjects');
      Object.entries(t.subjects || {}).forEach(([sname, n]) => {
        const row = el('div', 'tc-subj-row');
        row.append(el('span', 'tc-subj-dot', '●'));
        row.append(el('span', '', `${sname} : ${n} Questions`));
        subs.append(row);
      });
      body.append(subs);
    }

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

  // Import button; seedha file manager, direct save
  const importBtn = el('button', 'import-mini', '');
  importBtn.type = 'button';
  importBtn.append(el('span', 'import-cta-ico', '⬆'), el('span', 'import-cta-txt', 'Import'));
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = '.json,application/json';
  picker.multiple = true;
  picker.hidden = true;
  picker.addEventListener('change', async () => {
    const files = Array.from(picker.files || []);
    picker.value = '';
    if (!files.length) return;
    importBtn.disabled = true;
    importBtn.querySelector('.import-cta-txt').textContent = '...';
    try {
      await api.importTests(files, null, '');
    } catch (e) {
      let msg = e.message || 'Import fail';
      if (e.skipped) Object.entries(e.skipped).forEach(([f, m]) => { msg += `\n${f}: ${[].concat(m).join(', ')}`; });
      alert('Import fail: ' + msg);
    }
    showAvailableTests();
  });
  importBtn.addEventListener('click', () => picker.click());
  importBtn.append(picker);
  topRow.append(importBtn);

  // Merge button (only visible when 2+ tests selected)
  const mergeBtn = el('button', 'import-mini merge-mini');
  mergeBtn.type = 'button';
  mergeBtn.style.display = 'none';
  mergeBtn.append(el('span', 'import-cta-ico', '🔀'), el('span', 'import-cta-txt', 'Merge'));
  mergeBtn.addEventListener('click', openMergeDialog);
  topRow.append(mergeBtn);

  function updateMergeBtn() {
    if (selectedIds.size >= 2) {
      mergeBtn.style.display = 'flex';
      mergeBtn.querySelector('.import-cta-txt').textContent = `Merge (${selectedIds.size})`;
    } else {
      mergeBtn.style.display = 'none';
    }
  }

  function openMergeDialog() {
    if (selectedIds.size < 2) return;
    
    const sheet = el('div', 'sheet');
    sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.remove(); });
    const panel = el('div', 'sheet-panel');
    panel.append(el('div', 'sheet-handle'));
    panel.append(el('h3', '', `Merge ${selectedIds.size} tests`));
    panel.append(el('div', 'muted small', 'Sabhi selected tests merge hokar ek naya test ban jayenge. Purane tests delete ho jayenge.'));

    const nameInput = document.createElement('input');
    nameInput.className = 'input';
    nameInput.type = 'text';
    nameInput.placeholder = 'Naye test ka naam';
    nameInput.value = 'Merged Test';
    panel.append(nameInput);

    const row = el('div', 'actions-row');
    const cancel = el('button', 'btn ghost', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => sheet.remove());
    
    const okBtn = el('button', 'btn', 'OK');
    okBtn.type = 'button';
    okBtn.addEventListener('click', async () => {
      const nm = nameInput.value.trim();
      if (!nm) { alert('Naam chahiye'); return; }
      okBtn.disabled = true;
      okBtn.textContent = 'Merging...';
      try {
        await api.mergeTests(Array.from(selectedIds), nm);
        sheet.remove();
        showAvailableTests();
      } catch (e) {
        alert('Merge fail: ' + e.message);
        okBtn.disabled = false;
        okBtn.textContent = 'OK';
      }
    });
    row.append(cancel, okBtn);
    panel.append(row);
    sheet.append(panel);
    document.body.append(sheet);
    nameInput.focus();
    nameInput.select();
  }

  // Paste JSON: clipboard se test JSON seedha Available Test me save.
  const pasteBtn = el('button', 'import-mini paste-mini');
  pasteBtn.type = 'button';
  pasteBtn.title = 'Paste JSON';
  pasteBtn.append(el('span', 'import-cta-ico', '📋'), el('span', 'import-cta-txt', 'Paste'));
  pasteBtn.addEventListener('click', openPasteSheet);
  topRow.append(pasteBtn);
  state._availCta = null;

  function openPasteSheet() {
    const sheet = el('div', 'sheet');
    sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.remove(); });
    const panel = el('div', 'sheet-panel');
    panel.append(el('div', 'sheet-handle'));
    panel.append(el('h3', '', 'Paste test JSON'));
    panel.append(el('div', 'muted small', 'AI ka banaya test JSON yahan paste karo — seedha Available Test me save ho jayega.'));

    const ta = document.createElement('textarea');
    ta.className = 'input prompt-area paste-area';
    ta.spellcheck = false;
    ta.placeholder = '{\n  "name": "Test name",\n  "subjects": { "Physics": [ { "q": "...", "options": ["A","B"], "answer": "A", "chapter": "...", "topic": "...", "difficulty": "easy" } ] }\n}';
    panel.append(ta);

    const nameInput = document.createElement('input');
    nameInput.className = 'input';
    nameInput.type = 'text';
    nameInput.placeholder = 'Test name (optional — JSON ke "name" se lega)';
    panel.append(nameInput);

    const msg = el('div', 'muted small', '');
    msg.style.whiteSpace = 'pre-line';
    panel.append(msg);

    const row = el('div', 'actions-row');
    const cancel = el('button', 'btn ghost', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => sheet.remove());
    const save = el('button', 'btn', 'Save test');
    save.type = 'button';
    save.addEventListener('click', async () => {
      const text = ta.value.trim();
      if (!text) { msg.textContent = 'Pehle JSON paste karo.'; ta.focus(); return; }
      save.disabled = true;
      msg.textContent = 'Save ho raha hai...';
      try {
        await api.pasteTest(text, nameInput.value.trim());
        sheet.remove();
        showAvailableTests();
      } catch (e) {
        let detail = '';
        if (e.skipped) {
          const lines = [];
          Object.values(e.skipped).forEach((m) => lines.push(...[].concat(m)));
          detail = lines.slice(0, 5).join('\n');
        }
        msg.textContent = 'Save fail: ' + (e.message || 'unknown') + (detail ? '\n' + detail : '');
        save.disabled = false;
      }
    });
    row.append(cancel, save);
    panel.append(row);
    sheet.append(panel);
    document.body.append(sheet);
    ta.focus();
  }

  renderList();
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

  wrap.append(el('h2', 'section-title', 'AI Prompt'));
  [
    ['photos', '🤖 AI Prompt 1 — Photos se', 'Book ki photos attach karke test JSON banwane ka prompt.'],
    ['generate', '✨ AI Prompt 2 — Bina photo ke', 'Photo ke bina AI se naye questions banwane ka prompt (same JSON format).'],
  ].forEach(([key, title, sub]) => {
    const pCard = el('div', 'card tap');
    pCard.append(el('h3', '', title));
    pCard.append(el('div', 'muted small', sub));
    pCard.addEventListener('click', () => { location.hash = '#/prompt/' + key; });
    wrap.append(pCard);
  });

  show('Setting', wrap);
  backBtn.hidden = false;
}

// ========== AI Prompt (view / edit / copy) ==========
async function showPrompt(key) {
  key = key === 'generate' ? 'generate' : 'photos';
  const ptitle = key === 'generate' ? 'AI Prompt 2 (bina photo)' : 'AI Prompt 1 (photos se)';
  state.screen = 'prompt';
  show(ptitle, el('p', 'muted', 'Load ho raha hai...'));
  let data;
  try { data = await api.prompt(key); }
  catch (e) { show(ptitle, el('p', 'error', e.message)); backBtn.hidden = false; return; }

  const wrap = el('div', 'stack prompt-screen');
  const baseLabel = () => (curEdited ? 'Tumhara edited version (server pe saved)' : 'Default prompt');
  let curEdited = data.edited;
  let savedText = data.text;
  const status = el('div', 'muted small', baseLabel());
  wrap.append(status);
  wrap.append(el('div', 'muted small', '✏ Neeche text me seedha edit karo, phir 💾 Save dabao. Save server pe hota hai (data/ folder), isliye reload ya server restart ke baad bhi rahega.'));

  const ta = document.createElement('textarea');
  ta.className = 'input prompt-area';
  ta.spellcheck = false;
  ta.value = data.text;   // textarea.value = plain text, innerHTML nahi
  wrap.append(ta);
  const refreshStatus = () => {
    status.textContent = ta.value !== savedText ? '● Unsaved changes — Save dabao' : baseLabel();
  };
  ta.addEventListener('input', refreshStatus);

  const msg = el('div', 'muted small', '');
  const flash = (t) => { msg.textContent = t; };

  const row = el('div', 'actions-row');
  const copyBtn = el('button', 'btn', '📋 Copy');
  copyBtn.type = 'button';
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(ta.value);
      flash('✓ Copy ho gaya');
    } catch {
      ta.focus(); ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch {}
      flash(ok ? '✓ Copy ho gaya' : 'Auto-copy nahi hua — text select hai, long-press karke copy karo');
    }
  });
  const saveBtn = el('button', 'btn ghost', '💾 Save');
  saveBtn.type = 'button';
  saveBtn.addEventListener('click', async () => {
    try {
      const r = await api.savePrompt(key, ta.value);
      curEdited = r.edited; savedText = r.text;
      refreshStatus();
      flash('✓ Server pe save ho gaya');
    } catch (e) { flash('Save fail: ' + e.message); }
  });
  row.append(copyBtn, saveBtn);
  wrap.append(row);

  const resetBtn = el('button', 'btn ghost wide', '↺ Default pe wapas');
  resetBtn.type = 'button';
  resetBtn.addEventListener('click', async () => {
    if (!confirm('Tumhara edited prompt hat jayega aur default wapas aayega. Pakka?')) return;
    try {
      const r = await api.resetPrompt(key);
      ta.value = r.text;
      curEdited = r.edited; savedText = r.text;
      refreshStatus();
      flash('✓ Default wapas aa gaya');
    } catch (e) { flash('Reset fail: ' + e.message); }
  });
  wrap.append(resetBtn);
  wrap.append(msg);

  show(ptitle, wrap);
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
  if (parts[0] === 'prompt') return showPrompt(parts[1]);
  if (parts[0] === 'attempt' && parts[1]) return showAttempt(parts[1]);
  return showHome();
}

backBtn.addEventListener('click', () => { location.hash = state.screen === 'prompt' ? '#/settings' : '#/home'; });
if (themeBtn) themeBtn.addEventListener('click', cycleTheme);
window.addEventListener('hashchange', route);

(async () => {
  await loadSettings();
  route();
})();