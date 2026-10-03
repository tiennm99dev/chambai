// Generate bubble grid positions based on Vietnamese THPT answer sheet layout
// Layout reference: Công văn 1239/BGDĐT (2025 format)
// Sections: Student ID (8 digits) + Exam Code (4 digits) + Phần I + Phần II + Phần III
/** @typedef {import('./types.js').Bubble} Bubble */
/** @typedef {import('./types.js').MarkerDetectionResult} MarkerDetectionResult */
/** @typedef {import('./types.js').BoundingBox} BoundingBox */

/**
 * @typedef {object} SheetArea
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 */

/**
 * @typedef {(rx: number, ry: number) => { x: number, y: number }} AbsFn
 */

// Vietnamese THPT answer sheet proportional layout (2025 format, CV1239/BGDĐT)
// Ratios measured from official template PDF (assets/Bộ GD 2025 - CV1239)
// Relative to the full sheet content area (outer border or detected rectangle)
const SHEET_LAYOUT = {
  // Student ID: top-right area, 8 columns x 10 rows (digits 0-9)
  studentId: { x: 0.53, y: 0.12, w: 0.27, h: 0.14, cols: 8, rows: 10 },
  // Exam code: right of student ID, 4 columns x 10 rows
  examCode: { x: 0.84, y: 0.12, w: 0.13, h: 0.14, cols: 4, rows: 10 },
  // Phần I: multiple choice (A,B,C,D), 4 question columns x 10 rows = 40 questions
  phanI: { x: 0.03, y: 0.30, w: 0.94, h: 0.26, questionCols: 4, questionsPerCol: 10 },
  // Phần II: true/false, 4 question columns x 2 rows (8 questions, each with a,b,c,d sub-options)
  phanII: { x: 0.03, y: 0.59, w: 0.94, h: 0.10, questions: 8, subOptions: 4 },
  // Phần III: multi-char numerical answers, 6 questions x 5 char positions x 12 rows
  // Row layout per char column: index 0='-', index 1=',', indices 2-11='0'-'9'
  phanIII: { x: 0.03, y: 0.72, w: 0.94, h: 0.26, questions: 6, charsPerQuestion: 5, charRows: 12 },
};

/**
 * Generate all bubble positions based on detected markers and known sheet layout.
 * @param {MarkerDetectionResult} markers
 * @param {number} imageWidth
 * @param {number} imageHeight
 * @returns {Bubble[]}
 */
export function generateBubbleGrid(markers, imageWidth, imageHeight) {
  const box = markers.boundingBox ?? {
    left: imageWidth * 0.03,
    top: imageHeight * 0.03,
    width: imageWidth * 0.94,
    height: imageHeight * 0.94,
    right: imageWidth * 0.97,
    bottom: imageHeight * 0.97,
  };

  /** @type {Bubble[]} */
  const bubbles = [];
  const layout = SHEET_LAYOUT;

  // Helper: convert layout ratios to absolute pixel positions
  /** @type {AbsFn} */
  const abs = (ratioX, ratioY) => ({
    x: box.left + ratioX * box.width,
    y: box.top + ratioY * box.height,
  });

  generateStudentIdBubbles(bubbles, layout.studentId, abs, box);
  generateExamCodeBubbles(bubbles, layout.examCode, abs, box);
  generatePhanIBubbles(bubbles, layout.phanI, abs, box);
  generatePhanIIBubbles(bubbles, layout.phanII, abs, box);
  generatePhanIIIBubbles(bubbles, layout.phanIII, abs, box);

  return bubbles;
}

// Bubble (printed ring) diameter as a fraction of sheet width. Measured directly from
// assets/cv1239-thpt-answer-sheet-template.png (1638x2339px, 200dpi): connected-component
// analysis of the printed circle outlines gives a ring outer diameter of ~23.5-25px
// (studentId grid: 23.5px; Phần I option grid: 24.5px), i.e. ~0.0143-0.015 of sheet width.
// 0.016 covers the full ring with a small margin while staying under the tightest
// neighbor pitch measured (studentId row pitch ~29.8px, ratio ~0.0182) so the ROI
// never bleeds into the adjacent row.
const BUBBLE_SIZE_RATIO = 0.016;

/**
 * @param {{ width: number }} box
 * @returns {number}
 */
function bubbleSize(box) {
  return Math.max(8, Math.round(box.width * BUBBLE_SIZE_RATIO));
}

/**
 * @param {Bubble[]} bubbles
 * @param {typeof SHEET_LAYOUT.studentId} area
 * @param {AbsFn} abs
 * @param {{ width: number }} box
 */
function generateStudentIdBubbles(bubbles, area, abs, box) {
  const size = bubbleSize(box);
  const colSpacing = area.w / area.cols;
  const rowSpacing = area.h / (area.rows + 1); // +1 for header space

  for (let col = 0; col < area.cols; col++) {
    for (let row = 0; row < area.rows; row++) {
      const pos = abs(
        area.x + col * colSpacing + colSpacing * 0.5,
        area.y + (row + 1) * rowSpacing
      );
      // pos is the bubble center; consumers (measureBubbleFill, debug overlay) treat
      // bubble.x/y as the ROI top-left, so shift back by half the bubble size.
      bubbles.push({
        x: pos.x - size / 2,
        y: pos.y - size / 2,
        width: size,
        height: size,
        area: size * size,
        circularity: 0.9,
        section: 'studentId',
        column: col,
        row: row, // row = digit value (0-9)
      });
    }
  }
}

/**
 * @param {Bubble[]} bubbles
 * @param {typeof SHEET_LAYOUT.examCode} area
 * @param {AbsFn} abs
 * @param {{ width: number }} box
 */
function generateExamCodeBubbles(bubbles, area, abs, box) {
  const size = bubbleSize(box);
  const colSpacing = area.w / area.cols;
  const rowSpacing = area.h / (area.rows + 1);

  for (let col = 0; col < area.cols; col++) {
    for (let row = 0; row < area.rows; row++) {
      const pos = abs(
        area.x + col * colSpacing + colSpacing * 0.5,
        area.y + (row + 1) * rowSpacing
      );
      bubbles.push({
        x: pos.x - size / 2,
        y: pos.y - size / 2,
        width: size,
        height: size,
        area: size * size,
        circularity: 0.9,
        section: 'examCode',
        column: col,
        row: row,
      });
    }
  }
}

/**
 * @param {Bubble[]} bubbles
 * @param {typeof SHEET_LAYOUT.phanI} area
 * @param {AbsFn} abs
 * @param {{ width: number }} box
 */
function generatePhanIBubbles(bubbles, area, abs, box) {
  const size = bubbleSize(box);
  const { questionCols, questionsPerCol } = area;
  const colGroupWidth = area.w / questionCols;
  const rowSpacing = area.h / (questionsPerCol + 1);
  const options = ['A', 'B', 'C', 'D'];
  // Within each question column, space for question number + 4 option bubbles
  const optionSpacing = colGroupWidth * 0.15;
  const optionStartOffset = colGroupWidth * 0.25; // skip question number area

  for (let qCol = 0; qCol < questionCols; qCol++) {
    for (let qRow = 0; qRow < questionsPerCol; qRow++) {
      const questionNum = qCol * questionsPerCol + qRow + 1;
      for (let optIdx = 0; optIdx < options.length; optIdx++) {
        const pos = abs(
          area.x + qCol * colGroupWidth + optionStartOffset + optIdx * optionSpacing,
          area.y + (qRow + 1) * rowSpacing
        );
        bubbles.push({
          x: pos.x - size / 2,
          y: pos.y - size / 2,
          width: size,
          height: size,
          area: size * size,
          circularity: 0.9,
          section: 'section1',
          question: questionNum,
          option: options[optIdx],
        });
      }
    }
  }
}

/**
 * @param {Bubble[]} bubbles
 * @param {typeof SHEET_LAYOUT.phanII} area
 * @param {AbsFn} abs
 * @param {{ width: number }} box
 */
function generatePhanIIBubbles(bubbles, area, abs, box) {
  const size = bubbleSize(box);
  const { questions, subOptions } = area;
  // Layout: 4 questions per row, 2 rows
  const qPerRow = 4;
  const qRows = Math.ceil(questions / qPerRow);
  const colWidth = area.w / qPerRow;
  const rowHeight = area.h / qRows;
  const subOptionLabels = /** @type {const} */ (['a', 'b', 'c', 'd']);
  const tfSpacing = colWidth * 0.18;
  const subRowSpacing = rowHeight / (subOptions + 1);

  for (let q = 0; q < questions; q++) {
    const qCol = q % qPerRow;
    const qRow = Math.floor(q / qPerRow);

    for (let sub = 0; sub < subOptions; sub++) {
      // "Đúng" bubble
      const posTrue = abs(
        area.x + qCol * colWidth + colWidth * 0.4,
        area.y + qRow * rowHeight + (sub + 1) * subRowSpacing
      );
      bubbles.push({
        x: posTrue.x - size / 2,
        y: posTrue.y - size / 2,
        width: size,
        height: size,
        area: size * size,
        circularity: 0.9,
        section: 'section2',
        question: q + 1,
        subOption: subOptionLabels[sub],
        value: true,
      });

      // "Sai" bubble
      const posFalse = abs(
        area.x + qCol * colWidth + colWidth * 0.4 + tfSpacing,
        area.y + qRow * rowHeight + (sub + 1) * subRowSpacing
      );
      bubbles.push({
        x: posFalse.x - size / 2,
        y: posFalse.y - size / 2,
        width: size,
        height: size,
        area: size * size,
        circularity: 0.9,
        section: 'section2',
        question: q + 1,
        subOption: subOptionLabels[sub],
        value: false,
      });
    }
  }
}

// Row index → character value mapping for Phần III multi-char columns
// Index 0='-' (sign), index 1=',' (decimal comma), indices 2-11='0'-'9'
const PHAN_III_CHAR_VALUES = ['-', ',', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

/**
 * Generate Phần III bubbles using the multi-character answer model.
 * Each question has `charsPerQuestion` character position columns.
 * Each character column has `charRows` rows: '-', ',', '0'-'9'.
 * @param {Bubble[]} bubbles
 * @param {typeof SHEET_LAYOUT.phanIII} area
 * @param {AbsFn} abs
 * @param {{ width: number }} box
 */
function generatePhanIIIBubbles(bubbles, area, abs, box) {
  const size = bubbleSize(box);
  const { questions, charsPerQuestion, charRows } = area;
  // Each question occupies an equal slice of the total width
  const questionWidth = area.w / questions;
  // Each character position column within a question
  const charColWidth = questionWidth / charsPerQuestion;
  const rowSpacing = area.h / (charRows + 1);

  for (let q = 0; q < questions; q++) {
    for (let charPos = 0; charPos < charsPerQuestion; charPos++) {
      for (let rowIdx = 0; rowIdx < charRows; rowIdx++) {
        const charValue = PHAN_III_CHAR_VALUES[rowIdx];
        const pos = abs(
          area.x + q * questionWidth + charPos * charColWidth + charColWidth * 0.5,
          area.y + (rowIdx + 1) * rowSpacing
        );
        bubbles.push({
          x: pos.x - size / 2,
          y: pos.y - size / 2,
          width: size,
          height: size,
          area: size * size,
          circularity: 0.9,
          section: 'section3',
          question: q + 1,
          charPosition: charPos,
          charValue,
          row: rowIdx, // kept for debug visualization backward compat
        });
      }
    }
  }
}
