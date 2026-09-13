// Image preprocessing: grayscale conversion, thresholding, noise reduction, resize
/** @typedef {import('./types.js').OpenCVMat} OpenCVMat */
/** @typedef {import('./types.js').Bubble} Bubble */

const MAX_PROCESSING_WIDTH = 2000;

// Fallback binarization threshold used only if a caller omits the page-level value from
// computeGlobalThreshold (the real pipeline always supplies it). 200 sits between the
// typical printed-paper level (~240) and ink/marker level (<150) measured from the
// answer sheet template, so this is a reasonable neutral guess, not a tuned value.
export const DEFAULT_BIN_THRESHOLD = 200;

/**
 * Downscale canvas to max width for faster, more reliable processing.
 * Phone photos (12MP+) are too large for accurate bubble grid alignment.
 * @param {HTMLCanvasElement} canvas
 * @returns {HTMLCanvasElement} - resized canvas (or original if already small enough)
 */
export function resizeForProcessing(canvas) {
  if (canvas.width <= MAX_PROCESSING_WIDTH) return canvas;
  const scale = MAX_PROCESSING_WIDTH / canvas.width;
  const resized = document.createElement('canvas');
  resized.width = MAX_PROCESSING_WIDTH;
  resized.height = Math.round(canvas.height * scale);
  const ctx = resized.getContext('2d');
  ctx.drawImage(canvas, 0, 0, resized.width, resized.height);
  return resized;
}

/**
 * Convert image to grayscale and apply adaptive thresholding.
 * Uses simple, reliable preprocessing that works in opencv.js browser build.
 * @param {OpenCVMat} src - Source RGBA image matrix
 * @returns {{ gray: OpenCVMat, thresh: OpenCVMat }}
 */
export function preprocessForBubbleDetection(src) {
  const cv = window.cv;

  // gray/closed are returned to the caller on success; blurred/thresh/kernel are
  // always-intermediate Mats. Track all five so any throw mid-pipeline (cvtColor,
  // GaussianBlur, adaptiveThreshold, morphologyEx) still releases whatever was
  // already allocated instead of leaking the whole image-sized Mat set.
  let gray = null;
  let blurred = null;
  let thresh = null;
  let kernel = null;
  let closed = null;

  try {
    // Convert to grayscale
    gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    // Apply Gaussian blur to reduce noise
    blurred = new cv.Mat();
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

    // Adaptive threshold - works well for scanned/photographed answer sheets
    thresh = new cv.Mat();
    cv.adaptiveThreshold(
      blurred,
      thresh,
      255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY_INV,
      15,
      4
    );

    // Morphological close to fill small gaps in bubbles
    kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3));
    closed = new cv.Mat();
    cv.morphologyEx(thresh, closed, cv.MORPH_CLOSE, kernel);

    const result = { gray, thresh: closed };
    gray = null; // ownership transferred to caller, don't delete in finally
    closed = null;
    return result;
  } finally {
    gray?.delete();
    blurred?.delete();
    thresh?.delete();
    kernel?.delete();
    closed?.delete();
  }
}

/**
 * Compute a single binarization threshold for the whole page. A full-page grayscale
 * histogram is genuinely bimodal (ink/markers vs. paper), so Otsu is valid here —
 * unlike on a single ~30px bubble ROI, where the histogram usually has one mode
 * (paper only) and Otsu degenerates into splitting sensor noise roughly in half.
 * @param {OpenCVMat} gray
 * @returns {number} intensity threshold (0-255) separating ink from paper
 */
export function computeGlobalThreshold(gray) {
  const cv = (typeof self !== 'undefined' && self.cv) || window.cv;
  const dummy = new cv.Mat();
  try {
    return cv.threshold(gray, dummy, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
  } finally {
    dummy.delete();
  }
}

/**
 * Compute adaptive fill threshold from empty bubble regions.
 * Measures fill of all bubbles, uses low-fill ones as "empty" baseline,
 * then sets threshold above that baseline.
 * @param {Bubble[]} bubbles - all bubbles from grid
 * @param {OpenCVMat} gray - grayscale image
 * @param {number} [binThreshold] - page-level intensity threshold from computeGlobalThreshold
 * @returns {{ threshold: number, reliable: boolean }} - fill threshold (clamped 0.25-0.50,
 *   fallback 0.35) plus whether the baseline population was well-formed. `reliable: false`
 *   means the baseline could not be trusted (too few samples, or every bubble reads the
 *   same way) — callers must treat the result as needing review, not as a normal reading.
 */
export function computeAdaptiveThreshold(bubbles, gray, binThreshold = DEFAULT_BIN_THRESHOLD) {
  const fills = bubbles.map((b) => measureBubbleFill(b, gray, binThreshold));
  const empties = fills.filter((f) => f < 0.3);

  // Degenerate baseline: either too few bubbles read as empty (grid misaligned, or
  // most of the page is registering fill) or literally none read as filled at all
  // (grid produced no signal whatsoever — cannot tell "blank sheet" from "detection
  // failed"). Either way, guessing a threshold would fabricate a result; flag it.
  if (empties.length < 20 || empties.length === fills.length) {
    return { threshold: 0.35, reliable: false };
  }

  const mean = empties.reduce((a, b) => a + b, 0) / empties.length;
  const stddev = Math.sqrt(
    empties.reduce((a, v) => a + (v - mean) ** 2, 0) / empties.length
  );
  const threshold = Math.min(0.5, Math.max(0.25, mean + 1.5 * stddev));
  return { threshold: Math.round(threshold * 100) / 100, reliable: true };
}

/**
 * Check how filled a bubble region is using a page-level binarization threshold + pixel
 * counting. The threshold is computed once per page (computeGlobalThreshold) from the
 * whole image, where the ink-vs-paper histogram is genuinely bimodal; running Otsu again
 * on a single small ROI would degenerate on unimodal (blank paper) data and read ~0.3-0.5
 * fill on an empty bubble. Returns 0.0 (empty) to 1.0 (fully filled).
 * @param {{ x: number, y: number, width: number, height: number }} bubble
 * @param {OpenCVMat} gray - Grayscale image matrix
 * @param {number} [binThreshold] - page-level intensity threshold from computeGlobalThreshold
 * @returns {number}
 */
export function measureBubbleFill(bubble, gray, binThreshold = DEFAULT_BIN_THRESHOLD) {
  const cv = (typeof self !== 'undefined' && self.cv) || window.cv;

  let roi = null;
  let binary = null;
  try {
    const x = Math.max(0, Math.round(bubble.x));
    const y = Math.max(0, Math.round(bubble.y));
    const w = Math.min(bubble.width, gray.cols - x);
    const h = Math.min(bubble.height, gray.rows - y);

    if (w <= 0 || h <= 0) return 0;

    const rect = new cv.Rect(x, y, w, h);
    roi = gray.roi(rect);

    // Absolute-contrast gate: a ROI containing only blank paper has near-zero
    // dynamic range. Without this, a fixed threshold near the paper's own noise
    // floor can still register a few "dark" pixels from scan/JPEG noise.
    const { minVal, maxVal } = cv.minMaxLoc(roi);
    if (maxVal - minVal < 40) return 0;

    binary = new cv.Mat();
    cv.threshold(roi, binary, binThreshold, 255, cv.THRESH_BINARY_INV);

    const darkPixels = cv.countNonZero(binary);
    const totalPixels = w * h;

    return totalPixels > 0 ? darkPixels / totalPixels : 0;
  } catch {
    return 0;
  } finally {
    roi?.delete();
    binary?.delete();
  }
}
