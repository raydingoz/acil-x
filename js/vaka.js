import { $, $all, createEl, formatTime, uuid } from './ui.js';
import {
  loadCasesData,
  getFeaturedCaseId,
  findCaseById,
  loadOrCreateUser,
  updateUserName,
  queryLLM,
  loadFlowDefaults
} from './data.js';
import { ScoreManager } from './scoring.js';
import { FIREBASE_CONFIG, STORAGE_KEYS } from './config.js';
import {
  ensureSession,
  initFirestore,
  listenToParticipantScores,
  listenToSession,
  listenToSelections,
  updateParticipantScore,
  updateSessionState,
  pushSelection
} from './firestoreService.js';

let casesData = null;
let currentCase = null;
let scoreManager = null;
let user = null;
let sessionId = null;
let sessionUnsubscribe = null;
let scoresUnsubscribe = null;
let hostState = null;
let selectionUnsubscribe = null;
let flowDefaults = null;
let flowHistory = [];
let timerInterval = null;

const FLOW_TIMER_DURATION_MS = 12 * 60 * 1000; // 12 dakikalık varsayılan süre

window.llmEnabled = false;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  user = loadOrCreateUser();
  initUserUI();

  flowDefaults = await loadFlowDefaults();

  casesData = await loadCasesData();
  populateCaseSelect(casesData);
  const featuredId = getFeaturedCaseId(casesData);
  const lastCaseId = localStorage.getItem(STORAGE_KEYS.LAST_CASE_ID);
  const startCaseId = lastCaseId || featuredId;
  loadCaseById(startCaseId);

  initTabs();
  initActions();
  initHostPanel();
  initFlowControls();
}

function initUserUI() {
  const nameInput = $('#userNameInput');
  const saveBtn = $('#saveUserNameBtn');
  nameInput.value = user.name || '';
  saveBtn.addEventListener('click', () => {
    const updated = updateUserName(nameInput.value.trim());
    user = updated;
  });
}

function populateCaseSelect(data) {
  const sel = $('#caseSelect');
  sel.innerHTML = '';
  if (!data?.cases) return;
  data.cases.forEach(c => {
    const opt = createEl('option', { text: `${c.id} – ${c.title}` });
    opt.value = c.id;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => {
    loadCaseById(sel.value);
  });
}

function loadCaseById(caseId) {
  currentCase = findCaseById(casesData, caseId);
  if (!currentCase && casesData?.cases?.length) {
    currentCase = casesData.cases[0];
  }
  if (!currentCase) return;

  localStorage.setItem(STORAGE_KEYS.LAST_CASE_ID, currentCase.id);

  $('#caseTitle').textContent = currentCase.title;
  const metaParts = [];
  if (currentCase.difficulty) metaParts.push(`Zorluk: ${currentCase.difficulty}`);
  if (currentCase.patient) {
    const p = currentCase.patient;
    const txt = [
      p.age != null ? `${p.age}Y` : '',
      p.sex ? p.sex : '',
      p.setting ? `(${p.setting})` : '',
      p.triage ? `Triaj: ${p.triage}` : ''
    ].filter(Boolean).join(' ');
    if (txt) metaParts.push(txt);
  }
  $('#caseMeta').textContent = metaParts.join(' | ');

  // Paramedik
  $('#paramedicText').textContent = currentCase.paramedic || 'Paramedik sunumu tanımlı değil.';

  // Hikaye
  $('#storyText').textContent = currentCase.story || 'Hikaye tanımlı değil.';

  // Muayene
  $('#examVitals').textContent = currentCase.exam?.vitals || 'Vital bulgular tanımlı değil.';
  $('#examPhysical').textContent = currentCase.exam?.physical || 'Fizik muayene bulguları tanımlı değil.';

  // Dropdownlar
  setupKeyedSelect($('#labSelect'), currentCase.labs);
  setupKeyedSelect($('#imagingSelect'), currentCase.imaging);
  setupKeyedSelect($('#procedureSelect'), currentCase.procedures);

  setupDrugsSelects(currentCase.drugs || []);

  // Konsültasyon
  const consultDiv = $('#consultList');
  consultDiv.innerHTML = '';
  if (Array.isArray(currentCase.consults) && currentCase.consults.length) {
    const ul = createEl('ul');
    currentCase.consults.forEach(c => {
      const li = createEl('li', { text: c });
      ul.appendChild(li);
    });
    consultDiv.appendChild(ul);
  } else {
    consultDiv.textContent = 'Tanımlı konsültasyon yok.';
  }

  // Disposition default
  $('#dispositionInput').value = '';
  $('#dispositionResultBox').textContent = currentCase.disposition || '';

  // Final tanı
  $('#diagnosisInput').value = '';
  $('#diagnosisResultBox').textContent = '';

  renderFlowOptions();
  updateFlowPlaceholder(null, null);

  // Skor
  scoreManager = new ScoreManager(user.id, currentCase.id, currentCase.scoring);
  scoreManager.startCaseTimer();
  updateScoreUI();
  clearLog();
  syncScoreToSession();
}

function setupKeyedSelect(selectEl, obj) {
  selectEl.innerHTML = '';
  if (!obj) {
    const opt = createEl('option', { text: 'Tanımlı seçenek yok', attrs: { value: '' } });
    selectEl.appendChild(opt);
    selectEl.disabled = true;
    return;
  }
  const keys = Object.keys(obj).filter(k => k !== 'default');
  if (!keys.length) {
    const opt = createEl('option', { text: 'Tanımlı seçenek yok', attrs: { value: '' } });
    selectEl.appendChild(opt);
    selectEl.disabled = true;
    return;
  }
  selectEl.disabled = false;
  keys.forEach(k => {
    const opt = createEl('option', { text: k });
    opt.value = k;
    selectEl.appendChild(opt);
  });
}

function setupDrugsSelects(drugs) {
  const drugSelect = $('#drugSelect');
  const doseSelect = $('#doseSelect');
  drugSelect.innerHTML = '';
  doseSelect.innerHTML = '';

  if (!Array.isArray(drugs) || !drugs.length) {
    const opt = createEl('option', { text: 'İlaç tanımlı değil', attrs: { value: '' } });
    drugSelect.appendChild(opt);
    drugSelect.disabled = true;
    doseSelect.disabled = true;
    return;
  }

  drugs.forEach((d, idx) => {
    const opt = createEl('option', { text: d.name || `İlaç ${idx + 1}` });
    opt.value = String(idx);
    drugSelect.appendChild(opt);
  });
  drugSelect.disabled = false;

  const updateDoses = () => {
    const idx = parseInt(drugSelect.value, 10);
    const drug = drugs[idx];
    doseSelect.innerHTML = '';
    if (!drug || !Array.isArray(drug.doses) || !drug.doses.length) {
      const opt = createEl('option', { text: 'Doz tanımlı değil', attrs: { value: '' } });
      doseSelect.appendChild(opt);
      doseSelect.disabled = true;
      return;
    }
    doseSelect.disabled = false;
    drug.doses.forEach((d, i) => {
      const opt = createEl('option', { text: d });
      opt.value = String(i);
      doseSelect.appendChild(opt);
    });
  };

  drugSelect.addEventListener('change', updateDoses);
  updateDoses();
}

function initTabs() {
  const buttons = $all('.tab-btn');
  const panels = $all('.tab-panel');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      buttons.forEach(b => b.classList.toggle('active', b === btn));
      panels.forEach(p => {
        p.classList.toggle('active', p.id === `tab-${tab}`);
      });
    });
  });
}

function initActions() {
  $('#requestLabBtn').addEventListener('click', () => handleKeyedAction('labs', 'lab', $('#labSelect'), $('#labResultBox')));
  $('#requestImagingBtn').addEventListener('click', () => handleKeyedAction('imaging', 'imaging', $('#imagingSelect'), $('#imagingResultBox')));
  $('#doProcedureBtn').addEventListener('click', () => handleKeyedAction('procedures', 'procedure', $('#procedureSelect'), $('#procedureResultBox')));

  $('#giveDrugBtn').addEventListener('click', handleDrugAction);

  $('#saveDispositionBtn').addEventListener('click', () => {
    const text = $('#dispositionInput').value.trim();
    $('#dispositionResultBox').textContent = text || 'Plan kaydedildi.';
    appendLog({
      section: 'disposition',
      actionType: 'set_disposition',
      key: null,
      result: text,
      scoreDelta: 0
    });
  });

  $('#submitDiagnosisBtn').addEventListener('click', handleDiagnosisSubmit);

  $('#llmToggle').addEventListener('change', e => {
    window.llmEnabled = e.target.checked;
  });

  $('#resetCaseBtn').addEventListener('click', () => {
    if (!currentCase || !scoreManager) return;
    scoreManager.reset();
    updateScoreUI();
    clearLog();
    $('#labResultBox').textContent = '';
    $('#imagingResultBox').textContent = '';
    $('#procedureResultBox').textContent = '';
    $('#drugResultBox').textContent = '';
    $('#dispositionResultBox').textContent = currentCase.disposition || '';
    $('#diagnosisInput').value = '';
    $('#diagnosisResultBox').textContent = '';
    syncScoreToSession();
  });
}

function initFlowControls() {
  $all('[data-step-submit]').forEach(btn => {
    btn.addEventListener('click', () => handleFlowSubmit(btn.dataset.stepSubmit));
  });
}

function renderFlowOptions() {
  const config = flowDefaults || {};
  const steps = ['anamnez', 'muayene', 'tetkik', 'tani'];
  steps.forEach(step => {
    const select = $(`#${step}Select`);
    const hint = $(`#${step}Hint`);
    if (!select) return;
    select.innerHTML = '';
    const defaults = config.flowOptions?.[step] || [];
    const caseSpecific = collectCaseSpecificOptions(step);
    const items = [...new Set([...defaults, ...caseSpecific])];
    if (!items.length) {
      const opt = createEl('option', { text: 'Seçenek bulunamadı', attrs: { value: '' } });
      select.appendChild(opt);
      select.disabled = true;
    } else {
      items.forEach(item => {
        const opt = createEl('option', { text: item, attrs: { value: item } });
        select.appendChild(opt);
      });
      select.disabled = false;
    }
    if (hint) {
      const report = config.flowPlaceholders?.[step]?.report || '';
      hint.textContent = report;
    }
  });
}

function collectCaseSpecificOptions(step) {
  if (!currentCase) return [];
  if (step === 'anamnez') return [currentCase.story || 'Anamnez kaydı'];
  if (step === 'muayene') return [currentCase.exam?.vitals, currentCase.exam?.physical].filter(Boolean);
  if (step === 'tetkik') {
    const labs = Object.keys(currentCase.labs || {}).filter(k => k !== 'default');
    const imaging = Object.keys(currentCase.imaging || {}).filter(k => k !== 'default');
    return [...labs, ...imaging];
  }
  if (step === 'tani') {
    const drugs = (currentCase.drugs || []).map(d => d.name).filter(Boolean);
    return [currentCase.final_diagnosis, ...drugs].filter(Boolean);
  }
  return [];
}

async function handleFlowSubmit(step) {
  const select = $(`#${step}Select`);
  if (!select) return;
  const choice = select.value;
  if (!choice) return;

  const entry = {
    id: uuid(),
    step,
    choice,
    caseId: currentCase?.id || null,
    userId: user?.id || null,
    userName: user?.name || 'Kullanıcı',
    createdAt: Date.now()
  };

  flowHistory = [entry, ...flowHistory].slice(0, 50);
  renderFlowHistory();
  updateFlowPlaceholder(step, choice);

  if (sessionId) {
    await pushSelection(sessionId, entry);
  }
}

function renderFlowHistory() {
  const list = $('#selectionHistory');
  if (!list) return;
  list.innerHTML = '';
  if (!flowHistory.length) {
    const empty = createEl('li', { text: 'Henüz seçim yapılmadı.' });
    list.appendChild(empty);
    return;
  }
  flowHistory.slice(0, 20).forEach(item => {
    const time = item.createdAt?.toDate ? item.createdAt.toDate() : item.createdAt;
    const timeText = formatTime(time || new Date());
    const li = createEl('li', {
      html: `<strong>${item.step}</strong> — ${item.choice} <span class="muted">${timeText}</span><br/><small>${item.userName || 'Katılımcı'}</small>`
    });
    list.appendChild(li);
  });
}

function updateFlowPlaceholder(step, choice) {
  const img = $('#flowPlaceholderImage');
  const text = $('#flowPlaceholderText');
  const report = $('#flowReportText');
  const placeholder = step ? flowDefaults?.flowPlaceholders?.[step] : null;

  if (img) {
    const source = placeholder?.image || flowDefaults?.flowPlaceholders?.anamnez?.image;
    img.src = source || '';
    img.alt = step ? `${step} placeholder` : 'Akış görseli';
  }
  if (text) {
    text.textContent = choice || 'Adımlardan birini seçerek ilerleyin.';
  }
  if (report) {
    report.textContent = placeholder?.report || 'Seçim raporu hazır olduğunda burada gösterilecek.';
  }
}

async function handleKeyedAction(fieldName, scoreType, selectEl, resultBox) {
  if (!currentCase || !scoreManager) return;
  const key = selectEl.value;
  if (!key) return;

  const source = currentCase[fieldName] || {};
  const staticResult = source[key] ?? source.default ?? 'Bu işlem için tanımlı yanıt yok.';
  const isUnnecessary = source[key] == null;

  // İlk LLM'ye sor, yoksa statik
  const llmAnswer = await queryLLM({
    userId: user.id,
    caseId: currentCase.id,
    section: fieldName,
    actionType: scoreType,
    key,
    state: {} // ileride genişletilebilir
  });

  const resultText = llmAnswer || staticResult;
  resultBox.textContent = resultText;

  const scoreDelta = scoreManager.applyPenalty(scoreType, { unnecessary: isUnnecessary });
  updateScoreUI();
  appendLog({
    section: fieldName,
    actionType: scoreType,
    key,
    result: resultText,
    scoreDelta
  });
  syncScoreToSession();
}

async function handleDrugAction() {
  if (!currentCase || !scoreManager) return;
  const drugs = currentCase.drugs || [];
  const drugIdx = parseInt($('#drugSelect').value, 10);
  const doseIdx = parseInt($('#doseSelect').value, 10);
  const drug = drugs[drugIdx];
  if (!drug) return;
  const doseText = drug.doses?.[doseIdx] ?? '';
  const staticResult = drug.response || 'Tedavi uygulandı.';

  const llmAnswer = await queryLLM({
    userId: user.id,
    caseId: currentCase.id,
    section: 'drugs',
    actionType: 'drug',
    key: drug.name,
    dose: doseText,
    state: {}
  });

  const resultText = llmAnswer || staticResult;
  $('#drugResultBox').textContent = `${drug.name} (${doseText}): ${resultText}`;

  // İlaç için şimdilik skor cezası uygulamıyoruz, istersen type ekleyebilirsin
  appendLog({
    section: 'drugs',
    actionType: 'drug',
    key: drug.name,
    result: resultText,
    scoreDelta: 0
  });
}

async function handleDiagnosisSubmit() {
  if (!currentCase || !scoreManager) return;
  const inputDx = $('#diagnosisInput').value.trim();
  if (!inputDx) return;

  const correctDx = (currentCase.final_diagnosis || '').trim();
  const isCorrect =
    inputDx.localeCompare(correctDx, 'tr-TR', { sensitivity: 'base' }) === 0;

  const { diagnosisDelta, speedDelta, total } = scoreManager.applyDiagnosis(isCorrect);
  updateScoreUI();

  let msg;
  if (isCorrect) {
    msg = `Doğru: ${correctDx}. Tanı bonusu +${diagnosisDelta} puan.`;
  } else {
    msg = `Beklenen tanı: ${correctDx}. Girilen: ${inputDx}.`;
  }
  if (speedDelta) {
    msg += ` Hız bonusu: +${speedDelta}.`;
  }
  $('#diagnosisResultBox').textContent = msg;

  appendLog({
    section: 'diagnosis',
    actionType: 'submit_diagnosis',
    key: null,
    result: msg,
    scoreDelta: total
  });
  syncScoreToSession();
}

function updateScoreUI() {
  $('#currentScore').textContent = scoreManager.currentScore;
  $('#bestScore').textContent = scoreManager.bestScore != null ? scoreManager.bestScore : '-';
}

function clearLog() {
  $('#logList').innerHTML = '';
}

function appendLog({ section, actionType, key, result, scoreDelta }) {
  const ul = $('#logList');
  const li = createEl('li');
  const timeEl = createEl('time', { text: formatTime(new Date()) });
  const main = createEl('div', {
    html: `<strong>${section}</strong> – ${actionType}${key ? ` (${key})` : ''}`
  });
  const res = createEl('div', {
    text: typeof result === 'string' ? result : JSON.stringify(result),
    className: 'log-result'
  });
  const scoreTxt =
    scoreDelta === 0
      ? ''
      : scoreDelta > 0
      ? `Skor +${scoreDelta}`
      : `Skor ${scoreDelta}`;
  const scoreEl = createEl('div', {
    text: scoreTxt,
    className: 'log-score'
  });

  li.appendChild(timeEl);
  li.appendChild(main);
  li.appendChild(res);
  if (scoreTxt) li.appendChild(scoreEl);
  ul.prepend(li);
}

async function syncScoreToSession() {
  if (!sessionId || !scoreManager) return;
  await updateParticipantScore(sessionId, {
    id: user.id,
    name: user.name,
    caseId: currentCase?.id,
    score: scoreManager.currentScore
  });
}

function initHostPanel() {
  const sessionInput = $('#sessionIdInput');
  if (!sessionInput) return;
  const savedSession = localStorage.getItem(STORAGE_KEYS.SESSION_ID) || '';
  sessionInput.value = savedSession || 'demo-session';

  $('#connectSessionBtn').addEventListener('click', () => connectToSession(sessionInput.value.trim()));
  $('#startCaseBtn').addEventListener('click', () => handleHostAction('startCase'));
  $('#endCaseBtn').addEventListener('click', () => handleHostAction('endCase'));
  $('#nextCaseBtn').addEventListener('click', () => handleHostAction('nextCase'));
  $('#startTimerBtn').addEventListener('click', () => handleHostAction('startTimer'));
  $('#stopTimerBtn').addEventListener('click', () => handleHostAction('stopTimer'));

  const configured = initFirestore(window?.FIREBASE_CONFIG || null);
  if (!configured) {
    updateSessionStatus('Firebase yapılandırması yapılmadı; host paneli pasif.');
    return;
  }
  if (sessionInput.value) {
    connectToSession(sessionInput.value.trim());
  }
}

async function connectToSession(targetSessionId) {
  if (!targetSessionId) {
    updateSessionStatus('Oturum kodu gerekli.');
    return;
  }

  const configured = initFirestore(window?.FIREBASE_CONFIG || null);
  if (!configured) {
    updateSessionStatus('Firebase yapılandırması bulunamadı.');
    return;
  }

  sessionId = targetSessionId;
  localStorage.setItem(STORAGE_KEYS.SESSION_ID, sessionId);
  await ensureSession(sessionId, { hostName: user?.name || 'Host' });

  if (sessionUnsubscribe) sessionUnsubscribe();
  sessionUnsubscribe = listenToSession(sessionId, updateHostStatus);

  if (scoresUnsubscribe) scoresUnsubscribe();
  scoresUnsubscribe = listenToParticipantScores(sessionId, renderParticipantScores);

  if (selectionUnsubscribe) selectionUnsubscribe();
  selectionUnsubscribe = listenToSelections(sessionId, syncSelectionHistory);

  startTimerTicker();

  updateSessionStatus('Firestore oturumuna bağlanıldı.');
  syncScoreToSession();
}

function updateHostStatus(snapshot) {
  hostState = snapshot;
  if (!snapshot) {
    updateSessionStatus('Oturum kaydı bulunamadı.');
    return;
  }
  const parts = [`Durum: ${snapshot.status || 'bilinmiyor'}`];
  if (snapshot.activeCaseId) parts.push(`Aktif vaka: ${snapshot.activeCaseId}`);
  if (snapshot.timerRunning) parts.push('Süre çalışıyor');
  updateSessionStatus(parts.join(' | '));
  updateRemainingTime();
}

function renderParticipantScores(scores) {
  const container = $('#participantScores');
  if (!container) return;
  container.innerHTML = '';
  if (!scores || !scores.length) {
    container.textContent = 'Henüz katılımcı skoru yok.';
    return;
  }
  const ul = createEl('ul', { className: 'participant-score-list' });
  scores
    .slice()
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .forEach(s => {
      const li = createEl('li', {
        html: `<strong>${s.displayName || s.id}</strong> – ${s.score ?? 0} puan` +
          (s.currentCaseId ? ` (${s.currentCaseId})` : '')
      });
      ul.appendChild(li);
    });
  container.appendChild(ul);
}

async function handleHostAction(action) {
  if (!sessionId) {
    updateSessionStatus('Önce bir oturuma bağlanın.');
    return;
  }
  const payload = { lastAction: action };
  if (action === 'startCase') {
    payload.status = 'running';
    payload.activeCaseId = currentCase?.id ?? null;
  } else if (action === 'endCase') {
    payload.status = 'completed';
    payload.activeCaseId = currentCase?.id ?? null;
  } else if (action === 'nextCase') {
    const nextCase = findNextCase();
    if (nextCase) {
      loadCaseById(nextCase.id);
      payload.activeCaseId = nextCase.id;
    }
    payload.status = 'pending';
  } else if (action === 'startTimer') {
    payload.timerRunning = true;
    payload.timerStartedAt = Date.now();
  } else if (action === 'stopTimer') {
    payload.timerRunning = false;
    payload.timerStoppedAt = Date.now();
  }
  await updateSessionState(sessionId, payload);
}

function updateSessionStatus(text) {
  const statusEl = $('#sessionStatus');
  if (statusEl) {
    statusEl.textContent = text;
  }
}

function findNextCase() {
  if (!casesData?.cases?.length || !currentCase) return null;
  const idx = casesData.cases.findIndex(c => c.id === currentCase.id);
  const nextIdx = idx >= 0 && idx < casesData.cases.length - 1 ? idx + 1 : 0;
  return casesData.cases[nextIdx];
}

function syncSelectionHistory(items) {
  flowHistory = (items || []).map(item => ({
    ...item,
    createdAt: item.createdAt || Date.now()
  }));
  renderFlowHistory();
  if (flowHistory[0]) {
    updateFlowPlaceholder(flowHistory[0].step, flowHistory[0].choice);
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
  if (!hostState?.timerRunning || !hostState?.timerStartedAt) {
    el.textContent = '--:--';
    return;
  }
  const started = hostState.timerStartedAt;
  const stopped = hostState.timerStoppedAt;
  const now = Date.now();
  const elapsed = Math.max((stopped || now) - started, 0);
  const remaining = Math.max(FLOW_TIMER_DURATION_MS - elapsed, 0);
  const minutes = String(Math.floor(remaining / 60000)).padStart(2, '0');
  const seconds = String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0');
  el.textContent = `${minutes}:${seconds}`;
}
