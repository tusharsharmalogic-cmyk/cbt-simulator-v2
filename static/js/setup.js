// Test setup (Start New Test screen).
// - Template chuno
// - Test chuno (data/tests/ se existing JSON)
// - Test Name (optional)
// - Test Details: template ko kitne Q chahiye vs test me kitne hain (progress bars)
// - Start Test
// - Import JSON section bhi yahin hai (multiple files merge)

const setup = (() => {

  function initialState(templates, tests) {
    const firstT = templates.find(t => !t.error);
    const firstTest = tests.find(t => !t.error);
    return {
      templates,
      tests,
      templateId: firstT ? firstT.id : null,
      testId: firstTest ? firstTest.id : null,
      testName: '',
      // import state
      files: [],
      importing: false,
      importError: null,
      imported: null,
      showImport: false,
    };
  }

  function computeDetails(s) {
    const t = s.templates.find(x => x.id === s.templateId);
    const test = s.tests.find(x => x.id === s.testId);
    if (!t || !test) return [];
    const rows = [];
    (t.subjects || []).forEach(sub => {
      const need = Number(sub.questions) || 0;
      const have = Number((test.subjects || {})[sub.name] || 0);
      rows.push({ name: sub.name, need, have, marks: sub.marks, negative: sub.negative });
    });
    return rows;
  }

  function render(s, opts) {
    // opts: {
    //   onTemplateChange(id), onTestChange(id), onNameChange(name),
    //   onFilesPicked(files), onImport(), onStart(),
    //   onToggleImport()
    // }
    const root = el('div', 'stack setup');

    // 1. Template
    const tField = el('label', 'field');
    tField.append(el('span', 'field-label', '📋 Choose Template'));
    const tSel = document.createElement('select');
    tSel.className = 'input';
    const goodTemplates = s.templates.filter(t => !t.error);
    if (!goodTemplates.length) {
      const o = document.createElement('option');
      o.value = ''; o.textContent = '(koi template nahi — pehle banao)';
      tSel.append(o); tSel.disabled = true;
    } else {
      goodTemplates.forEach(t => {
        const o = document.createElement('option');
        o.value = t.id;
        o.textContent = t.name + (t.timer_mode === 'subject' ? ' (subject timer)' : ` (${t.total_minutes} min)`);
        if (s.templateId === t.id) o.selected = true;
        tSel.append(o);
      });
    }
    tSel.addEventListener('change', () => opts.onTemplateChange(tSel.value));
    tField.append(tSel);
    root.append(tField);

    // 2. Test
    const testField = el('label', 'field');
    testField.append(el('span', 'field-label', '📝 Choose Test'));
    const testSel = document.createElement('select');
    testSel.className = 'input';
    const goodTests = s.tests.filter(t => !t.error);
    if (!goodTests.length) {
      const o = document.createElement('option');
      o.value = ''; o.textContent = '(koi test nahi — import karo)';
      testSel.append(o); testSel.disabled = true;
    } else {
      goodTests.forEach(t => {
        const total = Object.values(t.subjects || {}).reduce((a, n) => a + n, 0);
        const o = document.createElement('option');
        o.value = t.id;
        o.textContent = `${t.name} (${total} Q)`;
        if (s.testId === t.id) o.selected = true;
        testSel.append(o);
      });
    }
    testSel.addEventListener('change', () => opts.onTestChange(testSel.value));
    testField.append(testSel);
    root.append(testField);

    // 3. Test Name
    const nameField = el('label', 'field');
    nameField.append(el('span', 'field-label', '✏ Type Test Name'));
    const nameInp = document.createElement('input');
    nameInp.type = 'text';
    nameInp.className = 'input';
    const curTest = goodTests.find(t => t.id === s.testId);
    nameInp.value = s.testName || (curTest ? curTest.name : '');
    nameInp.placeholder = 'e.g. IMU-CET Mock Test 1';
    nameInp.maxLength = 60;
    nameInp.addEventListener('input', () => opts.onNameChange(nameInp.value));
    nameField.append(nameInp);
    root.append(nameField);

    // 4. Test Details (progress bars)
    const details = computeDetails(s);
    if (details.length) {
      const detCard = el('div', 'card');
      detCard.append(el('h3', '', '📊 Test Details'));
      details.forEach(d => {
        const row = el('div', 'td-row');
        const nameEl = el('div', 'td-name', d.name);
        const barWrap = el('div', 'td-bar');
        const pct = d.need > 0 ? Math.min(100, Math.round(100 * d.have / d.need)) : 0;
        const fill = el('div', 'td-fill' + (d.have >= d.need ? ' full' : ''));
        fill.style.width = pct + '%';
        barWrap.append(fill);
        const count = el('div', 'td-count', `${d.have} / ${d.need}`);
        row.append(nameEl, barWrap, count);
        detCard.append(row);
        const mk = el('div', 'td-marks', `Marking: +${d.marks ?? '?'} / -${d.negative ?? '?'}`);
        mk.style.marginLeft = '90px';
        mk.style.marginBottom = '8px';
        detCard.append(mk);
      });
      root.append(detCard);
    }

    // 5. Import JSON section
    const impToggle = el('button', 'btn ghost wide', s.showImport ? '✕ Close import' : '⬆ Import Test from JSON');
    impToggle.type = 'button';
    impToggle.addEventListener('click', () => opts.onToggleImport());
    root.append(impToggle);

    if (s.showImport) {
      const impSection = el('div', 'card');

      const fileField = el('div', 'field');
      fileField.append(el('span', 'field-label', 'Import .json files (multiple allowed)'));
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = '.json,application/json';
      fileInput.multiple = true;
      fileInput.className = 'input file-input';
      fileInput.id = 'import-files';
      fileInput.addEventListener('change', () => {
        const files = Array.from(fileInput.files || []);
        opts.onFilesPicked(files);
      });
      fileField.append(fileInput);
      fileField.append(el('div', 'muted small', 'Sirf .json. Template ke hisaab se subjects merge honge.'));
      impSection.append(fileField);

      if (s.files && s.files.length) {
        impSection.append(el('div', 'field-label', `Selected: ${s.files.length} file(s)`));
        s.files.forEach(f => impSection.append(el('div', 'file-row', `${f.name} (${fmtBytes(f.size)})`)));
      }

      const importBtn = el('button', 'btn wide', s.importing ? 'Import ho raha hai...' : 'Import karo');
      importBtn.type = 'button';
      importBtn.disabled = s.importing || !s.files.length || !s.templateId;
      importBtn.addEventListener('click', () => opts.onImport());
      impSection.append(importBtn);

      if (s.importError) {
        const box = el('div', 'error-box');
        box.append(el('div', 'err-title', 'Import fail'));
        box.append(el('div', 'err-row', s.importError.message || 'Unknown error'));
        if (s.importError.skipped) {
          Object.entries(s.importError.skipped).forEach(([fname, msgs]) => {
            msgs.forEach(m => box.append(el('div', 'err-row muted', `${fname}: ${m}`)));
          });
        }
        impSection.append(box);
      }

      if (s.imported) {
        const box = el('div', 'ok-box');
        box.append(el('div', 'ok-title', '✓ Import ho gaya'));
        box.append(el('div', 'muted', `Test: ${s.imported.test_name}`));
        box.append(el('div', 'muted small', `Total: ${s.imported.total} questions`));
        impSection.append(box);
      }
      root.append(impSection);
    }

    // 6. Start Test button
    const startBtn = el('button', 'btn wide', '▶ Start Test');
    startBtn.type = 'button';
    startBtn.classList.add('start-btn');
    const canStart = !!(s.templateId && s.testId);
    startBtn.disabled = !canStart;
    if (canStart) {
      // green
      startBtn.style.background = 'linear-gradient(135deg, #16a34a, #22c55e)';
      startBtn.style.color = '#fff';
      startBtn.style.fontSize = '17px';
      startBtn.style.padding = '14px';
    }
    startBtn.addEventListener('click', () => opts.onStart());
    root.append(startBtn);

    return root;
  }

  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  return { initialState, render, computeDetails };
})();