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
    return {
      templates,
      tests,
      templateId: firstT ? firstT.id : null,
      testIds: [],
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
    const picked = s.tests.filter(x => (s.testIds || []).includes(x.id));
    if (!t || !picked.length) return [];
    const rows = [];
    (t.subjects || []).forEach(sub => {
      const need = Number(sub.questions) || 0;
      const have = picked.reduce((n, test) => n + Number((test.subjects || {})[sub.name] || 0), 0);
      // Only show subjects that have at least 1 question in the test
      if (have <= 0) return;
      rows.push({
        name: sub.name,
        need,
        have,
        marks: Number(sub.marks) || 0,
        negative: Number(sub.negative) || 0,
      });
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

    // 2. Test (multi-select: checkbox list)
    const testField = el('div', 'field');
    const picked0 = (s.testIds || []).length;
    testField.append(el('span', 'field-label',
      '📝 Choose Test' + (picked0 ? ` (${picked0} selected)` : '')));
    const goodTests = s.tests.filter(t => !t.error);
    if (!goodTests.length) {
      testField.append(el('div', 'muted', '(koi test nahi — import karo)'));
    } else {
      const list = el('div', 'test-pick-list');
      goodTests.forEach(t => {
        const total = Object.values(t.subjects || {}).reduce((a, n) => a + n, 0);
        const row = el('label', 'test-pick-row');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = s.testIds.includes(t.id);
        cb.addEventListener('change', () => opts.onTestToggle(t.id));
        row.append(cb, el('span', 'test-pick-name', `${t.name} (${total} Q)`));
        list.append(row);
      });
      testField.append(list);
    }
    root.append(testField);

    // 3. Test Name
    const nameField = el('label', 'field');
    nameField.append(el('span', 'field-label', '✏ Type Test Name'));
    const nameInp = document.createElement('input');
    nameInp.type = 'text';
    nameInp.className = 'input';
    nameInp.value = s.testName || '';
    nameInp.placeholder = 'e.g. IMU-CET Mock Test 1';
    nameInp.maxLength = 60;
    nameInp.addEventListener('input', () => opts.onNameChange(nameInp.value));
    nameField.append(nameInp);
    root.append(nameField);

    // 4. Test Details (progress bars) — only when test(s) selected (counts summed)
    const details = s.testIds.length ? computeDetails(s) : [];
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
    const canStart = !!(s.templateId && s.testIds.length);
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