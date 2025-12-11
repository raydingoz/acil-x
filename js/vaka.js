import { $, $all, createEl, formatTime } from './ui.js';
import { loadCasesData, getFeaturedCaseId, findCaseById, loadOrCreateUser, updateUserName, queryLLM } from './data.js';
import { ScoreManager } from './score.js';
import { STORAGE_KEYS } from './config.js';

let casesData = null;
let currentCase = null;
let scoreManager = null;
let user = null;

window.llmEnabled = false;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  user = loadOrCreateUser();
  initUserUI();

  casesData = await loadCasesData();
  populateCaseSelect(casesData);
  const featuredId = getFeaturedCaseId(casesData);
  const lastCaseId = localStorage.getItem(STORAGE_KEYS.LAST_CASE_ID);
  const startCaseId = lastCaseId || featuredId;
  loadCaseById(startCaseId);

  initTabs();
  initActions();
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

  // Skor
  scoreManager = new ScoreManager(user.id, currentCase.id, currentCase.scoring);
  updateScoreUI();
  clearLog();
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
  });
}

async function handleKeyedAction(fieldName, scoreType, selectEl, resultBox) {
  if (!currentCase || !scoreManager) return;
  const key = selectEl.value;
  if (!key) return;

  const source = currentCase[fieldName] || {};
  const staticResult = source[key] ?? source.default ?? 'Bu işlem için tanımlı yanıt yok.';

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

  const scoreDelta = scoreManager.applyPenalty(scoreType);
  updateScoreUI();
  appendLog({
    section: fieldName,
    actionType: scoreType,
    key,
    result: resultText,
    scoreDelta
  });
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

  const bonus = scoreManager.applyDiagnosisBonus(isCorrect);
  scoreManager.saveBestScore();
  updateScoreUI();

  let msg;
  if (isCorrect) {
    msg = `Doğru: ${correctDx}. Bonus +${bonus} puan.`;
  } else {
    msg = `Beklenen tanı: ${correctDx}. Girilen: ${inputDx}.`;
  }
  $('#diagnosisResultBox').textContent = msg;

  appendLog({
    section: 'diagnosis',
    actionType: 'submit_diagnosis',
    key: null,
    result: msg,
    scoreDelta: bonus
  });
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
