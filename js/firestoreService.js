import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  addDoc,
  collection,
  doc,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

let firestore = null;
let initialized = false;

export function initFirestore(config) {
  if (!config) {
    console.warn('Firebase config bulunamadı; Firestore servisleri pasif.');
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
  const breakdown = participant.breakdown || {};
  const payload = {
    displayName: participant.name || 'Katılımcı',
    currentCaseId: participant.caseId || null,
    score: participant.score ?? 0,
    speedBonus: breakdown.speedBonus ?? participant.speedBonus ?? 0,
    penaltyTotal: breakdown.penaltyTotal ?? participant.penaltyTotal ?? 0,
    diagnosisScore: breakdown.diagnosisScore ?? participant.diagnosisScore ?? 0,
    baseScore: breakdown.base ?? participant.baseScore ?? null,
    elapsedMs: participant.elapsedMs ?? null,
    updatedAt: serverTimestamp()
  };

  if (Object.keys(breakdown).length) {
    payload.scoreBreakdown = breakdown;
  }

  await setDoc(participantRef, payload, { merge: true });
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

export async function pushSelection(sessionId, payload) {
  const db = requireFirestore();
  if (!db || !sessionId) return false;
  const selectionsRef = collection(doc(db, 'sessions', sessionId), 'selections');
  await addDoc(selectionsRef, {
    ...payload,
    createdAt: serverTimestamp()
  });
  return true;
}

export function listenToSelections(sessionId, callback) {
  const db = requireFirestore();
  if (!db || !sessionId) return () => {};
  const selectionsRef = collection(doc(db, 'sessions', sessionId), 'selections');
  const q = query(selectionsRef, orderBy('createdAt', 'desc'));
  return onSnapshot(q, snap => {
    const selections = [];
    snap.forEach(docSnap => selections.push({ id: docSnap.id, ...docSnap.data() }));
    callback(selections);
  });
}
