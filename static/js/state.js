// Sirf memory me. Browser storage kabhi use nahi hoga.
// state.attempt shape spec 4.3 se mirror hai — Step 5 me local -> server swap ho jaayega.
const state = {
  screen: 'home',
  test: null,
  settings: { theme: 'system' },
  templates: [],
  editor: null,   // {id, name, timer_mode, total_minutes, subjects[], errors:{}}
  attempt: null,  // {id, status, template, test_id, test_name, questions, responses, current, ...}
};