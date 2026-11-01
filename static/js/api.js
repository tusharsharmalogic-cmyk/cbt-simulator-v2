// Saare fetch calls yahin. Baaki JS sirf api.* use karega.
async function _json(url, opts) {
  const r = await fetch(url, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data.error || (data.errors && data.errors[0]) || `HTTP ${r.status}`);
    err.status = r.status;
    err.errors = data.errors;
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
  del: (url) => _json(url, { method: 'DELETE' }),

  tests: () => api.get('/api/tests'),
  test: (id) => api.get('/api/tests/' + encodeURIComponent(id)),

  settings: () => api.get('/api/settings'),
  saveSettings: (theme) => api.put('/api/settings', { theme }),

  templates: () => api.get('/api/templates'),
  template: (id) => api.get('/api/templates/' + encodeURIComponent(id)),
  saveTemplate: (id, body) => api.put('/api/templates/' + encodeURIComponent(id), body),
  deleteTemplate: (id) => api.del('/api/templates/' + encodeURIComponent(id)),
};