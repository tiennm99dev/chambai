'use client';

import Script from 'next/script';

// jsDelivr mirror of opencv.js — docs.opencv.org returns a Cloudflare 403 and
// is unusable from the browser. Pinned build + SRI hash, verified UMD (sets
// window.cv) with the same onRuntimeInitialized contract as upstream. The
// @techstark/opencv-js devDependency supplies the JSDoc types for this build,
// so bump both versions together.
const OPENCV_SRC = 'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js';
const OPENCV_INTEGRITY = 'sha384-XsTfGA62I8LzqS3D7IcgiSOCrJuECWLcg4s1M0AnrkDCcJ8lXX+j+qdg+o6t7KZa';

/**
 * Loads the OpenCV.js runtime exactly once for the whole app. This is the
 * single place the script is injected — components must never inject their
 * own copy of the script tag. On failure (CDN blocked, offline) it marks
 * `window.__opencvLoadFailed` and fires a `opencv-load-error` window event so
 * `ImageProcessor` can show a clear message instead of spinning forever.
 */
export default function OpenCvLoader() {
  return (
    <Script
      src={OPENCV_SRC}
      integrity={OPENCV_INTEGRITY}
      crossOrigin="anonymous"
      // Must not be "beforeInteractive": Next serializes those props through
      // JSON.stringify, which silently drops function handlers, so onError
      // would never fire and a blocked CDN would spin forever. The runtime is
      // only needed once the teacher starts grading, well after hydration.
      strategy="afterInteractive"
      onError={() => {
        // No ambient type exists for this app-defined flag on `window` — the
        // cast is scoped to this one assignment, not spread across the file.
        /** @type {any} */ (window).__opencvLoadFailed = true;
        window.dispatchEvent(new Event('opencv-load-error'));
      }}
    />
  );
}
