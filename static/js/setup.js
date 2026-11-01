// Test Setup screen: template chuno + test chuno -> validate -> errors/warnings show.
// Step 3 me "Start" sirf state.attempt banake Step 4 screen pe bhejta hai.
// Step 5 me real POST /api/attempts yahan aayega.

const setup = (() => {

  function initialState(templates, tests) {
    const firstT = templates.find(t => !t.error);
    return {
      templates,
      tests,
      templateId: firstT ? firstT.id : null,
      testId: null,
      validation: null,   // {errors, warnings}
      validating: false,
      validateError: null,
    };
  }

  function render(s, opts) {
    // opts: {onTemplateChange, onTestChange, onValidate, onStart}
    const root = el('div', 'stack setup');

    root.append(el('p', 'muted', 'Template chuno, test chuno, phir Start dabao. Validation errors hone par Start band rahega.'));

    // ---- Template select ----
    const tField = el('label', 'field');
    tField.append(el('span', 'field-label', 'Exam template'));
    const tSel = document.createElement('select');
    tSel.className = 'input';
    s.templates.filter(t => !t.error).forEach(t => {
      const o = document.createElement('option');
      o.value = t.id;
      o.textContent = t.name + (t.timer_mode === 'subject' ? ' (subject timer)' : ` (${t.total_minutes} min)`);
      if (s.templateId === t.id) o.selected = true;
      tSel.append(o);
    });
    if (!s.templates.filter(t => !t.error).length) {
      const o = document.createElement('option');
      o.value = '';
      o.textContent = '(koi template nahi — pehle banao)';
      tSel.append(o);
      tSel.disabled = true;
    }
    tSel.addEventListener('change', () => opts.onTemplateChange(tSel.value));
    tField.append(tSel);
    root.append(tField);

    // ---- Test select ----
    const qField = el('label', 'field');
    qField.append(el('span', 'field-label', 'Test file'));
    const qSel = document.createElement('select');
    qSel.className = 'input';
    const goodTests = s.tests.filter(t => !t.error);
    if (!goodTests.length) {
      const o = document.createElement('option');
      o.value = '';
      o.textContent = '(koi test file nahi — data/tests/ me JSON daalo)';
      qSel.append(o);
      qSel.disabled = true;
    } else {
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = '— test chuno —';
      if (!s.testId) placeholder.selected = true;
      qSel.append(placeholder);
      goodTests.forEach(t => {
        const o = document.createElement('option');
        o.value = t.id;
        o.textContent = t.name;
        if (s.testId === t.id) o.selected = true;
        qSel.append(o);
      });
    }
    qSel.addEventListener('change', () => opts.onTestChange(qSel.value));
    qField.append(qSel);
    root.append(qField);

    // Broken test entries (info only)
    const broken = s.tests.filter(t => t.error);
    if (broken.length) {
      const box = el('div', 'card warn-box');
      box.append(el('div', 'warn-title', 'Kuch test files padhi nahi gayi:'));
      broken.forEach(b => box.append(el('div', 'warn-row', `${b.id}: ${b.error}`)));
      root.append(box);
    }

    // ---- Validation button ----
    const validateBtn = el('button', 'btn ghost wide',
      s.validating ? 'Validate ho raha hai...' : 'Validate karo');
    validateBtn.type = 'button';
    validateBtn.disabled = s.validating || !s.templateId || !s.testId;
    validateBtn.addEventListener('click', () => opts.onValidate());
    root.append(validateBtn);

    // ---- Validation results ----
    if (s.validateError) {
      root.append(el('div', 'error-box', `Validate fail: ${s.validateError}`));
    }
    if (s.validation) {
      const v = s.validation;
      if (v.errors.length) {
        const box = el('div', 'card error-box');
        box.append(el('div', 'err-title', `Errors (${v.errors.length})`));
        v.errors.forEach(e => box.append(el('div', 'err-row', e)));
        root.append(box);
      }
      if (v.warnings.length) {
        const box = el('div', 'card warn-box');
        box.append(el('div', 'warn-title', `Warnings (${v.warnings.length}) — allowed`));
        v.warnings.forEach(w => box.append(el('div', 'warn-row', w)));
        root.append(box);
      }
      if (!v.errors.length && !v.warnings.length) {
        root.append(el('div', 'card ok-box', 'Sab theek hai. Start dabao.'));
      }
    }

    // ---- Start ----
    const canStart = s.validation && s.validation.errors.length === 0 && s.templateId && s.testId;
    const startBtn = el('button', 'btn wide', 'Start test');
    startBtn.type = 'button';
    startBtn.disabled = !canStart;
    startBtn.addEventListener('click', () => opts.onStart && opts.onStart());
    root.append(startBtn);

    if (!canStart && !s.validation) {
      root.append(el('p', 'muted center', 'Pehle Validate karo.'));
    }

    return root;
  }

  return { initialState, render };
})();