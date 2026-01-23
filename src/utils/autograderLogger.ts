import { collection, addDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { getFirestoreInstance } from './firebase';

export interface IAutograderEvent {
  grader_id: string;
  output: string;
  success: boolean;
}

export async function logAutograderEvent(
  event: IAutograderEvent
): Promise<void> {
  const db = getFirestoreInstance();
  
  if (!db) {
    console.warn('Firestore not initialized, skipping autograder event log');
    return;
  }

  try {
    await addDoc(collection(db, 'autograder_events'), {
      grader_id: event.grader_id,
      output: event.output,
      success: event.success,
      timestamp: serverTimestamp() 
    });
    
    console.log('Autograder event logged to Firestore:', event.grader_id);
  } catch (error) {
    console.error('Failed to log autograder event to Firestore:', error);
  }
}