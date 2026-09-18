/**
 * Every call is bounded. A request that never settles used to leave the header
 * on "Saving…" for as long as the tab stayed open (F11); now it aborts and is
 * reported as a timeout, which the save pipeline treats as retryable.
 */
export const REQUEST_TIMEOUT_MS = 15_000;

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'network', field = null, body = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.field = field;
    this.body = body;
  }

  /** Worth trying again unprompted: nothing about the request itself was wrong. */
  get retryable() {
    return this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

async function request(path, { timeoutMs = REQUEST_TIMEOUT_MS, ...options } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      signal: controller.signal,
      ...options
    });
  } catch (error) {
    if (error.name === 'AbortError') throw new ApiError('The request took too long.', { code: 'timeout' });
    throw new ApiError('No connection.', { code: 'network' });
  } finally {
    clearTimeout(timer);
  }

  const type = response.headers.get('content-type') || '';
  const body = type.includes('application/json') ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    const detail = body?.error;
    throw new ApiError(detail?.message || `Request failed (${response.status})`, {
      status: response.status,
      code: detail?.code || `http_${response.status}`,
      field: detail?.field || null,
      body
    });
  }

  return body;
}

export const api = {
  session: () => request('/api/session', { timeoutMs: 10_000 }),
  login: password => request('/api/login', { method: 'POST', body: JSON.stringify({ password }) }),
  logout: () => request('/api/logout', { method: 'POST', body: '{}' }),
  load: since => request(since === undefined || since === null ? '/api/plan' : `/api/plan?since=${encodeURIComponent(since)}`),
  save: (plan, revision, deviceId) => request('/api/plan', { method: 'PUT', body: JSON.stringify({ plan, revision, deviceId }) }),
  template: () => request('/api/template'),
  share: () => request('/api/share'),
  rotateShare: () => request('/api/share', { method: 'POST', body: '{}' }),
  versions: () => request('/api/versions'),
  version: id => request(`/api/versions?id=${encodeURIComponent(id)}`),
  createVersion: (name, extra = {}) => request('/api/versions', { method: 'POST', body: JSON.stringify({ name, ...extra }) }),
  restoreVersion: (id, revision) => request('/api/versions', { method: 'PUT', body: JSON.stringify({ id, revision }) }),
  deleteVersion: id => request(`/api/versions?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),

  /**
   * Sent as the page goes away. `keepalive` lets the browser finish it after
   * the tab is gone; there is no answer to read, so there is nothing to await.
   */
  saveOnHide(plan, revision, deviceId) {
    fetch('/api/plan', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan, revision, deviceId }),
      keepalive: true
    }).catch(() => {});
  }
};

export { request };
