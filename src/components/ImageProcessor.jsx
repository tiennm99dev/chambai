'use client';

import { useEffect, useRef, useState } from 'react';
import { resizeForProcessing } from '@/lib/image-preprocessing';
import { runDetectionPipeline } from '@/lib/detection-pipeline';

/**
 * OpenCV's UMD build and our own load-failure flag both hang off `window`,
 * which has no ambient type for either without @types/react's DOM lib —
 * narrow the escape to this one accessor instead of sprinkling `any` around.
 * @returns {{ cv?: { Mat?: Function, onRuntimeInitialized?: () => void }, __opencvLoadFailed?: boolean }}
 */
function getCvWindow() {
  return /** @type {any} */ (window);
}

/** True only once the WASM runtime is compiled, not just when the JS namespace exists. */
function isCvReady() {
  return typeof window !== 'undefined' && typeof getCvWindow().cv?.Mat === 'function';
}

// Give the OpenCV runtime a generous window on a slow school connection, but
// never an unbounded one — an unreachable engine must surface as an error.
const OPENCV_LOAD_TIMEOUT_MS = 60000;

export default function ImageProcessor({ imageFile, testConfig, onProcessingComplete }) {
  const [processing, setProcessing] = useState(false);
  const [cvLoaded, setCvLoaded] = useState(false);
  const [cvLoadError, setCvLoadError] = useState(false);
  const [debugImageUrl, setDebugImageUrl] = useState(null);

  // Always call the latest callback without adding it to effect deps below —
  // the parent recreates it on every render, and re-running the pipeline
  // effect on every parent render would restart in-flight processing. Synced
  // in an effect (not during render) since refs must not be written mid-render.
  const onProcessingCompleteRef = useRef(onProcessingComplete);
  useEffect(() => {
    onProcessingCompleteRef.current = onProcessingComplete;
  });

  useEffect(() => {
    let cancelled = false;
    /** @type {ReturnType<typeof setInterval> | undefined} */
    let pollId;

    const markReady = () => { if (!cancelled) setCvLoaded(true); };
    const markError = () => { if (!cancelled) setCvLoadError(true); };

    if (typeof window === 'undefined') return undefined;
    const cvWindow = getCvWindow();

    if (cvWindow.__opencvLoadFailed) {
      markError();
      return undefined;
    }
    if (isCvReady()) {
      markReady();
      return undefined;
    }

    window.addEventListener('opencv-load-error', markError);

    if (cvWindow.cv) {
      // window.cv already exists (UMD assigns it synchronously) but the WASM
      // runtime may still be compiling — wait for the real ready signal.
      const prevInit = cvWindow.cv.onRuntimeInitialized;
      cvWindow.cv.onRuntimeInitialized = () => { prevInit?.(); markReady(); };
    } else {
      // Script tag hasn't executed yet on a slow connection; there is no
      // single reliable event for "UMD global just got assigned", so poll.
      // Bounded deadline: onError is not guaranteed to fire for every failure
      // mode (an SRI mismatch or a captive-portal redirect can stall silently),
      // so the poll must give up on its own rather than spin indefinitely.
      const deadline = Date.now() + OPENCV_LOAD_TIMEOUT_MS;
      pollId = setInterval(() => {
        if (cvWindow.__opencvLoadFailed) { clearInterval(pollId); markError(); return; }
        if (isCvReady()) { clearInterval(pollId); markReady(); return; }
        if (cvWindow.cv && !cvWindow.cv.onRuntimeInitialized) {
          cvWindow.cv.onRuntimeInitialized = markReady;
        }
        if (Date.now() > deadline) { clearInterval(pollId); markError(); }
      }, 150);
    }

    return () => {
      cancelled = true;
      if (pollId) clearInterval(pollId);
      window.removeEventListener('opencv-load-error', markError);
    };
  }, []);

  // If OpenCV never loads, every queued image must still settle so a batch
  // never hangs — surface it as a per-image error instead of a silent spinner.
  useEffect(() => {
    if (cvLoadError && imageFile) {
      onProcessingCompleteRef.current({
        error: true,
        errorMessage: 'Không thể tải công cụ xử lý ảnh (OpenCV). Vui lòng tải lại trang.',
      });
    }
  }, [cvLoadError, imageFile]);

  useEffect(() => {
    if (!cvLoaded || !imageFile) return undefined;

    let cancelled = false;
    setProcessing(true);
    setDebugImageUrl(null);

    const imageUrl = URL.createObjectURL(imageFile);
    const img = new Image();

    img.onload = () => {
      if (cancelled) {
        URL.revokeObjectURL(imageUrl);
        return;
      }
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = img.width;
        canvas.height = img.height;
        ctx?.drawImage(img, 0, 0);

        const processCanvas = resizeForProcessing(canvas);
        const processCtx = processCanvas.getContext('2d');
        const imageData = processCtx?.getImageData(0, 0, processCanvas.width, processCanvas.height);
        if (!imageData) {
          throw new Error('Không đọc được dữ liệu ảnh.');
        }

        const { result } = runDetectionPipeline(imageData, canvas, testConfig);
        if (cancelled) return;
        setDebugImageUrl(result.debugImageUrl);
        onProcessingCompleteRef.current(result);
      } catch (err) {
        console.error('Pipeline error:', err);
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          onProcessingCompleteRef.current({ error: true, errorMessage: message });
        }
      } finally {
        URL.revokeObjectURL(imageUrl);
        if (!cancelled) setProcessing(false);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(imageUrl);
      if (cancelled) return;
      setProcessing(false);
      onProcessingCompleteRef.current({
        error: true,
        errorMessage: 'Không đọc được file ảnh. File có thể bị hỏng hoặc sai định dạng.',
      });
    };

    img.src = imageUrl;

    return () => {
      cancelled = true;
    };
  }, [cvLoaded, imageFile, testConfig]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center p-4">
        {cvLoadError && (
          <div className="text-center max-w-md">
            <p className="text-sm font-medium text-red-700">Không thể tải công cụ xử lý ảnh (OpenCV).</p>
            <p className="text-xs text-red-600 mt-1">
              Vui lòng kiểm tra kết nối mạng và tải lại trang. Chức năng chấm điểm hiện không khả dụng.
            </p>
          </div>
        )}
        {!cvLoaded && !cvLoadError && (
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2" />
            <p className="text-sm text-gray-600">Đang tải OpenCV...</p>
          </div>
        )}
        {cvLoaded && processing && (
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600 mx-auto mb-2" />
            <p className="text-sm text-gray-600">Đang xử lý ảnh...</p>
          </div>
        )}
      </div>

      {debugImageUrl && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <h3 className="text-lg font-semibold text-gray-900 mb-3">Debug Visualization</h3>
          <div className="flex flex-col items-center space-y-3">
            <img
              src={debugImageUrl}
              alt="Debug visualization showing detected bubbles"
              className="max-w-full h-auto border border-gray-300 rounded"
              style={{ maxHeight: '600px' }}
            />
            <div className="text-sm text-gray-600 bg-gray-50 p-3 rounded-lg">
              <div className="font-medium mb-2">Legend:</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full border-2 border-pink-400" />
                  <span>All positions</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full border-2 border-blue-500" />
                  <span>Student ID</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full border-2 border-purple-500" />
                  <span>Exam code</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full border-2 border-green-500" />
                  <span>Correct</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full border-2 border-red-500" />
                  <span>Wrong</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
