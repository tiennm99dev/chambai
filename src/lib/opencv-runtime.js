/** @typedef {import('./types.js').OpenCV} OpenCV */

/**
 * Returns the OpenCV.js runtime global. The UMD build assigns `cv` on the global
 * scope — `window` on the main thread, `self` in a Web Worker — and `globalThis`
 * is that scope in both cases.
 * @returns {OpenCV}
 * @throws {Error} when the runtime has not been loaded yet
 */
export function getCv() {
  const cv = /** @type {typeof globalThis & { cv?: OpenCV }} */ (globalThis).cv;
  if (!cv) throw new Error('OpenCV.js runtime is not loaded');
  return cv;
}
