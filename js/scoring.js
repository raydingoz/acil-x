import { STORAGE_KEYS } from './config.js';

export const defaultScoringConfig = {
  base: 100,
  penalty_per_lab: 5,
  penalty_per_imaging: 8,
  penalty_per_procedure: 10,
  penalty_unnecessary: 6,
  penalty_wrong_dx: 25,
  bonus_correct_dx: 50,
  required: [],
  unnecessary: [],
  bonus: [],
  category_weights: {
    muayene: 0.35,
    istek: 0.25,
    tedavi: 0.2,
    tani: 0.2
  },
  caps: {
    overall_max: 100,
    overall_min: 0,
    category_max: {
      muayene: 100,
      istek: 100,
      tedavi: 100,
      tani: 100
    }
  },
  penalty_on_missing_default: 10,
  speed_bonus_window_sec: 120,
  speed_max_bonus: 25
};

export function calculateBaseScore(config = {}) {
  const scoring = { ...defaultScoringConfig, ...config };
  return scoring.base;
}

export function calculateActionPenalty(actionType, config = {}, options = {}) {
  const scoring = { ...defaultScoringConfig, ...config };
  const penalties = {
    lab: scoring.penalty_per_lab,
    imaging: scoring.penalty_per_imaging,
    procedure: scoring.penalty_per_procedure
  };
  const base = penalties[actionType] ?? 0;
  const unnecessaryPenalty = options.unnecessary ? scoring.penalty_unnecessary : 0;
  return -(base + unnecessaryPenalty);
}

export function calculateDiagnosisDelta(isCorrect, config = {}) {
  const scoring = { ...defaultScoringConfig, ...config };
  if (isCorrect) return scoring.bonus_correct_dx;
  return -(scoring.penalty_wrong_dx ?? 0);
}

export function calculateSpeedBonus(elapsedMs, config = {}) {
  const scoring = { ...defaultScoringConfig, ...config };
  if (!elapsedMs || scoring.speed_max_bonus <= 0 || !scoring.speed_bonus_window_sec) return 0;
  const elapsedSec = elapsedMs / 1000;
  const remaining = Math.max(scoring.speed_bonus_window_sec - elapsedSec, 0);
  if (remaining <= 0) return 0;
  const ratio = remaining / scoring.speed_bonus_window_sec;
  return Math.round(scoring.speed_max_bonus * ratio);
}

const normalizeText = value =>
  (value || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_\s-]+/g, '');

const clamp = (value, min = 0, max = 100) => Math.min(Math.max(value, min), max);

function mapRuleToCategory(type) {
  const normalized = normalizeText(type);
  if (['muayene', 'anamnez', 'hikaye', 'exam'].includes(normalized)) return 'muayene';
  if (['lab', 'labs', 'imaging', 'goruntuleme', 'istek'].includes(normalized))
    return 'istek';
  if (['drug', 'drugs', 'ilac', 'tedavi', 'procedure', 'procedures'].includes(normalized)) return 'tedavi';
  if (['tani', 'diagnosis'].includes(normalized)) return 'tani';
  return 'istek';
}

function buildSelectionBuckets(selectionState = {}, flowHistory = []) {
  const anamnezMuayene = selectionState.anamnezMuayene || [];
  const istekler = selectionState.istekler || [];
  const sonuclar = selectionState.sonuclar || [];

  const muayeneSet = new Set(
    anamnezMuayene
      .map(item => normalizeText(item.choice || item.step))
      .filter(Boolean)
  );
  const storySet = new Set(
    flowHistory
      .filter(item => ['anamnez', 'hikaye'].includes(item.step))
      .map(item => normalizeText(item.choice))
      .filter(Boolean)
  );
  const requestMap = istekler.reduce(
    (acc, item) => {
      const section = item.section || '';
      const key = normalizeText(item.key);
      if (!key) return acc;
      const bucket = acc[section] || new Set();
      bucket.add(key);
      acc[section] = bucket;
      return acc;
    },
    { labs: new Set(), imaging: new Set(), procedures: new Set() }
  );

  const drugSet = new Set(
    sonuclar
      .filter(item => item.section === 'drugs')
      .map(item => normalizeText(String(item.key || '').split('(')[0]))
      .filter(Boolean)
  );

  const procedureResultSet = new Set(
    sonuclar
      .filter(item => item.section === 'procedures')
      .map(item => normalizeText(item.key))
      .filter(Boolean)
  );

  return {
    muayeneSet,
    storySet,
    requestMap,
    drugSet,
    procedureResultSet
  };
}

function wasActionPerformed(type, key, buckets) {
  const normalizedKey = normalizeText(key);
  const category = mapRuleToCategory(type);
  if (!normalizedKey) return false;
  if (category === 'muayene') {
    return buckets.muayeneSet.has(normalizedKey) || buckets.storySet.has(normalizedKey);
  }
  if (category === 'istek') {
    const section =
      normalizeText(type) === 'imaging'
        ? 'imaging'
        : normalizeText(type) === 'labs' || normalizeText(type) === 'lab'
          ? 'labs'
          : normalizeText(type).startsWith('procedure')
            ? 'procedures'
            : null;
    if (section && buckets.requestMap[section]) {
      if (buckets.requestMap[section].has(normalizedKey)) return true;
    }
    // sonuÇular listesinde arama
    return Array.from(Object.values(buckets.requestMap)).some(set => set.has(normalizedKey));
  }
  if (category === 'tedavi') {
    if (normalizeText(type).includes('procedure')) {
      return (
        buckets.requestMap.procedures?.has(normalizedKey) ||
        buckets.procedureResultSet.has(normalizedKey)
      );
    }
    return buckets.drugSet.has(normalizedKey);
  }
  return false;
}

export function evaluateCaseScore(options = {}) {
  const {
    scoringConfig = {},
    selectionState = {},
    flowHistory = [],
    diagnosisInput = '',
    expectedDiagnosis = '',
    elapsedMs = 0
  } = options;

  const scoring = { ...defaultScoringConfig, ...scoringConfig };
  const weights = scoring.category_weights || defaultScoringConfig.category_weights;
  const weightSum =
    Object.values(weights || {}).reduce((sum, val) => sum + (val || 0), 0) || 1;

  const caps = scoring.caps?.category_max || defaultScoringConfig.caps.category_max;
  const buckets = buildSelectionBuckets(selectionState, flowHistory);
  const categories = { muayene: 100, istek: 100, tedavi: 100, tani: 100 };
  const findings = [];

  const applyDelta = (category, delta, reason) => {
    const max = caps?.[category] ?? 100;
    categories[category] = clamp(categories[category] + delta, 0, max);
    if (reason) {
      findings.push({ category, delta, reason });
    }
  };

  const counts = {
    labs: selectionState.istekler?.filter(item => item.section === 'labs').length || 0,
    imaging: selectionState.istekler?.filter(item => item.section === 'imaging').length || 0,
    procedures: selectionState.istekler?.filter(item => item.section === 'procedures').length || 0
  };
  Object.entries(counts).forEach(([section, count]) => {
    const perActionPenalty =
      section === 'labs'
        ? scoring.penalty_per_lab
        : section === 'imaging'
          ? scoring.penalty_per_imaging
          : scoring.penalty_per_procedure;
    if (count && perActionPenalty) {
      applyDelta('istek', -(perActionPenalty * count), `${section} toplam ${count} istek`);
    }
  });

  (scoring.required || []).forEach(rule => {
    const category = mapRuleToCategory(rule.type);
    const penalty = -(rule.penalty_on_skip ?? scoring.penalty_on_missing_default);
    if (!wasActionPerformed(rule.type, rule.key, buckets)) {
      applyDelta(category, penalty, `${rule.key} istenmedi`);
    }
  });

  (scoring.unnecessary || []).forEach(rule => {
    const category = mapRuleToCategory(rule.type);
    const penalty = -(rule.penalty ?? scoring.penalty_unnecessary ?? 0);
    if (wasActionPerformed(rule.type, rule.key, buckets)) {
      applyDelta(category, penalty, `${rule.key} gereksizdi`);
    }
  });

  (scoring.bonus || []).forEach(rule => {
    const category = mapRuleToCategory(rule.type);
    const bonus = rule.bonus ?? 0;
    if (wasActionPerformed(rule.type, rule.key, buckets)) {
      applyDelta(category, bonus, `${rule.key} uygulandŽñ`);
    }
  });

  const normalizedDx = normalizeText(diagnosisInput);
  const normalizedExpected = normalizeText(expectedDiagnosis);
  const isDiagnosisCorrect =
    normalizedDx && normalizedExpected && normalizedDx.includes(normalizedExpected);
  const dxDelta = isDiagnosisCorrect
    ? scoring.bonus_correct_dx || 0
    : -(scoring.penalty_wrong_dx || 0);

  if (dxDelta) {
    applyDelta('tani', dxDelta, isDiagnosisCorrect ? 'Doğru tanı' : 'Yanlış tanı');
  }

  const speedBonus = calculateSpeedBonus(elapsedMs, scoring);
  if (speedBonus) {
    applyDelta('tani', speedBonus, 'HŽñz bonusu');
  }

  const weightedTotal = Object.entries(categories).reduce(
    (sum, [key, val]) => sum + val * (weights?.[key] ?? 0),
    0
  );

  const totalRaw = weightedTotal / weightSum;
  const overallMax = scoring.caps?.overall_max ?? defaultScoringConfig.caps.overall_max;
  const overallMin = scoring.caps?.overall_min ?? defaultScoringConfig.caps.overall_min;
  const total = clamp(Math.round(totalRaw), overallMin, overallMax);

  return {
    total,
    categories: Object.fromEntries(
      Object.entries(categories).map(([k, v]) => [k, Math.round(v)])
    ),
    findings,
    diagnosis: {
      input: diagnosisInput,
      expected: expectedDiagnosis,
      isCorrect: isDiagnosisCorrect
    },
    speedBonus
  };
}

export class ScoreManager {
  constructor(userId, caseId, scoring) {
    this.userId = userId;
    this.caseId = caseId;
    this.scoring = { ...defaultScoringConfig, ...(scoring || {}) };
    this.currentScore = calculateBaseScore(this.scoring);
    this.baseScore = this.currentScore;
    this.penaltyTotal = 0;
    this.speedBonus = 0;
    this.diagnosisScore = 0;
    this.lastEvaluation = null;
    this.logs = [];
    this.caseStartedAt = Date.now();
    this.loadBestScore();
  }

  loadBestScore() {
    const raw = localStorage.getItem(STORAGE_KEYS.SCORES);
    if (!raw) {
      this.bestScore = null;
      this.attempts = 0;
      return;
    }
    try {
      const data = JSON.parse(raw);
      const entry = data[this.caseId] || null;
      if (entry) {
        this.bestScore = entry.bestScore;
        this.attempts = entry.attempts;
      } else {
        this.bestScore = null;
        this.attempts = 0;
      }
    } catch (e) {
      console.warn('Skor JSON parse edilemedi.', e);
      this.bestScore = null;
      this.attempts = 0;
    }
  }

  saveBestScore() {
    const raw = localStorage.getItem(STORAGE_KEYS.SCORES);
    let data = {};
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch (e) {
        console.warn('Skor JSON parse hatalı, sıfırlanıyor.', e);
      }
    }
    const current = data[this.caseId] || { bestScore: null, attempts: 0 };
    current.attempts = (current.attempts || 0) + 1;
    if (current.bestScore == null || this.currentScore > current.bestScore) {
      current.bestScore = this.currentScore;
    }
    data[this.caseId] = current;
    this.bestScore = current.bestScore;
    this.attempts = current.attempts;
    localStorage.setItem(STORAGE_KEYS.SCORES, JSON.stringify(data));
  }

  applyPenalty(type, options = {}) {
    const delta = calculateActionPenalty(type, this.scoring, options);
    this.penaltyTotal += delta;
    this.currentScore = this.baseScore + this.penaltyTotal + this.diagnosisScore + this.speedBonus;
    return delta;
  }

  applyDiagnosis(isCorrect) {
    const elapsedMs = this.getElapsedMs();
    const diagnosisDelta = calculateDiagnosisDelta(isCorrect, this.scoring);
    const speedDelta = calculateSpeedBonus(elapsedMs, this.scoring);
    const total = diagnosisDelta + speedDelta;
    this.diagnosisScore = diagnosisDelta;
    this.speedBonus = speedDelta;
    this.currentScore = this.baseScore + this.penaltyTotal + this.diagnosisScore + this.speedBonus;
    this.saveBestScore();
    return { diagnosisDelta, speedDelta, total };
  }

  reset() {
    this.currentScore = calculateBaseScore(this.scoring);
    this.baseScore = this.currentScore;
    this.penaltyTotal = 0;
    this.speedBonus = 0;
    this.diagnosisScore = 0;
    this.lastEvaluation = null;
    this.logs = [];
    this.caseStartedAt = Date.now();
  }

  startCaseTimer() {
    this.caseStartedAt = Date.now();
  }

  getElapsedMs() {
    if (!this.caseStartedAt) return 0;
    return Date.now() - this.caseStartedAt;
  }

  getBreakdown() {
    return {
      base: this.baseScore,
      penaltyTotal: this.penaltyTotal,
      speedBonus: this.speedBonus,
      diagnosisScore: this.diagnosisScore,
      total: this.currentScore,
      evaluation: this.lastEvaluation
    };
  }

  applyFinalEvaluation(evaluation) {
    if (!evaluation) return evaluation;
    this.lastEvaluation = evaluation;
    this.currentScore = evaluation.total;
    this.saveBestScore();
    return evaluation;
  }
}
