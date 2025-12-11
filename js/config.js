export const CASES_URL = 'data/cases.json';

export const STORAGE_KEYS = {
  USER: 'vaka:user',
  LAST_CASE_ID: 'vaka:lastCaseId',
  SCORES: 'vaka:scores',
  LAST_CASES_JSON: 'vaka:lastCasesJson',
  SESSION_ID: 'vaka:sessionId'
};

export const LLM_ENDPOINT = '/api/llm'; // Şimdilik placeholder

// Firebase yapılandırmasını buradan ya da window.FIREBASE_CONFIG ile sağlayın.
// Boş değerler otomatik olarak geçersiz sayılır ve Firestore entegrasyonu pasif kalır.
const PLACEHOLDER_FIREBASE_CONFIG = {
    apiKey: "AIzaSyAk81XcXVGHtQ9Uwwn2VJPEMsnppMiZxpc",
    authDomain: "acil-x.firebaseapp.com",
    projectId: "acil-x",
    storageBucket: "acil-x.firebasestorage.app",
    messagingSenderId: "491316574624",
    appId: "1:491316574624:web:a62c2c8f8ccf6aefba0cc5",
    measurementId: "G-46V1GZQKYN"
};

export const FIREBASE_CONFIG = window?.FIREBASE_CONFIG || PLACEHOLDER_FIREBASE_CONFIG;
