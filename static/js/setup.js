// Test setup: template chuno -> multiple JSON files import karo -> start.
// Import endpoint merge/group/cap karta hai; summary yahan dikhta hai.
// "Validate" step hata diya (spec change).

const setup = (() => {

  function initialState(templates) {
    const firstT = templates.find(t => !t.error);
    return {
      templates,
      templateId: firstT ? firstT.id : null,
      files: [],             // File[]
      testName: '',          // custom name (optional; default = server computed)
      importing: false,
      importError: null,     // {message, skipped?}
      imported: null,        // {test_id, test_name, used, needed, counts, total, skipped, rejected}
    };
  }

  function render(s, opts) {
    // opts: {onTemplateChange, onFilesPicked(files), onNameChange, onImport, onStart, onRemoveImport}
    const root = el('div', 'stack setup');

    // Template select
    const tField = el('label', 'field');
    tField.append(el('span', 'field-label', 'Exam template'));
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

    // Selected template chips
    const cur = goodTemplates.find(t => t.id === s.templateId);
    if (cur) {
      const chips = el('div', 'chips');
      (cur.subjects || []).forEach(sub => chips.append(
        el('span', 'chip', `${sub.name}: ${sub.questions} Q`)));
      root.append(chips);
    }

    // File picker
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
    fileField.append(el('div', 'muted small', 'Sirf .json. Har file me subject-wise questions ho sakte hain.'));
    root.append(fileField);

    // Selected files list
    if (s.files && s.files.length) {
      const fl = el('div', 'card');
      fl.append(el('div', 'field-label', `Selected: ${s.files.length} file(s)`));
      s.files.forEach(f => fl.append(el('div', 'file-row', `${f.name} (${fmtBytes(f.size)})`)));
      root.append(fl);
    }

    // Name field (optional, only shows after files picked or always? — always after files)
    if (s.files && s.files.length && !s.imported) {
      const nameField = el('label', 'field');
      nameField.append(el('span', 'field-label', 'Test name (optional — default template + time)'));
      const nameInp = document.createElement('input');
      nameInp.type = 'text';
      nameInp.className = 'input';
      nameInp.value = s.testName || '';
      nameInp.placeholder = 'e.g. JEE Mains Mock 1';
      nameInp.maxLength = 60;
      nameInp.addEventListener('input', () => opts.onNameChange(nameInp.value));
      nameField.append(nameInp);
      root.append(nameField);

      const importBtn = el('button', 'btn wide', s.importing ? 'Import ho raha hai...' : 'Import karo');
      importBtn.type = 'button';
      importBtn.disabled = s.importing;
      importBtn.addEventListener('click', () => opts.onImport());
      root.append(importBtn);
    }

    // Import error
    if (s.importError) {
      const box = el('div', 'card error-box');
      box.append(el('div', 'err-title', 'Import fail'));
      box.append(el('div', 'err-row', s.importError.message || 'Unknown error'));
      if (s.importError.skipped) {
        Object.entries(s.importError.skipped).forEach(([fname, msgs]) => {
          msgs.forEach(m => box.append(el('div', 'err-row muted', `${fname}: ${m}`)));
        });
      }
      root.append(box);
    }

    // Import result summary
    if (s.imported) {
      const box = el('div', 'card ok-box');
      box.append(el('div', 'ok-title', 'Import ho gaya'));
      box.append(el('div', 'muted', `Test: ${s.imported.test_name}`));
      const tbl = el('div', 'import-summary');
      Object.entries(s.imported.needed).forEach(([subj, need]) => {
        const got = s.imported.used[subj] || 0;
        const row = el('div', 'import-row');
        const pct = need > 0 ? Math.round(100 * got / need) : 100;
        row.append(el('span', 'import-subj', subj));
        row.append(el('span', 'import-count', `${got} / ${need}`));
        const bar = el('div', 'import-bar');
        const fill = el('div', 'import-bar-fill');
        fill.style.width = Math.min(100, pct) + '%';
        if (got < need) fill.classList.add('short');
        bar.append(fill);
        row.append(bar);
        tbl.append(row);
      });
      box.append(tbl);
      box.append(el('div', 'muted small', `Total: ${s.imported.total} questions`));

      if (s.imported.skipped && Object.keys(s.imported.skipped).length) {
        const sk = el('details', 'skip-details');
        sk.append(el('summary', '', 'Kuch entries skip hui (details)'));
        Object.entries(s.imported.skipped).forEach(([fname, msgs]) => {
          msgs.forEach(m => sk.append(el('div', 'muted small', `${fname}: ${m}`)));
        });
        box.append(sk);
      }
      if (s.imported.rejected && s.imported.rejected.length) {
        box.append(el('div', 'muted small', `Rejected: ${s.imported.rejected.join(', ')}`));
      }
      root.append(box);

      const startBtn = el('button', 'btn wide', 'Start test →');
      startBtn.type = 'button';
      startBtn.disabled = s.imported.total === 0;
      startBtn.addEventListener('click', () => opts.onStart());
      root.append(startBtn);

      const resetBtn = el('button', 'btn ghost wide', 'Reset (dobara import karo)');
      resetBtn.type = 'button';
      resetBtn.addEventListener('click', () => opts.onRemoveImport());
      root.append(resetBtn);
    }

    return root;
  }

  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  return { initialState, render };
})();