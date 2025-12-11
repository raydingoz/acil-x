import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  collection,
  doc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

let firestore = null;
let initialized = false;
const REQUIRED_CONFIG_KEYS = ['apiKey', 'authDomain', 'projectId', 'appId'];

function hasValidConfig(config) {
  return (
    !!config &&
    REQUIRED_CONFIG_KEYS.every(key => typeof config[key] === 'string' && config[key].trim().length > 0)
  );
}

export function initFirestore(config) {
  if (!hasValidConfig(config)) {
    console.warn('Firebase config bulunamadı veya eksik; Firestore servisleri pasif.');
    return false;
  }
  if (!initialized) {
    if (!getApps().length) {
      initializeApp(config);
    }
    firestore = getFirestore();
    initialized = true;
  }
  return true;
}

function requireFirestore() {
  if (!initialized || !firestore) {
    console.warn('Firestore henüz yapılandırılmadı.');
    return null;
  }
  return firestore;
}

function sessionDoc(sessionId) {
  const db = requireFirestore();
  if (!db || !sessionId) return null;
  return doc(db, 'sessions', sessionId);
}

export async function ensureSession(sessionId, payload = {}) {
  const ref = sessionDoc(sessionId);
  if (!ref) return false;
  await setDoc(
    ref,
    {
      activeCaseId: null,
      status: 'idle',
      timerRunning: false,
      ...payload,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
  return true;
}

export async function updateSessionState(sessionId, state) {
  const ref = sessionDoc(sessionId);
  if (!ref) return false;
  await updateDoc(ref, { ...state, updatedAt: serverTimestamp() });
  return true;
}

export function listenToSession(sessionId, callback) {
  const ref = sessionDoc(sessionId);
  if (!ref) return () => {};
  return onSnapshot(ref, snap => {
    if (!snap.exists()) {
      callback(null);
      return;
    }
    callback({ id: snap.id, ...snap.data() });
  });
}

export async function updateParticipantScore(sessionId, participant) {
  const db = requireFirestore();
  if (!db || !sessionId || !participant?.id) return false;
  const participantRef = doc(collection(doc(db, 'sessions', sessionId), 'participants'), participant.id);
  await setDoc(
    participantRef,
    {
      displayName: participant.name || 'Katılımcı',
      currentCaseId: participant.caseId || null,
      score: participant.score ?? 0,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
  return true;
}

export function listenToParticipantScores(sessionId, callback) {
  const db = requireFirestore();
  if (!db || !sessionId) return () => {};
  const scoresRef = collection(doc(db, 'sessions', sessionId), 'participants');
  return onSnapshot(scoresRef, snap => {
    const scores = [];
    snap.forEach(docSnap => scores.push({ id: docSnap.id, ...docSnap.data() }));
    callback(scores);
  });
}
