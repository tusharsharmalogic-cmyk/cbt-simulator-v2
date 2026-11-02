// Palette drawer (bottom sheet). Current subject ke question numbers status se color.
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
    // opts: {onJump, onClose}
    const subj = attempt.current.subject;
    const list = attempt.responses[subj] || [];

    const sheet = el('div', 'sheet');
    sheet.addEventListener('click', (e) => { if (e.target === sheet) opts.onClose && opts.onClose(); });

    const panel = el('div', 'sheet-panel');
    panel.append(el('div', 'sheet-handle'));

    // Header
    const head = el('div', 'sheet-head');
    head.append(el('h3', '', `Palette — ${subj}`));
    const close = el('button', 'icon-btn', '×');
    close.type = 'button';
    close.addEventListener('click', () => opts.onClose && opts.onClose());
    head.append(close);
    panel.append(head);

    // Grid
    const grid = el('div', 'palette-grid');
    list.forEach((r, i) => {
      const st = statusOf(r);
      const b = el('button', 'pal-btn ' + st, String(i + 1));
      b.type = 'button';
      if (attempt.current.index === i) b.classList.add('current');
      b.addEventListener('click', () => {
        opts.onJump && opts.onJump(subj, i);
        opts.onClose && opts.onClose();
      });
      grid.append(b);
    });
    panel.append(grid);

    // Legend
    const c = counts(list);
    const legend = el('div', 'legend');
    const items = [
      ['answered', 'Answered', c.answered],
      ['not_answered', 'Not answered', c.not_answered],
      ['marked', 'Marked', c.marked],
      ['not_visited', 'Not visited', c.not_visited],
    ];
    items.forEach(([cls, label, n]) => {
      const row = el('div', 'legend-row');
      row.append(el('span', 'legend-dot ' + cls), el('span', 'legend-label', `${label}: ${n}`));
      legend.append(row);
    });
    panel.append(legend);

    // Close button
    const closeBtn = el('button', 'btn wide', 'Band karo');
    closeBtn.type = 'button';
    closeBtn.addEventListener('click', () => opts.onClose && opts.onClose());
    panel.append(closeBtn);

    sheet.append(panel);
    return sheet;
  }

  return { render, statusOf, counts };
})();