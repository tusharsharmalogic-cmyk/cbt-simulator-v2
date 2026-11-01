// Saare fetch calls yahin. Baaki JS sirf api.* use karega.
const api = {
  async get(url) {
    const r = await fetch(url);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data;
  },
  tests: () => api.get('/api/tests'),
  test: (id) => api.get('/api/tests/' + encodeURIComponent(id)),
};
