// Draw debug overlay on processed answer sheet images
// Shows detected bubbles, answers, and confidence levels
/** @typedef {import('./types.js').OpenCVMat} OpenCVMat */
/** @typedef {import('./types.js').Bubble} Bubble */
/** @typedef {import('./types.js').ProcessingResult} ProcessingResult */
/** @typedef {import('./types.js').TestConfig} TestConfig */
import { measureBubbleFill, DEFAULT_BIN_THRESHOLD } from './image-preprocessing';
import { getCv } from './opencv-runtime';

const COLORS = {
  allPositions: '#FF69B4',   // pink
  studentId: '#3B82F6',      // blue
  examCode: '#8B5CF6',       // purple
  correct: '#10B981',        // green
  wrong: '#EF4444',          // red
  unanswered: '#9CA3AF',     // gray
};

/**
 * Create a debug visualization canvas showing all detected bubbles and answers.
 * Draws directly from `gray` — the same image the bubble grid coordinates were
 * computed against (post-downscale, and post-perspective-correction when applied) —
 * instead of an externally supplied canvas. Previously the overlay was drawn on the
 * full-resolution, un-warped canvas while bubble coordinates were in downscaled or
 * warped space, so every circle landed in the wrong place; this is the operator's
 * only manual verification tool, so it must always be drawn in the same coordinate
 * space the detection itself used.
 * Returns a data URL of the annotated image (empty string when not on the main
 * thread / no DOM available, e.g. inside a Web Worker).
 * @param {Bubble[]} bubbles
 * @param {ProcessingResult} result
 * @param {TestConfig} testConfig
 * @param {OpenCVMat} gray - the image bubble coordinates are expressed against
 * @param {number} [binThreshold] - page-level intensity threshold from computeGlobalThreshold
 * @returns {string}
 */
export function createDebugVisualization(bubbles, result, testConfig, gray, binThreshold = DEFAULT_BIN_THRESHOLD) {
  if (typeof document === 'undefined') return '';
  // Guarded by the document check above, so this only ever runs on the main thread.
  const cv = getCv();

  const debugCanvas = document.createElement('canvas');
  cv.imshow(debugCanvas, gray);
  const ctx = debugCanvas.getContext('2d');
  if (!ctx) return '';

  // Mark all bubble positions (pink outlines)
  drawAllPositions(ctx, bubbles);

  // Mark student ID and exam code (blue/purple)
  drawIdBubbles(ctx, bubbles, gray, 'studentId', COLORS.studentId, binThreshold);
  drawIdBubbles(ctx, bubbles, gray, 'examCode', COLORS.examCode, binThreshold);

  // Mark Phần I answers
  drawPhanIAnswers(ctx, bubbles, result, testConfig, gray, binThreshold);

  // Mark Phần II answers
  drawPhanIIAnswers(ctx, bubbles, result, testConfig);

  // Mark Phần III answers
  drawPhanIIIAnswers(ctx, bubbles, result, testConfig);

  // Draw legend
  drawLegend(ctx);

  return debugCanvas.toDataURL();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Bubble[]} bubbles
 */
function drawAllPositions(ctx, bubbles) {
  ctx.strokeStyle = COLORS.allPositions;
  ctx.lineWidth = 1;

  for (const bubble of bubbles) {
    const cx = bubble.x + bubble.width / 2;
    const cy = bubble.y + bubble.height / 2;
    const r = Math.max(bubble.width, bubble.height) / 2 + 2;

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 2 * Math.PI);
    ctx.stroke();
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Bubble[]} bubbles
 * @param {OpenCVMat} gray
 * @param {string} section
 * @param {string} color
 * @param {number} [binThreshold]
 */
function drawIdBubbles(ctx, bubbles, gray, section, color, binThreshold = DEFAULT_BIN_THRESHOLD) {
  const sectionBubbles = bubbles.filter((b) => b.section === section);

  for (const bubble of sectionBubbles) {
    const confidence = measureBubbleFill(bubble, gray, binThreshold);
    if (confidence <= 0.3) continue;

    const cx = bubble.x + bubble.width / 2;
    const cy = bubble.y + bubble.height / 2;
    const r = Math.max(bubble.width, bubble.height) / 2 + 4;

    ctx.strokeStyle = color;
    ctx.lineWidth = confidence > 0.4 ? 3 : 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 2 * Math.PI);
    ctx.stroke();
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Bubble[]} bubbles
 * @param {ProcessingResult} result
 * @param {TestConfig} config
 * @param {OpenCVMat} gray
 * @param {number} [binThreshold]
 */
function drawPhanIAnswers(ctx, bubbles, result, config, gray, binThreshold = DEFAULT_BIN_THRESHOLD) {
  const section1 = bubbles.filter((b) => b.section === 'section1');

  for (const bubble of section1) {
    const q = bubble.question;
    if (!q || q > result.phanI.length) continue;

    const detected = result.phanI[q - 1];
    const correct = config.phanI.answers[q - 1];

    if (detected === bubble.option) {
      const confidence = measureBubbleFill(bubble, gray, binThreshold);
      if (confidence <= 0.3) continue;

      const isCorrect = detected === correct;
      const cx = bubble.x + bubble.width / 2;
      const cy = bubble.y + bubble.height / 2;
      const r = bubble.width / 2 + 4;

      ctx.strokeStyle = isCorrect ? COLORS.correct : COLORS.wrong;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 2 * Math.PI);
      ctx.stroke();
    }
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Bubble[]} bubbles
 * @param {ProcessingResult} result
 * @param {TestConfig} config
 */
function drawPhanIIAnswers(ctx, bubbles, result, config) {
  const section2 = bubbles.filter((b) => b.section === 'section2');

  for (const bubble of section2) {
    const q = bubble.question;
    const sub = bubble.subOption;
    if (!q || !sub || q > result.phanII.length) continue;

    const detected = result.phanII[q - 1];
    const correct = config.phanII.answers[q - 1];
    if (!detected) continue;

    if (detected[sub] === bubble.value) {
      const isCorrect = correct?.[sub] === bubble.value;
      const cx = bubble.x + bubble.width / 2;
      const cy = bubble.y + bubble.height / 2;
      const r = bubble.width / 2 + 4;

      ctx.strokeStyle = isCorrect ? COLORS.correct : COLORS.wrong;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 2 * Math.PI);
      ctx.stroke();
    }
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Bubble[]} bubbles
 * @param {ProcessingResult} result
 * @param {TestConfig} config
 */
function drawPhanIIIAnswers(ctx, bubbles, result, config) {
  const section3 = bubbles.filter((b) => b.section === 'section3');

  for (const bubble of section3) {
    const q = bubble.question;
    if (!q || q > result.phanIII.length) continue;

    const detected = result.phanIII[q - 1];
    const correct = config.phanIII.answers[q - 1];

    // Multi-char model: a bubble marks the detected answer at its own character
    // position (charValue/charPosition), not the legacy single-digit `digit` field
    // (never emitted by the generator) compared against the whole multi-char string.
    if (bubble.charPosition !== undefined && detected?.[bubble.charPosition] === bubble.charValue) {
      const isCorrect = detected === correct;
      const cx = bubble.x + bubble.width / 2;
      const cy = bubble.y + bubble.height / 2;
      const r = bubble.width / 2 + 4;

      ctx.strokeStyle = isCorrect ? COLORS.correct : COLORS.wrong;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 2 * Math.PI);
      ctx.stroke();
    }
  }
}

/** @param {CanvasRenderingContext2D} ctx */
function drawLegend(ctx) {
  const entries = [
    { color: COLORS.allPositions, label: 'Tất cả vị trí' },
    { color: COLORS.studentId, label: 'Số báo danh' },
    { color: COLORS.examCode, label: 'Mã đề thi' },
    { color: COLORS.correct, label: 'Đúng' },
    { color: COLORS.wrong, label: 'Sai' },
  ];

  const x = 10;
  const y = 10;
  const w = 160;
  const h = entries.length * 18 + 28;

  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);

  ctx.fillStyle = '#000';
  ctx.font = 'bold 12px Arial';
  ctx.fillText('Chú thích', x + 8, y + 16);

  entries.forEach((entry, i) => {
    ctx.fillStyle = entry.color;
    ctx.beginPath();
    ctx.arc(x + 16, y + 32 + i * 18, 5, 0, 2 * Math.PI);
    ctx.fill();

    ctx.fillStyle = '#333';
    ctx.font = '11px Arial';
    ctx.fillText(entry.label, x + 28, y + 36 + i * 18);
  });
}
