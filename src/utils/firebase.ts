import { initializeApp, FirebaseApp } from 'firebase/app';
import { getFirestore, Firestore } from 'firebase/firestore';
import { firebaseConfig } from './firebaseConfig';

let firebaseApp: FirebaseApp | null = null;
let firestore: Firestore | null = null;

/**
 * Initialize Firebase and Firestore
 * Safe to call multiple times (idempotent)
 */
export function initializeFirebase(): void {
  if (firebaseApp) {
    return; // Already initialized
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

/**
 * Get the Firestore instance
 * Returns null if Firebase is not initialized
 */
export function getFirestoreInstance(): Firestore | null {
  return firestore;
}

/**
 * Check if Firebase is initialized
 */
export function isFirebaseInitialized(): boolean {
  return firestore !== null;
}