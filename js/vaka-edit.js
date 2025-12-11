import { $, $all, createEl, debounce } from './ui.js';
import { loadCasesData, saveCasesToLocal } from './data.js';
import { STORAGE_KEYS } from './config.js';

let casesData = null;
let currentIndex = 0;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  casesData = await loadCasesData();
  if (!casesData.cases) casesData.cases = [];
  if (!casesData.featured_case_id && casesData.cases[0]) {
    casesData.featured_case_id = casesData.cases[0].id;
  }

  $('#featuredCaseIdInput').value = casesData.featured_case_id || '';

  renderCaseList();
  if (casesData.cases.length > 0) {
    selectCase(0);
  } else {
    addNewCase();
  }

  attachHandlers();
}

function attachHandlers() {
  $('#addCaseBtn').addEventListener('click', addNewCase);
  $('#deleteCaseBtn').addEventListener('click', deleteCurrentCase);
  $('#saveToLocalBtn').addEventListener('click', () => {
    syncFormToData();
    const featured = $('#featuredCaseIdInput').value.trim();
    if (featured) casesData.featured_case_id = featured;
    saveCasesToLocal(casesData);
    showValidation('Yerel olarak kaydedildi.\nNot: data/cases.json dosyasına ayrıca elle kopyalayabilirsin.');
    updateRawJsonPreview();
    renderCaseList();
  });

  $('#jsonFileInput').addEventListener('change', handleJsonImport);
  $('#downloadJsonBtn').addEventListener('click', downloadJson);

  $('#applyCaseChangesBtn').addEventListener('click', () => {
    syncFormToData();
    const errors = validateCasesData(casesData);
    if (errors.length) {
      showValidation('Hatalar:\n' + errors.join('\n'));
    } else {
      showValidation('Vaka verisi geçerli görünüyor.');
    }
    updateRawJsonPreview();
    renderCaseList();
  });

  $('#jsonToFormBtn').addEventListener('click', () => {
    try {
      const text = $('#rawJsonPreview').value;
      const obj = JSON.parse(text);
      casesData = obj;
      if (!casesData.cases) casesData.cases = [];
      $('#featuredCaseIdInput').value = casesData.featured_case_id || '';
      renderCaseList();
      if (casesData.cases.length > 0) {
        selectCase(0);
      }
      showValidation('JSON başarıyla forma aktarıldı.');
    } catch (e) {
      showValidation('JSON parse hatası: ' + e.message);
    }
  });

  // Dinamik alan butonları
  $('#addLabRowBtn').addEventListener('click', () => addKvRow($('#labsContainer')));
  $('#addImagingRowBtn').addEventListener('click', () => addKvRow($('#imagingContainer')));
  $('#addProcedureRowBtn').addEventListener('click', () => addKvRow($('#proceduresContainer')));
  $('#addDrugBtn').addEventListener('click', addDrugRow);

  // Raw JSON preview’i formdaki değişikliklere göre güncellemek için hafif debounce
  const form = $('#caseForm');
  form.addEventListener('input', debounce(updateRawJsonPreview, 500));
}

function renderCaseList() {
  const ul = $('#caseList');
  ul.innerHTML = '';
  casesData.cases.forEach((c, idx) => {
    const li = createEl('li', {
      text: c ? `${c.id || '(id yok)'} – ${c.title || '(başlık yok)'}` : '(boş vaka)'
    });
    if (idx === currentIndex) li.classList.add('active');
    li.addEventListener('click', () => selectCase(idx));
    ul.appendChild(li);
  });
}

function selectCase(idx) {
  if (idx < 0 || idx >= casesData.cases.length) return;
  syncFormToData();
  currentIndex = idx;
  const c = casesData.cases[idx];
  loadCaseToForm(c);
  renderCaseList();
  updateRawJsonPreview();
}

function addNewCase() {
  const newCase = {
    id: `case-${String(casesData.cases.length + 1).padStart(3, '0')}`,
    title: 'Yeni Vaka',
    difficulty: 'orta',
    tags: [],
    patient: {},
    paramedic: '',
    story: '',
    exam: { vitals: '', physical: '' },
    labs: { default: 'Bu tetkik için sonuç yok.' },
    imaging: { default: 'Bu görüntüleme için kayıt yok.' },
    procedures: { default: 'Prosedür sonucu kaydı yok.' },
    drugs: [],
    consults: [],
    disposition: '',
    final_diagnosis: '',
    scoring: {
      base: 100,
      penalty_per_lab: 5,
      penalty_per_imaging: 8,
      penalty_per_procedure: 10,
      bonus_correct_dx: 50
    }
  };
  casesData.cases.push(newCase);
  selectCase(casesData.cases.length - 1);
}

function deleteCurrentCase() {
  if (casesData.cases.length <= 1) {
    showValidation('En az bir vaka bulunmalı, silemezsiniz.');
    return;
  }
  casesData.cases.splice(currentIndex, 1);
  if (currentIndex >= casesData.cases.length) {
    currentIndex = casesData.cases.length - 1;
  }
  selectCase(currentIndex);
}

function loadCaseToForm(c) {
  $('#editorCaseTitle').textContent = c.title || 'Vaka Düzenleme';

  $('#caseIdInput').value = c.id || '';
  $('#caseTitleInput').value = c.title || '';
  $('#caseDifficultyInput').value = c.difficulty || 'orta';
  $('#caseTagsInput').value = Array.isArray(c.tags) ? c.tags.join(', ') : '';

  $('#patientAgeInput').value = c.patient?.age ?? '';
  $('#patientSexInput').value = c.patient?.sex ?? '';
  $('#patientSettingInput').value = c.patient?.setting ?? '';
  $('#patientTriageInput').value = c.patient?.triage ?? '';

  $('#storyInput').value = c.story || '';
  $('#examVitalsInput').value = c.exam?.vitals || '';
  $('#examPhysicalInput').value = c.exam?.physical || '';

  // Labs
  $('#labsDefaultInput').value = c.labs?.default ?? '';
  renderKvContainer($('#labsContainer'), c.labs, 'default');

  // Imaging
  $('#imagingDefaultInput').value = c.imaging?.default ?? '';
  renderKvContainer($('#imagingContainer'), c.imaging, 'default');

  // Procedures
  $('#proceduresDefaultInput').value = c.procedures?.default ?? '';
  renderKvContainer($('#proceduresContainer'), c.procedures, 'default');

  // Drugs
  renderDrugsContainer($('#drugsContainer'), c.drugs || []);

  $('#consultsInput').value = Array.isArray(c.consults) ? c.consults.join(', ') : '';
  $('#dispositionTextInput').value = c.disposition || '';

  $('#finalDiagnosisInput').value = c.final_diagnosis || '';
  $('#scoreBaseInput').value = c.scoring?.base ?? 100;
  $('#penaltyLabInput').value = c.scoring?.penalty_per_lab ?? 5;
  $('#penaltyImagingInput').value = c.scoring?.penalty_per_imaging ?? 8;
  $('#penaltyProcedureInput').value = c.scoring?.penalty_per_procedure ?? 10;
  $('#bonusDxInput').value = c.scoring?.bonus_correct_dx ?? 50;
}

function syncFormToData() {
  const c = casesData.cases[currentIndex];
  if (!c) return;

  c.id = $('#caseIdInput').value.trim();
  c.title = $('#caseTitleInput').value.trim();
  c.difficulty = $('#caseDifficultyInput').value;
  const tagsStr = $('#caseTagsInput').value.trim();
  c.tags = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(Boolean) : [];

  c.patient = c.patient || {};
  const ageVal = $('#patientAgeInput').value;
  c.patient.age = ageVal ? Number(ageVal) : undefined;
  c.patient.sex = $('#patientSexInput').value || undefined;
  c.patient.setting = $('#patientSettingInput').value.trim() || undefined;
  c.patient.triage = $('#patientTriageInput').value.trim() || undefined;

  c.story = $('#storyInput').value.trim();
  c.exam = {
    vitals: $('#examVitalsInput').value.trim(),
    physical: $('#examPhysicalInput').value.trim()
  };

  // Labs
  c.labs = readKvContainer($('#labsContainer'));
  c.labs.default = $('#labsDefaultInput').value.trim() || 'Bu tetkik için sonuç yok.';

  // Imaging
  c.imaging = readKvContainer($('#imagingContainer'));
  c.imaging.default = $('#imagingDefaultInput').value.trim() || 'Bu görüntüleme için kayıt yok.';

  // Procedures
  c.procedures = readKvContainer($('#proceduresContainer'));
  c.procedures.default = $('#proceduresDefaultInput').value.trim() || 'Prosedür sonucu kaydı yok.';

  // Drugs
  c.drugs = readDrugsContainer($('#drugsContainer'));

  const consultsStr = $('#consultsInput').value.trim();
  c.consults = consultsStr ? consultsStr.split(',').map(x => x.trim()).filter(Boolean) : [];

  c.disposition = $('#dispositionTextInput').value.trim();

  c.final_diagnosis = $('#finalDiagnosisInput').value.trim();

  c.scoring = {
    base: Number($('#scoreBaseInput').value) || 100,
    penalty_per_lab: Number($('#penaltyLabInput').value) || 5,
    penalty_per_imaging: Number($('#penaltyImagingInput').value) || 8,
    penalty_per_procedure: Number($('#penaltyProcedureInput').value) || 10,
    bonus_correct_dx: Number($('#bonusDxInput').value) || 50
  };
}

function renderKvContainer(container, obj, defaultKey) {
  container.innerHTML = '';
  if (!obj) return;
  Object.entries(obj)
    .filter(([k]) => k !== defaultKey)
    .forEach(([k, v]) => {
      const row = addKvRow(container);
      row.querySelector('.kv-key').value = k;
      row.querySelector('.kv-value').value = v;
    });
}

function addKvRow(container) {
  const row = createEl('div', { className: 'kv-row' });
  const keyInput = createEl('input', { attrs: { type: 'text', placeholder: 'anahtar (ör. troponin)' }, className: 'kv-key' });
  const valInput = createEl('input', { attrs: { type: 'text', placeholder: 'sonuç/metin' }, className: 'kv-value' });
  const delBtn = createEl('button', { text: 'Sil', className: 'btn small danger' });
  delBtn.type = 'button';
  delBtn.addEventListener('click', () => {
    row.remove();
  });
  row.appendChild(keyInput);
  row.appendChild(valInput);
  row.appendChild(delBtn);
  container.appendChild(row);
  return row;
}

function readKvContainer(container) {
  const obj = {};
  $all('.kv-row', container).forEach(row => {
    const key = row.querySelector('.kv-key').value.trim();
    const val = row.querySelector('.kv-value').value.trim();
    if (key && val) obj[key] = val;
  });
  return obj;
}

function renderDrugsContainer(container, drugs) {
  container.innerHTML = '';
  drugs.forEach(d => addDrugRow(d));
}

function addDrugRow(drug = null) {
  const container = $('#drugsContainer');
  const row = createEl('div', { className: 'drug-row' });

  const nameInput = createEl('input', {
    attrs: { type: 'text', placeholder: 'İlaç adı' },
    className: 'drug-name'
  });
  const dosesInput = createEl('input', {
    attrs: { type: 'text', placeholder: 'Dozlar (virgülle ayrılmış)' },
    className: 'drug-doses'
  });
  const delBtn = createEl('button', {
    text: 'Sil',
    className: 'btn small danger'
  });
  delBtn.type = 'button';
  delBtn.addEventListener('click', () => row.remove());

  const respTextarea = createEl('textarea', {
    className: 'drug-response',
    attrs: { rows: '2', placeholder: 'Beklenen yanıt' }
  });

  row.appendChild(nameInput);
  row.appendChild(dosesInput);
  row.appendChild(delBtn);
  row.appendChild(respTextarea);

  container.appendChild(row);

  if (drug) {
    nameInput.value = drug.name || '';
    dosesInput.value = Array.isArray(drug.doses) ? drug.doses.join(', ') : '';
    respTextarea.value = drug.response || '';
  }

  return row;
}

function readDrugsContainer(container) {
  const arr = [];
  $all('.drug-row', container).forEach(row => {
    const name = row.querySelector('.drug-name').value.trim();
    const dosesStr = row.querySelector('.drug-doses').value.trim();
    const response = row.querySelector('.drug-response').value.trim();
    if (!name) return;
    const doses = dosesStr ? dosesStr.split(',').map(x => x.trim()).filter(Boolean) : [];
    arr.push({ name, doses, response });
  });
  return arr;
}

function validateCasesData(data) {
  const errors = [];
  const ids = new Set();
  if (!data.cases || !Array.isArray(data.cases) || !data.cases.length) {
    errors.push('En az bir vaka olmalı.');
    return errors;
  }

  data.cases.forEach((c, idx) => {
    const prefix = `Vaka[${idx}]`;
    if (!c.id) errors.push(`${prefix}: id eksik.`);
    if (c.id && ids.has(c.id)) errors.push(`${prefix}: id tekrar ediyor (${c.id}).`);
    if (c.id) ids.add(c.id);
    if (!c.title) errors.push(`${prefix}: başlık eksik.`);
    if (!c.final_diagnosis) errors.push(`${prefix}: final_diagnosis eksik.`);
  });

  if (data.featured_case_id && !ids.has(data.featured_case_id)) {
    errors.push(`featured_case_id (${data.featured_case_id}) tanımlı vaka id'lerinden biri değil.`);
  }

  return errors;
}

function showValidation(text) {
  $('#validationResult').textContent = text;
}

function updateRawJsonPreview() {
  syncFormToData();
  const clone = JSON.parse(JSON.stringify(casesData));
  $('#rawJsonPreview').value = JSON.stringify(clone, null, 2);
}

function handleJsonImport(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const text = ev.target.result;
      const obj = JSON.parse(text);
      casesData = obj;
      if (!casesData.cases) casesData.cases = [];
      $('#featuredCaseIdInput').value = casesData.featured_case_id || '';
      renderCaseList();
      if (casesData.cases.length > 0) {
        selectCase(0);
      }
      updateRawJsonPreview();
      showValidation('JSON dosyası başarıyla yüklendi.');
    } catch (err) {
      showValidation('JSON dosyası okunamadı: ' + err.message);
    }
  };
  reader.readAsText(file, 'utf-8');
}

function downloadJson() {
  syncFormToData();
  const featured = $('#featuredCaseIdInput').value.trim();
  if (featured) casesData.featured_case_id = featured;
  const jsonStr = JSON.stringify(casesData, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'cases.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
