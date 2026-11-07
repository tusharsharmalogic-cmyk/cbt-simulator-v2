// Exam Template Builder. state.editor ke saath kaam karta hai.
// Inputs changes -> state.editor update + summary in-place patch (focus bacha rahe).
// Structural changes (add/del/move/timer toggle) -> full rerender.

const builder = (() => {
  let _summaryEl = null;
  let _ed = null;

  function emptySubject() {
    return { name: '', questions: 25, marks: 4, negative: 1, minutes: 30 };
  }

  function blankEditor() {
    return {
      id: 'new',
      name: '',
      timer_mode: 'total',
      total_minutes: 180,
      subjects: [emptySubject()],
      errors: {},
    };
  }

  function fromTemplate(t) {
    return {
      id: t.id || 'new',
      name: t.name || '',
      timer_mode: 'total',
      total_minutes: t.total_minutes || 180,
      auto_time: t.auto_time === true,
      subjects: (t.subjects || []).map(s => ({
        name: s.name,
        questions: s.questions,
        marks: s.marks,
        negative: s.negative,
        minutes: s.minutes || 30,
        lock_mode: s.lock_mode || 'none',
        per_question_seconds: s.per_question_seconds || null,
        subject_minutes: s.subject_minutes || null,
      })),
      errors: {},
    };
  }

  function computeSummary(ed) {
    let q = 0, m = 0;
    ed.subjects.forEach(s => {
      q += Number(s.questions) || 0;
      m += (Number(s.questions) || 0) * (Number(s.marks) || 0);
    });
    const t = Number(ed.total_minutes) || 0;
    return { totalQ: q, totalMarks: m, totalMin: t };
  }

  function updateSummary() {
    if (!_summaryEl || !_ed) return;
    const sum = computeSummary(_ed);
    const rows = _summaryEl.querySelectorAll('.sum-row');
    if (rows.length >= 3) {
      rows[0].textContent = `Total Q: ${sum.totalQ}`;
      rows[1].textContent = `Total Marks: ${sum.totalMarks}`;
      rows[2].textContent = `Time: ${sum.totalMin} min`;
    }
  }

  function fieldRow(label, input, errorText) {
    const wrap = el('label', 'field');
    wrap.append(el('span', 'field-label', label), input);
    if (errorText) wrap.append(el('span', 'field-error', errorText));
    return wrap;
  }

  function numInput(value, onInput, opts = {}) {
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.className = 'input';
    inp.value = value ?? '';
    if (opts.min !== undefined) inp.min = opts.min;
    if (opts.step !== undefined) inp.step = opts.step;
    if (opts.inputmode) inp.inputMode = opts.inputmode;
    inp.addEventListener('input', () => onInput(inp.value));
    return inp;
  }

  function textInput(value, onInput, opts = {}) {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'input';
    inp.value = value ?? '';
    if (opts.maxlength) inp.maxLength = opts.maxlength;
    inp.addEventListener('input', () => onInput(inp.value));
    return inp;
  }

  function render(ed, opts) {
    // opts: {onStructure, onSave, onDelete}
    _ed = ed;
    const root = el('div', 'stack builder');

    // Name
    root.append(fieldRow('Template name',
      textInput(ed.name, v => { ed.name = v; updateSummary(); }, { maxlength: 60 }),
      ed.errors.name));

    // Total minutes (always visible — subject timer mode removed)
    root.append(fieldRow('Total minutes',
      numInput(ed.total_minutes,
               v => { ed.total_minutes = v === '' ? null : Number(v); updateSummary(); },
               { min: 1, step: 1, inputmode: 'numeric' }),
      ed.errors.total_minutes));

    // Auto time toggle: test me kam Q hon to time usi ratio me ghate
    const atRow = el('label', 'lock-row');
    const atTog = document.createElement('input');
    atTog.type = 'checkbox';
    atTog.checked = ed.auto_time === true;
    atTog.addEventListener('change', () => { ed.auto_time = atTog.checked; });
    atRow.append(atTog, el('span', '', ' Auto time (JSON me kam Q ho to time bhi kam)'));
    root.append(atRow);
    root.append(el('div', 'muted small',
      'ON: template me 50 Q / 180 min aur test me 25 Q ho to time 90 min. OFF: time hamesha 180 min.'));

    // Subjects
    root.append(el('h2', 'section-title', 'Subjects'));
    ed.subjects.forEach((s, i) => root.append(subjectCard(ed, i, opts)));

    // Add subject
    const addBtn = el('button', 'btn ghost wide', '+ Add subject');
    addBtn.type = 'button';
    addBtn.addEventListener('click', () => {
      ed.subjects.push(emptySubject());
      opts.onStructure && opts.onStructure();
    });
    root.append(addBtn);

    // Summary
    const sum = computeSummary(ed);
    const sumBox = el('div', 'card summary');
    sumBox.append(el('div', 'sum-row', `Total Q: ${sum.totalQ}`));
    sumBox.append(el('div', 'sum-row', `Total Marks: ${sum.totalMarks}`));
    sumBox.append(el('div', 'sum-row', `Time: ${sum.totalMin} min`));
    _summaryEl = sumBox;
    root.append(sumBox);

    // Global errors
    if (ed.errors._global) {
      const eBox = el('div', 'error-box');
      ed.errors._global.forEach(msg => eBox.append(el('div', 'field-error', msg)));
      root.append(eBox);
    }

    // Actions
    const actions = el('div', 'actions-row');
    const saveBtn = el('button', 'btn', 'Save');
    saveBtn.type = 'button';
    saveBtn.addEventListener('click', () => opts.onSave && opts.onSave());
    actions.append(saveBtn);

    if (ed.id !== 'new') {
      const delBtn = el('button', 'btn danger ghost', 'Delete');
      delBtn.type = 'button';
      delBtn.addEventListener('click', () => {
        if (confirm('Is template ko delete karna hai? Undo nahi hoga.')) {
          opts.onDelete && opts.onDelete();
        }
      });
      actions.append(delBtn);
    }
    root.append(actions);

    return root;
  }

  function subjectCard(ed, idx, opts) {
    const s = ed.subjects[idx];
    const card = el('div', 'card subject-card');

    const head = el('div', 'subject-head');
    head.append(el('span', 'subject-idx', `#${idx + 1}`));

    const tools = el('div', 'subject-tools');
    const up = el('button', 'icon-btn', '↑');
    up.type = 'button'; up.title = 'Move up'; up.disabled = idx === 0;
    up.addEventListener('click', () => {
      [ed.subjects[idx - 1], ed.subjects[idx]] = [ed.subjects[idx], ed.subjects[idx - 1]];
      opts.onStructure && opts.onStructure();
    });
    const down = el('button', 'icon-btn', '↓');
    down.type = 'button'; down.title = 'Move down'; down.disabled = idx === ed.subjects.length - 1;
    down.addEventListener('click', () => {
      [ed.subjects[idx + 1], ed.subjects[idx]] = [ed.subjects[idx], ed.subjects[idx + 1]];
      opts.onStructure && opts.onStructure();
    });
    const del = el('button', 'icon-btn danger', '×');
    del.type = 'button'; del.title = 'Delete subject'; del.disabled = ed.subjects.length <= 1;
    del.addEventListener('click', () => {
      ed.subjects.splice(idx, 1);
      opts.onStructure && opts.onStructure();
    });
    tools.append(up, down, del);
    head.append(tools);
    card.append(head);

    const subErr = (ed.errors[`sub_${idx}`] || []).join(' | ');

    card.append(fieldRow('Name',
      textInput(s.name, v => { s.name = v; }, { maxlength: 40 })));

    const grid = el('div', 'sub-grid');
    grid.append(fieldRow('Questions',
      numInput(s.questions,
               v => { s.questions = v === '' ? null : Number(v); updateSummary(); },
               { min: 1, step: 1, inputmode: 'numeric' })));
    grid.append(fieldRow('+Marks',
      numInput(s.marks,
               v => { s.marks = v === '' ? null : Number(v); updateSummary(); },
               { min: 0, step: 0.25, inputmode: 'decimal' })));
    grid.append(fieldRow('−Negative',
      numInput(s.negative,
               v => { s.negative = v === '' ? null : Number(v); },
               { min: 0, step: 0.25, inputmode: 'decimal' })));
    card.append(grid);

    if (subErr) card.append(el('div', 'field-error', subErr));

    // Per-subject lock mode (mutually exclusive: per-Q XOR subject-max)
    card.append(lockSection(s, () => opts.onStructure && opts.onStructure()));

    return card;
  }

  function lockSection(s, rerender) {
    const wrap = el('div', 'lock-section');
    wrap.append(el('span', 'field-label', 'Time lock (optional)'));

    // Per-question toggle
    const qRow = el('label', 'lock-row');
    const qTog = document.createElement('input');
    qTog.type = 'checkbox';
    qTog.checked = s.lock_mode === 'question';
    qTog.addEventListener('change', () => {
      if (qTog.checked) {
        s.lock_mode = 'question';
        s.subject_minutes = null;
        if (!s.per_question_seconds) s.per_question_seconds = 60;
      } else {
        s.lock_mode = 'none';
        s.per_question_seconds = null;
      }
      rerender();
    });
    qRow.append(qTog, el('span', '', ' Per question maximum time'));
    wrap.append(qRow);
    if (s.lock_mode === 'question') {
      const inp = numInput(s.per_question_seconds,
        v => { s.per_question_seconds = v === '' ? null : Number(v); },
        { min: 1, step: 1, inputmode: 'numeric' });
      wrap.append(fieldRow('Seconds per question', inp));
    }

    // Per-subject toggle
    const sRow = el('label', 'lock-row');
    const sTog = document.createElement('input');
    sTog.type = 'checkbox';
    sTog.checked = s.lock_mode === 'subject';
    sTog.disabled = false;
    sTog.addEventListener('change', () => {
      if (sTog.checked) {
        s.lock_mode = 'subject';
        s.per_question_seconds = null;
        if (!s.subject_minutes) s.subject_minutes = 30;
      } else {
        s.lock_mode = 'none';
        s.subject_minutes = null;
      }
      rerender();
    });
    sRow.append(sTog, el('span', '', ' Subject maximum time'));
    wrap.append(sRow);
    if (s.lock_mode === 'subject') {
      const inp = numInput(s.subject_minutes,
        v => { s.subject_minutes = v === '' ? null : Number(v); },
        { min: 1, step: 1, inputmode: 'numeric' });
      wrap.append(fieldRow('Minutes for subject', inp));
    }

    wrap.append(el('div', 'muted small',
      'Sirf ek hi lock ek subject pe on ho sakta hai.'));
    return wrap;
  }

  return { blankEditor, fromTemplate, render, computeSummary, updateSummary };
})();