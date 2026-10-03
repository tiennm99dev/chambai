// Vietnamese THPT exam scoring logic
// Default scoring: Phần I = 0.25pts/question, Phần II = CV1239 partial-credit tiers, Phần III = 0.5pts/question
import { UNKNOWN_DIGIT } from './types.js';

/** @typedef {import('./types.js').StudentResult} StudentResult */
/** @typedef {import('./types.js').TestConfig} TestConfig */
/** @typedef {import('./types.js').ScoreResult} ScoreResult */
/** @typedef {import('./types.js').TrueFalseAnswer} TrueFalseAnswer */
/**
 * config.schemaVersion is an additive, persistence-layer field (stamped by
 * indexed-db-sessions.js) used only to pick the Phần II scoring model. It is
 * not part of the frozen TestConfig contract in types.js.
 * @typedef {TestConfig & { schemaVersion?: number }} ScoringInputConfig
 */

/** @type {Readonly<import('./types.js').ScoringConfig>} */
export const DEFAULT_SCORING = {
  phanI: { pointsPerQuestion: 0.25 },
  phanII: { pointsPerQuestion: 0.25, partialCredit: true },
  phanIII: { pointsPerQuestion: 0.5 },
};

/** Official CV1239 Phần II partial-credit tiers, as a fraction of full marks, indexed by number of correct sub-items (0-4). */
const PHAN_II_TIERS = [0, 0.1, 0.25, 0.5, 1.0];

/** Current session config schema version. Sessions stamped below this keep their original (pre-CV1239-tier) Phần II formula. */
const CURRENT_SCHEMA_VERSION = 3;

const SUB_OPTIONS = /** @type {const} */ (['a', 'b', 'c', 'd']);

/**
 * Calculate score for a student result against the answer key.
 * @param {Pick<StudentResult, 'phanI'|'phanII'|'phanIII'|'error'>} student - only the answers (and the failure flag) are read
 * @param {ScoringInputConfig} config
 * @returns {ScoreResult}
 */
export function calculateScore(student, config) {
  const scoring = config.scoring ?? DEFAULT_SCORING;

  const phanICount = config.phanI.questionCount;
  const phanIICount = config.phanII.questionCount;
  const phanIIICount = config.phanIII.questionCount;

  const maxTotal =
    phanICount * scoring.phanI.pointsPerQuestion +
    phanIICount * scoring.phanII.pointsPerQuestion * 4 + // 4 sub-options each
    phanIIICount * scoring.phanIII.pointsPerQuestion;
  const roundedMaxTotal = Math.round(maxTotal * 100) / 100;

  // Sessions saved before schemaVersion stamping existed (see indexed-db-sessions.js)
  // are marked schemaVersion 1 the first time they are read or saved after this fix.
  // Their Phần II grades must keep the original linear formula so a teacher's
  // already-recorded scores never shift silently on reload.
  const legacyPhanII = typeof config.schemaVersion === 'number' && config.schemaVersion < CURRENT_SCHEMA_VERSION;

  // A result whose image processing failed carries no reliable answer arrays
  // (they may be undefined) — scoring it would either throw or fabricate a
  // grade. Flag it as unscored instead of guessing.
  if (student.error) {
    const unscoredResult = {
      phanI: 0,
      phanII: 0,
      phanIII: 0,
      total: 0,
      maxTotal: roundedMaxTotal,
      percentage: 0,
      legacyPhanII,
      unscored: true,
    };
    return unscoredResult;
  }

  const phanI = scorePhanI(student.phanI ?? [], config.phanI.answers, scoring.phanI.pointsPerQuestion, phanICount);
  const phanII = scorePhanII(
    student.phanII ?? [],
    config.phanII.answers,
    scoring.phanII.pointsPerQuestion,
    scoring.phanII.partialCredit,
    phanIICount,
    legacyPhanII
  );
  const phanIII = scorePhanIII(student.phanIII ?? [], config.phanIII.answers, scoring.phanIII.pointsPerQuestion, phanIIICount);

  const total = phanI + phanII + phanIII;

  const result = {
    phanI: Math.round(phanI * 100) / 100,
    phanII: Math.round(phanII * 100) / 100,
    phanIII: Math.round(phanIII * 100) / 100,
    total: Math.round(total * 100) / 100,
    maxTotal: roundedMaxTotal,
    percentage: roundedMaxTotal > 0 ? Math.round((total / roundedMaxTotal) * 10000) / 100 : 0,
    legacyPhanII,
  };
  return result;
}

/**
 * @param {string[]} studentAnswers
 * @param {string[]} correctAnswers
 * @param {number} pointsEach
 * @param {number} questionCount
 * @returns {number}
 */
function scorePhanI(studentAnswers, correctAnswers, pointsEach, questionCount) {
  let score = 0;
  // Bound by the configured question count, not the (possibly stale) answer
  // key length, so shrinking the question count in config can never credit
  // questions that no longer exist on the paper.
  const n = Math.min(questionCount, correctAnswers.length);
  for (let i = 0; i < n; i++) {
    if (studentAnswers[i] && studentAnswers[i] === correctAnswers[i]) {
      score += pointsEach;
    }
  }
  return score;
}

/**
 * @param {TrueFalseAnswer[]} studentAnswers
 * @param {TrueFalseAnswer[]} correctAnswers
 * @param {number} pointsEach
 * @param {boolean} partialCredit
 * @param {number} questionCount
 * @param {boolean} legacyPhanII
 * @returns {number}
 */
function scorePhanII(studentAnswers, correctAnswers, pointsEach, partialCredit, questionCount, legacyPhanII) {
  let score = 0;
  const maxPerQuestion = pointsEach * 4;
  const n = Math.min(questionCount, correctAnswers.length);

  for (let i = 0; i < n; i++) {
    const student = studentAnswers[i];
    const correct = correctAnswers[i];
    if (!student || !correct) continue;

    let correctCount = 0;
    for (const sub of SUB_OPTIONS) {
      // A blank sub-item (null: student left it unmarked) must never compare
      // equal to the key and must never earn credit, even when the key value
      // itself is false — otherwise a blank question scores as "student
      // answered Sai" on every false key entry.
      if (student[sub] !== null && student[sub] !== undefined && student[sub] === correct[sub]) {
        correctCount++;
      }
    }

    if (!partialCredit) {
      // All-or-nothing: only full marks if all 4 sub-items match.
      if (correctCount === 4) score += maxPerQuestion;
      continue;
    }

    if (legacyPhanII) {
      score += correctCount * pointsEach;
    } else {
      // Official CV1239 tiers: 1 ý = 0,10 · 2 ý = 0,25 · 3 ý = 0,50 · 4 ý = 1,00
      // (scaled to the configured per-question maximum, which defaults to 1.0).
      score += PHAN_II_TIERS[correctCount] * maxPerQuestion;
    }
  }
  return score;
}

/**
 * @param {string[]} studentAnswers
 * @param {string[]} correctAnswers
 * @param {number} pointsEach
 * @param {number} questionCount
 * @returns {number}
 */
function scorePhanIII(studentAnswers, correctAnswers, pointsEach, questionCount) {
  let score = 0;
  const n = Math.min(questionCount, correctAnswers.length);
  for (let i = 0; i < n; i++) {
    const a = normalizePhanIIIAnswer(studentAnswers[i]);
    const b = normalizePhanIIIAnswer(correctAnswers[i]);
    if (a !== null && b !== null && a === b) {
      score += pointsEach;
    }
  }
  return score;
}

/**
 * Normalize a Vietnamese-style short numeric answer for comparison.
 * Vietnamese convention uses ',' as the decimal separator; students may also
 * omit a leading zero, and teachers may type trailing zero padding or stray
 * whitespace. This unifies all of that so equivalent values compare equal.
 * Returns null when the value cannot be safely compared: empty, containing
 * an unreadable digit (UNKNOWN_DIGIT), or not parseable as a number — a null
 * result never matches anything, so an unreadable answer is never credited
 * and never falsely rejected against a value it happens to stringify like.
 * @param {string} s
 * @returns {number|null}
 */
export function normalizePhanIIIAnswer(s) {
  if (typeof s !== 'string') return null;
  const trimmed = s.trim();
  if (trimmed === '' || trimmed.includes(UNKNOWN_DIGIT)) return null;
  const unified = trimmed.replace(',', '.');
  const n = Number(unified);
  return Number.isFinite(n) ? n : null;
}
