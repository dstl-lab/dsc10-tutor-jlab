/**
 * Firebase configuration for autograder event logging
 * 
 * IMPORTANT: Replace the values below with your actual Firebase config
 * from the Firebase Console.
 */
export const firebaseConfig = {
    apiKey: "AIzaSyDiLkU2-9MaN6JHTACiBWFTUdznMtg3VPE",
    authDomain: "dsc10-tutor-jlab.firebaseapp.com",
    projectId: "dsc10-tutor-jlab",
    storageBucket: "dsc10-tutor-jlab.firebasestorage.app",
    messagingSenderId: "149959300808",
    appId: "1:149959300808:web:8127e977f4a200626ff7fd",
    measurementId: "G-N67KK7RNX8"
  };
  
  /**
   * Initialize Firebase (call this once at app startup)
   */
  export function getFirebaseConfig() {
    return firebaseConfig;
  }