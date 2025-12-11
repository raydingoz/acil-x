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
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: ''
};

export const FIREBASE_CONFIG = window?.FIREBASE_CONFIG || PLACEHOLDER_FIREBASE_CONFIG;
