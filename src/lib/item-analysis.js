// Per-question item analysis: correct%, wrong%, blank%, difficulty rating
import { normalizePhanIIIAnswer } from './scoring.js';

/** @typedef {import('./types.js').TestConfig} TestConfig */
/** @typedef {import('./types.js').StudentResult} StudentResult */
/** @typedef {import('./types.js').ScoreResult} ScoreResult */
/** @typedef {StudentResult & { score?: ScoreResult }} ScoredStudentResult */

const SUB_OPTIONS = /** @type {const} */ (['a', 'b', 'c', 'd']);

/**
 * Analyze per-question performance across all students.
 * @param {ScoredStudentResult[]} results - scored student results
 * @param {TestConfig} config - test configuration with answer keys
 * @returns {Array<{ question: number, section: string, correctPct: number, wrongPct: number, blankPct: number, commonWrong: string, difficulty: string }>}
 */
export function analyzeItems(results, config) {
  if (results.length === 0) return [];
  const total = results.length;
  const items = [];

  // Phần I — multiple choice
  for (let q = 0; q < config.phanI.questionCount; q++) {
    const correct = config.phanI.answers[q];
    // An unconfigured key means "no answer set for this question", not "every
    // student got it wrong" — skip rather than reporting a false 0%/"Khó".
    if (!correct) continue;
    let correctCount = 0;
    let blankCount = 0;
    /** @type {Record<string, number>} */
    const wrongCounts = {};

    for (const r of results) {
      const ans = r.phanI?.[q];
      if (!ans) { blankCount++; continue; }
      if (ans === correct) { correctCount++; continue; }
      wrongCounts[ans] = (wrongCounts[ans] || 0) + 1;
    }

    const wrongEntries = Object.entries(wrongCounts);
    const commonWrong = wrongEntries.length > 0
      ? wrongEntries.sort((a, b) => b[1] - a[1])[0][0]
      : '-';

    const correctPct = Math.round((correctCount / total) * 100);
    const blankPct = Math.round((blankCount / total) * 100);
    items.push({
      question: q + 1,
      section: 'I',
      correctPct,
      // Derived from the already-rounded percentages (not independently
      // rounded) so the three always sum to exactly 100.
      wrongPct: 100 - correctPct - blankPct,
      blankPct,
      commonWrong,
      difficulty: getDifficulty(correctPct),
    });
  }

  // Phần II — true/false per sub-option
  for (let q = 0; q < config.phanII.questionCount; q++) {
    const correct = config.phanII.answers[q];
    if (!correct) continue;
    let correctCount = 0;
    let blankSubs = 0;
    // Denominator is total students × 4 sub-items, matching the total/blank
    // convention used by Phần I and III, instead of silently shrinking when
    // students are skipped for being blank.
    const totalSubs = total * 4;

    for (const r of results) {
      const ans = r.phanII?.[q];
      for (const sub of SUB_OPTIONS) {
        const value = ans ? ans[sub] : null;
        // A blank sub-item (null) must never be credited as correct, even
        // when the key itself is false.
        if (value === null || value === undefined) { blankSubs++; continue; }
        if (value === correct[sub]) correctCount++;
      }
    }

    const correctPct = totalSubs > 0 ? Math.round((correctCount / totalSubs) * 100) : 0;
    const blankPct = totalSubs > 0 ? Math.round((blankSubs / totalSubs) * 100) : 0;
    items.push({
      question: q + 1,
      section: 'II',
      correctPct,
      wrongPct: 100 - correctPct - blankPct,
      blankPct,
      commonWrong: '-',
      difficulty: getDifficulty(correctPct),
    });
  }

  // Phần III — numerical
  for (let q = 0; q < config.phanIII.questionCount; q++) {
    const correct = config.phanIII.answers[q];
    if (!correct) continue;
    let correctCount = 0;
    let blankCount = 0;
    const normalizedCorrect = normalizePhanIIIAnswer(correct);

    for (const r of results) {
      const ans = r.phanIII?.[q];
      if (!ans) { blankCount++; continue; }
      const normalizedAns = normalizePhanIIIAnswer(ans);
      if (normalizedAns !== null && normalizedCorrect !== null && normalizedAns === normalizedCorrect) {
        correctCount++;
      }
    }

    const correctPct = Math.round((correctCount / total) * 100);
    const blankPct = Math.round((blankCount / total) * 100);
    items.push({
      question: q + 1,
      section: 'III',
      correctPct,
      wrongPct: 100 - correctPct - blankPct,
      blankPct,
      commonWrong: '-',
      difficulty: getDifficulty(correctPct),
    });
  }

  return items;
}

/** @param {number} correctPct @returns {'Dễ'|'TB'|'Khó'} */
function getDifficulty(correctPct) {
  if (correctPct >= 80) return 'Dễ';
  if (correctPct >= 50) return 'TB';
  return 'Khó';
}
