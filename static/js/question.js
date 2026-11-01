// Ek question ka card banata hai. User/AI ka text kabhi innerHTML me nahi jaata
// (textContent), SVG sanitizeSvg() se guzarta hai. LaTeX ke liye typeset() baad me chalta hai.
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function renderQuestion(q, no, opts = {}) {
  const card = el('div', 'card');

  const text = el('div', 'qtext');
  text.append(el('span', 'qno', `Q${no}.`), document.createTextNode(q.q || ''));
  card.append(text);

  if (q.svg) {
    const svg = sanitizeSvg(q.svg);
    const box = el('div', 'diagram');
    if (svg) box.append(svg);
    else box.append(el('div', 'muted error', 'Diagram (SVG) kharab hai'));
    card.append(box);
  }

  const ul = el('ul', 'options');
  (q.options || []).forEach((o, i) => {
    const li = el('li', 'option');
    li.append(el('span', 'lbl', String.fromCharCode(65 + i)), el('span', 'otext', String(o)));
    ul.append(li);
  });
  card.append(ul);

  if (opts.showSolution) {
    const s = el('div', 'solution');
    s.append(el('b', '', `Answer: ${q.answer}`));
    if (q.solution) s.append(document.createElement('br'), document.createTextNode(q.solution));
    card.append(s);
  }
  return card;
}
