// Ek question ka card banata hai. User/AI ka text kabhi innerHTML me nahi jaata
// (textContent), SVG sanitizeSvg() se guzarta hai. LaTeX ke liye typeset() baad me chalta hai.
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

// Question card ke liye ek metadata strip: subject / chapter / topic / difficulty.
// `meta` optional hai: {subject, index, onRemove(index)}.
function renderQuestionMeta(card, q, meta) {
  if (!meta) return;
  const strip = el('div', 'qmeta');
  if (meta.subject) strip.append(el('span', 'qmeta-chip subj', '📚 ' + meta.subject));

  const chapter = (typeof q.chapter === 'string' && q.chapter.trim()) ? q.chapter.trim() : null;
  const topic = (typeof q.topic === 'string' && q.topic.trim()) ? q.topic.trim() : null;
  if (chapter) strip.append(el('span', 'qmeta-chip ch', '📖 ' + chapter));
  if (topic) strip.append(el('span', 'qmeta-chip tp', '🏷 ' + topic));

  const d = (typeof q.difficulty === 'string' ? q.difficulty.trim().toLowerCase() : '');
  const dLabel = d === 'easy' ? 'Easy' : d === 'medium' ? 'Medium' : d === 'hard' ? 'Hard' : 'Unknown';
  strip.append(el('span', 'qmeta-chip diff diff-' + (d || 'unknown'), dLabel));

  if (typeof meta.onRemove === 'function' && Number.isInteger(meta.index)) {
    const rm = el('button', 'qmeta-remove', '🗑 Hatao');
    rm.type = 'button';
    rm.title = 'Yeh question test JSON se delete karo';
    rm.addEventListener('click', () => meta.onRemove(meta.index));
    strip.append(rm);
  }
  card.append(strip);
}

function renderQuestion(q, no, opts = {}) {
  const card = el('div', 'card');

  // Metadata strip pehle (subject/chapter/topic/difficulty + optional remove).
  renderQuestionMeta(card, q, opts.meta);

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
    if (opts.choice === String.fromCharCode(65 + i)) li.classList.add('selected');
    if (opts.onSelect) {
      li.classList.add('tap');
      li.addEventListener('click', () => opts.onSelect(String.fromCharCode(65 + i)));
    }
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
