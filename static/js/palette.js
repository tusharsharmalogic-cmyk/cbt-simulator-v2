// Palette drawer (bottom sheet). Saare subjects ke question numbers (subject heading ke saath) status se color.
// States: not_visited (grey), visited (red), answered (green), marked (purple),
// answered_marked (purple + green dot).

const palette = (() => {

  function statusOf(r) {
    if (!r) return 'not_visited';
    if (!r.visited) return 'not_visited';
    if (r.marked && r.choice) return 'answered_marked';
    if (r.marked) return 'marked';
    if (r.choice) return 'answered';
    return 'visited';
  }

  function counts(responses) {
    const c = { total: responses.length, answered: 0, not_answered: 0, marked: 0, not_visited: 0 };
    responses.forEach(r => {
      const st = statusOf(r);
      if (st === 'answered' || st === 'answered_marked') c.answered++;
      else if (st === 'marked') c.marked++;
      else if (st === 'visited') c.not_answered++;
      else c.not_visited++;
    });
    return c;
  }

  function render(attempt, opts) {
    // opts: {onJump, onClose, onSubmit}
    // Saare subjects ek saath, har subject ki apni heading. Neeche Submit button.
    const subjects = Object.keys(attempt.questions || {});

    const sheet = el('div', 'sheet');
    sheet.addEventListener('click', (e) => { if (e.target === sheet) opts.onClose && opts.onClose(); });

    const panel = el('div', 'sheet-panel');
    panel.append(el('div', 'sheet-handle'));

    // Header
    const head = el('div', 'sheet-head');
    head.append(el('h3', '', 'Palette'));
    const close = el('button', 'icon-btn', '×');
    close.type = 'button';
    close.addEventListener('click', () => opts.onClose && opts.onClose());
    head.append(close);
    panel.append(head);

    // Har subject: heading + grid
    const all = [];
    subjects.forEach(subj => {
      const list = (attempt.responses && attempt.responses[subj]) || [];
      all.push(...list);
      const sec = el('div', 'pal-section');
      const c = counts(list);
      sec.append(el('h4', 'pal-subject', `${subj}  ·  ${c.answered}/${list.length}`));

      const lockInfo = (attempt.locks && attempt.locks[subj]) || null;
      const grid = el('div', 'palette-grid');
      list.forEach((r, i) => {
        const ql = lockInfo && lockInfo.questions && lockInfo.questions[i];
        const locked = !!(lockInfo && lockInfo.subject_locked) || !!(ql && ql.locked);
        const st = statusOf(r, locked);
        const label = locked ? (String(i + 1) + '🔒') : String(i + 1);
        const b = el('button', 'pal-btn ' + st, label);
        b.type = 'button';
        if (attempt.current.subject === subj && attempt.current.index === i) b.classList.add('current');
        if (locked) {
          b.disabled = true;
          b.setAttribute('aria-disabled', 'true');
          b.title = 'Locked';
        }
        b.addEventListener('click', (ev) => {
          if (locked) { ev.preventDefault(); ev.stopPropagation(); return; }
          opts.onJump && opts.onJump(subj, i);
          opts.onClose && opts.onClose();
        });
        grid.append(b);
      });
      sec.append(grid);
      panel.append(sec);
    });

    // Legend (saare subjects ka total)
    const c = counts(all);
    const legend = el('div', 'legend');
    const items = [
      ['answered', 'Answered', c.answered],
      ['not_answered', 'Not answered', c.not_answered],
      ['marked', 'Marked', c.marked],
      ['not_visited', 'Not visited', c.not_visited],
    ];
    items.forEach(([cls, label, n]) => {
      const row = el('div', 'legend-row ' + cls);
      row.append(el('span', 'legend-dot ' + cls), el('span', 'legend-label ' + cls, `${label}: ${n}`));
      legend.append(row);
    });
    panel.append(legend);

    // Submit button (palette ke andar, sabse neeche)
    const submitBtn = el('button', 'btn wide submit-btn pal-submit', 'Submit');
    submitBtn.type = 'button';
    submitBtn.addEventListener('click', () => opts.onSubmit && opts.onSubmit());
    panel.append(submitBtn);

    sheet.append(panel);
    return sheet;
  }

  return { render, statusOf, counts };
})();