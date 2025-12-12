export const CASE_FILES = ['data/case-1.json', 'data/case-2.json'];
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

function missingKeys(cfg) {
  if (!cfg || typeof cfg !== 'object') return REQUIRED_KEYS;
  return REQUIRED_KEYS.filter(key => !cfg[key]);
}

function isValidConfig(cfg) {
  return missingKeys(cfg).length === 0;
}

function detectFirebaseDebug() {
  if (typeof window === 'undefined') return false;
  if (window.FIREBASE_DEBUG === true) return true;
  const params = new URLSearchParams(window.location.search);
  const flag = params.get('firebaseDebug') || params.get('debug');
  return flag === '1' || flag === 'true';
}

function resolveFirebaseConfig() {
  const issues = [];
  const globalConfig = typeof window !== 'undefined' ? window.FIREBASE_CONFIG : undefined;

  if (globalConfig) {
    const missing = missingKeys(globalConfig);
    if (missing.length === 0) {
      return { config: globalConfig, source: 'window.FIREBASE_CONFIG', issues };
    }
    issues.push(`window.FIREBASE_CONFIG eksik alanlar: ${missing.join(', ')}`);
  }

  if (isValidConfig(PLACEHOLDER_FIREBASE_CONFIG)) {
    return { config: PLACEHOLDER_FIREBASE_CONFIG, source: 'PLACEHOLDER_FIREBASE_CONFIG', issues };
  }

  issues.push('Geçerli Firebase yapılandırması bulunamadı; Firestore servisleri pasif.');
  console.warn(issues[issues.length - 1]);
  return { config: null, source: 'none', issues };
}

const RESOLVED = resolveFirebaseConfig();
export const FIREBASE_CONFIG = RESOLVED.config;
export const FIREBASE_CONFIG_SOURCE = RESOLVED.source;
export const FIREBASE_CONFIG_ISSUES = RESOLVED.issues;
export const FIREBASE_DEBUG = detectFirebaseDebug();
