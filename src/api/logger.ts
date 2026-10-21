import { getStudentEmailFromUrl, isProduction } from '@/utils';
import { UUID } from '@lumino/coreutils';
import packageInfo from '../../package.json';
import { flushPendingNotebookEdits } from '../utils/notebookEditBoundary';

export const observationMetadata = {
  schema_version: 1,
  client_version: packageInfo.version
};

const LOG_API = isProduction()
  ? 'https://dsc10-tutor-logging-api.nrp-nautilus.io'
  : 'https://dsc10-tutor-logging-api-dev.nrp-nautilus.io';

interface ILogEvent {
  event_type: string;
  user_email?: string;
  payload?: Record<string, unknown>;
}

const analyticsSessionId = UUID.uuid4();
let clientSequence = 0;

export function logEvent(event: ILogEvent): void {
  // Source summaries must precede the next observed action, not their idle timer.
  if (event.event_type !== 'notebook_cell_source_changed') {
    flushPendingNotebookEdits();
  }
  const body: ILogEvent = {
    ...event,
    user_email: event.user_email ?? getStudentEmailFromUrl(),
    payload: {
      ...(event.payload ?? {}),
      event_id: UUID.uuid4(),
      analytics_session_id: analyticsSessionId,
      client_sequence: ++clientSequence,
      client_timestamp: new Date().toISOString()
    }
  };

  fetch(`${LOG_API}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
    .then(response => {
      if (!response.ok) {
        throw new Error(`Logging endpoint returned HTTP ${response.status}`);
      }
    })
    .catch(err => {
      // Never routed through logError: the collector itself is unreachable.
      console.error('Failed to log event:', err);
    });
}

/**
 * An error carrying diagnostic fields (HTTP status, failure stage, server
 * response) that logError copies into the `client_error` payload.
 */
export class TutorError extends Error {
  constructor(
    message: string,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'TutorError';
  }
}

const MAX_STACK_CHARS = 4000;
const MAX_ERRORS_PER_SESSION = 100;
const loggedErrors = new WeakSet<object>();
let errorCount = 0;

/**
 * Record a failure as a `client_error` event. Each error object is logged at
 * most once, so callers along the same failure path can all call this safely.
 *
 * @param source - Where the failure surfaced, e.g. 'tutor_stream'.
 * @param error - The thrown value.
 * @param context - Extra identifiers, e.g. request_id or endpoint.
 */
export function logError(
  source: string,
  error: unknown,
  context: Record<string, unknown> = {}
): void {
  if (typeof error === 'object' && error !== null) {
    if (loggedErrors.has(error)) {
      return;
    }
    loggedErrors.add(error);
  }
  // A crash loop must not flood the collector.
  if (++errorCount > MAX_ERRORS_PER_SESSION) {
    return;
  }
  try {
    const err = error instanceof Error ? error : null;
    // ServerConnection.ResponseError exposes the failed response.
    const response = (error as { response?: Response } | null)?.response;
    logEvent({
      event_type: 'client_error',
      payload: {
        ...observationMetadata,
        timestamp: new Date().toISOString(),
        source,
        error_name: err?.name ?? typeof error,
        error_message: err?.message ?? String(error),
        stack: err?.stack?.slice(0, MAX_STACK_CHARS) ?? null,
        http_status: response?.status ?? null,
        ...(error instanceof TutorError ? error.details : {}),
        ...context,
        online: typeof navigator !== 'undefined' ? navigator.onLine : null,
        user_agent:
          typeof navigator !== 'undefined' ? navigator.userAgent : null,
        page_visibility:
          typeof document !== 'undefined' ? document.visibilityState : null,
        ms_since_page_load:
          typeof performance !== 'undefined'
            ? Math.round(performance.now())
            : null
      }
    });
  } catch (loggingError) {
    console.error('Failed to log error:', loggingError);
  }
}

const EXTENSION_SCRIPT_MARKER = 'dsc10-tutor-jlab';

/**
 * Log uncaught errors and unhandled rejections thrown from this extension's
 * code. Errors from JupyterLab or other extensions are ignored.
 */
export function startGlobalErrorLogging(): void {
  const fromExtension = (error: unknown, filename?: string) =>
    (filename ?? '').includes(EXTENSION_SCRIPT_MARKER) ||
    (error instanceof Error &&
      (error.stack ?? '').includes(EXTENSION_SCRIPT_MARKER));

  window.addEventListener('error', event => {
    if (fromExtension(event.error, event.filename)) {
      logError('uncaught_error', event.error ?? event.message, {
        filename: event.filename,
        line: event.lineno,
        column: event.colno
      });
    }
  });
  window.addEventListener('unhandledrejection', event => {
    if (fromExtension(event.reason)) {
      logError('unhandled_rejection', event.reason);
    }
  });
}
