// Entry: screens switch. Step 1 me sirf: test list + test preview (render check).
const app = document.getElementById('app');
const backBtn = document.getElementById('back');
const titleEl = document.getElementById('title');

function show(title, ...nodes) {
  titleEl.textContent = title;
  app.replaceChildren(...nodes);
  backBtn.hidden = state.screen === 'home';
  window.scrollTo(0, 0);
  typeset(app);
}

async function showHome() {
  state.screen = 'home';
  show('CBT Simulator', el('p', 'muted', 'Load ho raha hai...'));
  try {
    const tests = await api.tests();
    const wrap = el('div', 'stack');
    wrap.append(el('h2', '', 'Tests'));
    if (!tests.length) wrap.append(el('p', 'muted', 'data/tests/ me koi .json test nahi mila.'));
    tests.forEach((t) => {
      const card = el('div', 'card tap');
      card.append(el('h3', '', t.name));
      if (t.error) {
        card.append(el('p', 'error', t.error));
      } else {
        const chips = el('div', 'chips');
        Object.entries(t.subjects).forEach(([s, n]) => chips.append(el('span', 'chip', `${s}: ${n} Q`)));
        card.append(chips);
        card.addEventListener('click', () => showPreview(t.id));
      }
      wrap.append(card);
    });
    show('CBT Simulator', wrap);
  } catch (e) {
    show('CBT Simulator', el('p', 'error', e.message));
  }
}

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

backBtn.addEventListener('click', showHome);
showHome();
