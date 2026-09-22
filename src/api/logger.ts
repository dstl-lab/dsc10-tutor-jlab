import { getStudentEmailFromUrl, isProduction } from '@/utils';
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

export function logEvent(event: ILogEvent): void {
  const body: ILogEvent = {
    ...event,
    user_email: event.user_email ?? getStudentEmailFromUrl()
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
