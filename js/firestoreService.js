import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  addDoc,
  collection,
  doc,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  deleteDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const REQUIRED_KEYS = ['apiKey', 'authDomain', 'projectId', 'appId'];

let firestore = null;
let initialized = false;
let debugEnabled = false;

function logDebug(message, meta) {
  if (!debugEnabled) return;
  if (meta) {
    console.debug(`[firestore][debug] ${message}`, meta);
  } else {
    console.debug(`[firestore][debug] ${message}`);
  }
}

function validateFirebaseConfig(config) {
  if (!config || typeof config !== 'object') {
    return { ok: false, error: 'Firebase config nesnesi sağlanmadı.' };
  }
  const missing = REQUIRED_KEYS.filter(key => !config[key]);
  if (missing.length) {
    return { ok: false, error: `Eksik Firebase alanları: ${missing.join(', ')}` };
  }
  return { ok: true };
}

export function initFirestore(config, options = {}) {
  debugEnabled = Boolean(options.debug);

  const validation = validateFirebaseConfig(config);
  if (!validation.ok) {
    console.warn(validation.error);
    return { ready: false, error: validation.error };
  }

  if (!initialized) {
    try {
      if (!getApps().length) {
        initializeApp(config);
        logDebug('Firebase app initialize edildi.', { projectId: config.projectId });
      }
      firestore = getFirestore();
      initialized = true;
      logDebug('Firestore referansı alındı.');
    } catch (err) {
      console.error('Firestore başlatma hatası:', err);
      return { ready: false, error: `Firebase başlatılamadı: ${err?.message || err}` };
    }
  } else {
    logDebug('Mevcut Firestore örneği yeniden kullanılıyor.');
  }

  return { ready: true };
}

function requireFirestore(context = 'işlem') {
  if (!initialized || !firestore) {
    const msg = `Firestore henüz yapılandırılmadı (${context}).`;
    console.warn(msg);
    logDebug(msg);
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
  if (!ref) {
    logDebug('ensureSession atlandı, geçersiz sessionId.', { sessionId });
    return false;
  }

  const data = { updatedAt: serverTimestamp() };
  Object.entries(payload).forEach(([key, value]) => {
    if (value !== undefined) {
      data[key] = value;
    }
  });

  await setDoc(ref, data, { merge: true });
  logDebug('Oturum kaydı güncellendi/oluşturuldu.', { sessionId, payloadKeys: Object.keys(data) });
  return true;
}

export async function updateSessionState(sessionId, state) {
  const ref = sessionDoc(sessionId);
  if (!ref) {
    logDebug('updateSessionState başarısız, oturum referansı yok.', { sessionId });
    return false;
  }
  await updateDoc(ref, { ...state, updatedAt: serverTimestamp() });
  logDebug('Oturum durumu güncellendi.', { sessionId, stateKeys: Object.keys(state) });
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
  const db = requireFirestore('katılımcı skoru');
  if (!db || !sessionId || !participant?.id) {
    logDebug('updateParticipantScore atlandı.', { sessionId, participantId: participant?.id });
    return false;
  }
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
  const db = requireFirestore('skor dinleyicisi');
  if (!db || !sessionId) return () => {};
  const scoresRef = collection(doc(db, 'sessions', sessionId), 'participants');
  return onSnapshot(scoresRef, snap => {
    const scores = [];
    snap.forEach(docSnap => scores.push({ id: docSnap.id, ...docSnap.data() }));
    callback(scores);
  });
}

export async function pushSelection(sessionId, payload) {
  const db = requireFirestore('seçim kaydı');
  if (!db || !sessionId) return false;
  const selectionsRef = collection(doc(db, 'sessions', sessionId), 'selections');
  await addDoc(selectionsRef, {
    ...payload,
    createdAt: serverTimestamp()
  });
  return true;
}

export function listenToSelections(sessionId, callback) {
  const db = requireFirestore('seçim dinleyicisi');
  if (!db || !sessionId) return () => {};
  const selectionsRef = collection(doc(db, 'sessions', sessionId), 'selections');
  const q = query(selectionsRef, orderBy('createdAt', 'desc'));
  return onSnapshot(q, snap => {
    const selections = [];
    snap.forEach(docSnap => selections.push({ id: docSnap.id, ...docSnap.data() }));
    callback(selections);
  });
}

export async function deleteSession(sessionId) {
  const db = requireFirestore('oturum silme');
  if (!db || !sessionId) return false;
  await deleteDoc(doc(db, 'sessions', sessionId));
  return true;
}

export async function resetSessionData(sessionId) {
  const db = requireFirestore('oturum sıfırlama');
  if (!db || !sessionId) return false;
  const sessionRef = doc(db, 'sessions', sessionId);

  // participants alt koleksiyonunu temizle
  const participantsRef = collection(sessionRef, 'participants');
  const participantsSnap = await getDocs(participantsRef);
  const deletions = participantsSnap.docs.map(d => deleteDoc(d.ref));

  // selections alt koleksiyonunu isteğe bağlı temizle
  const selectionsRef = collection(sessionRef, 'selections');
  const selectionsSnap = await getDocs(selectionsRef);
  deletions.push(...selectionsSnap.docs.map(d => deleteDoc(d.ref)));

  await Promise.all(deletions);
  return true;
}
