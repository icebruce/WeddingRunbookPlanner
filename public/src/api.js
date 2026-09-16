async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });

  const type = response.headers.get('content-type') || '';
  const body = type.includes('application/json') ? await response.json() : null;

  if (!response.ok) {
    const error = new Error(body?.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return body;
}

export const api = {
  session: () => request('/api/session'),
  login: password => request('/api/login', { method: 'POST', body: JSON.stringify({ password }) }),
  logout: () => request('/api/logout', { method: 'POST', body: '{}' }),
  load: () => request('/api/plan'),
  save: (plan, revision) => request('/api/plan', { method: 'PUT', body: JSON.stringify({ plan, revision }) }),
  versions: () => request('/api/versions'),
  createVersion: (name, revision) => request('/api/versions', { method: 'POST', body: JSON.stringify({ name, revision }) }),
  restoreVersion: (id, revision) => request('/api/versions', { method: 'PUT', body: JSON.stringify({ id, revision }) })
};
