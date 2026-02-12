import { logEvent } from '@/api/logger';

export interface IAutograderEvent {
  grader_id: string;
  output: string;
  success: boolean;
  notebook?: string;
}

export async function logAutograderEvent(
  event: IAutograderEvent
): Promise<void> {
  logEvent({
    event_type: 'autograder_info',
    payload: {
      grader_id: event.grader_id,
      output: event.output,
      success: event.success,
      timestamp: new Date().toISOString(),
      notebook: event.notebook || ''
    }
  });
}
