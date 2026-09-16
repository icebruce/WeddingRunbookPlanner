/**
 * Minimal Upstash Redis REST client.
 *
 * Every call is bounded by a timeout: an Upstash request that never settles
 * would otherwise hold a serverless function open until the platform killed it,
 * which is what F11 described. Reads are idempotent and get one retry; writes
 * are not retried, because a write that timed out may still have landed.
 */
const REQUEST_TIMEOUT_MS = 5_000;

export function upstashCredentials() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

export class UpstashClient {
  constructor({ url, token }, { timeoutMs = REQUEST_TIMEOUT_MS, fetchImpl = fetch } = {}) {
    this.url = url;
    this.token = token;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  async send(command) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
        signal: controller.signal
      });
      if (!response.ok) {
        throw Object.assign(new Error(`Storage request failed (${response.status})`), { statusCode: 502 });
      }
      const body = await response.json();
      if (body?.error) throw Object.assign(new Error(String(body.error)), { statusCode: 502 });
      return body?.result ?? null;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw Object.assign(new Error('Storage timed out'), { statusCode: 504 });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Reads are safe to repeat, so a single transient failure does not surface. */
  async read(command) {
    try {
      return await this.send(command);
    } catch {
      return this.send(command);
    }
  }

  write(command) {
    return this.send(command);
  }
}

export function getUpstash(options) {
  const credentials = upstashCredentials();
  return credentials ? new UpstashClient(credentials, options) : null;
}
