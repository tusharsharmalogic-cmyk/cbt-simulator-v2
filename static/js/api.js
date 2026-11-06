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
  visit: (id, subject, index, spent) =>
    api.post(`/api/attempts/${encodeURIComponent(id)}/visit`, { subject, index, spent }),
  submit: (id) => api.post(`/api/attempts/${encodeURIComponent(id)}/submit`),
};