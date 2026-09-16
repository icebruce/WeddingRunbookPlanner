import { errorStatus, fail } from './http.js';
import { log } from './log.js';
import { ValidationError } from './validate.js';

/**
 * Turns a thrown error into the one response shape the client understands, and
 * records it (F17). Messages for 5xx are deliberately generic: the detail goes
 * to the log, not to the browser.
 */
export function respondWithError(res, route, error, extra = {}) {
  const status = errorStatus(error);

  if (error instanceof ValidationError) {
    // Only the field name is logged — never the value that was rejected.
    log.warn(route, error.code, 'rejected invalid input', { field: error.field });
    return fail(res, 400, error.code, error.message, { field: error.field });
  }

  if (status === 409) {
    log.warn(route, 'revision_conflict', 'save rejected on a stale revision', extra.logExtra);
    return fail(res, 409, 'revision_conflict', error.message, { latest: extra.latest });
  }

  if (status >= 400 && status < 500) {
    log.warn(route, error.code || 'client_error', error.message, extra.logExtra);
    return fail(res, status, error.code || 'client_error', error.message, { field: error.field });
  }

  log.error(route, error.code || 'server_error', error, extra.logExtra);
  return fail(res, status, error.code || 'server_error', 'Something went wrong on our side. Try again.');
}
