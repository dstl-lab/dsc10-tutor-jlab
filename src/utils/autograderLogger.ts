import { requestAPI } from '@/api';

export interface IAutograderEvent {
  grader_id: string;
  output: string;
  success: boolean;
}

export async function logAutograderEvent(
  event: IAutograderEvent
): Promise<void> {
  try {
    await requestAPI<{ status: string; message: string }>('log', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        grader_id: event.grader_id,
        output: event.output,
        success: event.success
      })
    });

    console.log('Autograder event logged successfully:', event.grader_id);
  } catch (error) {
    console.error('Failed to log autograder event to backend:', error);
  }
}
