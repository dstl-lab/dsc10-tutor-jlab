import { getStudentEmailFromUrl, isProduction } from '@/utils';
import { UUID } from '@lumino/coreutils';
import packageInfo from '../../package.json';

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
      console.error('Failed to log event:', err);
    });
}
