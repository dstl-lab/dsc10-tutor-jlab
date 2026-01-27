import { requestAPI } from '@/api';

export interface IAutograderEvent {
  grader_id: string;
  output: string;
  success: boolean;
}

/**
 * Log an autograder execution event to the backend
 * The backend will handle logging to Firebase
 * 
 * This function is non-blocking and will not throw errors.
 * Failures are logged to console but won't interrupt execution.
 * 
 * @param event - The autograder event data to log
 */
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

    console.log('✅ Autograder event logged successfully:', event.grader_id);
  } catch (error) {
    // Non-blocking: log error but don't throw
    console.error('❌ Failed to log autograder event to backend:', error);
  }
}
