import { $, createEl } from './ui.js';
import { FIREBASE_CONFIG, STORAGE_KEYS } from './config.js';
import { ensureSession, initFirestore, listenToParticipantScores, listenToSession } from './firestoreService.js';

const FLOW_TIMER_DURATION_MS = 12 * 60 * 1000;

let sessionId = null;
let sessionUnsubscribe = null;
let scoresUnsubscribe = null;
let sessionSnapshot = null;
let timerInterval = null;

document.addEventListener('DOMContentLoaded', () => {
  bindConnect();

  const configured = initFirestore(FIREBASE_CONFIG);
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

function bindConnect() {
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

async function connectToSession(targetSessionId) {
  sessionId = targetSessionId;
  localStorage.setItem(STORAGE_KEYS.SESSION_ID, sessionId);
  await ensureSession(sessionId);

  if (sessionUnsubscribe) sessionUnsubscribe();
  sessionUnsubscribe = listenToSession(sessionId, snap => {
    sessionSnapshot = snap;
    renderSessionStatus();
    updateRemainingTime();
  });

  if (scoresUnsubscribe) scoresUnsubscribe();
  scoresUnsubscribe = listenToParticipantScores(sessionId, renderScoreboard);

  startTimerTicker();
  setStatus('Firestore oturumuna bağlanıldı.');
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

function renderSessionStatus() {
  const statusEl = $('#sessionStatus');
  if (!statusEl) return;
  if (!sessionSnapshot) {
    statusEl.textContent = 'Oturum kaydı bulunamadı';
    return;
  }

  const parts = [`Durum: ${sessionSnapshot.status || 'bilinmiyor'}`];
  if (sessionSnapshot.activeCaseId) parts.push(`Aktif vaka: ${sessionSnapshot.activeCaseId}`);
  if (sessionSnapshot.timerRunning) parts.push('Süre çalışıyor');

  statusEl.textContent = parts.join(' | ');
}

function startTimerTicker() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(updateRemainingTime, 1000);
  updateRemainingTime();
}

function updateRemainingTime() {
  const el = $('#remainingTime');
  if (!el) return;
  if (!sessionSnapshot?.timerRunning || !sessionSnapshot?.timerStartedAt) {
    el.textContent = '--:--';
    return;
  }
  const started = sessionSnapshot.timerStartedAt;
  const stopped = sessionSnapshot.timerStoppedAt;
  const now = Date.now();
  const elapsed = Math.max((stopped || now) - started, 0);
  const remaining = Math.max(FLOW_TIMER_DURATION_MS - elapsed, 0);
  const minutes = String(Math.floor(remaining / 60000)).padStart(2, '0');
  const seconds = String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0');
  el.textContent = `${minutes}:${seconds}`;
}

function setStatus(text) {
  const el = $('#sessionStatus');
  if (el) el.textContent = text;
}

function toggleControls(disabled) {
  const btn = $('#connectSessionBtn');
  if (btn) btn.disabled = disabled;
}
