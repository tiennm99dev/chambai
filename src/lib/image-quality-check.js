// Image quality validation: blur, resolution, marker checks before processing
import { getCv } from './opencv-runtime';
/** @typedef {import('./types.js').OpenCVMat} OpenCVMat */
/** @typedef {import('./types.js').MarkerDetectionResult} MarkerDetectionResult */

/**
 * @typedef {Object} QualityIssue
 * @property {'resolution'|'blur'|'markers'} type
 * @property {string} message
 */

/**
 * @typedef {Object} QualityReport
 * @property {boolean} passed
 * @property {QualityIssue[]} issues
 * @property {{ resolution: string, blurVariance: number, markersFound: number }} metrics
 */

/**
 * Validate image quality before full detection pipeline.
 * Checks resolution, blur level, and corner marker presence.
 * @param {OpenCVMat} gray - grayscale image
 * @param {MarkerDetectionResult} markers - detected corner markers
 * @param {number} imageWidth
 * @param {number} imageHeight
 * @returns {QualityReport}
 */
export function checkImageQuality(gray, markers, imageWidth, imageHeight) {
  const cv = getCv();
  /** @type {QualityIssue[]} */
  const issues = [];

  // Resolution check — too small for reliable bubble detection
  if (imageWidth < 800 || imageHeight < 1000) {
    issues.push({
      type: 'resolution',
      message: `Ảnh quá nhỏ (${imageWidth}x${imageHeight}px, cần >= 800x1000px)`,
    });
  }

  // Blur detection via Laplacian variance
  // Sentinel for "blur check could not run" — never Infinity, which JSON.stringify
  // (session export) silently turns into null.
  const BLUR_CHECK_UNAVAILABLE = -1;
  let variance = BLUR_CHECK_UNAVAILABLE;
  let laplacian = null;
  let meanMat = null;
  let stdDevMat = null;
  try {
    laplacian = new cv.Mat();
    cv.Laplacian(gray, laplacian, cv.CV_64F);
    meanMat = new cv.Mat();
    stdDevMat = new cv.Mat();
    cv.meanStdDev(laplacian, meanMat, stdDevMat);
    variance = stdDevMat.data64F[0] ** 2;
  } catch {
    // If Laplacian fails, skip blur check rather than blocking
    variance = BLUR_CHECK_UNAVAILABLE;
  } finally {
    laplacian?.delete();
    meanMat?.delete();
    stdDevMat?.delete();
  }

  if (variance !== BLUR_CHECK_UNAVAILABLE && variance < 100) {
    issues.push({
      type: 'blur',
      message: 'Ảnh bị mờ, vui lòng chụp lại rõ hơn',
    });
  }

  // Corner marker check — need 4 for reliable alignment. The corner-marker fallback
  // reports partial hits via `edges` (candidates found) rather than `corners` (a
  // resolved set of 4), so count whichever is more informative instead of always
  // reading 0/4 when the fallback found some markers but not all four.
  const markersFound = markers?.corners?.length || Math.min(markers?.edges?.length ?? 0, 4);
  if (markersFound < 4) {
    issues.push({
      type: 'markers',
      message: `Không tìm thấy viền phiếu trả lời (tìm thấy ${markersFound}/4 góc)`,
    });
  }

  return {
    passed: issues.length === 0,
    issues,
    metrics: {
      resolution: `${imageWidth}x${imageHeight}`,
      blurVariance: Math.round(variance),
      markersFound,
    },
  };
}
