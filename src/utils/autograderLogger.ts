import { collection, addDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { getFirestoreInstance } from './firebase';

export interface IAutograderEvent {
  grader_id: string;
  output: string;
  success: boolean;
}

/**
 * Log an autograder execution event to Firestore
 * 
 * This function is non-blocking and will not throw errors.
 * Failures are logged to console but won't interrupt execution.
 * 
 * @param event - The autograder event data to log
 */
export async function logAutograderEvent(
  event: IAutograderEvent
): Promise<void> {
  const db = getFirestoreInstance();
  
  if (!db) {
    console.warn('Firestore not initialized, skipping autograder event log');
    return;
  }

  try {
    // Only log the essential fields: grader_id, output, success, timestamp
    await addDoc(collection(db, 'autograder_events'), {
      grader_id: event.grader_id,
      output: event.output,
      success: event.success,
      timestamp: serverTimestamp() // Firestore server timestamp
    });
    
    console.log('✅ Autograder event logged to Firestore:', event.grader_id);
  } catch (error) {
    // Non-blocking: log error but don't throw
    console.error('❌ Failed to log autograder event to Firestore:', error);
  }
}