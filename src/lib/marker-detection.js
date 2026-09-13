// Detect answer sheet boundary via contour detection + perspective correction
// Primary: find largest rectangular contour (the sheet border)
// Fallback: detect corner marker squares (extracted to corner-marker-fallback.js)
/** @typedef {import('./types.js').OpenCVMat} OpenCVMat */
/** @typedef {import('./types.js').Point} Point */
/** @typedef {import('./types.js').MarkerDetectionResult} MarkerDetectionResult */

import { detectCornerMarkers } from './corner-marker-fallback';

/**
 * Detect the answer sheet boundary by finding the largest rectangular contour.
 * Falls back to corner marker detection if no rectangle found.
 * @param {OpenCVMat} thresh - Binary inverted thresholded image
 * @param {number} imageWidth
 * @param {number} imageHeight
 * @returns {MarkerDetectionResult}
 */
export function detectSheetContour(thresh, imageWidth, imageHeight) {
  const cv = (typeof self !== 'undefined' && self.cv) || window.cv;
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  // Ownership transfers to whichever branch keeps it (see loop below); deleted in
  // the outer finally either way, after `result` has been built from it.
  let bestApprox = null;

  try {
    // RETR_EXTERNAL = outermost contours only (the sheet border, not inner grid lines)
    cv.findContours(thresh, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const imageArea = imageWidth * imageHeight;
    let bestArea = 0;

    for (let i = 0; i < contours.size(); i++) {
      // contours.get(i) returns a JS-owned Mat copy — contours.delete() later does NOT
      // free it, so it must be released explicitly on every loop path.
      const contour = contours.get(i);
      try {
        const area = cv.contourArea(contour);

        // Sheet must be at least 10% of image area, and reject a contour that is
        // essentially the whole photo (e.g. a dark background photographed behind
        // the sheet turns into one giant foreground blob under THRESH_BINARY_INV).
        if (area < imageArea * 0.1 || area > imageArea * 0.95) continue;

        const peri = cv.arcLength(contour, true);
        const approx = new cv.Mat();
        let keepApprox = false;
        try {
          cv.approxPolyDP(contour, approx, 0.02 * peri, true);

          if (approx.rows === 4 && area > bestArea) {
            const rect = cv.boundingRect(contour);
            const aspect = rect.width / rect.height;
            // Portrait A4 ≈ 0.7, allow 0.4-1.2 for rotated/cropped sheets
            if (aspect > 0.4 && aspect < 1.2) {
              if (bestApprox) bestApprox.delete();
              bestApprox = approx;
              bestArea = area;
              keepApprox = true;
            }
          }
        } finally {
          if (!keepApprox) approx.delete();
        }
      } finally {
        contour.delete();
      }
    }

    if (bestApprox) {
      const corners = orderCornerPoints(bestApprox);
      return buildMarkerResult(corners);
    }
    // Fallback: try corner marker detection (always builds its own RETR_LIST contours —
    // the nested marker squares are excluded by RETR_EXTERNAL above).
    return detectCornerMarkers(thresh, imageWidth, imageHeight);
  } finally {
    bestApprox?.delete();
    contours.delete();
    hierarchy.delete();
  }
}

/**
 * Order 4 points from approxPolyDP as [TL, TR, BR, BL] using a rotation-stable rule:
 * TL = argmin(x+y), BR = argmax(x+y), TR = argmin(y-x), BL = argmax(y-x). A plain
 * y-then-x sort (the previous approach) only holds below ~45° of rotation — past that
 * it cyclically relabels the corners, the aspect-ratio filter still passes, and the
 * warp silently emits a 90°-rotated sheet. This rule is stable for any rotation angle.
 * A 180° flip is not detectable from geometry alone (all four sums/diffs swap in pairs
 * with no distinguishing anchor on this sheet) — not handled here, see caller.
 * @param {OpenCVMat} approx - 4x1 matrix from approxPolyDP
 * @returns {{ topLeft: Point, topRight: Point, bottomRight: Point, bottomLeft: Point }}
 */
function orderCornerPoints(approx) {
  const points = [];
  for (let i = 0; i < 4; i++) {
    points.push({ x: approx.data32S[i * 2], y: approx.data32S[i * 2 + 1] });
  }

  let topLeft = points[0];
  let topRight = points[0];
  let bottomLeft = points[0];
  let bottomRight = points[0];
  let minSum = Infinity;
  let maxSum = -Infinity;
  let minDiff = Infinity;
  let maxDiff = -Infinity;

  for (const p of points) {
    const sum = p.x + p.y;
    const diff = p.y - p.x;
    if (sum < minSum) { minSum = sum; topLeft = p; }
    if (sum > maxSum) { maxSum = sum; bottomRight = p; }
    if (diff < minDiff) { minDiff = diff; topRight = p; }
    if (diff > maxDiff) { maxDiff = diff; bottomLeft = p; }
  }

  return { topLeft, topRight, bottomLeft, bottomRight };
}

/**
 * Build MarkerDetectionResult from ordered corner points.
 * @param {{ topLeft: Point, topRight: Point, bottomRight: Point, bottomLeft: Point }} c
 * @returns {MarkerDetectionResult}
 */
function buildMarkerResult(c) {
  const left = Math.min(c.topLeft.x, c.bottomLeft.x);
  const right = Math.max(c.topRight.x, c.bottomRight.x);
  const top = Math.min(c.topLeft.y, c.topRight.y);
  const bottom = Math.max(c.bottomLeft.y, c.bottomRight.y);

  return {
    corners: [c.topLeft, c.topRight, c.bottomRight, c.bottomLeft],
    edges: [c.topLeft, c.topRight, c.bottomRight, c.bottomLeft],
    boundingBox: { left, right, top, bottom, width: right - left, height: bottom - top },
  };
}

/**
 * Apply perspective correction to straighten the answer sheet.
 * Always applies when 4 corners are detected (no skew threshold).
 * @param {OpenCVMat} src - Grayscale source image
 * @param {MarkerDetectionResult} markers
 * @param {number} imageWidth
 * @param {number} imageHeight
 * @returns {{ corrected: OpenCVMat, markers: MarkerDetectionResult, applied: boolean }}
 */
export function applyPerspectiveCorrection(src, markers, imageWidth, imageHeight) {
  const cv = (typeof self !== 'undefined' && self.cv) || window.cv;

  if (!markers.corners || markers.corners.length !== 4) {
    return { corrected: src, markers, applied: false };
  }

  if (!cv.getPerspectiveTransform || !cv.warpPerspective) {
    return { corrected: src, markers, applied: false };
  }

  const [tl, tr, br, bl] = markers.corners;

  const dstWidth = Math.round(
    Math.max(Math.hypot(tr.x - tl.x, tr.y - tl.y), Math.hypot(br.x - bl.x, br.y - bl.y))
  );
  const dstHeight = Math.round(
    Math.max(Math.hypot(bl.x - tl.x, bl.y - tl.y), Math.hypot(br.x - tr.x, br.y - tr.y))
  );

  // Degenerate corners (near-collinear/near-coincident approxPolyDP output) collapse
  // dstWidth/dstHeight toward 0, which makes getPerspectiveTransform singular and
  // warpPerspective either throw or produce garbage that would then be graded as-is.
  // A sheet is portrait (CV1239 ≈ 0.7 aspect); dstHeight <= dstWidth means the corner
  // ordering above still yielded a 90°-rotated warp (rotation-stable ordering fixes
  // the y-sort's ~45° failure mode, but cannot itself prove the result is portrait) —
  // reject rather than grade a sideways sheet.
  if (dstWidth < imageWidth * 0.3 || dstHeight < imageHeight * 0.3 || dstHeight <= dstWidth) {
    return { corrected: src, markers, applied: false };
  }

  let srcPts = null;
  let dstPts = null;
  let M = null;
  let corrected = null;
  try {
    srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
      tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y,
    ]);
    dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0, dstWidth, 0, dstWidth, dstHeight, 0, dstHeight,
    ]);

    M = cv.getPerspectiveTransform(srcPts, dstPts);
    corrected = new cv.Mat();
    cv.warpPerspective(src, corrected, M, new cv.Size(dstWidth, dstHeight));
  } catch (err) {
    corrected?.delete();
    throw err;
  } finally {
    srcPts?.delete();
    dstPts?.delete();
    M?.delete();
  }

  // corners/edges are re-expressed in warped-image coordinates (the sheet rectangle)
  // rather than left stale in pre-warp image coordinates — boundingBox is already in
  // warped space, so leaving corners in the old space would silently mix coordinate
  // systems for any future consumer.
  const warpedCorners = [
    { x: 0, y: 0 }, { x: dstWidth, y: 0 }, { x: dstWidth, y: dstHeight }, { x: 0, y: dstHeight },
  ];
  const updatedMarkers = {
    corners: warpedCorners,
    edges: warpedCorners,
    boundingBox: { left: 0, top: 0, right: dstWidth, bottom: dstHeight, width: dstWidth, height: dstHeight },
  };

  return { corrected, markers: updatedMarkers, applied: true };
}
