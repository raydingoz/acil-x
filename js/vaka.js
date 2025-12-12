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
import { ScoreManager, evaluateCaseScore } from './scoring.js';
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
let sessionFollowerId = null;
let sessionLocked = false;
let sessionUnsubscribe = null;
let scoresUnsubscribe = null;
let hostState = null;
let selectionUnsubscribe = null;
let flowDefaults = null;
let flowHistory = [];
let timerInterval = null;
let simulatedMinutes = 0;
let activeFlowStep = 'anamnez';
const isStudentPage = window.location.pathname.includes('student');
const selectionState = {
  anamnezMuayene: [],
  istekler: [],
  sonuclar: []
};
const LIVE_STATUSES = ['running', 'active', 'started'];
const requestQueue = [];
const usedOptions = new Set();
const searchFilters = [];
const animatedResultIds = new Set();
const noticeTimeouts = new WeakMap();

function showNotice(message, variant = 'info') {
  if (!message) return;
  let stack = $('#noticeStack');
  if (!stack) {
    stack = createEl('div', { className: 'notice-stack', attrs: { id: 'noticeStack' } });
    document.body.appendChild(stack);
  }
  const notice = createEl('div', { className: `notice ${variant}`, text: message });
  stack.appendChild(notice);

  const existingTimeout = noticeTimeouts.get(notice);
  if (existingTimeout) clearTimeout(existingTimeout);
  const timeout = setTimeout(() => {
    notice.remove();
  }, 4200);
  noticeTimeouts.set(notice, timeout);
}
const setTextContent = (selector, text) => {
  const el = $(selector);
  if (el) el.textContent = text;
};

const WAIT_TIME_BY_SECTION = {
  labs: 20,
  imaging: 30,
  procedures: 10,
  anamnez: 5,
  muayene: 5,
  hikaye: 5
};

const STANDARD_OPTIONS = {
  anamnez: [
    "Şikayeti netleştir",
    "OPQRST sorgula",
    "Kırmızı bayrak taraması",
    "Ağrı değerlendirmesi",
    "İlaç listesini al",
    "Alerji sorgula",
    "Antikoagülan/antiagregan sorgula",
    "Gebelik/LMP/emzirme sorgula",
    "Özgeçmiş/soygeçmiş",
    "Cerrahi öykü/implant/pacemaker",
    "Enfeksiyon riskleri",
    "Toksik maruziyet",
    "Travma mekanizması",
    "Kanama öyküsü",
    "Nöro öykü",
    "Kardiyak öykü",
    "Pulmoner öykü",
    "Renal/ürolojik öykü",
    "GİS öykü",
    "Psikiyatrik risk",
    "Aşılama durumu",
    "Sosyal öykü"
  ],
  hikaye: [
    "Olay başlangıcı ve tetikleyici",
    "Önceki benzer atak",
    "Fonksiyonel durum",
    "Son 4 hafta cerrahi/immobilizasyon",
    "İş/ev içi maruziyet",
    "Enfeksiyon odağı sorgula",
    "Antibiyotik kullanımı",
    "Kanama/antikoagülasyon yönetimi",
    "Diyet/ilaç tetikleyici",
    "Sıvı kaybı ve alımı",
    "Ağrı karakteri",
    "Nöro alarm bulguları",
    "Obstetrik alarm bulguları",
    "Pediatrik durum sorgusu",
    "Özel durum modülü"
  ],
  muayene: [
    "Primer değerlendirme ABC",
    "Vital bulgular ve trend",
    "GKS/AVPU + pupil",
    "Genel görünüm",
    "Hava yolu değerlendirmesi",
    "Solunum muayenesi",
    "Dolaşım muayenesi",
    "Kardiyak muayene",
    "Abdomen muayenesi",
    "Nörolojik muayene",
    "Cilt/yumuşak doku",
    "Travma sekonder survey",
    "DVT muayenesi",
    "Dehidratasyon değerlendirmesi",
    "Meninks irritasyon bulguları",
    "Gebelikte obstetrik muayene"
  ],
  labs: [
    "Tam Kan",
    "Elektrolit Paneli",
    "BUN/Kreatinin",
    "Glukoz",
    "Karaciğer Fonksiyon",
    "CRP",
    "Prokalsitonin",
    "Laktat",
    "Koagülasyon",
    "D-dimer",
    "Troponin",
    "BNP/NT-proBNP",
    "Kan Gazı",
    "İdrar tahlili",
    "İdrar kültürü",
    "Gebelik testi",
    "Hemokültür x2",
    "Solunum viral panel",
    "COVID/Influenza hızlı test",
    "Monospot/EBV",
    "Hepatit serolojileri",
    "TSH/Serbest T4",
    "HbA1c",
    "Ketone",
    "Osmolalite",
    "Toksikoloji taraması",
    "Parasetamol düzeyi",
    "Salisilat düzeyi",
    "Etanol düzeyi",
    "Karboksihemoglobin/Methemoglobin",
    "Kan grubu ve crossmatch",
    "Fibrinojen",
    "DIC paneli",
    "CK",
    "Magnezyum",
    "Fosfor",
    "Lipaz",
    "Amilaz",
    "Amonyak",
    "İdrar sodyumu/FeNa",
    "LP paketi"
  ],
  imaging: [
    "12 derivasyon EKG",
    "Akciğer grafisi",
    "Direkt batın grafisi",
    "POCUS FAST",
    "POCUS RUSH",
    "POCUS akciğer",
    "POCUS DVT",
    "Abdomen US",
    "Renal US",
    "Ekokardiyografi",
    "Beyin BT",
    "Beyin BT Anjiyo",
    "Toraks BT",
    "BT pulmoner anjiyo",
    "Abdomen-pelvis BT kontrastsız",
    "Abdomen-pelvis BT kontrastlı",
    "Travma pan-CT",
    "Aort BT anjiyo",
    "Beyin MR",
    "Difüzyon MR",
    "Spinal MR",
    "Alt ekstremite venöz Doppler",
    "Skrotal Doppler US",
    "Obstetrik US"
  ],
  procedures: [
    "Monitorizasyon",
    "İki geniş damar yolu",
    "İntraosseöz erişim",
    "Arteriyel kanül",
    "Santral venöz kateter",
    "Kan şekeri ölçümü",
    "Oksijen",
    "NIV",
    "Nebül tedavi",
    "Entübasyon hazırlığı",
    "Endotrakeal entübasyon",
    "Supraglottik airway",
    "Cerrahi hava yolu",
    "Sıvı resüsitasyonu",
    "Vazopressör infüzyon",
    "Kan/ürün transfüzyonu",
    "Defibrilasyon",
    "Senkronize kardiyoversiyon",
    "Geçici pacing",
    "Servikal immobilizasyon",
    "Pelvik kemer",
    "Turnike/hemosztaz",
    "Yara irrigasyonu ve sütür",
    "Apse drenajı",
    "Torakostomi tüpü",
    "İğne dekompresyon",
    "Foley kateter",
    "Nazogastrik sonda",
    "Lomber ponksiyon",
    "Prosedürel sedasyon"
  ],
  drugs: [
    "Parasetamol",
    "NSAİİ",
    "Opioid analjezik",
    "Topikal anestezik",
    "Ondansetron",
    "Metoklopramid",
    "PPI",
    "H2 bloker",
    "Antasid",
    "Antihistaminik",
    "Kortikosteroid",
    "Adrenalin",
    "Nebül adrenalin",
    "Salbutamol nebül",
    "İpratropium nebül",
    "Sistemik steroid",
    "Aspirin",
    "P2Y12 inhibitörü",
    "Nitrogliserin",
    "Heparin/LMWH",
    "Beta bloker",
    "Diüretik",
    "Amiodaron",
    "Lidokain",
    "Adenozin",
    "Magnezyum sülfat",
    "Kalsiyum glukonat",
    "Sodyum bikarbonat",
    "Benzodiazepin",
    "Antiepileptik yükleme",
    "Empirik antibiyotik sepsis",
    "Empirik antibiyotik pnömoni",
    "Empirik antibiyotik menenjit",
    "İnsülin",
    "Dekstroz",
    "Tiamin",
    "Nalokson",
    "N-asetilsistein",
    "Aktif kömür",
    "Sedatif",
    "Antipsikotik"
  ],
  tani: [
    "Ön tanı listesi oluştur",
    "Hayatı tehdit edenleri dışla",
    "Risk skoru uygula",
    "Tedavi hedeflerini yaz",
    "Konsültasyon planla",
    "Yatış/yoğun bakım değerlendirmesi",
    "Gözlem protokolü",
    "Taburculuk kriterleri ve bilgilendirme",
    "Yüksek riskli kararları gerekçelendir"
  ]
};

const OPTION_CATEGORIES = {
  labs: [
    {
      label: "Temel",
      items: ["Tam Kan", "Elektrolit Paneli", "BUN/Kreatinin", "Glukoz", "Karaciğer Fonksiyon", "Kan Gazı"]
    },
    {
      label: "Enfeksiyon/Sepsis",
      items: ["CRP", "Prokalsitonin", "Laktat", "Hemokültür", "Solunum viral panel", "COVID/Influenza hızlı test"]
    },
    {
      label: "Kardiyak",
      items: ["Troponin", "BNP/NT-proBNP", "CK"]
    },
    {
      label: "Koagülasyon",
      items: ["Koagülasyon", "D-dimer", "Fibrinojen", "DIC paneli"]
    },
    {
      label: "Endokrin/Metabolik",
      items: ["TSH/Serbest T4", "HbA1c", "Ketone", "Osmolalite"]
    },
    {
      label: "Toksikoloji",
      items: ["Toksikoloji taraması", "Parasetamol düzeyi", "Salisilat düzeyi", "Etanol düzeyi", "Karboksihemoglobin/Methemoglobin"]
    },
    {
      label: "Diğer",
      items: ["Lipaz", "Amilaz", "Amonyak", "İdrar tahlili", "İdrar kültürü", "Gebelik testi", "Mg/P"]
    }
  ],
  imaging: [
    {
      label: "Temel",
      items: ["12 derivasyon EKG", "Akciğer grafisi", "Direkt batın grafisi"]
    },
    {
      label: "POCUS",
      items: ["POCUS FAST", "POCUS RUSH", "POCUS akciğer", "POCUS DVT", "Abdomen US", "Renal US", "Ekokardiyografi"]
    },
    {
      label: "BT",
      items: [
        "Beyin BT",
        "Beyin BT Anjiyo",
        "Toraks BT",
        "BT pulmoner anjiyo",
        "Abdomen-pelvis BT kontrastsız",
        "Abdomen-pelvis BT kontrastlı",
        "Travma pan-CT",
        "Aort BT anjiyo"
      ]
    },
    {
      label: "MR",
      items: ["Beyin MR", "Difüzyon MR", "Spinal MR"]
    },
    {
      label: "Diğer",
      items: ["Alt ekstremite venöz Doppler", "Skrotal Doppler US", "Obstetrik US"]
    }
  ]
};

const USED_KEY_SEPARATOR = '::';

function normalizeSectionKey(key) {
  if (!key) return '';
  const map = {
    laboratuvar: 'labs',
    labs: 'labs',
    tetkik: 'labs',
    goruntuleme: 'imaging',
    imaging: 'imaging',
    prosedur: 'procedures',
    procedures: 'procedures',
    ilac: 'drugs',
    drugs: 'drugs',
    tani: 'tani',
    anamnez: 'anamnez',
    muayene: 'muayene',
    hikaye: 'hikaye'
  };
  return map[key] || key;
}

function markOptionUsed(section, key) {
  if (!section || !key) return;
  usedOptions.add(`${normalizeSectionKey(section)}${USED_KEY_SEPARATOR}${key}`);
}

function isOptionUsed(section, key) {
  if (!section || !key) return false;
  return usedOptions.has(`${normalizeSectionKey(section)}${USED_KEY_SEPARATOR}${key}`);
}

function truncateText(text = '', limit = 120) {
  if ((text || '').length <= limit) return text || '';
  return `${text.slice(0, limit)}...`;
}

const ICD10_SUGGESTIONS = [
  { code: "I21.9", label: "Akut miyokard infarktüsü" },
  { code: "I50.9", label: "Kalp yetmezliği" },
  { code: "J18.9", label: "Pnömoni, tanımlanmamış" },
  { code: "K52.9", label: "Gastroenterit, tanımlanmamış" },
  { code: "A09", label: "Enfeksiyöz gastroenterit" },
  { code: "N17.9", label: "Akut böbrek yetmezliği" },
  { code: "E11.9", label: "Tip 2 DM, komplikasyonsuz" },
  { code: "G40.9", label: "Epilepsi, tanımlanmamış" },
  { code: "S06.0", label: "Sarsıntı" },
  { code: "T81.4", label: "Enfeksiyon, prosedür sonrası" }
];

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

const QUICK_ACTIONS = {
  anamnez: { label: 'Anamnez', submitStep: 'anamnez' },
  muayene: { label: 'Muayene', submitStep: 'muayene' },
  hikaye: { label: 'Hikaye', submitStep: 'hikaye' },
  laboratuvar: {
    label: 'Laboratuvar',
    selectId: 'labSelect',
    handler: key => handleKeyedAction('labs', 'lab', $('#labSelect'), $('#labResultBox'), key)
  },
  goruntuleme: {
    label: 'Görüntüleme',
    selectId: 'imagingSelect',
    handler: key => handleKeyedAction('imaging', 'imaging', $('#imagingSelect'), $('#imagingResultBox'), key)
  },
  prosedur: {
    label: 'Prosedür',
    selectId: 'procedureSelect',
    handler: key => handleKeyedAction('procedures', 'procedure', $('#procedureSelect'), $('#procedureResultBox'), key)
  },
  ilac: {
    label: 'İlaç / Tedavi',
    selectId: 'drugSelect',
    handler: handleDrugAction
  },
  tani: {
    label: 'Tanı',
    prompt: 'Hızlı tanı gir:',
    onConfirm: value => {
      $('#diagnosisInput').value = value;
      handleDiagnosisSubmit();
    }
  }
};

const FLOW_TIMER_DURATION_MS = 3 * 60 * 1000; // 3 dakikalık varsayılan süre

window.llmEnabled = false;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  user = loadOrCreateUser();
  initUserUI();
  const urlSession = getSessionIdFromUrl();
  const savedSession = localStorage.getItem(STORAGE_KEYS.SESSION_ID);
  sessionFollowerId = urlSession || (savedSession && savedSession !== 'demo-session' ? savedSession : null);

  flowDefaults = await loadFlowDefaults();

  casesData = await loadCasesData();
  const featuredId = getFeaturedCaseId(casesData);
  const lastCaseId = localStorage.getItem(STORAGE_KEYS.LAST_CASE_ID);
  const startCaseId = sessionFollowerId ? null : lastCaseId || featuredId;
  if (startCaseId) {
    loadCaseById(startCaseId);
  }

  initTabs();
  initActions();
  initHostPanel();
  initFlowControls();
  initSearchFilters();
  initStudentModal();
  initRequestDock();
  initQuickRails();
  initMicroInteractions();
  renderSelectionLists();
  renderRequestQueue();
  refreshSearchSources();
  populateIcd10List();

  if (sessionFollowerId) {
    updateSessionGate(true, 'Host’un vakayı başlatması bekleniyor.');
    connectToSession(sessionFollowerId);
  }
}

function initUserUI() {
  if (isStudentPage) {
    const aliasFromUrl = getAliasFromUrl();
    if (aliasFromUrl) {
      user = updateUserName(aliasFromUrl);
    }
    ensureAliasExists();
    attachAliasChangeHandler();
  } else if (!user.name) {
    showNotice('Simulasyona baslamadan once bir rumuz belirlemelisin.', 'warning');
    const entered = prompt('Rumuzunu yaz:')?.trim();
    if (entered) {
      user = updateUserName(entered);
    }
  }

  const nameDisplay = $('#userNameDisplay');
  if (nameDisplay) nameDisplay.textContent = user?.name || 'Katilimci';
}

function getAliasFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const alias = (params.get('alias') || params.get('rumuz') || params.get('nick') || '').trim();
  return alias || null;
}

function ensureAliasExists() {
  const defaultNames = ['Kullanıcı', 'Kullanici', 'Katılımcı', 'Katilimci'];
  if (user?.name && !defaultNames.includes(user.name)) {
    renderAliasDisplay();
    return;
  }
  showNotice('Simulasyona baslamadan once bir rumuz belirlemelisin.', 'warning');
  promptAndSaveAlias();
}

function renderAliasDisplay() {
  const nameDisplay = $('#userNameDisplay');
  if (nameDisplay) nameDisplay.textContent = user?.name || 'Katilimci';
}

function promptAndSaveAlias(message = 'Rumuzunu yaz:') {
  const entered = prompt(message, user?.name || '')?.trim();
  if (entered) {
    user = updateUserName(entered);
    renderAliasDisplay();
    showNotice('Rumuz kaydedildi.');
  }
}

function attachAliasChangeHandler() {
  renderAliasDisplay();
  const btn = $('#changeAliasBtn');
  if (btn) {
    btn.addEventListener('click', () => promptAndSaveAlias('Yeni rumuzunu yaz:'));
  }
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
  $('#storyPeek').textContent = currentCase.story || 'Hikaye tanımlı değil.';

  // Muayene
  const vitalsText = currentCase.exam?.vitals || 'Vital bulgular tanımlı değil.';
  setTextContent('#examVitals', vitalsText);
  setTextContent('#monitorVitals', vitalsText);
  setTextContent(
    '#examPhysical',
    currentCase.exam?.physical || 'Fizik muayene bulguları tanımlı değil.'
  );

  // Dropdownlar
  setupKeyedSelect($('#labSelect'), currentCase.labs);
  setupKeyedSelect($('#imagingSelect'), currentCase.imaging);
  setupKeyedSelect($('#procedureSelect'), currentCase.procedures);

  setupDrugsSelects(currentCase.drugs || []);

  // Konsültasyon
  const consultDiv = $('#consultList');
  if (consultDiv) {
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
  }

  // Disposition default
  const dispositionInput = $('#dispositionInput');
  const dispositionResult = $('#dispositionResultBox');
  if (dispositionInput) dispositionInput.value = '';
  if (dispositionResult) dispositionResult.textContent = currentCase.disposition || '';

  // Final tanı
  const diagnosisInput = $('#diagnosisInput');
  const diagnosisResult = $('#diagnosisResultBox');
  if (diagnosisInput) diagnosisInput.value = '';
  if (diagnosisResult) diagnosisResult.textContent = '';

  resetSelectionState();
  resetRequestQueue();

  renderFlowOptions();
  updateFlowPlaceholder(null, null);
  refreshSearchSources();

  // Skor
  scoreManager = new ScoreManager(user.id, currentCase.id, currentCase.scoring);
  scoreManager.startCaseTimer();
  updateScoreUI();
  clearLog();
  syncScoreToSession();
}

function setupKeyedSelect(selectEl, obj) {
  if (!selectEl) return;
  selectEl.innerHTML = '';
  const keys = Object.keys(obj || {}).filter(k => k !== 'default');
  const fallbackSection = selectEl.id?.includes('lab')
    ? 'labs'
    : selectEl.id?.includes('imaging')
      ? 'imaging'
      : selectEl.id?.includes('procedure')
        ? 'procedures'
        : null;
  const merged = [...new Set([...keys, ...getStandardOptions(fallbackSection)])].filter(Boolean);
  const list = merged.length ? merged : ['Seçenek yok'];
  selectEl.disabled = !merged.length;
  list.forEach(k => {
    const opt = createEl('option', { text: k });
    opt.value = k;
    selectEl.appendChild(opt);
  });
}

function setupDrugsSelects(drugs) {
  const drugSelect = $('#drugSelect');
  const doseSelect = $('#doseSelect');
  if (!drugSelect || !doseSelect) return;
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

function promptForKey(section) {
  if (!currentCase) return null;
  const source = currentCase[section];
  if (!source) return null;
  const keys = Object.keys(source).filter(k => k !== 'default');
  if (!keys.length) return null;
  const promptText = [`Bir ${section} seç:`, ...keys.map((k, i) => `${i + 1}) ${k}`)].join('\n');
  const input = prompt(promptText)?.trim();
  if (!input) return null;
  const index = parseInt(input, 10);
  if (!Number.isNaN(index) && index >= 1 && index <= keys.length) {
    return keys[index - 1];
  }
  const directMatch = keys.find(k => k.toLowerCase() === input.toLowerCase());
  return directMatch || null;
}

function promptForDrug(drugs) {
  if (!Array.isArray(drugs) || !drugs.length) return null;
  const promptText = ['Bir ilaç seç:', ...drugs.map((d, i) => `${i + 1}) ${d.name || `İlaç ${i + 1}`}`)].join('\n');
  const input = prompt(promptText)?.trim();
  const index = parseInt(input, 10);
  if (!Number.isNaN(index) && index >= 1 && index <= drugs.length) {
    return index - 1;
  }
  const byName = drugs.findIndex(d => (d.name || '').toLowerCase() === (input || '').toLowerCase());
  return byName >= 0 ? byName : null;
}

function promptForDose(drug) {
  if (!drug || !Array.isArray(drug.doses) || !drug.doses.length) return null;
  const promptText = ['Doz seç:', ...drug.doses.map((d, i) => `${i + 1}) ${d}`)].join('\n');
  const input = prompt(promptText)?.trim();
  const index = parseInt(input, 10);
  if (!Number.isNaN(index) && index >= 1 && index <= drug.doses.length) {
    return index - 1;
  }
  const byText = drug.doses.findIndex(d => d.toLowerCase() === (input || '').toLowerCase());
  return byText >= 0 ? byText : null;
}

function getSelectedIndex(selectEl) {
  if (!selectEl) return null;
  const value = selectEl.value;
  if (value == null || value === '') return null;
  const index = parseInt(value, 10);
  return Number.isNaN(index) ? null : index;
}

function getSessionIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('session');
}

function isCaseUnlocked() {
  if (!sessionFollowerId) return true;
  return Boolean(LIVE_STATUSES.includes(hostState?.status) && hostState?.activeCaseId);
}

function enforceCaseUnlock() {
  const unlocked = isCaseUnlocked();
  if (!unlocked) {
    showNotice('Host vakayı başlatana kadar işlem yapamazsın.', 'warning');
    updateSessionGate(true, 'Host’un başlatmasını bekleyin.');
  }
  return unlocked;
}

function updateSessionGate(locked, text) {
  const gate = $('#sessionGate');
  if (!gate) return;
  sessionLocked = Boolean(locked);
  gate.hidden = !locked;
  document.body.classList.toggle('session-locked', locked);
  const gateText = $('#sessionGateText');
  if (gateText && text) gateText.textContent = text;
  const gateId = $('#sessionGateId');
  if (gateId && sessionFollowerId) gateId.textContent = sessionFollowerId;
}

function initTabs() {
  const buttons = $all('.tab-btn');
  const panels = $all('.tab-panel');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      activateTab(tab);
    });
  });
}

function activateTab(tab) {
  if (!tab) return;
  const buttons = $all('.tab-btn');
  const panels = $all('.tab-panel');
  buttons.forEach(btn => {
    const isActive = btn.dataset.tab === tab;
    btn.classList.toggle('active', isActive);
  });
  panels.forEach(panel => {
    const isActive = panel.id === `tab-${tab}`;
    panel.classList.toggle('active', isActive);
  });
}

function initActions() {
  $('#requestLabBtn')?.addEventListener('click', () =>
    handleKeyedAction('labs', 'lab', $('#labSelect'), $('#labResultBox'))
  );
  $('#requestImagingBtn')?.addEventListener('click', () =>
    handleKeyedAction('imaging', 'imaging', $('#imagingSelect'), $('#imagingResultBox'))
  );
  $('#doProcedureBtn')?.addEventListener('click', () =>
    handleKeyedAction('procedures', 'procedure', $('#procedureSelect'), $('#procedureResultBox'))
  );

  $('#showResultsBtn').addEventListener('click', handleShowResults);
  $('#showResultsBtnTop')?.addEventListener('click', handleShowResults);
  $('#quickApplyBtn')?.addEventListener('click', handleQuickApply);
  $('#openDiagnosisBtn')?.addEventListener('click', openDiagnosisModal);

  $('#giveDrugBtn')?.addEventListener('click', handleDrugAction);

  $('#saveDispositionBtn')?.addEventListener('click', () => {
    const input = $('#dispositionInput');
    if (!input) return;
    const text = input.value.trim();
    const result = $('#dispositionResultBox');
    if (result) result.textContent = text || 'Plan kaydedildi.';
    appendLog({
      section: 'disposition',
      actionType: 'set_disposition',
      key: null,
      result: text,
      scoreDelta: 0
    });
  });

  $('#submitDiagnosisBtn')?.addEventListener('click', handleDiagnosisSubmit);

  $('#llmToggle')?.addEventListener('change', e => {
    window.llmEnabled = e.target.checked;
  });

  $('#resetCaseBtn')?.addEventListener('click', () => {
    if (!currentCase || !scoreManager) return;
    scoreManager.reset();
    updateScoreUI();
    clearLog();
    setTextContent('#labResultBox', '');
    setTextContent('#imagingResultBox', '');
    setTextContent('#procedureResultBox', '');
    setTextContent('#drugResultBox', '');
    const dispositionResult = $('#dispositionResultBox');
    if (dispositionResult) dispositionResult.textContent = currentCase.disposition || '';
    const diagnosisInput = $('#diagnosisInput');
    if (diagnosisInput) diagnosisInput.value = '';
    setTextContent('#diagnosisResultBox', '');
    resetSelectionState();
    resetRequestQueue();
  });

  syncScoreToSession();
}

function initFlowControls() {
  $all('[data-step-submit]').forEach(btn => {
    btn.addEventListener('click', () => handleFlowSubmit(btn.dataset.stepSubmit));
  });
  ['anamnez', 'muayene', 'tetkik', 'tani'].forEach(step => {
    const sel = $(`#${step}Select`);
    if (sel) {
      sel.addEventListener('change', () => setActiveFlowStep(step));
      sel.addEventListener('focus', () => setActiveFlowStep(step));
    }
  });
  setActiveFlowStep(activeFlowStep);
}

function initSearchFilters() {
  $all('[data-search-target]').forEach(input => {
    const select = document.getElementById(input.dataset.searchTarget);
    if (!select) return;
    const binding = { input, select };
    input.addEventListener('input', () => filterSelectOptions(binding));
    searchFilters.push(binding);
  });
}

function refreshSearchSources() {
  searchFilters.forEach(binding => {
    const { input, select } = binding;
    if (!input || !select) return;
    const source = [...select.options].map(opt => ({ value: opt.value, text: opt.textContent }));
    input.dataset.source = JSON.stringify(source);
    filterSelectOptions(binding, false);
  });
}

function filterSelectOptions(binding, allowEmpty = true) {
  const { input, select } = binding;
  if (!input || !select) return;
  const source = JSON.parse(input.dataset.source || '[]');
  const prevValue = select.value;
  const term = (input.value || '').toLowerCase();
  const filtered = term ? source.filter(item => item.text.toLowerCase().includes(term)) : source;

  select.innerHTML = '';
  const list = filtered.length || !allowEmpty ? filtered : source;
  if (!list.length) {
    select.appendChild(createEl('option', { text: 'Sonuç yok', attrs: { value: '', disabled: true } }));
    select.disabled = true;
    return;
  }

  list.forEach(item => {
    const opt = createEl('option', { text: item.text, attrs: { value: item.value } });
    select.appendChild(opt);
  });
  select.disabled = false;
  select.value = list.some(item => item.value === prevValue) ? prevValue : list[0].value;
}

function initQuickRails() {
  $all('[data-quick-action]').forEach(btn => {
    btn.addEventListener('click', () => handleQuickRailAction(btn.dataset.quickAction));
  });
}

function getQuickActionOptions(actionKey, action) {
  const normalized = normalizeSectionKey(actionKey || action?.submitStep);
  const caseOpts = collectCaseSpecificOptions(normalized) || [];
  const standard = getStandardOptions(normalized);
  if (normalized === 'labs') {
    const labKeys = Object.keys(currentCase?.labs || {}).filter(k => k !== 'default');
    const merged = [...new Set([...labKeys, ...standard])];
    const categories = buildOptionCategories('labs', labKeys, standard);
    return { options: merged.map(key => ({ value: key, label: key })), categories };
  }
  if (normalized === 'imaging') {
    const keys = Object.keys(currentCase?.imaging || {}).filter(k => k !== 'default');
    const merged = [...new Set([...keys, ...standard])];
    const categories = buildOptionCategories('imaging', keys, standard);
    return { options: merged.map(key => ({ value: key, label: key })), categories };
  }
  if (normalized === 'procedures') {
    const keys = Object.keys(currentCase?.procedures || {}).filter(k => k !== 'default');
    const merged = [...new Set([...keys, ...standard])];
    return { options: merged.map(key => ({ value: key, label: key })) };
  }
  if (normalized === 'drugs') {
    const drugs = currentCase?.drugs || [];
    const caseDrugs = drugs.map((drug, idx) => ({
      value: String(idx),
      label: drug.name || `İlaç ${idx + 1}`
    }));
    const merged = [...caseDrugs, ...standard.map((name, idx) => ({ value: `std-${idx}`, label: name }))];
    return { options: merged };
  }
  const flowOptions = flowDefaults?.flowOptions?.[action?.submitStep || normalized] || [];
  const merged = [...new Set([...flowOptions, ...caseOpts, ...standard])];
  return { options: merged.map(item => ({ value: item, label: item })) };
}

function openOptionPickerModal({ title, description, options, categories = null, multiSelect = false, onSelect }) {
  const overlay = $('#studentModalOverlay');
  const body = $('#studentModalBody');
  if (!overlay || !body) return;
  $('#studentModalTitle').textContent = title;

  const optionListId = 'quickOptionList';
  const searchId = 'quickOptionSearch';
  body.innerHTML = `
    <p class="muted">${description || 'Listeden bir seçenek seçebilirsin.'}</p>
    <input id="${searchId}" type="search" class="option-search" placeholder="Ara..." />
    <div id="${optionListId}" class="option-list"></div>
  `;

  const listEl = document.getElementById(optionListId);
  const searchEl = document.getElementById(searchId);

  const flatOptions = options || [];
  const grouped = categories || [{ label: null, items: flatOptions }];

  const renderList = items => {
    if (!listEl) return;
    listEl.innerHTML = '';
    if (!items.length) {
      listEl.appendChild(createEl('div', { text: 'Seçenek bulunamadı.', className: 'muted' }));
      return;
    }
    items.forEach(group => {
      if (group.label) {
        const hdr = createEl('div', { text: group.label, className: 'pill-meta' });
        listEl.appendChild(hdr);
      }
      group.items.forEach(item => {
        if (multiSelect) {
          const wrapper = createEl('label', { className: 'option-row' });
          const cb = createEl('input', {
            attrs: { type: 'checkbox', value: item.value, 'data-option-value': item.value }
          });
          const txt = createEl('span', { text: item.label });
          wrapper.appendChild(cb);
          wrapper.appendChild(txt);
          listEl.appendChild(wrapper);
        } else {
          const btn = createEl('button', {
            text: item.label,
            className: 'btn block ghost',
            attrs: { type: 'button', 'data-option-value': item.value }
          });
          listEl.appendChild(btn);
        }
      });
    });
  };

  renderList(grouped);

  if (multiSelect) {
    setModalActions([
      { text: 'Vazgeç', className: 'btn ghost', attrs: { 'data-close-student-modal': '' } },
      { text: 'Uygula', className: 'btn primary', attrs: { id: 'applyMultiOptions' } }
    ]);
    $('#applyMultiOptions')?.addEventListener('click', () => {
      const selected = Array.from(listEl.querySelectorAll('input[type="checkbox"]:checked')).map(
        el => el.dataset.optionValue || el.value
      );
      if (selected.length) onSelect?.(selected);
      closeStudentModal();
    });
  } else {
    listEl?.addEventListener('click', evt => {
      const btn = evt.target.closest('[data-option-value]');
      if (!btn) return;
      const value = btn.dataset.optionValue;
      onSelect?.(value);
      closeStudentModal();
    });
    setModalActions([{ text: 'Kapat', className: 'btn ghost', attrs: { 'data-close-student-modal': '' } }]);
  }

  searchEl?.addEventListener('input', () => {
    const term = searchEl.value.toLowerCase();
    const filtered = grouped
      .map(g => ({
        label: g.label,
        items: g.items.filter(opt => opt.label.toLowerCase().includes(term))
      }))
      .filter(g => g.items.length);
    renderList(filtered);
  });

  openStudentModal();
}

function openInfoModal(title, content) {
  const body = $('#studentModalBody');
  if (!body) return;
  $('#studentModalTitle').textContent = title;
  body.innerHTML = `<p>${content}</p>`;
  setModalActions();
  openStudentModal();
}

function openInputModal({ title, prompt, defaultValue = '', onConfirm }) {
  const body = $('#studentModalBody');
  if (!body) return;
  $('#studentModalTitle').textContent = title;
  body.innerHTML = `
    <p>${prompt}</p>
    <input type="text" id="quickInputField" value="${defaultValue}" />
  `;
  setModalActions([
    { text: 'Kaydet', className: 'btn primary', attrs: { id: 'quickInputConfirm' } },
    { text: 'Vazgeç', className: 'btn ghost', attrs: { 'data-close-student-modal': '' } }
  ]);
  openStudentModal();
  $('#quickInputConfirm')?.addEventListener('click', () => {
    const val = $('#quickInputField')?.value?.trim();
    if (val) onConfirm?.(val);
    closeStudentModal();
  });
}

function handleQuickRailAction(actionKey) {
  if (!enforceCaseUnlock()) return;
  const action = QUICK_ACTIONS[actionKey];
  if (!action) return;

  if (action.showTextId) {
    const text = $(`#${action.showTextId}`)?.textContent?.trim() || 'Bilgi yok.';
    openInfoModal(action.label, text);
    return;
  }

  if (action.prompt) {
    openInputModal({
      title: action.label,
      prompt: action.prompt,
      defaultValue: $('#diagnosisInput')?.value || '',
      onConfirm: action.onConfirm
    });
    return;
  }

  const { options, categories } = getQuickActionOptions(actionKey, action);
  if (!options.length) {
    showNotice('Seçenek bulunamadı', 'warning');
    return;
  }

  const multiSelect = ['laboratuvar', 'goruntuleme'].includes(actionKey);
  openOptionPickerModal({
    title: action.label,
    description: 'Butonu uygulamak için bir seçenek seç.',
    options,
    categories,
    multiSelect,
    onSelect: value => {
      const values = Array.isArray(value) ? value : [value];
      values.forEach(val => {
        if (action.selectId) {
          const select = $(`#${action.selectId}`);
          if (select) select.value = val;
        }
        if (action.submitStep) handleFlowSubmit(action.submitStep, val);
        if (typeof action.handler === 'function') action.handler(val);
      });
    }
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
  const normalized = normalizeSectionKey(step);
  step = normalized;
  if (step === 'anamnez' || step === 'hikaye') return [];
  if (step === 'muayene') return [];
  if (step === 'tetkik' || step === 'labs') return [];
  if (step === 'imaging') return [];
  if (step === 'procedures') return [];
  if (step === 'drugs') return (currentCase.drugs || []).map(d => d.name).filter(Boolean);
  if (step === 'tani') {
    const drugs = (currentCase.drugs || []).map(d => d.name).filter(Boolean);
    return [currentCase.final_diagnosis, ...drugs].filter(Boolean);
  }
  return [];
}

async function handleFlowSubmit(step, choiceOverride = null) {
  if (!enforceCaseUnlock()) return;
  const select = $(`#${step}Select`);
  const choice = choiceOverride ?? select?.value;
  if (!choice) return;

  setActiveFlowStep(step);
  const tabMap = { anamnez: 'story', hikaye: 'story', muayene: 'exam' };
  if (tabMap[step]) {
    activateTab(tabMap[step]);
  }

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

  if (['anamnez', 'muayene', 'hikaye'].includes(step)) {
    recordAnamnezMuayene(step, choice);
    if (step === 'muayene') {
      showExamAlert(choice);
    }
  }

  const flowResult = getFlowResult(step, choice);
  if (flowResult && !['anamnez', 'muayene', 'hikaye'].includes(step)) {
    appendResultToDetails(step, choice, flowResult);
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

function setActiveFlowStep(step) {
  activeFlowStep = step;
  const label = $('#activeStepLabel');
  if (!label) return;
  const titles = {
    anamnez: 'Anamnez',
    hikaye: 'Hikaye',
    muayene: 'Muayene',
    tetkik: 'Tetkik',
    tani: 'Tanı/Tedavi'
  };
  label.textContent = `Aktif adım: ${titles[step] || step}`;
}

function handleQuickApply() {
  if (!activeFlowStep) return;
  // Quick apply now opens the related quick action picker
  const actionKey = activeFlowStep === 'tetkik' ? 'laboratuvar' : activeFlowStep;
  handleQuickRailAction(actionKey);
}

async function handleKeyedAction(fieldName, scoreType, selectEl, resultBox, keyOverride) {
  if (!enforceCaseUnlock()) return;
  if (!currentCase || !scoreManager) return;
  const key = keyOverride || selectEl?.value || promptForKey(fieldName);
  if (!key) return;

  const staticResult = getActionResult(fieldName, key);
  const isUnnecessary = !currentCase[fieldName] || currentCase[fieldName][key] == null;

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

  const scoreDelta = scoreManager.applyPenalty(scoreType, { unnecessary: isUnnecessary });
  updateScoreUI();
  appendLog({
    section: fieldName,
    actionType: scoreType,
    key,
    result: 'İstek kuyruğuna eklendi.',
    scoreDelta
  });
  if (['labs', 'imaging', 'procedures'].includes(fieldName)) {
    enqueueRequest(fieldName, key, resultText);
  } else {
    if (resultBox) resultBox.textContent = resultText;
  }
  syncScoreToSession();
}

async function handleDrugAction(keyOverride = null) {
  if (!enforceCaseUnlock()) return;
  if (!currentCase || !scoreManager) return;
  const drugs = currentCase.drugs || [];
  let drug = null;
  let doseText = '';

  const resolveFromValue = value => {
    if (value == null) return null;
    const strVal = String(value);
    if (strVal.startsWith('std-')) {
      const idx = parseInt(strVal.split('-').pop(), 10);
      const name = STANDARD_OPTIONS.drugs?.[idx] || 'İlaç';
      return {
        drug: { name, doses: ['Standart doz'], response: 'Tedavi uygulandı.' },
        doseIdx: 0
      };
    }
    const num = parseInt(strVal, 10);
    if (!Number.isNaN(num) && drugs[num]) return { drug: drugs[num], doseIdx: 0 };
    const byName = drugs.find(d => (d.name || '').toLowerCase() === strVal.toLowerCase());
    if (byName) return { drug: byName, doseIdx: 0 };
    // Standart havuzdan serbest isim
    return {
      drug: { name: strVal || 'İlaç', doses: ['Standart doz'], response: 'Tedavi uygulandı.' },
      doseIdx: 0
    };
  };

  if (keyOverride != null) {
    const found = resolveFromValue(keyOverride);
    drug = found?.drug;
    doseText = found?.drug?.doses?.[found.doseIdx] || '';
  } else {
    const drugIdx = getSelectedIndex($('#drugSelect'));
    if (drugIdx != null && drugs[drugIdx]) {
      drug = drugs[drugIdx];
      const doseIdx = getSelectedIndex($('#doseSelect')) ?? 0;
      doseText = drug.doses?.[doseIdx] ?? '';
      if (!doseText && Array.isArray(drug.doses) && drug.doses.length > 1) {
        const doseOptions = drug.doses.map((d, i) => ({ value: String(i), label: d }));
        openOptionPickerModal({
          title: 'Doz seç',
          options: doseOptions,
          onSelect: val => {
            const idx = parseInt(val, 10);
            const dt = drug.doses?.[idx] ?? '';
            handleDrugActionWithSelection(drug, dt);
          }
        });
        return;
      }
    }
  }

  if (!drug) return;
  handleDrugActionWithSelection(drug, doseText);
}

async function handleDrugActionWithSelection(drug, doseText) {
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
  const label = doseText ? `${drug.name} (${doseText})` : drug.name;
  const uniqueKey = `${label} ${formatTime(new Date())}`;
  appendResultToDetails('drugs', uniqueKey, resultText);
  recordRequestAndResult('drugs', uniqueKey, resultText);

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
  if (!enforceCaseUnlock()) return;
  if (!currentCase || !scoreManager) return;
  const inputDx = $('#diagnosisInput').value.trim();
  if (!inputDx) return;

  const correctDx = (currentCase.final_diagnosis || '').trim();
  const evaluation = evaluateCaseScore({
    scoringConfig: currentCase.scoring,
    selectionState,
    flowHistory,
    diagnosisInput: inputDx,
    expectedDiagnosis: correctDx,
    elapsedMs: scoreManager.getElapsedMs()
  });
  scoreManager.applyFinalEvaluation(evaluation);
  updateScoreUI();

  const briefing = buildEvaluationBriefing(evaluation);
  $('#diagnosisResultBox').innerHTML = briefing.html;
  showNotice(briefing.notice, evaluation.diagnosis?.isCorrect ? 'success' : 'warning');

  appendLog({
    section: 'diagnosis',
    actionType: 'submit_diagnosis',
    key: null,
    result: briefing.notice,
    scoreDelta: evaluation.total
  });
  syncScoreToSession();
}

function buildEvaluationBriefing(evaluation) {
  if (!evaluation) {
    return { html: 'Değerlendirme bulunamadı.', notice: 'Skor hesaplanamadı.' };
  }
  const categoryLabels = {
    muayene: 'Muayene',
    istek: 'İstek',
    tedavi: 'Tedavi',
    tani: 'Tanı'
  };

  const categoryParts = Object.entries(evaluation.categories || {}).map(([key, val]) => {
    const label = categoryLabels[key] || key;
    return `${label} ${val}/100`;
  });

  const findings = (evaluation.findings || []).map(item => {
    const deltaTxt = item.delta > 0 ? `+${item.delta}` : `${item.delta}`;
    const label = categoryLabels[item.category] || item.category;
    return `<li>${label}: ${escapeHtml(item.reason)} (${deltaTxt})</li>`;
  });

  const notice = `Genel skor ${evaluation.total}/100 | ${categoryParts.join(' | ')}`;
  const findingsHtml = findings.length ? `<ul>${findings.join('')}</ul>` : '<p>Ek not yok.</p>';
  const html = `<strong>${notice}</strong><br/>${findingsHtml}`;
  return { html, notice };
}

function updateScoreUI() {
  $('#currentScore').textContent = scoreManager.currentScore;
  const bestScore = $('#bestScore');
  if (bestScore) {
    bestScore.textContent = scoreManager.bestScore != null ? scoreManager.bestScore : '-';
  }
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
    if (sessionFollowerId) {
      updateSessionGate(true, 'Host bağlantısı bekleniyor.');
    }
    return;
  }
  const parts = [`Durum: ${snapshot.status || 'bilinmiyor'}`];
  if (snapshot.activeCaseId) parts.push(`Aktif vaka: ${snapshot.activeCaseId}`);
  if (snapshot.timerRunning) parts.push('Süre çalışıyor');
  updateSessionStatus(parts.join(' | '));
  updateCaseStatusBadge(snapshot);
  updateRemainingTime();
  if (sessionFollowerId) {
    const isLive = LIVE_STATUSES.includes(snapshot.status);
    const ready = isLive && snapshot.activeCaseId;
    const completed = snapshot.status === 'completed';
    const message = ready
      ? 'Vaka açıldı, başlayabilirsin.'
      : completed
        ? 'Vaka tamamlandı.'
        : 'Host vakayı başlatmadı.';
    updateSessionGate(!ready, message);
  }
  if (snapshot.activeCaseId && snapshot.activeCaseId !== currentCase?.id) {
    loadCaseById(snapshot.activeCaseId);
  }
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
    payload.timerRunning = true;
    payload.timerStartedAt = Date.now();
    payload.timerStoppedAt = null;
  } else if (action === 'endCase') {
    payload.status = 'completed';
    payload.activeCaseId = currentCase?.id ?? null;
    payload.timerRunning = false;
    payload.timerStartedAt = null;
    payload.timerStoppedAt = Date.now();
  } else if (action === 'nextCase') {
    const nextCase = findNextCase();
    if (nextCase) {
      loadCaseById(nextCase.id);
      payload.activeCaseId = nextCase.id;
    }
    payload.status = 'pending';
    payload.timerRunning = false;
    payload.timerStartedAt = null;
    payload.timerStoppedAt = null;
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
      showNotice(message, 'info');
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

  // Anamnez/hikaye/muayene seçimlerini Hasta Detayları alanına biriktir
  if (step === 'muayene') {
    const vitals = currentCase?.exam?.vitals;
    const physical = currentCase?.exam?.physical;
    const merged = [vitals, physical].filter(Boolean).join(' | ');
    const note = `${choice}: ${merged || 'Muayene bulgusu kaydedildi.'}`;
    appendResultToDetails('muayene', choice, note);
  } else if (step === 'anamnez' || step === 'hikaye') {
    const storyText = currentCase?.story || 'Anamnez/hikaye kaydı.';
    const note = `${choice}: ${storyText}`;
    appendResultToDetails(step, choice, note);
  }
}

function recordRequestAndResult(section, key, result) {
  const base = { id: uuid(), section, key, createdAt: Date.now() };
  selectionState.sonuclar = [{ ...base, result }, ...selectionState.sonuclar].slice(0, 30);
  renderSelectionLists({ animateResults: true });
}

function resolveEntryResult(entry) {
  if (!entry) return 'Sonuç hazır.';
  if (entry.resultText) return entry.resultText;
  const source = currentCase?.[entry.section] || {};
  return source[entry.key] ?? source.default ?? 'Sonuç hazır.';
}

function appendResultToDetails(section, key, resultText) {
  const map = {
    labs: ['#tab-labs #labResultBox', '#labResultBox'],
    imaging: ['#tab-imaging #imagingResultBox', '#imagingResultBox'],
    procedures: ['#tab-procedures #procedureResultBox', '#procedureResultBox'],
    drugs: ['#tab-drugs #drugResultBox', '#drugResultBox'],
    anamnez: ['#tab-story #storyText', '#storyText'],
    hikaye: ['#tab-story #storyText', '#storyText'],
    muayene: ['#tab-exam #examPhysical', '#examPhysical']
  };
  const target = map[section];
  if (!target) return;
  const selectors = Array.isArray(target) ? target : [target];
  const box = selectors.map(sel => $(sel)).find(Boolean);
  if (!box) return;
  const entryKey = `${section}::${key || ''}`;
  box.classList.add('result-box');
  const markup = `<strong>${escapeHtml(key || formatSection(section))}</strong> <span class="pill-meta">${formatTime(
    Date.now()
  )}</span><br/><span class="muted mini">${escapeHtml(resultText || 'Sonuç hazır.')}</span>`;
  const existing = box.querySelector(`[data-entry-key="${entryKey}"]`);
  if (existing) {
    existing.innerHTML = markup;
    return;
  }
  const row = createEl('div', {
    className: 'result-entry',
    attrs: { 'data-entry-key': entryKey },
    html: markup
  });
  box.appendChild(row);
}

function getFlowResult(step, choice) {
  if (step === 'anamnez' || step === 'hikaye') {
    return `${choice}: kayıt edildi.`;
  }
  if (step === 'muayene') {
    return `${choice}: muayene kaydı.`;
  }
  return choice;
}

function getStandardOptions(section) {
  const normalized = normalizeSectionKey(section);
  return STANDARD_OPTIONS[normalized] || [];
}

function buildOptionCategories(section, caseKeys = [], standardList = []) {
  const preset = OPTION_CATEGORIES[section] || [];
  const categories = preset.map(group => ({
    label: group.label,
    items: (group.items || [])
      .filter(Boolean)
      .map(val => ({ value: val, label: val }))
  }));
  const extras = (caseKeys || []).filter(k => !standardList.includes(k));
  if (extras.length) {
    categories.unshift({
      label: 'Vaka özel',
      items: extras.map(val => ({ value: val, label: val }))
    });
  }
  return categories.filter(cat => cat.items.length);
}

function randomInRange(min, max, digits = 1) {
  const val = min + Math.random() * (max - min);
  return Number(val.toFixed(digits));
}

function generateLabResult(key) {
  const normalized = (key || '').toLowerCase();
  if (normalized.includes('tam kan') || normalized.includes('hemogram')) {
    return `Hb ${randomInRange(12.5, 15, 1)} g/dL, WBC ${randomInRange(4.5, 10.5, 1)}k, PLT ${Math.round(
      randomInRange(170, 340, 0)
    )}k`;
  }
  if (normalized.includes('elektrolit') || normalized.includes('bmp')) {
    return `Na ${randomInRange(136, 144, 0)} mEq/L, K ${randomInRange(3.5, 4.9, 1)} mEq/L, Kreatinin ${randomInRange(
      0.7,
      1.1,
      1
    )} mg/dL`;
  }
  if (normalized.includes('pt') || normalized.includes('inr')) {
    return `PT 12 sn, INR ${randomInRange(0.9, 1.1, 2)}`;
  }
  if (normalized.includes('troponin')) {
    return `Troponin I ${randomInRange(0.0, 0.04, 2)} ng/mL (normal)`;
  }
  if (normalized.includes('crp')) {
    return `CRP ${randomInRange(0.1, 0.5, 1)} mg/dL (normal)`;
  }
  if (normalized.includes('gaz')) {
    return `pH ${randomInRange(7.37, 7.43, 2)}, PaCO2 ${randomInRange(36, 44, 0)} mmHg, HCO3 ${randomInRange(
      22,
      26,
      0
    )} mEq/L`;
  }
  return 'Değerler normal sınırlarda.';
}

function generateDefaultResult(section, key) {
  if (section === 'labs') return generateLabResult(key);
  if (section === 'imaging') return 'Görüntülemede akut patoloji saptanmadı.';
  if (section === 'procedures') return 'İşlem komplikasyonsuz tamamlandı.';
  if (section === 'anamnez' || section === 'hikaye') return `${key}: bilgi notu kaydedildi.`;
  if (section === 'muayene') return `${key}: normal sınırlarda bulgular.`;
  return 'İşlem kaydedildi.';
}

function getActionResult(section, key) {
  const source = currentCase?.[section] || {};
  const hasCaseValue = Object.prototype.hasOwnProperty.call(source, key);
  const staticResult = hasCaseValue ? source[key] : source.default;
  const lowered = (staticResult || '').toLowerCase();
  const placeholderPhrases = ['kaydı yok', 'kayıt yok', 'kayit yok', 'sonuç yok', 'sonuc yok', 'kayıt bulunamadı'];
  const placeholder = placeholderPhrases.some(phrase => lowered.includes(phrase));
  if (staticResult && !placeholder) return staticResult;
  return generateDefaultResult(section, key);
}

function populateIcd10List() {
  const list = $('#icd10List');
  if (!list) return;
  list.innerHTML = '';
  ICD10_SUGGESTIONS.forEach(item => {
    const opt = createEl('option', { text: `${item.code} - ${item.label}` });
    opt.value = `${item.code} - ${item.label}`;
    list.appendChild(opt);
  });
}

function enqueueRequest(section, key, resultText, targetWaitOverride) {
  const entry = {
    id: uuid(),
    section,
    key,
    requestedAt: Date.now(),
    waitedMinutes: 0,
    targetWait: Math.max(targetWaitOverride ?? WAIT_TIME_BY_SECTION[section] ?? 15, 1),
    resultText
  };
  const requestRecord = { id: entry.id, section, key, createdAt: entry.requestedAt };
  selectionState.istekler = [requestRecord, ...selectionState.istekler].slice(0, 30);
  requestQueue.unshift(entry);
  renderRequestQueue();
  renderSelectionLists();
}

function resetSelectionState() {
  selectionState.anamnezMuayene = [];
  selectionState.istekler = [];
  selectionState.sonuclar = [];
  animatedResultIds.clear();
  usedOptions.clear();
  renderSelectionLists();
}

function resetRequestQueue() {
  requestQueue.length = 0;
  simulatedMinutes = 0;
  renderRequestQueue();
  updateCaseStatusLocal('stabil');
  updateVirtualTimeDisplay();
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
  const dock = document.querySelector('.floating-requests');
  if (!list) return;
  list.innerHTML = '';
  if (!requestQueue.length) {
    if (dock) dock.hidden = true;
    updateQueueCount();
    return;
  }
  requestQueue
    .slice(0, 20)
    .forEach(item => {
      const meta = createEl('div', { text: `${item.waitedMinutes}/${item.targetWait} dk`, className: 'pill-meta' });
      const label = createEl('div', {
        text: `${formatSection(item.section)} · ${item.key}`
      });
      const actions = createEl('div', { className: 'queue-actions' });
      const applyBtn = createEl('button', {
        text: 'Uygula',
        className: 'btn ghost tiny',
        attrs: { 'data-request-action': 'apply', 'data-request-id': item.id }
      });
      const cancelBtn = createEl('button', {
        text: 'İptal',
        className: 'btn danger ghost tiny',
        attrs: { 'data-request-action': 'cancel', 'data-request-id': item.id }
      });
      actions.appendChild(applyBtn);
      actions.appendChild(cancelBtn);
      const li = createEl('li', { className: 'queue-item' });
      li.appendChild(label);
      li.appendChild(meta);
      li.appendChild(actions);
      list.appendChild(li);
    });
    if (dock) dock.hidden = false;
    updateQueueCount();
  }

function updateQueueCount() {
  const countEl = $('#queueCount');
  if (!countEl) return;
  const count = requestQueue.length;
  countEl.textContent = count ? `${count} bekleyen` : 'Bekleyen yok';
}

function updateVirtualTimeDisplay() {
  const label = $('#virtualTime');
  if (label) {
    label.textContent = `${simulatedMinutes} dk`;
  }
  const dockLabel = $('#virtualTimeDock');
  if (dockLabel) {
    dockLabel.textContent = `${simulatedMinutes} dk`;
  }
}

function showExamAlert(choice) {
  const message = `Muayene seçimin kaydedildi: ${choice}`;
  showNotice(message, 'success');
}

function showRequestModal(section, key, resultText) {
  const title = `${formatSection(section)} isteği`;
  const overlay = $('#studentModalOverlay');
  const body = $('#studentModalBody');
  if (!overlay || !body) return;
  $('#studentModalTitle').textContent = title;
  body.innerHTML = `<p><strong>${key}</strong> için yanıt:</p><p>${resultText}</p>`;
  setModalActions();
  openStudentModal();
}

function openDiagnosisModal() {
  if (!enforceCaseUnlock()) return;
  const overlay = $('#studentModalOverlay');
  const body = $('#studentModalBody');
  if (!overlay || !body) return;
  const expectedDx = currentCase?.final_diagnosis || 'Final tanı';
  $('#studentModalTitle').textContent = 'Tanı ve Planı Tamamla';
  const options = [
    `Tanı: ${expectedDx}`,
    'Yoğun bakıma yatır',
    'Servise yatır',
    'Acil ameliyat planla',
    'Taburcu & poliklinik kontrol'
  ];
  body.innerHTML = `<p>Hızlı tanı ve plan seç. Seçim vaka için kaydedilir.</p>
    <form id="diagnosisQuickForm" class="option-list">${options
      .map((opt, idx) => `<label><input type="radio" name="diagnosisOption" value="${opt}" ${idx === 0 ? 'checked' : ''}/> ${opt}</label>`)
      .join('')}</form>`;
  setModalActions([
    { text: 'Kaydet', className: 'btn primary', attrs: { id: 'confirmDiagnosisBtn' } },
    { text: 'Vazgeç', className: 'btn ghost', attrs: { 'data-close-student-modal': '' } }
  ]);
  openStudentModal();
  $('#confirmDiagnosisBtn')?.addEventListener('click', () => {
    const form = $('#diagnosisQuickForm');
    if (!form) return;
    const data = new FormData(form);
    const choice = data.get('diagnosisOption');
    finalizeDiagnosisSelection(choice);
    closeStudentModal();
  });
}

function finalizeDiagnosisSelection(choice) {
  if (!choice) return;
  const diagnosisInput = $('#diagnosisInput');
  const diagnosisBox = $('#diagnosisResultBox');
  if (diagnosisInput) diagnosisInput.value = choice;
  if (diagnosisBox) diagnosisBox.textContent = `Tanı/plan: ${choice}`;
  appendLog({
    section: 'diagnosis',
    actionType: 'diagnosis',
    key: choice,
    result: 'Tanı/plan kaydedildi.',
    scoreDelta: 0
  });
  const expectedDx = currentCase?.final_diagnosis || '';
  const normalizedChoice = choice.toLowerCase();
  const isAligned = expectedDx && normalizedChoice.includes(expectedDx.toLowerCase());
  const summaryLines = [
    `Seçim: ${choice}`,
    `Beklenen tanı ile uyum: ${isAligned ? 'Evet' : 'Hayır'}`,
    `Kaydedilen adım: ${flowHistory.length} seçim`
  ];
  showNotice(summaryLines.join(' • '), isAligned ? 'success' : 'info');
}

function handleShowResults() {
  if (!enforceCaseUnlock()) return;
  const remainingTimes = requestQueue.map(item => Math.max((item.targetWait || 0) - (item.waitedMinutes || 0), 0));
  const maxRemaining = remainingTimes.length ? Math.max(...remainingTimes) : 0;
  const increment = maxRemaining > 0 ? maxRemaining : 15;
  simulatedMinutes += increment;
  requestQueue.forEach(item => {
    item.waitedMinutes = Math.min(item.targetWait, (item.waitedMinutes || 0) + increment);
  });
  updateVirtualTimeDisplay();
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
  showNotice(`Geçen süre +${increment} dk. ${feedback}`, 'info');
}

function applyRequest(id) {
  const idx = requestQueue.findIndex(item => item.id === id);
  if (idx < 0) return;
  const entry = requestQueue[idx];
  const remaining = Math.max((entry.targetWait || 0) - (entry.waitedMinutes || 0), 0);
  if (remaining > 0) {
    simulatedMinutes += remaining;
    updateVirtualTimeDisplay();
  }
  requestQueue.splice(idx, 1);
  const resultText = resolveEntryResult(entry);
  recordRequestAndResult(entry.section, entry.key, resultText);
  appendResultToDetails(entry.section, entry.key, resultText);
  renderRequestQueue();
}

function cancelRequest(id) {
  const idx = requestQueue.findIndex(item => item.id === id);
  if (idx < 0) return;
  const entry = requestQueue[idx];
  requestQueue.splice(idx, 1);
  appendLog({
    section: entry.section,
    actionType: 'cancel_request',
    key: entry.key,
    result: 'İstek iptal edildi.',
    scoreDelta: 0
  });
  renderRequestQueue();
}

function applyAllRequests() {
  const ids = requestQueue.map(item => item.id);
  ids.forEach(applyRequest);
}

function cancelAllRequests() {
  const ids = requestQueue.map(item => item.id);
  ids.forEach(cancelRequest);
}

function evaluateScenarioRules() {
  const triggered = SCENARIO_RULES.filter(rule => rule.predicate());
  const status = triggered.find(rule => rule.status === 'kötüleşti') ? 'kötüleşti' : 'stabil';
  return {
    status,
    messages: triggered.map(rule => rule.message)
  };
}

function initCollapsibles() {
  $all('[data-collapsible]').forEach(wrapper => {
    const trigger = wrapper.querySelector('.collapsible-trigger');
    const body = wrapper.querySelector('.collapsible-body');
    if (!trigger || !body) return;
    body.hidden = true;
    trigger.addEventListener('click', () => {
      const expanded = trigger.getAttribute('aria-expanded') === 'true';
      trigger.setAttribute('aria-expanded', String(!expanded));
      body.hidden = expanded;
    });
  });
}

function initRequestDock() {
  const list = $('#requestQueueList');
  if (!list) return;
  list.addEventListener('click', evt => {
    const btn = evt.target.closest('[data-request-action]');
    if (!btn) return;
    const id = btn.dataset.requestId;
    if (!id) return;
    if (btn.dataset.requestAction === 'apply') {
      applyRequest(id);
    } else if (btn.dataset.requestAction === 'cancel') {
      cancelRequest(id);
    }
  });
  $('#applyAllBtn')?.addEventListener('click', applyAllRequests);
  $('#cancelAllBtn')?.addEventListener('click', cancelAllRequests);
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
  attachModalCloseHandlers();
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

function setModalActions(configs = []) {
  const actionsEl = $('.modal-actions');
  if (!actionsEl) return;
  const buttons = configs.length
    ? configs
    : [{ text: 'Tamam', className: 'btn', attrs: { 'data-close-student-modal': '' } }];

  actionsEl.innerHTML = '';
  buttons.forEach(cfg => {
    const btn = createEl('button', {
      text: cfg.text || 'Kapat',
      className: cfg.className || 'btn',
      attrs: { type: 'button', ...(cfg.attrs || {}) }
    });
    actionsEl.appendChild(btn);
  });
  attachModalCloseHandlers();
}

function attachModalCloseHandlers() {
  const overlay = $('#studentModalOverlay');
  if (!overlay) return;
  overlay.querySelectorAll('[data-close-student-modal]').forEach(btn => {
    btn.addEventListener('click', closeStudentModal);
  });
}

function formatSection(section) {
  if (section === 'labs') return 'Laboratuvar';
  if (section === 'imaging') return 'Görüntüleme';
  if (section === 'muayene') return 'Muayene';
  if (section === 'procedures') return 'Prosedür';
  if (section === 'scenario') return 'Senaryo';
  return section;
}






