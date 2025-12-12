// ui.js ve data.js'e ihtiyacımız var ama tek dosyada basitleştirilmiş halini yazıyorum.
// Eğer modül sistemin varsa importları koru.

/* --- MOCK DATA & CONFIG (Dosyadan okuyormuş gibi) --- */
const STANDARD_SETS = {
  labs: ["Tam Kan", "BUN/Kreatinin", "Elektrolit", "Glukoz", "Karaciğer Fonk.", "Troponin", "D-dimer", "Kan Gazı", "CRP"],
  imaging: ["Akciğer Grafisi", "EKG", "Abdomen USG", "Beyin BT", "Toraks BT", "FAST USG"],
  procedures: ["Damar Yolu", "Oksijen", "Monitorizasyon", "Entübasyon", "Foley Kateter"],
  drugs: ["Parasetamol", "Aspirin", "Nitrogliserin", "Adrenalin", "Atropin", "Serum Fizyolojik", "Lidokain", "Furosemid"]
};

let casesData = { cases: [], featured_case_id: null };
let currentIndex = 0;

/* --- MAIN INIT --- */
document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initVitalSync();
    setupEventListeners();
    
    // Varsayılan: Boş başla veya LocalStorage'dan yükle
    loadFromLocal();
    renderQuickPickers();
});

function setupEventListeners() {
    document.getElementById('addCaseBtn').addEventListener('click', addNewCase);
    document.getElementById('deleteCaseBtn').addEventListener('click', deleteCurrentCase);
    document.getElementById('downloadJsonBtn').addEventListener('click', downloadJson);
    document.getElementById('saveToLocalBtn').addEventListener('click', saveToLocal);
    document.getElementById('jsonFileInput').addEventListener('change', handleJsonImport);
    document.getElementById('importJsonBtn').addEventListener('click', () => document.getElementById('jsonFileInput').click());
    
    // Form input changes -> Sync to data object immediately
    document.getElementById('caseForm').addEventListener('input', (e) => {
        syncFormToData();
    });

    // Dinamik Ekleme Butonları
    document.getElementById('addLabRowBtn').addEventListener('click', () => addKvRow('labsContainer'));
    document.getElementById('addImagingRowBtn').addEventListener('click', () => addKvRow('imagingContainer'));
    document.getElementById('addDrugBtn').addEventListener('click', () => addDrugRow());
    
    // Toggle Preset Menu
    document.getElementById('toggleDrugPresets').addEventListener('click', () => {
        document.getElementById('drugPresetsList').classList.toggle('hidden');
    });

    // Arama
    document.getElementById('caseSearchInput').addEventListener('input', (e) => {
        renderCaseList(e.target.value);
    });
}

/* --- TABS SYSTEM --- */
function initTabs() {
    const buttons = document.querySelectorAll('.tab-btn');
    const panes = document.querySelectorAll('.tab-pane');

    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            // Remove active
            buttons.forEach(b => b.classList.remove('active'));
            panes.forEach(p => p.classList.remove('active'));
            // Add active
            btn.classList.add('active');
            const targetId = btn.getAttribute('data-tab');
            document.getElementById(targetId).classList.add('active');
        });
    });
}

/* --- VITAL SYNC SYSTEM (Akıllı Birleştirici) --- */
function initVitalSync() {
    const inputs = ['vitalBP', 'vitalHR', 'vitalTemp', 'vitalSat', 'vitalRR', 'vitalGCS'];
    const mainArea = document.getElementById('examVitalsInput');

    inputs.forEach(id => {
        document.getElementById(id).addEventListener('input', updateMainVitalText);
    });

    function updateMainVitalText() {
        const bp = document.getElementById('vitalBP').value;
        const hr = document.getElementById('vitalHR').value;
        const temp = document.getElementById('vitalTemp').value;
        const sat = document.getElementById('vitalSat').value;
        
        let parts = [];
        if(bp) parts.push(`TA: ${bp} mmHg`);
        if(hr) parts.push(`Nabız: ${hr} /dk`);
        if(temp) parts.push(`Ateş: ${temp} °C`);
        if(sat) parts.push(`SpO2: %${sat}`);
        
        // Eğer manuel bir şey yazıldıysa onu ezmemeye çalışmak zor, 
        // bu basit versiyonda inputlar textareayı ezer.
        if(parts.length > 0) {
            mainArea.value = parts.join(', ');
            syncFormToData();
        }
    }
}

/* --- RENDERERS --- */
function renderCaseList(filterText = '') {
    const list = document.getElementById('caseList');
    list.innerHTML = '';
    
    casesData.cases.forEach((c, idx) => {
        if(filterText && !c.title.toLowerCase().includes(filterText.toLowerCase())) return;

        const li = document.createElement('li');
        li.textContent = `${c.id} - ${c.title}`;
        if (idx === currentIndex) li.classList.add('active');
        li.addEventListener('click', () => selectCase(idx));
        list.appendChild(li);
    });
}

function renderQuickPickers() {
    // Labs
    const labArea = document.getElementById('quickLabsArea');
    STANDARD_SETS.labs.forEach(item => {
        const btn = document.createElement('button');
        btn.className = 'chip';
        btn.type = 'button';
        btn.textContent = '+ ' + item;
        btn.onclick = () => addKvRow('labsContainer', item, 'Sonuç Giriniz');
        labArea.appendChild(btn);
    });

    // Imaging
    const imgArea = document.getElementById('quickImagingArea');
    STANDARD_SETS.imaging.forEach(item => {
        const btn = document.createElement('button');
        btn.className = 'chip';
        btn.type = 'button';
        btn.textContent = '+ ' + item;
        btn.onclick = () => addKvRow('imagingContainer', item, 'Normal');
        imgArea.appendChild(btn);
    });
    
    // Drug Presets (Dropdown)
    const drugList = document.getElementById('drugPresetsList');
    STANDARD_SETS.drugs.forEach(item => {
        const div = document.createElement('div');
        div.textContent = item;
        div.style.padding = '8px';
        div.style.cursor = 'pointer';
        div.style.borderBottom = '1px solid #eee';
        div.onclick = () => {
             addDrugRow({ name: item, doses: [''] });
             drugList.classList.add('hidden');
        };
        drugList.appendChild(div);
    });
}

/* --- DATA MANAGEMENT --- */
function selectCase(idx) {
    currentIndex = idx;
    const c = casesData.cases[idx];
    if(!c) return;
    
    // Form Doldurma
    document.getElementById('caseIdDisplay').textContent = c.id;
    document.getElementById('caseTitleInput').value = c.title;
    document.getElementById('caseDifficultyInput').value = c.difficulty || 'orta';
    document.getElementById('caseTagsInput').value = (c.tags || []).join(', ');

    // Patient
    document.getElementById('patientAgeInput').value = c.patient?.age || '';
    if(c.patient?.sex === 'E') document.getElementById('sexM').checked = true;
    if(c.patient?.sex === 'K') document.getElementById('sexF').checked = true;
    document.getElementById('patientTriageInput').value = c.patient?.triage || 'sarı';
    document.getElementById('patientSettingInput').value = c.patient?.setting || 'acil';

    // Story
    document.getElementById('paramedicInput').value = c.paramedic || '';
    document.getElementById('storyInput').value = c.story || '';
    
    // Exam
    document.getElementById('examVitalsInput').value = c.exam?.vitals || '';
    document.getElementById('examPhysicalInput').value = c.exam?.physical || '';
    
    // Clear & Re-render Lists
    renderKvList('labsContainer', c.labs);
    renderKvList('imagingContainer', c.imaging);
    renderKvList('proceduresContainer', c.procedures);
    
    // Drugs
    const drugCont = document.getElementById('drugsContainer');
    drugCont.innerHTML = '';
    (c.drugs || []).forEach(d => addDrugRow(d));

    // Final
    document.getElementById('finalDiagnosisInput').value = c.final_diagnosis || '';
    document.getElementById('dispositionInput').value = c.disposition || '';
    document.getElementById('baseScoreInput').value = c.scoring?.base || 100;

    renderCaseList(); // Highlight update
}

function syncFormToData() {
    if (!casesData.cases[currentIndex]) return;
    const c = casesData.cases[currentIndex];

    c.title = document.getElementById('caseTitleInput').value;
    c.difficulty = document.getElementById('caseDifficultyInput').value;
    c.tags = document.getElementById('caseTagsInput').value.split(',').map(s=>s.trim());
    
    c.patient = c.patient || {};
    c.patient.age = Number(document.getElementById('patientAgeInput').value);
    c.patient.sex = document.querySelector('input[name="sex"]:checked')?.value;
    c.patient.triage = document.getElementById('patientTriageInput').value;
    c.patient.setting = document.getElementById('patientSettingInput').value;

    c.story = document.getElementById('storyInput').value;
    c.paramedic = document.getElementById('paramedicInput').value;
    
    c.exam = c.exam || {};
    c.exam.vitals = document.getElementById('examVitalsInput').value;
    c.exam.physical = document.getElementById('examPhysicalInput').value;

    // KV Lists update (Labs, etc) -> Read DOM
    c.labs = readKvList('labsContainer');
    c.imaging = readKvList('imagingContainer');
    c.procedures = readKvList('proceduresContainer');
    
    // Drugs update
    c.drugs = readDrugsList();

    c.final_diagnosis = document.getElementById('finalDiagnosisInput').value;
    c.disposition = document.getElementById('dispositionInput').value;
    
    renderCaseList(); // Title might change
}

/* --- HELPER FUNCTIONS --- */

function addKvRow(containerId, key = '', val = '') {
    const container = document.getElementById(containerId);
    const row = document.createElement('div');
    row.className = 'kv-row';
    row.innerHTML = `
        <input class="kv-key" value="${key}" placeholder="Tetkik Adı">
        <input class="kv-value" value="${val}" placeholder="Sonuç">
        <button type="button" class="btn icon-only danger-ghost"><span class="material-icons-round">close</span></button>
    `;
    row.querySelector('button').onclick = () => { row.remove(); syncFormToData(); };
    row.querySelectorAll('input').forEach(i => i.addEventListener('input', syncFormToData));
    container.appendChild(row);
    syncFormToData();
}

function renderKvList(containerId, dataObj) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    if(!dataObj) return;
    Object.entries(dataObj).forEach(([k, v]) => {
        if(k !== 'default') addKvRow(containerId, k, v);
    });
}

function readKvList(containerId) {
    const obj = {};
    const container = document.getElementById(containerId);
    // Default değer inputunu ayrıca almalısın, şimdilik atlıyorum
    container.querySelectorAll('.kv-row').forEach(row => {
        const k = row.querySelector('.kv-key').value.trim();
        const v = row.querySelector('.kv-value').value.trim();
        if(k) obj[k] = v;
    });
    return obj;
}

function addDrugRow(data = null) {
    const container = document.getElementById('drugsContainer');
    const row = document.createElement('div');
    row.className = 'drug-row';
    row.innerHTML = `
        <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
            <input class="drug-name seamless-input" style="font-size:1rem; color:var(--primary);" placeholder="İlaç Adı" value="${data?.name || ''}">
            <button type="button" class="btn icon-only danger-ghost" onclick="this.closest('.drug-row').remove(); syncFormToData();">X</button>
        </div>
        <input class="drug-doses" style="width:100%; margin-bottom:5px;" placeholder="Dozlar (virgülle)" value="${data?.doses?.join(', ') || ''}">
        <textarea class="drug-resp" style="width:100%;" rows="1" placeholder="Yanıt">${data?.response || ''}</textarea>
    `;
    row.querySelectorAll('input, textarea').forEach(i => i.addEventListener('input', syncFormToData));
    container.appendChild(row);
}

function readDrugsList() {
    const list = [];
    document.querySelectorAll('.drug-row').forEach(row => {
        list.push({
            name: row.querySelector('.drug-name').value,
            doses: row.querySelector('.drug-doses').value.split(','),
            response: row.querySelector('.drug-resp').value
        });
    });
    return list;
}

function addNewCase() {
    const newId = `CASE-${String(casesData.cases.length + 1).padStart(3, '0')}`;
    casesData.cases.push({ id: newId, title: 'Yeni Vaka', patient: {}, labs: {}, imaging: {}, drugs: [] });
    selectCase(casesData.cases.length - 1);
}

function deleteCurrentCase() {
    if(confirm('Silmek istediğine emin misin?')) {
        casesData.cases.splice(currentIndex, 1);
        selectCase(Math.max(0, currentIndex - 1));
    }
}

function saveToLocal() {
    localStorage.setItem('medsim_cases', JSON.stringify(casesData));
    alert('Kaydedildi!');
}

function loadFromLocal() {
    const stored = localStorage.getItem('medsim_cases');
    if(stored) {
        casesData = JSON.parse(stored);
        if(casesData.cases.length > 0) selectCase(0);
        else addNewCase();
    } else {
        addNewCase();
    }
}

function downloadJson() {
    const blob = new Blob([JSON.stringify(casesData, null, 2)], {type: 'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'cases.json';
    a.click();
}

function handleJsonImport(e) {
    const reader = new FileReader();
    reader.onload = (ev) => {
        casesData = JSON.parse(ev.target.result);
        renderCaseList();
        selectCase(0);
    };
    reader.readAsText(e.target.files[0]);
}