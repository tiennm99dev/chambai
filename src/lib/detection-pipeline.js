// Full OMR detection pipeline — pure function, no React/DOM deps (except cv global)
import { preprocessForBubbleDetection, computeAdaptiveThreshold, computeGlobalThreshold } from './image-preprocessing';
import { detectSheetContour, applyPerspectiveCorrection } from './marker-detection';
import { generateBubbleGrid } from './bubble-grid-generator';
import {
  detectStudentId,
  detectExamCode,
  detectPhanIAnswers,
  detectPhanIIAnswers,
  detectPhanIIIAnswers,
} from './answer-detection';
import { checkImageQuality } from './image-quality-check';
import { createDebugVisualization } from './debug-visualization';
import { UNKNOWN_DIGIT } from './types.js';

/**
 * Run full OMR detection pipeline on image data.
 * Works on main thread (window.cv) or in Web Worker (self.cv).
 * @param {ImageData} imageData - pixel data from canvas
 * @param {HTMLCanvasElement|null} originalCanvas - truthy to request a debug overlay
 *   (built from the pipeline's own working image, not drawn onto this canvas — see
 *   createDebugVisualization); pass null (e.g. in a Worker) to skip it entirely.
 * @param {object} testConfig - answer key configuration
 * @returns {{ result: object, debugUrl: string|null }}
 */
export function runDetectionPipeline(imageData, originalCanvas, testConfig) {
  const cv = (typeof self !== 'undefined' && self.cv) || window.cv;

  // Declared outside the try so the finally block can always release whatever was
  // allocated so far, even when something throws mid-pipeline (e.g. warpPerspective
  // on degenerate corners) — previously these full-image Mats (~25MB per failed
  // 2000x2500 frame) were only deleted on the happy path.
  let src = null;
  let gray = null;
  let thresh = null;
  let corrected = null;
  let perspectiveApplied = false;

  try {
    src = cv.matFromImageData(imageData);
    ({ gray, thresh } = preprocessForBubbleDetection(src));
    const markers = detectSheetContour(thresh, imageData.width, imageData.height);

    const qualityReport = checkImageQuality(gray, markers, imageData.width, imageData.height);

    const correction = applyPerspectiveCorrection(gray, markers, imageData.width, imageData.height);
    corrected = correction.corrected;
    const activeMarkers = correction.markers;
    perspectiveApplied = correction.applied;

    // When correction is not applied, `corrected` aliases `gray` (same Mat) — only
    // delete it below when perspectiveApplied, never both.
    const activeGray = perspectiveApplied ? corrected : gray;
    const activeWidth = perspectiveApplied ? corrected.cols : imageData.width;
    const activeHeight = perspectiveApplied ? corrected.rows : imageData.height;

    const bubbles = generateBubbleGrid(activeMarkers, activeWidth, activeHeight);
    const binThreshold = computeGlobalThreshold(activeGray);
    const { threshold: fillThreshold, reliable } = computeAdaptiveThreshold(bubbles, activeGray, binThreshold);

    const studentId = detectStudentId(bubbles, activeGray, fillThreshold, binThreshold);
    const examCode = detectExamCode(bubbles, activeGray, fillThreshold, binThreshold);
    const { answers: phanI, confidenceMap } = detectPhanIAnswers(
      bubbles, activeGray, testConfig.phanI.questionCount, fillThreshold, binThreshold
    );
    const phanII = detectPhanIIAnswers(
      bubbles, activeGray, testConfig.phanII.questionCount, fillThreshold, binThreshold
    );
    const phanIII = detectPhanIIIAnswers(
      bubbles, activeGray, testConfig.phanIII.questionCount, fillThreshold, binThreshold
    );

    // A failing quality report, an unreliable empty-bubble baseline, or any UNKNOWN_DIGIT
    // placeholder all mean the same thing: don't trust this result silently — a teacher
    // must review it before it counts toward a grade.
    const needsReview =
      !reliable ||
      !qualityReport.passed ||
      studentId.includes(UNKNOWN_DIGIT) ||
      examCode.includes(UNKNOWN_DIGIT) ||
      phanIII.some((answer) => answer.includes(UNKNOWN_DIGIT));

    const result = {
      studentId,
      examCode,
      phanI,
      phanII,
      phanIII,
      confidenceMap,
      fillThreshold,
      confidence: computeConfidence(confidenceMap, reliable),
      needsReview,
    };

    // Debug visualization only works on the main thread with a DOM (createDebugVisualization
    // itself returns '' when document is unavailable, e.g. inside a Web Worker).
    const debugUrl = originalCanvas
      ? createDebugVisualization(bubbles, result, testConfig, activeGray, binThreshold)
      : null;

    return { result: { ...result, debugImageUrl: debugUrl, qualityReport }, debugUrl };
  } finally {
    src?.delete();
    gray?.delete();
    thresh?.delete();
    if (perspectiveApplied) corrected?.delete();
  }
}

/**
 * Derive an overall confidence score instead of a hardcoded constant that nothing
 * ever consumed meaningfully. Uses the margin between the best and second-best fill
 * reading per Phần I question (a thin margin means the pipeline was unsure which
 * bubble was actually marked), and folds in the adaptive-threshold reliability flag —
 * a result built on a degenerate empty-bubble baseline must never report high
 * confidence regardless of how clean individual margins look.
 * @param {Record<number, Record<string, number>>} confidenceMap
 * @param {boolean} reliable
 * @returns {number} 0-1
 */
function computeConfidence(confidenceMap, reliable) {
  if (!reliable) return 0.3;

  const margins = [];
  for (const fills of Object.values(confidenceMap)) {
    const values = Object.values(fills);
    if (values.length === 0) continue;
    const sorted = [...values].sort((a, b) => b - a);
    const margin = sorted.length > 1 ? sorted[0] - sorted[1] : sorted[0];
    margins.push(Math.max(0, Math.min(1, margin)));
  }

  if (margins.length === 0) return 0.3;
  const avg = margins.reduce((a, b) => a + b, 0) / margins.length;
  return Math.round(avg * 100) / 100;
}
