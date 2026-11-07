// Saare fetch calls yahin. Baaki JS sirf api.* use karega.
async function _json(url, opts) {
  const r = await fetch(url, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data.error || (data.errors && data.errors[0]) || `HTTP ${r.status}`);
    err.status = r.status;
    err.errors = data.errors;
    err.data = data;
    err.skipped = data.skipped;
    throw err;
  }
  return data;
}

const api = {
  get: (url) => _json(url),
  put: (url, body) => _json(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }),
  post: (url, body) => _json(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  }),
  del: (url) => _json(url, { method: 'DELETE' }),

  tests: () => api.get('/api/tests'),
  test: (id) => api.get('/api/tests/' + encodeURIComponent(id)),
  removeQuestion: (id, subject, index) => api.post(
    `/api/tests/${encodeURIComponent(id)}/remove_question`, { subject, index }),
  mergeTests: (test_ids, name) => api.post('/api/tests/merge', { test_ids, name }),
  splitTest: (id, questions) => api.post(
    `/api/tests/${encodeURIComponent(id)}/split`, { questions }),
  splitTestGroups: (id, groups) => api.post(
    `/api/tests/${encodeURIComponent(id)}/split`, { groups }),
  testPool: () => api.get('/api/tests/pool'),
  schedule: () => api.get('/api/schedule'),
  setSchedule: (testId, date, template_id) => api.put(
    '/api/schedule/' + encodeURIComponent(testId), { date, template_id }),
  clearSchedule: (testId) => api.del('/api/schedule/' + encodeURIComponent(testId)),
  customTest: (filters) => api.post('/api/tests/custom', filters),
  validateTest: (id, templateId) => api.get(
    `/api/tests/${encodeURIComponent(id)}/validate?template=${encodeURIComponent(templateId)}`),

  importTests: async (files, templateId, name) => {
    const fd = new FormData();
    files.forEach(f => fd.append('files[]', f, f.name));
    if (templateId) fd.append('template_id', templateId);
    if (name) fd.append('name', name);
    const r = await fetch('/api/tests/import', { method: 'POST', body: fd });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(data.error || (data.errors && data.errors[0]) || `HTTP ${r.status}`);
      err.status = r.status;
      err.errors = data.errors;
      err.skipped = data.skipped;
      throw err;
    }
    return data;
  },

  pasteTest: (text, name) => api.post('/api/tests/paste', { json: text, name }),

  prompt: (key) => api.get('/api/prompt/' + encodeURIComponent(key)),
  savePrompt: (key, text) => api.put('/api/prompt/' + encodeURIComponent(key), { text }),
  resetPrompt: (key) => api.del('/api/prompt/' + encodeURIComponent(key)),

  settings: () => api.get('/api/settings'),
  saveSettings: (theme) => api.put('/api/settings', { theme }),

  templates: () => api.get('/api/templates'),
  template: (id) => api.get('/api/templates/' + encodeURIComponent(id)),
  saveTemplate: (id, body) => api.put('/api/templates/' + encodeURIComponent(id), body),
  deleteTemplate: (id) => api.del('/api/templates/' + encodeURIComponent(id)),

  attempts: () => api.get('/api/attempts'),
  attempt: (id) => api.get('/api/attempts/' + encodeURIComponent(id)),
  createAttempt: (template_id, test_ids) => api.post('/api/attempts', {
    template_id,
    test_ids: Array.isArray(test_ids) ? test_ids : [test_ids],
  }),
  deleteAttempt: (id) => api.del('/api/attempts/' + encodeURIComponent(id)),
  answer: (id, subject, index, choice) =>
    api.post(`/api/attempts/${encodeURIComponent(id)}/answer`, { subject, index, choice }),
  mark: (id, subject, index, marked) =>
    api.post(`/api/attempts/${encodeURIComponent(id)}/mark`, { subject, index, marked }),
  visit: (id, subject, index, spent, from) =>
    api.post(`/api/attempts/${encodeURIComponent(id)}/visit`, {
      subject, index, spent,
      from_subject: from ? from.subject : undefined,
      from_index: from ? from.index : undefined,
    }),
  submit: (id, subject, index, spent) =>
    api.post(`/api/attempts/${encodeURIComponent(id)}/submit`, { subject, index, spent }),
  retry: (id, mode) =>
    api.post(`/api/attempts/${encodeURIComponent(id)}/retry`, { mode }),
};