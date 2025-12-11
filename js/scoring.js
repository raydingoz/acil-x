import { STORAGE_KEYS } from './config.js';

export const defaultScoringConfig = {
  base: 100,
  penalty_per_lab: 5,
  penalty_per_imaging: 8,
  penalty_per_procedure: 10,
  penalty_unnecessary: 6,
  bonus_correct_dx: 50,
  penalty_wrong_dx: 25,
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

export class ScoreManager {
  constructor(userId, caseId, scoring) {
    this.userId = userId;
    this.caseId = caseId;
    this.scoring = { ...defaultScoringConfig, ...(scoring || {}) };
    this.currentScore = calculateBaseScore(this.scoring);
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
    this.currentScore += delta;
    return delta;
  }

  applyDiagnosis(isCorrect) {
    const elapsedMs = this.getElapsedMs();
    const diagnosisDelta = calculateDiagnosisDelta(isCorrect, this.scoring);
    const speedDelta = calculateSpeedBonus(elapsedMs, this.scoring);
    const total = diagnosisDelta + speedDelta;
    this.currentScore += total;
    this.saveBestScore();
    return { diagnosisDelta, speedDelta, total };
  }

  reset() {
    this.currentScore = calculateBaseScore(this.scoring);
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
}
