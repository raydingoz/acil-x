import { STORAGE_KEYS } from './config.js';

export class ScoreManager {
  constructor(userId, caseId, scoring) {
    this.userId = userId;
    this.caseId = caseId;
    this.scoring = scoring || {};
    this.currentScore = scoring?.base ?? 100;
    this.logs = [];
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

  applyPenalty(type) {
    let delta = 0;
    if (type === 'lab') {
      delta = -(this.scoring?.penalty_per_lab ?? 5);
    } else if (type === 'imaging') {
      delta = -(this.scoring?.penalty_per_imaging ?? 8);
    } else if (type === 'procedure') {
      delta = -(this.scoring?.penalty_per_procedure ?? 10);
    }
    this.currentScore += delta;
    return delta;
  }

  applyDiagnosisBonus(isCorrect) {
    if (!isCorrect) return 0;
    const bonus = this.scoring?.bonus_correct_dx ?? 50;
    this.currentScore += bonus;
    return bonus;
  }

  reset() {
    this.currentScore = this.scoring?.base ?? 100;
    this.logs = [];
  }
}
