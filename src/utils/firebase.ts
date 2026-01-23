import { initializeApp, FirebaseApp } from 'firebase/app';
import { getFirestore, Firestore } from 'firebase/firestore';
import { firebaseConfig } from './firebaseConfig';

let firebaseApp: FirebaseApp | null = null;
let firestore: Firestore | null = null;

export function initializeFirebase(): void {
  if (firebaseApp) {
    return; 
  }

  try {
    firebaseApp = initializeApp(firebaseConfig);
    firestore = getFirestore(firebaseApp);
    console.log('Firebase initialized successfully');
  } catch (error) {
    console.error('Failed to initialize Firebase:', error);
    // Don't throw - allow app to continue without logging
  }
}

export function getFirestoreInstance(): Firestore | null {
  return firestore;
}

export function isFirebaseInitialized(): boolean {
  return firestore !== null;
}