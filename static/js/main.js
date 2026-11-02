// Entry + hash router.
// Routes: #/home, #/templates/new, #/templates/<id>, #/preview/<test_id>, #/setup

const app = document.getElementById('app');
const backBtn = document.getElementById('back');
const titleEl = document.getElementById('title');
const themeBtn = document.getElementById('theme-toggle');

function show(title, ...nodes) {
  titleEl.textContent = title;
  app.replaceChildren(...nodes);
  backBtn.hidden = !(state.screen !== 'home');
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
  try {
    state.settings = await api.settings();
  } catch (e) {
    state.settings = { theme: 'system' };
  }
  applyTheme(state.settings.theme);
}

function cycleTheme() {
  const order = ['system', 'light', 'dark'];
  const next = order[(order.indexOf(state.settings.theme) + 1) % order.length];
  state.settings.theme = next;
  applyTheme(next);
  api.saveSettings(next).catch((e) => console.warn('theme save:', e.message));
}

// ---------- Home ----------
async function showHome() {
  state.screen = 'home';
  show('CBT Simulator', el('p', 'muted', 'Load ho raha hai...'));
  let templates = [], tests = [];
  try { templates = await api.templates(); } catch (e) { templates = []; }
  try { tests = await api.tests(); } catch (e) { tests = []; }
  state.templates = templates;

  const wrap = el('div', 'stack');

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

  // Test shuru karo — kam se kam 1 template + 1 good test chahiye
  const hasTemplate = templates.some(t => !t.error);
  const hasTest = tests.some(t => !t.error);
  if (hasTemplate && hasTest) {
    const startBtn = el('button', 'btn wide', 'Start test \u2192');
    startBtn.type = 'button';
    startBtn.addEventListener('click', () => { location.hash = '#/setup'; });
    wrap.append(startBtn);
  }

  // Tests (existing preview list — step 3 me setup screen aayegi)
  wrap.append(el('h2', 'section-title', 'Tests'));
  if (!tests.length) {
    wrap.append(el('p', 'muted', 'data/tests/ me koi .json test nahi mila.'));
  } else {
    tests.forEach((t) => {
      const card = el('div', 'card tap');
      card.append(el('h3', '', t.name));
      if (t.error) {
        card.append(el('p', 'error', t.error));
      } else {
        const chips = el('div', 'chips');
        Object.entries(t.subjects).forEach(([s, n]) => chips.append(el('span', 'chip', `${s}: ${n} Q`)));
        card.append(chips);
        card.addEventListener('click', () => { location.hash = `#/preview/${t.id}`; });
      }
      wrap.append(card);
    });
  }

  show('CBT Simulator', wrap);
}

// ---------- Builder ----------
async function showBuilder(id) {
  state.screen = 'builder';
  let ed;
  if (id === 'new') {
    ed = builder.blankEditor();
  } else {
    show('Template', el('p', 'muted', 'Load ho raha hai...'));
    try {
      const t = await api.template(id);
      ed = builder.fromTemplate(t);
    } catch (e) {
      show('Error', el('p', 'error', e.message));
      return;
    }
  }
  state.editor = ed;

  const rerender = () => {
    app.replaceChildren(renderBuilderScreen());
    typeset(app);
  };

  function renderBuilderScreen() {
    return builder.render(ed, {
      onStructure: () => rerender(),
      onSave: save,
      onDelete: del,
    });
  }

  async function save() {
    ed.errors = {};
    const body = {
      name: ed.name,
      timer_mode: ed.timer_mode,
      total_minutes: ed.timer_mode === 'total' ? ed.total_minutes : null,
      subjects: ed.subjects.map(s => ({
        name: s.name,
        questions: s.questions,
        marks: s.marks,
        negative: s.negative,
        minutes: ed.timer_mode === 'subject' ? s.minutes : null,
      })),
    };
    try {
      const saved = await api.saveTemplate(ed.id, body);
      // Naya create hua to URL ko edit-mode pe le jao
      if (ed.id === 'new') {
        ed.id = saved.id;
        location.hash = `#/templates/${saved.id}`;
      }
      // chhota toast
      const note = el('div', 'toast', 'Saved');
      document.body.append(note);
      setTimeout(() => note.remove(), 1500);
    } catch (e) {
      if (e.status === 422 && e.errors) {
        ed.errors._global = e.errors;
        rerender();
        window.scrollTo(0, document.body.scrollHeight);
      } else {
        alert('Save fail: ' + e.message);
      }
    }
  }

  async function del() {
    try {
      await api.deleteTemplate(ed.id);
      location.hash = '#/home';
    } catch (e) {
      alert('Delete fail: ' + e.message);
    }
  }

  show(id === 'new' ? 'New Template' : 'Edit Template', renderBuilderScreen());
  typeset(app);
}

// ---------- Test screen (Step 4: UI only, in-memory attempt) ----------
let paletteOpen = false;
let paletteEl = null;

function showTestScreen() {
  state.screen = 'test';
  if (!state.attempt) {
    location.hash = '#/setup';
    return;
  }
  testScreen.visitCurrent(state.attempt);
  renderTest();
}

function renderTest() {
  const root = testScreen.render(state.attempt, {
    onChange: () => renderTest(),
    onOpenPalette: () => { paletteOpen = true; mountPalette(); },
  });
  document.getElementById('app').replaceChildren(root);
  titleEl.textContent = state.attempt.test_name || 'Test';
  // Test screen pe accidental back nahi — Step 5 me Submit se bahar nikalega.
  backBtn.hidden = true;
  typeset(document.getElementById('app'));
}

function mountPalette() {
  if (paletteEl) paletteEl.remove();
  if (!paletteOpen) return;
  paletteEl = palette.render(state.attempt, {
    onJump: (subj, idx) => {
      testScreen.jumpTo(state.attempt, subj, idx);
      renderTest();
    },
    onClose: () => { paletteOpen = false; unmountPalette(); },
  });
  document.body.append(paletteEl);
}

function unmountPalette() {
  if (paletteEl) { paletteEl.remove(); paletteEl = null; }
}

// ---------- Setup (Step 3) ----------
async function showSetup() {
  state.screen = 'setup';
  show('Test shuru karo', el('p', 'muted', 'Load ho raha hai...'));
  let templates = [], tests = [];
  try { templates = await api.templates(); } catch (e) { templates = []; }
  try { tests = await api.tests(); } catch (e) { tests = []; }
  const s = setup.initialState(templates, tests);
  // Default test = pehla good test
  const firstGood = tests.find(t => !t.error);
  if (firstGood) s.testId = firstGood.id;

  const rerender = () => {
    app.replaceChildren(setup.render(s, {
      onTemplateChange: (id) => { s.templateId = id; s.validation = null; rerender(); },
      onTestChange: (id) => { s.testId = id; s.validation = null; rerender(); },
      onValidate: validate,
      onStart: start,
    }));
    typeset(app);
  };

  async function validate() {
    s.validating = true;
    s.validateError = null;
    s.validation = null;
    rerender();
    try {
      const url = `/api/tests/${encodeURIComponent(s.testId)}/validate?template=${encodeURIComponent(s.templateId)}`;
      s.validation = await api.get(url);
    } catch (e) {
      s.validateError = e.message;
    } finally {
      s.validating = false;
      rerender();
    }
  }

  async function start() {
    // Step 4: in-memory attempt banao aur test screen pe jao.
    // Step 5 me yeh api POST /api/attempts hoga.
    try {
      const t = await api.template(s.templateId);
      const test = await api.test(s.testId);
      test.id = s.testId;
      state.attempt = testScreen.makeAttempt(t, test);
      location.hash = '#/test';
    } catch (e) {
      alert('Start fail: ' + e.message);
    }
  }

  show('Test shuru karo', setup.render(s, {
    onTemplateChange: (id) => { s.templateId = id; s.validation = null; rerender(); },
    onTestChange: (id) => { s.testId = id; s.validation = null; rerender(); },
    onValidate: validate,
    onStart: start,
  }));
  typeset(app);
}

// ---------- Preview (Step 1 kept) ----------
async function showPreview(id) {
  state.screen = 'preview';
  try {
    state.test = await api.test(id);
  } catch (e) {
    show('Error', el('p', 'error', e.message));
    return;
  }
  const wrap = el('div', 'stack');
  wrap.append(el('p', 'muted', 'Preview: LaTeX, SVG aur options render check (step 1).'));
  Object.entries(state.test.subjects).forEach(([subject, qs]) => {
    wrap.append(el('h2', 'subject-title', subject));
    qs.forEach((q, i) => wrap.append(renderQuestion(q, i + 1, { showSolution: true })));
  });
  show(state.test.name, wrap);
}

// ---------- Router ----------
async function route() {
  const hash = location.hash || '#/home';
  const parts = hash.replace(/^#\//, '').split('/');
  if (parts[0] === 'templates' && parts[1]) return showBuilder(parts[1]);
  if (parts[0] === 'preview' && parts[1]) return showPreview(parts[1]);
  if (parts[0] === 'setup') return showSetup();
  if (parts[0] === 'test') return showTestScreen();
  return showHome();
}

backBtn.addEventListener('click', () => { location.hash = '#/home'; });
if (themeBtn) themeBtn.addEventListener('click', cycleTheme);
window.addEventListener('hashchange', route);

(async () => {
  await loadSettings();
  route();
})();