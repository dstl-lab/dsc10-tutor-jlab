import { getStudentEmailFromUrl, isProduction } from '@/utils';

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
  }).catch(err => {
    console.error('Failed to log event:', err);
  });
}
