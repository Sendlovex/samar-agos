// Firebase web app configuration (Project settings → Your apps → SDK setup and configuration).
// These values identify the project; they are not secrets. Access is enforced by
// Firebase Authentication and the Firestore security rules in firestore.rules.
// Set apiKey to '' to run SAMAR-AGOS in offline demo mode (local data only).
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBZ7JDno3x_l-gNAKWv2yHw51_d3odkzOc',
  authDomain: 'samar-agos-ic9sb.firebaseapp.com',
  projectId: 'samar-agos-ic9sb',
  storageBucket: 'samar-agos-ic9sb.firebasestorage.app',
  messagingSenderId: '541185771911',
  appId: '1:541185771911:web:9ab188400e6277cae1eb22',
};

// Google Apps Script web app that emails residents about advisories (scripts/advisory-email).
// Opening it only asks the script to check for advisory changes now; set to '' to disable.
export const ADVISORY_EMAIL_URL = 'https://script.google.com/macros/s/AKfycbxbtn2pztasTKTBJZAEqftr0cnF1vwfrmfSOYyFpheR2VUUouUil5dYgLTORahi_B1J0w/exec';
