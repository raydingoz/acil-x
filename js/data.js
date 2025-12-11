import { CASES_URL, STORAGE_KEYS, LLM_ENDPOINT } from './config.js';
import { uuid } from './ui.js';

let cachedCasesData = null;

// ---------- Vaka verisi yükleme / kaydetme ----------

export async function loadCasesData() {
  // Önce localStorage override var mı?
  const localJson = localStorage.getItem(STORAGE_KEYS.LAST_CASES_JSON);
  if (localJson) {
    try {
      cachedCasesData = JSON.parse(localJson);
      return cachedCasesData;
    } catch (e) {
      console.warn('Yerel cases JSON parse edilemedi, sunucudan okunacak.', e);
    }
  }

  if (!cachedCasesData) {
    try {
      const res = await fetch(CASES_URL);
      if (!res.ok) throw new Error('Cases JSON yüklenemedi');
      cachedCasesData = await res.json();
    } catch (e) {
      console.error('Vaka verisi yüklenemedi, fallback kullanılacak', e);
      cachedCasesData = fallbackCasesData();
    }
  }

  return cachedCasesData;
}

export function getFeaturedCaseId(data) {
  if (!data) return null;
  if (data.featured_case_id) return data.featured_case_id;
  if (data.cases && data.cases.length > 0) return data.cases[0].id;
  return null;
}

export function findCaseById(data, id) {
  if (!data || !data.cases) return null;
  return data.cases.find(c => c.id === id) || null;
}

export function saveCasesToLocal(data) {
  cachedCasesData = data;
  localStorage.setItem(STORAGE_KEYS.LAST_CASES_JSON, JSON.stringify(data, null, 2));
}

// ---------- Kullanıcı ----------

export function loadOrCreateUser() {
  const existing = localStorage.getItem(STORAGE_KEYS.USER);
  if (existing) {
    try {
      return JSON.parse(existing);
    } catch (e) {
      console.warn('Kullanıcı JSON parse edilemedi, yeni oluşturulacak.', e);
    }
  }
  const user = {
    id: uuid(),
    name: 'Kullanıcı'
  };
  localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
  return user;
}

export function updateUserName(name) {
  const user = loadOrCreateUser();
  user.name = name || user.name;
  localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
  return user;
}

// ---------- LLM Placeholder ----------

export async function queryLLM(payload) {
  if (!window.llmEnabled) {
    return null;
  }
  try {
    const res = await fetch(LLM_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      console.warn('LLM yanıtı başarısız, statik veriye dönülüyor.');
      return null;
    }
    const data = await res.json();
    return data.answer || null;
  } catch (e) {
    console.warn('LLM isteği hata verdi, statik veriye dönülüyor.', e);
    return null;
  }
}

// ---------- Basit fallback data ----------

function fallbackCasesData() {
  return {
    featured_case_id: 'case-001',
    cases: [
      {
        id: 'case-001',
        title: 'Göğüs Ağrısı',
        difficulty: 'orta',
        tags: ['kardiyoloji', 'STEMI'],
        patient: {
          age: 55,
          sex: 'E',
          setting: 'ambulans',
          triage: 'kırmızı'
        },
        paramedic: '112 ekibi tarafından evde senkop sonrası göğüs ağrısı ile alınan hasta. İlk değerlendirmede hipotansif ve taşikardik.',
        story: '55 yaşında erkek hasta, 1 saattir devam eden, göğüs ortasında baskı tarzında ağrı tarifliyor. Ağrı sol kola ve çeneye yayılıyor. Soğuk terleme mevcut.',
        exam: {
          vitals: 'TA: 90/60 mmHg, Nabız: 110/dk, SpO2: %92 (oda havası), Solunum sayısı: 24/dk',
          physical: 'Bilinç açık, oryante ve koopere. Solunum sesleri bilateral veziküler, ral/rhonşi yok. Kalp sesleri taşikardik, ek ses yok. Periferik nabızlar zayıf.'
        },
        labs: {
          troponin: 'Yüksek (örn. 3x üst sınır)',
          d_dimer: 'Normal',
          ck_mb: 'Yüksek',
          default: 'Bu tetkik için sonuç yok.'
        },
        imaging: {
          ekg: 'II, III ve aVF derivasyonlarında ST elevasyonu, karşılık gelen prekordiyal derivasyonlarda ST depresyonu.',
          xray: 'Akciğer grafisi normal sınırlarda, kardiyotorasik indeks normal.',
          default: 'Bu görüntüleme için kayıt yok.'
        },
        procedures: {
          cpr: 'Ritim VF olduğunda yüksek enerjili (ör. 200 J) defibrilasyon önerilir.',
          defibrillation: 'Monofazik/bifazik cihazlara göre uygun enerji ile tek şok ardından kompresyona devam edilmesi gerekir.',
          default: 'Prosedür sonucu kaydı yok.'
        },
        drugs: [
          {
            name: 'Aspirin',
            doses: ['300 mg çiğneme'],
            response: 'Ağrı bir miktar azalır, trombosit agregasyonu baskılanır.'
          },
          {
            name: 'Nitrogliserin',
            doses: ['0.4 mg dil altı'],
            response: 'Kan basıncı yeterliyse ağrıda azalma olabilir; hipotansiyonda dikkatli kullanılmalıdır.'
          }
        ],
        consults: ['Kardiyoloji'],
        disposition: 'Primer PCI yapılabilen merkeze acil nakil planlanmalı.',
        final_diagnosis: 'STEMI',
        scoring: {
          base: 100,
          penalty_per_lab: 5,
          penalty_per_imaging: 8,
          penalty_per_procedure: 10,
          bonus_correct_dx: 50
        }
      },
      {
        id: 'case-002',
        title: 'Travma Sonrası Hipotansiyon',
        difficulty: 'zor',
        tags: ['travma', 'şok'],
        patient: {
          age: 32,
          sex: 'E',
          setting: 'acil',
          triage: 'kırmızı'
        },
        paramedic: 'Yüksekten düşme sonrası 20 dakikada olay yerine ulaşılmış, servikal immobilizasyon yapılmış, acile getirilmiş.',
        story: '32 yaşında erkek hasta, 3. kattan düşme sonrası acil servise getiriliyor. Bilinç bulanık, karında dolgunluk hissi mevcut.',
        exam: {
          vitals: 'TA: 80/50 mmHg, Nabız: 130/dk, SpO2: %94 (oksijen desteği ile), Solunum: 28/dk',
          physical: 'Bilinç konfü, periton irritasyon bulguları, karında hassasiyet ve defans. Pelvis stabil değil.'
        },
        labs: {
          hb: 'Düşük (ör. 7 g/dL)',
          hct: 'Düşük',
          default: 'Bu tetkik için sonuç yok.'
        },
        imaging: {
          fast: 'Abdominal FAST pozitif, Morrison ve splenorenal aralıkta serbest sıvı.',
          pelvic_xray: 'Pelvis kırığı ile uyumlu görünüm.',
          default: 'Bu görüntüleme için kayıt yok.'
        },
        procedures: {
          blood_transfusion: 'Masif transfüzyon protokolü başlatılır.',
          pelvic_binder: 'Pelvik binder ile stabilizasyon yapılır, hemodinami bir miktar düzelebilir.',
          default: 'Prosedür sonucu kaydı yok.'
        },
        drugs: [
          {
            name: 'Kristalloid',
            doses: ['500 mL hızlı infüzyon', '1000 mL hızlı infüzyon'],
            response: 'Kan basıncında kısmi düzelme olabilir ancak kontrolsüz kanamada dikkatli olunmalı.'
          }
        ],
        consults: ['Genel Cerrahi', 'Ortopedi'],
        disposition: 'Acil cerrahi girişim ve yoğun bakım ihtiyacı.',
        final_diagnosis: 'Hemorajik şok',
        scoring: {
          base: 120,
          penalty_per_lab: 3,
          penalty_per_imaging: 5,
          penalty_per_procedure: 8,
          bonus_correct_dx: 60
        }
      }
    ]
  };
}
