// Fallback corner marker detection for answer sheets with solid black square markers
// Used when contour-based sheet detection fails to find the rectangular border
/** @typedef {import('./types.js').OpenCVMat} OpenCVMat */
/** @typedef {import('./types.js').Point} Point */
/** @typedef {import('./types.js').MarkerDetectionResult} MarkerDetectionResult */

/**
 * Detect 4 corner markers (solid black squares) on the answer sheet. Always computes
 * its own RETR_LIST contours — the marker squares are nested inside the sheet border
 * and are excluded from a caller's RETR_EXTERNAL contour set, so reusing that set
 * left `candidates` almost always empty and this function fell straight through to
 * the image-bounds fallback.
 * @param {OpenCVMat} thresh
 * @param {number} imageWidth
 * @param {number} imageHeight
 * @returns {MarkerDetectionResult}
 */
export function detectCornerMarkers(thresh, imageWidth, imageHeight) {
  const cv = (typeof self !== 'undefined' && self.cv) || window.cv;

  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();

  try {
    cv.findContours(thresh, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    /** @type {Array<{ center: Point, area: number }>} */
    const candidates = [];
    const imageArea = imageWidth * imageHeight;

    for (let i = 0; i < contours.size(); i++) {
      // contours.get(i) returns a JS-owned Mat copy — contours.delete() later does
      // NOT free it, so it must be released explicitly on every loop path.
      const contour = contours.get(i);
      try {
        const area = cv.contourArea(contour);
        const rect = cv.boundingRect(contour);
        const aspectRatio = rect.width / rect.height;
        const areaRatio = area / imageArea;

        // Corner markers: small square-ish shapes (0.03%-2% of image area)
        if (areaRatio < 0.0003 || areaRatio > 0.02) continue;
        if (aspectRatio < 0.6 || aspectRatio > 1.7) continue;
        // Solidity: filled area vs bounding rect
        if (area / (rect.width * rect.height) < 0.7) continue;

        candidates.push({ center: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, area });
      } finally {
        contour.delete();
      }
    }

    const corners = findFourCorners(candidates, imageWidth, imageHeight);
    if (corners) {
      return buildResult(corners);
    }

    // Final fallback: image bounds with margin
    const margin = Math.min(imageWidth, imageHeight) * 0.03;
    return {
      corners: [],
      edges: candidates.map((c) => c.center),
      boundingBox: {
        left: margin, right: imageWidth - margin, top: margin, bottom: imageHeight - margin,
        width: imageWidth - margin * 2, height: imageHeight - margin * 2,
      },
    };
  } finally {
    contours.delete();
    hierarchy.delete();
  }
}

/**
 * From candidates, pick the 4 closest to each image corner.
 * @param {Array<{ center: Point, area: number }>} candidates
 * @param {number} imageWidth
 * @param {number} imageHeight
 * @returns {{ topLeft: Point, topRight: Point, bottomLeft: Point, bottomRight: Point } | null}
 */
function findFourCorners(candidates, imageWidth, imageHeight) {
  if (candidates.length < 4) return null;

  const imageCorners = [
    { x: 0, y: 0 }, { x: imageWidth, y: 0 },
    { x: 0, y: imageHeight }, { x: imageWidth, y: imageHeight },
  ];

  /** @type {Point[]} */
  const assigned = [];
  /** @type {Set<number>} */
  const used = new Set();
  const maxDist = Math.sqrt(imageWidth * imageWidth + imageHeight * imageHeight) * 0.4;

  for (const corner of imageCorners) {
    let bestDist = Infinity;
    let bestIdx = -1;

    for (let i = 0; i < candidates.length; i++) {
      if (used.has(i)) continue;
      const dist = Math.hypot(candidates[i].center.x - corner.x, candidates[i].center.y - corner.y);
      if (dist < bestDist) { bestDist = dist; bestIdx = i; }
    }

    if (bestIdx === -1 || bestDist > maxDist) return null;
    assigned.push(candidates[bestIdx].center);
    used.add(bestIdx);
  }

  return { topLeft: assigned[0], topRight: assigned[1], bottomLeft: assigned[2], bottomRight: assigned[3] };
}

/**
 * Build MarkerDetectionResult from ordered corner points.
 * @param {{ topLeft: Point, topRight: Point, bottomRight: Point, bottomLeft: Point }} c
 * @returns {MarkerDetectionResult}
 */
function buildResult(c) {
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
