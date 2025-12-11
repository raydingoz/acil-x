import { $, createEl } from './ui.js';
import { loadCasesData, findCaseById, getFeaturedCaseId } from './data.js';
import { FIREBASE_CONFIG, STORAGE_KEYS } from './config.js';
import {
  ensureSession,
  initFirestore,
  listenToParticipantScores,
  listenToSession,
  updateSessionState
} from './firestoreService.js';

const FLOW_TIMER_DURATION_MS = 3 * 60 * 1000;

let sessionId = null;
let sessionUnsubscribe = null;
let scoresUnsubscribe = null;
let hostSnapshot = null;
let timerInterval = null;
let qrInstance = null;
let qrLoadPromise = null;
let casesData = null;
let firebaseReady = false;

document.addEventListener('DOMContentLoaded', () => {
  setupSessionForm();
  bindHostButtons();

  loadCasesData()
    .then(data => {
      casesData = data;
      if (!hostSnapshot?.activeCaseId && data) {
        const featured = getFeaturedCaseId(data);
        if (featured) updateCaseSummary(featured);
      }
    })
    .catch(() => {
      setStatus('Vaka verisi yüklenemedi, özet kapalı.');
    });

  const configured = initFirestore(FIREBASE_CONFIG);
  firebaseReady = configured;
  if (!configured) {
    setStatus('Firebase yapılandırması bulunamadı, Firestore pasif.');
    toggleControls(true);
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const querySession = params.get('session');
  const savedSession = querySession || localStorage.getItem(STORAGE_KEYS.SESSION_ID) || 'demo-session';
  const input = $('#sessionIdInput');
  if (input && !input.value) input.value = savedSession;
  connectToSession(savedSession);
});

function setupSessionForm() {
  const connectBtn = $('#connectSessionBtn');
  const input = $('#sessionIdInput');
  if (!connectBtn || !input) return;

  connectBtn.addEventListener('click', () => {
    if (!input.value.trim()) {
      setStatus('Oturum kodu gerekli.');
      return;
    }
    connectToSession(input.value.trim());
  });
}

function bindHostButtons() {
  const mapping = {
    startCaseBtn: 'startCase',
    endCaseBtn: 'endCase',
    nextCaseBtn: 'nextCase',
    startTimerBtn: 'startTimer',
    stopTimerBtn: 'stopTimer'
  };

  Object.entries(mapping).forEach(([id, action]) => {
    const btn = $(`#${id}`);
    if (btn) btn.addEventListener('click', () => handleHostAction(action));
  });
}

async function connectToSession(targetSessionId) {
  if (!firebaseReady) {
    setStatus('Firestore devre dışı, oturum bağlanamadı.');
    return;
  }

  sessionId = targetSessionId;
  localStorage.setItem(STORAGE_KEYS.SESSION_ID, sessionId);
  await ensureSession(sessionId, { hostName: 'Dashboard' });

  if (sessionUnsubscribe) sessionUnsubscribe();
  sessionUnsubscribe = listenToSession(sessionId, snap => {
    hostSnapshot = snap;
    renderSessionStatus();
    updateRemainingTime();
  });

  if (scoresUnsubscribe) scoresUnsubscribe();
  scoresUnsubscribe = listenToParticipantScores(sessionId, renderScoreboard);

  startTimerTicker();
  setStatus('Firestore oturumuna bağlanıldı.');
  await renderStudentLink();
}

function renderScoreboard(scores) {
  const tbody = $('#scoreboardBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!scores || !scores.length) {
    const empty = createEl('tr');
    const td = createEl('td', { text: 'Henüz skor kaydı yok.', attrs: { colspan: 4 } });
    empty.appendChild(td);
    tbody.appendChild(empty);
    return;
  }

  scores
    .slice()
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .forEach((score, idx) => {
      const breakdown = score.scoreBreakdown || {};
      const speed = breakdown.speedBonus ?? score.speedBonus ?? 0;
      const penalty = breakdown.penaltyTotal ?? score.penaltyTotal ?? 0;
      const total = breakdown.total ?? score.score ?? 0;

      const tr = createEl('tr');
      const name = score.displayName || score.id || `#${idx + 1}`;

      [
        name,
        `+${speed}`,
        penalty,
        total
      ].forEach((val, cellIdx) => {
        const td = createEl('td', { text: val });
        if (cellIdx === 3) td.classList.add('score-cell');
        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    });
}

async function handleHostAction(action) {
  if (!sessionId) {
    setStatus('Önce bir oturuma bağlanın.');
    return;
  }

  const payload = { lastAction: action };
  if (action === 'startCase') {
    payload.status = 'running';
  } else if (action === 'endCase') {
    payload.status = 'completed';
  } else if (action === 'nextCase') {
    payload.status = 'pending';
    payload.activeCaseId = null;
  } else if (action === 'startTimer') {
    payload.timerRunning = true;
    payload.timerStartedAt = Date.now();
    payload.timerStoppedAt = null;
  } else if (action === 'stopTimer') {
    payload.timerRunning = false;
    payload.timerStoppedAt = Date.now();
  }

  await updateSessionState(sessionId, payload);
}

function renderSessionStatus() {
  const statusEl = $('#sessionStatus');
  if (!statusEl) return;
  if (!hostSnapshot) {
    statusEl.textContent = 'Oturum kaydı bulunamadı';
    return;
  }

  const parts = [`Durum: ${hostSnapshot.status || 'bilinmiyor'}`];
  if (hostSnapshot.activeCaseId) parts.push(`Aktif vaka: ${hostSnapshot.activeCaseId}`);
  if (hostSnapshot.timerRunning) parts.push('Süre çalışıyor');

  statusEl.textContent = parts.join(' | ');

  if (hostSnapshot.activeCaseId) {
    updateCaseSummary(hostSnapshot.activeCaseId);
  }
}

function startTimerTicker() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(updateRemainingTime, 1000);
  updateRemainingTime();
}

function updateRemainingTime() {
  const el = $('#remainingTime');
  if (!el) return;
  if (!hostSnapshot?.timerRunning || !hostSnapshot?.timerStartedAt) {
    el.textContent = '--:--';
    return;
  }
  const started = hostSnapshot.timerStartedAt;
  const stopped = hostSnapshot.timerStoppedAt;
  const now = Date.now();
  const elapsed = Math.max((stopped || now) - started, 0);
  const remaining = Math.max(FLOW_TIMER_DURATION_MS - elapsed, 0);
  const minutes = String(Math.floor(remaining / 60000)).padStart(2, '0');
  const seconds = String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0');
  el.textContent = `${minutes}:${seconds}`;
}

async function ensureQrLibrary() {
  if (typeof QRious !== 'undefined') return true;
  if (!qrLoadPromise) {
    qrLoadPromise = new Promise(resolve => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrious/4.0.2/qrious.min.js';
      script.async = true;
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.head.appendChild(script);
    });
  }
  return qrLoadPromise;
}

async function renderStudentLink() {
  const linkEl = $('#studentLink');
  const fieldEl = $('#studentLinkField');
  const copyBtn = $('#copyStudentLinkBtn');
  const statusEl = $('#qrStatus');
  if (!sessionId) return;
  const url = new URL(window.location.href);
  url.pathname = url.pathname.replace(/[^/]+$/, 'student.html');
  url.searchParams.set('session', sessionId);

  if (linkEl) {
    linkEl.href = url.toString();
    linkEl.textContent = 'Öğrenci Linkini Aç';
  }

  if (fieldEl) {
    fieldEl.value = url.toString();
  }

  if (copyBtn) {
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(url.toString());
        if (statusEl) statusEl.textContent = 'Bağlantı kopyalandı.';
      } catch (err) {
        if (statusEl) statusEl.textContent = 'Kopyalama başarısız, manuel kopyalayın.';
      }
    };
  }

  const canvas = $('#studentQr');
  if (!canvas) return;

  const hasLib = await ensureQrLibrary();
  if (!hasLib) {
    if (statusEl) statusEl.textContent = 'QR kütüphanesi yüklenemedi, bağlantı linkini kullanın.';
    setStatus('QR kütüphanesi yüklenemedi, bağlantı linkini kullanın.');
    return;
  }

  if (!qrInstance) {
    qrInstance = new QRious({ element: canvas, size: 220 });
  }
  qrInstance.set({ value: url.toString() });
  if (statusEl) statusEl.textContent = 'QR hazır. Öğrenciler link veya QR ile girebilir.';
}

function setStatus(text) {
  const el = $('#sessionStatus');
  if (el) el.textContent = text;
}

function toggleControls(disabled) {
  ['connectSessionBtn', 'startCaseBtn', 'endCaseBtn', 'nextCaseBtn', 'startTimerBtn', 'stopTimerBtn'].forEach(id => {
    const btn = $(`#${id}`);
    if (btn) btn.disabled = disabled;
  });
}

function updateCaseSummary(caseId) {
  const titleEl = $('#activeCaseTitle');
  const metaEl = $('#activeCaseMeta');
  const blurbEl = $('#activeCaseBlurb');
  if (!titleEl || !casesData?.cases) return;

  const found = findCaseById(casesData, caseId) || findCaseById(casesData, getFeaturedCaseId(casesData));
  if (!found) return;

  titleEl.textContent = `${found.id} – ${found.title}`;

  const metaParts = [];
  if (found.difficulty) metaParts.push(`Zorluk: ${found.difficulty}`);
  if (found.patient) {
    const p = found.patient;
    const txt = [
      p.age != null ? `${p.age}Y` : '',
      p.sex ? p.sex : '',
      p.setting ? `(${p.setting})` : '',
      p.triage ? `Triaj: ${p.triage}` : ''
    ].filter(Boolean).join(' ');
    if (txt) metaParts.push(txt);
  }
  metaEl.textContent = metaParts.join(' | ');
  blurbEl.textContent = found.paramedic || found.story || 'Kısa vaka özeti bekleniyor.';
}
