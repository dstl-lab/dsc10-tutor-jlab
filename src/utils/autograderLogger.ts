import { logEvent, observationMetadata } from '@/api/logger';

export interface IAutograderEvent extends Record<string, unknown> {
  grader_id: string;
  output: string;
  success: boolean | null;
  notebook?: string;
}

export async function logAutograderEvent(
  event: IAutograderEvent
): Promise<void> {
  logEvent({
    event_type: 'autograder_info',
    payload: {
      ...observationMetadata,
      ...event,
      timestamp: new Date().toISOString(),
      notebook: event.notebook || ''
    }
  });
}
