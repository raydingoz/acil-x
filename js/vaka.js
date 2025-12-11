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
import { FIREBASE_CONFIG, FIREBASE_CONFIG_ISSUES, FIREBASE_CONFIG_SOURCE, FIREBASE_DEBUG, STORAGE_KEYS } from './config.js';
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
let simulatedMinutes = 0;
const selectionState = {
  anamnezMuayene: [],
  istekler: [],
  sonuclar: []
};
const requestQueue = [];
const animatedResultIds = new Set();

const WAIT_TIME_BY_SECTION = {
  labs: 20,
  imaging: 30,
  procedures: 10
};

const SCENARIO_RULES = [
  {
    id: 'hemorrhage_ct_delay',
    status: 'kötüleşti',
    message:
      'Kanama kontrolü yapılmadı ve BT beklerken gecikme yaşandı; hastanın kan basıncı düşüyor.',
    predicate: () => {
      const hasBleeding = selectionState.anamnezMuayene.some(item =>
        (item.choice || '').toLowerCase().includes('kanama')
      );
      const bandajYapildi = selectionState.istekler.some(
        item => item.section === 'procedures' && (item.key || '').toLowerCase().includes('bandaj')
      );
      const ctDelayed = requestQueue.some(
        item =>
          item.section === 'imaging' &&
          (item.key || '').toLowerCase().includes('bt') &&
          item.waitedMinutes >= 30
      );
      return hasBleeding && !bandajYapildi && ctDelayed;
    }
  },
  {
    id: 'aby_only_biochem',
    status: 'kötüleşti',
    message: 'ABY vakasında sadece biyokimya istendi; 1 saat içinde pH düşüyor.',
    predicate: () => {
      const hasABY = selectionState.anamnezMuayene.some(item =>
        (item.choice || '').toLowerCase().includes('aby')
      );
      const labEntries = requestQueue.filter(item => item.section === 'labs');
      if (!labEntries.length) return false;
      const onlyBiochem = labEntries.every(item => (item.key || '').toLowerCase().includes('biyokimya'));
      return hasABY && onlyBiochem && simulatedMinutes >= 60;
    }
  }
];

const FLOW_TIMER_DURATION_MS = 3 * 60 * 1000; // 3 dakikalık varsayılan süre

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
  initStudentModal();
  initMicroInteractions();
  renderSelectionLists();
  renderRequestQueue();
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

  resetSelectionState();
  resetRequestQueue();

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

  $('#showResultsBtn').addEventListener('click', handleShowResults);

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
    resetSelectionState();
    resetRequestQueue();
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

  if (['anamnez', 'muayene'].includes(step)) {
    recordAnamnezMuayene(step, choice);
    if (step === 'muayene') {
      showExamAlert(choice);
    }
  }

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
  if (['labs', 'imaging'].includes(fieldName)) {
    enqueueRequest(fieldName, key);
    recordRequestAndResult(fieldName, key, resultText);
    showRequestModal(fieldName, key, resultText);
  } else if (fieldName === 'procedures') {
    enqueueRequest(fieldName, key);
    recordRequestAndResult(fieldName, key, resultText);
  }
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
  const breakdown = scoreManager.getBreakdown();
  await updateParticipantScore(sessionId, {
    id: user.id,
    name: user.name,
    caseId: currentCase?.id,
    score: breakdown.total,
    breakdown,
    elapsedMs: scoreManager.getElapsedMs()
  });
}

function initHostPanel() {
  const sessionInput = $('#sessionIdInput');
  const connectBtn = $('#connectSessionBtn');
  if (!sessionInput || !connectBtn) return;
  const savedSession = localStorage.getItem(STORAGE_KEYS.SESSION_ID) || '';
  sessionInput.value = savedSession || 'demo-session';

  connectBtn.addEventListener('click', () => connectToSession(sessionInput.value.trim()));
  const startBtn = $('#startCaseBtn');
  if (startBtn) startBtn.addEventListener('click', () => handleHostAction('startCase'));
  const endBtn = $('#endCaseBtn');
  if (endBtn) endBtn.addEventListener('click', () => handleHostAction('endCase'));
  const nextBtn = $('#nextCaseBtn');
  if (nextBtn) nextBtn.addEventListener('click', () => handleHostAction('nextCase'));
  const startTimerBtn = $('#startTimerBtn');
  if (startTimerBtn) startTimerBtn.addEventListener('click', () => handleHostAction('startTimer'));
  const stopTimerBtn = $('#stopTimerBtn');
  if (stopTimerBtn) stopTimerBtn.addEventListener('click', () => handleHostAction('stopTimer'));

  const configured = initFirestore(FIREBASE_CONFIG, { debug: FIREBASE_DEBUG, source: FIREBASE_CONFIG_SOURCE });
  if (!configured.ready) {
    const reasons = [configured.error || 'Firebase yapılandırması yapılmadı; host paneli pasif.'];
    if (FIREBASE_DEBUG && FIREBASE_CONFIG_ISSUES.length) reasons.push(FIREBASE_CONFIG_ISSUES.join(' | '));
    updateSessionStatus(reasons.join(' '));
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

  const configured = initFirestore(FIREBASE_CONFIG, { debug: FIREBASE_DEBUG, source: FIREBASE_CONFIG_SOURCE });
  if (!configured.ready) {
    const reasons = [configured.error || 'Firebase yapılandırması bulunamadı.'];
    if (FIREBASE_DEBUG && FIREBASE_CONFIG_ISSUES.length) reasons.push(FIREBASE_CONFIG_ISSUES.join(' | '));
    updateSessionStatus(reasons.join(' '));
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
  updateCaseStatusBadge(snapshot);
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
    payload.timerStoppedAt = null;
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
  const targets = ['#remainingTime', '#remainingTimeFlow', '#remainingTimeTop']
    .map(sel => $(sel))
    .filter(Boolean);
  if (!targets.length) return;
  if (!hostState?.timerRunning || !hostState?.timerStartedAt) {
    targets.forEach(el => (el.textContent = '--:--'));
    return;
  }
  const started = hostState.timerStartedAt;
  const stopped = hostState.timerStoppedAt;
  const now = Date.now();
  const elapsed = Math.max((stopped || now) - started, 0);
  const remaining = Math.max(FLOW_TIMER_DURATION_MS - elapsed, 0);
  const minutes = String(Math.floor(remaining / 60000)).padStart(2, '0');
  const seconds = String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0');
  targets.forEach(el => (el.textContent = `${minutes}:${seconds}`));
}

function updateCaseStatusBadge(snapshot) {
  const badge = $('#caseStatusBadge');
  if (!badge) return;
  const status = snapshot?.status || 'beklemede';
  const active = snapshot?.activeCaseId ? ` · ${snapshot.activeCaseId}` : '';
  badge.textContent = `${status}${active}`;
  const live = ['active', 'running', 'started'].includes(status);
  badge.classList.toggle('status-live', live);
}

function initMicroInteractions() {
  $all('[data-trigger-alert]').forEach(btn => {
    btn.addEventListener('click', () => {
      const message = btn.dataset.triggerAlert || 'Bilgilendirme gönderildi.';
      alert(message);
    });
  });

  const overlay = $('#modalOverlay');
  const defaultModal = overlay?.querySelector('.modal-card');
  const closeModal = () => {
    if (overlay) overlay.classList.remove('open');
  };
  const openModal = target => {
    if (!overlay) return;
    const modal = typeof target === 'string' ? document.querySelector(target) : target || defaultModal;
    if (!modal) return;
    overlay.classList.add('open');
    modal.focus?.();
  };

  $all('[data-open-modal]').forEach(btn => {
    btn.addEventListener('click', evt => {
      evt.preventDefault();
      openModal(btn.dataset.openModal);
    });
  });

  $all('[data-close-modal]').forEach(btn => btn.addEventListener('click', closeModal));

  if (overlay) {
    overlay.addEventListener('click', evt => {
      if (evt.target === overlay) closeModal();
    });
  }

  document.addEventListener('keydown', evt => {
    if (evt.key === 'Escape') closeModal();
  });
}

function recordAnamnezMuayene(step, choice) {
  const entry = {
    id: uuid(),
    step,
    choice,
    createdAt: Date.now()
  };
  selectionState.anamnezMuayene = [entry, ...selectionState.anamnezMuayene].slice(0, 30);
  renderSelectionLists();
}

function recordRequestAndResult(section, key, result) {
  const base = { id: uuid(), section, key, createdAt: Date.now() };
  selectionState.istekler = [base, ...selectionState.istekler].slice(0, 30);
  selectionState.sonuclar = [{ ...base, result }, ...selectionState.sonuclar].slice(0, 30);
  renderSelectionLists({ animateResults: true });
}

function enqueueRequest(section, key) {
  const entry = {
    id: uuid(),
    section,
    key,
    requestedAt: Date.now(),
    waitedMinutes: 0,
    targetWait: WAIT_TIME_BY_SECTION[section] || 15
  };
  requestQueue.unshift(entry);
  renderRequestQueue();
}

function resetSelectionState() {
  selectionState.anamnezMuayene = [];
  selectionState.istekler = [];
  selectionState.sonuclar = [];
  animatedResultIds.clear();
  renderSelectionLists();
}

function resetRequestQueue() {
  requestQueue.length = 0;
  simulatedMinutes = 0;
  renderRequestQueue();
  updateCaseStatusLocal('stabil');
}

function formatTimestamp(value) {
  const date = value?.toDate ? value.toDate() : new Date(value);
  return date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildListTemplate(items, renderItem, emptyText = 'Henüz kayıt yok.') {
  if (!items.length) return `<li class="muted">${escapeHtml(emptyText)}</li>`;
  return items.map(renderItem).join('');
}

function renderSelectionLists(options = {}) {
  const { animateResults = false } = options;
  const anamnezList = $('#anamnezMuayeneList');
  const istekList = $('#istekList');
  const sonucList = $('#sonucList');
  if (!anamnezList || !istekList || !sonucList) return;

  anamnezList.innerHTML = buildListTemplate(
    selectionState.anamnezMuayene,
    item =>
      `<li><div class="pill-text"><span>${escapeHtml(item.step)}: ${escapeHtml(
        item.choice
      )}</span></div><span class="pill-meta">${formatTimestamp(item.createdAt)}</span></li>`,
    'Henüz kayıt yok.'
  );

  istekList.innerHTML = buildListTemplate(
    selectionState.istekler,
    item =>
      `<li><span>${escapeHtml(formatSection(item.section))} · ${escapeHtml(
        item.key
      )}</span><span class="pill-meta">${formatTimestamp(item.createdAt)}</span></li>`,
    'Henüz kayıt yok.'
  );

  renderResultsList(selectionState.sonuclar, sonucList, { animateResults });
}

function renderResultsList(items, listEl, { animateResults }) {
  listEl.innerHTML = buildListTemplate(
    items,
    item => {
      const summary = item.result || 'Sonuç kaydedildi.';
      return `<li data-entry-id="${item.id}"><div class="pill-text"><span>${escapeHtml(
        formatSection(item.section)
      )} · ${escapeHtml(item.key || '')}</span><span class="pill-meta" data-result-text data-full="${escapeHtml(
        summary
      )}">${escapeHtml(summary)}</span></div><span class="pill-meta">${formatTimestamp(
        item.createdAt
      )}</span></li>`;
    },
    'Henüz sonuç yok.'
  );

  if (animateResults) {
    animateResultText(listEl);
  } else {
    listEl.querySelectorAll('[data-entry-id]').forEach(item => animatedResultIds.add(item.dataset.entryId));
  }
}

async function animateResultText(listEl) {
  const fastShow = $('#fastShowToggle')?.checked;
  const entries = Array.from(listEl.querySelectorAll('[data-entry-id]'));
  for (const entry of entries) {
    const id = entry.dataset.entryId;
    const textEl = entry.querySelector('[data-result-text]');
    if (!id || !textEl) continue;
    const fullText = textEl.dataset.full || textEl.textContent || '';
    if (fastShow) {
      animatedResultIds.add(id);
      textEl.textContent = fullText;
      continue;
    }
    if (animatedResultIds.has(id)) continue;
    animatedResultIds.add(id);
    textEl.textContent = '';
    for (const ch of fullText) {
      textEl.textContent += ch;
      await sleep(18);
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function renderRequestQueue() {
  const list = $('#requestQueueList');
  if (!list) return;
  list.innerHTML = '';
  if (!requestQueue.length) {
    list.appendChild(createEl('li', { text: 'Kuyrukta istek yok.' }));
    return;
  }
  requestQueue
    .slice(0, 20)
    .forEach(item => {
      const meta = createEl('span', { text: `${item.waitedMinutes} dk`, className: 'pill-meta' });
      const label = createEl('span', {
        text: `${formatSection(item.section)} · ${item.key}`
      });
      const li = createEl('li');
      li.appendChild(label);
      li.appendChild(meta);
      list.appendChild(li);
    });
}

function showExamAlert(choice) {
  const message = `Muayene seçimin kaydedildi: ${choice}`;
  alert(message);
}

function showRequestModal(section, key, resultText) {
  const title = `${formatSection(section)} isteği`;
  const overlay = $('#studentModalOverlay');
  const body = $('#studentModalBody');
  if (!overlay || !body) return;
  $('#studentModalTitle').textContent = title;
  body.innerHTML = `<p><strong>${key}</strong> için yanıt:</p><p>${resultText}</p>`;
  openStudentModal();
}

function handleShowResults() {
  const increment = 15;
  simulatedMinutes += increment;
  requestQueue.forEach(item => {
    item.waitedMinutes += increment;
  });
  renderRequestQueue();

  const scenarioResult = evaluateScenarioRules();
  updateCaseStatusLocal(scenarioResult.status);

  if (scenarioResult.messages.length) {
    scenarioResult.messages.forEach(msg => {
      const entry = {
        id: uuid(),
        section: 'scenario',
        key: `Simülasyon ${simulatedMinutes} dk`,
        createdAt: Date.now(),
        result: msg
      };
      selectionState.sonuclar = [entry, ...selectionState.sonuclar].slice(0, 30);
    });
    renderSelectionLists({ animateResults: true });
  }

  const feedback = scenarioResult.messages.length
    ? scenarioResult.messages.join(' ')
    : 'Vaka stabil seyrediyor.';
  alert(`Geçen süre +${increment} dk. ${feedback}`);
}

function evaluateScenarioRules() {
  const triggered = SCENARIO_RULES.filter(rule => rule.predicate());
  const status = triggered.find(rule => rule.status === 'kötüleşti') ? 'kötüleşti' : 'stabil';
  return {
    status,
    messages: triggered.map(rule => rule.message)
  };
}

function updateCaseStatusLocal(status) {
  const badge = $('#caseStatusLocal');
  if (!badge) return;
  const normalized = status === 'kötüleşti' ? 'kötüleşti' : 'stabil';
  badge.textContent = normalized.charAt(0).toUpperCase() + normalized.slice(1);
  badge.classList.toggle('status-live', normalized === 'kötüleşti');
}

function initStudentModal() {
  const overlay = $('#studentModalOverlay');
  if (!overlay) return;
  overlay.addEventListener('click', evt => {
    if (evt.target === overlay) closeStudentModal();
  });
  overlay.querySelectorAll('[data-close-student-modal]').forEach(btn => {
    btn.addEventListener('click', closeStudentModal);
  });
}

function openStudentModal() {
  const overlay = $('#studentModalOverlay');
  if (!overlay) return;
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
}

function closeStudentModal() {
  const overlay = $('#studentModalOverlay');
  if (!overlay) return;
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
}

function formatSection(section) {
  if (section === 'labs') return 'Laboratuvar';
  if (section === 'imaging') return 'Görüntüleme';
  if (section === 'muayene') return 'Muayene';
  if (section === 'procedures') return 'Prosedür';
  if (section === 'scenario') return 'Senaryo';
  return section;
}
