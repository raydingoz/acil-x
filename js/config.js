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

const REQUIRED_KEYS = ['apiKey', 'authDomain', 'projectId', 'appId'];

function isValidConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return false;
  return REQUIRED_KEYS.every(key => Boolean(cfg[key]));
}

function resolveFirebaseConfig() {
  const globalConfig = typeof window !== 'undefined' ? window.FIREBASE_CONFIG : undefined;
  if (isValidConfig(globalConfig)) return globalConfig;
  if (isValidConfig(PLACEHOLDER_FIREBASE_CONFIG)) return PLACEHOLDER_FIREBASE_CONFIG;

  console.warn('Firebase config bulunamadı veya eksik; Firestore servisleri pasif.');
  return null;
}

export const FIREBASE_CONFIG = resolveFirebaseConfig();
