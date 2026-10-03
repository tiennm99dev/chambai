// Detect student answers by analyzing bubble fill levels
/** @typedef {import('./types.js').OpenCVMat} OpenCVMat */
/** @typedef {import('./types.js').Bubble} Bubble */
/** @typedef {import('./types.js').TrueFalseAnswer} TrueFalseAnswer */
import { measureBubbleFill, DEFAULT_BIN_THRESHOLD } from './image-preprocessing';
import { UNKNOWN_DIGIT } from './types.js';

const DEFAULT_FILL_THRESHOLD = 0.35;

// Minimum fill-confidence gap required to pick a winner between two candidate bubbles.
// Below this, the two readings are noise-level indistinguishable (e.g. a double mark),
// so the caller must treat the position as ambiguous rather than resolve a coin flip.
const AMBIGUITY_MARGIN = 0.15;

/**
 * Detect student ID from bubble grid (8 digits, each column has rows 0-9).
 * Every column always contributes one character — UNKNOWN_DIGIT when the column's
 * bubble could not be read — so the string length always equals the printed field
 * width and a single miss can never shift the digits that follow it.
 * @param {Bubble[]} bubbles
 * @param {OpenCVMat} gray
 * @param {number} [threshold]
 * @param {number} [binThreshold]
 * @returns {string}
 */
export function detectStudentId(bubbles, gray, threshold = DEFAULT_FILL_THRESHOLD, binThreshold = DEFAULT_BIN_THRESHOLD) {
  const idBubbles = bubbles.filter((b) => b.section === 'studentId');
  if (idBubbles.length === 0) return 'UNKNOWN';

  const columns = groupByColumn(idBubbles);
  let studentId = '';

  for (let col = 0; col < 8; col++) {
    const colBubbles = columns[col] || [];
    const best = findBestFilled(colBubbles, gray, threshold, binThreshold);
    studentId += best?.row !== undefined ? best.row.toString() : UNKNOWN_DIGIT;
  }

  return studentId;
}

/**
 * Detect exam code from bubble grid (4 digits). Same UNKNOWN_DIGIT-per-position
 * rule as detectStudentId — a dropped digit here would otherwise silently select
 * the wrong answer key for the whole sheet.
 * @param {Bubble[]} bubbles
 * @param {OpenCVMat} gray
 * @param {number} [threshold]
 * @param {number} [binThreshold]
 * @returns {string}
 */
export function detectExamCode(bubbles, gray, threshold = DEFAULT_FILL_THRESHOLD, binThreshold = DEFAULT_BIN_THRESHOLD) {
  const codeBubbles = bubbles.filter((b) => b.section === 'examCode');
  if (codeBubbles.length === 0) return '';

  const columns = groupByColumn(codeBubbles);
  let code = '';

  for (let col = 0; col < 4; col++) {
    const colBubbles = columns[col] || [];
    const best = findBestFilled(colBubbles, gray, threshold, binThreshold);
    code += best?.row !== undefined ? best.row.toString() : UNKNOWN_DIGIT;
  }

  return code;
}

/**
 * Detect Phần I answers: multiple choice A/B/C/D for 40 questions.
 * Also returns confidence map with fill values per option.
 * @param {Bubble[]} bubbles
 * @param {OpenCVMat} gray
 * @param {number} [questionCount=40]
 * @param {number} [threshold]
 * @param {number} [binThreshold]
 * @returns {{ answers: string[], confidenceMap: Record<number, Record<string, number>> }}
 */
export function detectPhanIAnswers(
  bubbles, gray, questionCount = 40, threshold = DEFAULT_FILL_THRESHOLD, binThreshold = DEFAULT_BIN_THRESHOLD
) {
  const sectionBubbles = bubbles.filter((b) => b.section === 'section1');
  const questions = groupByQuestion(sectionBubbles);
  /** @type {string[]} */
  const answers = [];
  /** @type {Record<number, Record<string, number>>} */
  const confidenceMap = {};

  for (let q = 1; q <= questionCount; q++) {
    const qBubbles = questions[q] || [];
    /** @type {Record<string, number>} */
    const fills = {};
    for (const b of qBubbles) {
      if (b.option) fills[b.option] = measureBubbleFill(b, gray, binThreshold);
    }
    confidenceMap[q] = fills;
    const best = findBestFilled(qBubbles, gray, threshold, binThreshold);
    answers.push(best?.option || '');
  }

  return { answers, confidenceMap };
}

/**
 * Detect Phần II answers: true/false for sub-options a,b,c,d per question.
 * A sub-item is `null` when neither bubble clears the threshold (left blank) or when
 * both do within a noise-level margin (an invalid double mark) — either way it must
 * never compare equal to a key value, so scoring can never award credit for it.
 * @param {Bubble[]} bubbles
 * @param {OpenCVMat} gray
 * @param {number} [questionCount=8]
 * @param {number} [threshold]
 * @param {number} [binThreshold]
 * @returns {TrueFalseAnswer[]}
 */
export function detectPhanIIAnswers(
  bubbles, gray, questionCount = 8, threshold = DEFAULT_FILL_THRESHOLD, binThreshold = DEFAULT_BIN_THRESHOLD
) {
  const sectionBubbles = bubbles.filter((b) => b.section === 'section2');
  /** @type {TrueFalseAnswer[]} */
  const answers = [];

  for (let q = 1; q <= questionCount; q++) {
    const qBubbles = sectionBubbles.filter((b) => b.question === q);
    /** @type {TrueFalseAnswer} */
    const answer = { a: null, b: null, c: null, d: null };

    for (const subOpt of /** @type {const} */ (['a', 'b', 'c', 'd'])) {
      const subBubbles = qBubbles.filter((b) => b.subOption === subOpt);
      const trueBubble = subBubbles.find((b) => b.value === true);
      const falseBubble = subBubbles.find((b) => b.value === false);

      const trueConf = trueBubble ? measureBubbleFill(trueBubble, gray, binThreshold) : 0;
      const falseConf = falseBubble ? measureBubbleFill(falseBubble, gray, binThreshold) : 0;

      const trueMarked = trueConf > threshold;
      const falseMarked = falseConf > threshold;

      // null unless a single clear reading exists — either one bubble is above
      // threshold, or both are but one is clearly darker than the other. A
      // noise-level gap between two filled bubbles (a genuine double mark, invalid
      // on THPT sheets) must not silently pick the marginally darker one.
      let value = null;
      if (trueMarked && falseMarked) {
        if (Math.abs(trueConf - falseConf) >= AMBIGUITY_MARGIN) value = trueConf > falseConf;
      } else if (trueMarked || falseMarked) {
        value = trueMarked;
      }
      answer[subOpt] = value;
    }

    answers.push(answer);
  }

  return answers;
}

// Number of character positions per Phần III question (must match SHEET_LAYOUT)
const PHAN_III_CHARS_PER_QUESTION = 5;

/**
 * Detect Phần III answers: multi-character numerical strings (e.g. "-1,5").
 * Each question has `charsPerQuestion` character positions; each position
 * finds the best-filled bubble and reads its charValue.
 * @param {Bubble[]} bubbles
 * @param {OpenCVMat} gray
 * @param {number} [questionCount=6]
 * @param {number} [threshold]
 * @param {number} [binThreshold]
 * @returns {string[]}
 */
export function detectPhanIIIAnswers(
  bubbles, gray, questionCount = 6, threshold = DEFAULT_FILL_THRESHOLD, binThreshold = DEFAULT_BIN_THRESHOLD
) {
  const sectionBubbles = bubbles.filter((b) => b.section === 'section3');
  const byQuestion = groupByQuestion(sectionBubbles);
  /** @type {string[]} */
  const answers = [];

  for (let q = 1; q <= questionCount; q++) {
    const qBubbles = byQuestion[q] || [];
    const byCharPos = groupByField(qBubbles, 'charPosition');
    let answer = '';

    for (let pos = 0; pos < PHAN_III_CHARS_PER_QUESTION; pos++) {
      const posBubbles = byCharPos[pos] || [];
      const best = findBestFilled(posBubbles, gray, threshold, binThreshold);
      // Every character position always contributes one character — UNKNOWN_DIGIT
      // when unreadable — so a missed position can never shift the ones after it
      // (e.g. "-1,5" collapsing into the wrong-shaped "-15").
      answer += best?.charValue !== undefined ? best.charValue : UNKNOWN_DIGIT;
    }

    answers.push(answer);
  }

  return answers;
}

// --- Helpers ---

/**
 * @param {Bubble[]} bubbles
 * @returns {Record<number, Bubble[]>}
 */
function groupByColumn(bubbles) {
  /** @type {Record<number, Bubble[]>} */
  const groups = {};
  for (const b of bubbles) {
    if (b.column !== undefined) {
      (groups[b.column] ??= []).push(b);
    }
  }
  return groups;
}

/**
 * @param {Bubble[]} bubbles
 * @returns {Record<number, Bubble[]>}
 */
function groupByQuestion(bubbles) {
  /** @type {Record<number, Bubble[]>} */
  const groups = {};
  for (const b of bubbles) {
    if (b.question !== undefined) {
      (groups[b.question] ??= []).push(b);
    }
  }
  return groups;
}

/**
 * Group bubbles by an arbitrary numeric field value.
 * @param {Bubble[]} bubbles
 * @param {'column'|'row'|'question'|'digit'|'charPosition'} fieldName - a numeric Bubble field
 * @returns {Record<number, Bubble[]>}
 */
function groupByField(bubbles, fieldName) {
  /** @type {Record<number, Bubble[]>} */
  const groups = {};
  for (const b of bubbles) {
    const val = b[fieldName];
    if (val !== undefined) {
      (groups[val] ??= []).push(b);
    }
  }
  return groups;
}

/**
 * Find the bubble with highest fill confidence above threshold. Returns null (caller
 * treats as "undetected") when the top two candidates are within AMBIGUITY_MARGIN of
 * each other — e.g. a double mark — instead of silently resolving a noise-level tie.
 * @param {Bubble[]} bubbles
 * @param {OpenCVMat} gray
 * @param {number} [threshold]
 * @param {number} [binThreshold]
 * @returns {Bubble | null}
 */
function findBestFilled(bubbles, gray, threshold = DEFAULT_FILL_THRESHOLD, binThreshold = DEFAULT_BIN_THRESHOLD) {
  /** @type {Bubble | null} */
  let best = null;
  let bestConf = -Infinity;
  let secondConf = -Infinity;

  for (const bubble of bubbles) {
    const conf = measureBubbleFill(bubble, gray, binThreshold);
    if (conf > bestConf) {
      secondConf = bestConf;
      bestConf = conf;
      best = bubble;
    } else if (conf > secondConf) {
      secondConf = conf;
    }
  }

  if (!best || bestConf <= threshold) return null;
  // Only compare against a real second candidate — with just one bubble in the group
  // there is nothing to be ambiguous against.
  if (secondConf > -Infinity && bestConf - secondConf < AMBIGUITY_MARGIN) return null;
  return best;
}
