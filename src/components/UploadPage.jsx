'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import ImageProcessor from './ImageProcessor';
import ImageProcessorErrorBoundary from './image-processor-error-boundary';
import HighlightUnknown from './highlight-unknown';
import { saveDebugImage } from '@/lib/indexed-db-store';

const PER_IMAGE_TIMEOUT_MS = 60000; // generous cap for one sheet on modest hardware

function fileKey(file) {
  return `${file.name}-${file.lastModified}-${file.size}`;
}

function isImageFile(file) {
  if (file.type) return file.type.startsWith('image/');
  // Some file managers hand drag-and-drop files over with an empty MIME type.
  return /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);
}

export default function UploadPage({ config, onResultsAdd, onProcessingStateChange }) {
  const [selectedImages, setSelectedImages] = useState([]);
  const [processedResults, setProcessedResults] = useState([]);
  const [failedItems, setFailedItems] = useState(new Map()); // fileKey -> error message
  const [processing, setProcessing] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [completedCount, setCompletedCount] = useState(0);
  const [batchTotal, setBatchTotal] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);
  const [expandedDebug, setExpandedDebug] = useState(new Set());
  const fileInputRef = useRef(null);
  const resolveRef = useRef(null);
  const currentFileRef = useRef(null);
  const succeededKeysRef = useRef(new Set());

  // Let the parent (page.jsx) lock navigation while a batch is running so an
  // in-flight batch can't be unmounted mid-way and silently lose every result
  // still in the queue.
  useEffect(() => {
    onProcessingStateChange?.(processing);
  }, [processing, onProcessingStateChange]);

  useEffect(() => {
    if (!processing) return undefined;
    const handleBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [processing]);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(e.type === 'dragenter' || e.type === 'dragover');
  };

  const addImageFiles = (files) => {
    const all = Array.from(files);
    const imageFiles = all.filter(isImageFile);
    const skipped = all.length - imageFiles.length;
    if (imageFiles.length > 0) {
      setSelectedImages((prev) => [...prev, ...imageFiles]);
    }
    if (skipped > 0) {
      setStatusMessage({
        type: imageFiles.length === 0 ? 'error' : 'info',
        text: `Đã bỏ qua ${skipped} file không phải ảnh.`,
      });
    } else if (imageFiles.length > 0) {
      setStatusMessage(null);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    addImageFiles(e.dataTransfer.files);
  };

  const handleFileSelect = (e) => {
    if (e.target.files) addImageFiles(e.target.files);
    e.target.value = '';
  };

  const removeImage = (index) => {
    setSelectedImages((prev) => {
      const removed = prev[index];
      if (removed) {
        const key = fileKey(removed);
        setFailedItems((fm) => {
          if (!fm.has(key)) return fm;
          const next = new Map(fm);
          next.delete(key);
          return next;
        });
      }
      return prev.filter((_, i) => i !== index);
    });
  };

  const settleCurrentSlot = () => {
    if (resolveRef.current) {
      resolveRef.current();
      resolveRef.current = null;
    }
  };

  const handleProcessingComplete = useCallback((result) => {
    const file = currentFileRef.current;
    const key = file ? fileKey(file) : null;

    if (result?.error) {
      if (key) {
        setFailedItems((fm) => {
          const next = new Map(fm);
          next.set(key, result.errorMessage || 'Lỗi không xác định khi xử lý ảnh.');
          return next;
        });
      }
      setCompletedCount((c) => c + 1);
      settleCurrentSlot();
      return;
    }

    const newResult = {
      id: `student_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      fileName: file?.name || 'unknown',
      studentId: result.studentId,
      examCode: result.examCode,
      phanI: result.phanI,
      phanII: result.phanII,
      phanIII: result.phanIII,
      confidenceMap: result.confidenceMap,
      qualityReport: result.qualityReport,
      needsReview: result.needsReview,
      processed: true,
      debugImageUrl: result.debugImageUrl,
    };

    if (key) {
      succeededKeysRef.current.add(key);
      setFailedItems((fm) => {
        if (!fm.has(key)) return fm;
        const next = new Map(fm);
        next.delete(key);
        return next;
      });
    }

    setProcessedResults((prev) => [...prev, newResult]);
    setCompletedCount((c) => c + 1);

    if (newResult.debugImageUrl) {
      saveDebugImage(newResult.id, newResult.debugImageUrl).catch((err) => {
        console.error('Không lưu được ảnh debug:', err);
      });
    }

    // Persist immediately — an interruption (crash, tab close, nav) must never
    // lose more than the one sheet still in flight.
    Promise.resolve(onResultsAdd([newResult])).catch((err) => {
      console.error('Không lưu được kết quả:', err);
      setStatusMessage({
        type: 'error',
        text: `Không lưu được kết quả của ${newResult.fileName} vào bộ nhớ trình duyệt. Vui lòng xuất CSV ngay sau khi xử lý xong để tránh mất dữ liệu.`,
      });
    });

    settleCurrentSlot();
  }, [onResultsAdd]);

  const handleBoundaryError = useCallback(() => {
    const file = currentFileRef.current;
    if (file) {
      setFailedItems((fm) => {
        const next = new Map(fm);
        next.set(fileKey(file), 'Giao diện xử lý ảnh bị lỗi. Ảnh này đã được bỏ qua.');
        return next;
      });
    }
    setCompletedCount((c) => c + 1);
    settleCurrentSlot();
  }, []);

  const waitForSlot = () => new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolveRef.current = null;
      resolve({ timedOut: true });
    }, PER_IMAGE_TIMEOUT_MS);
    resolveRef.current = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ timedOut: false });
    };
  });

  const processImages = async () => {
    if (selectedImages.length === 0) {
      setStatusMessage({ type: 'error', text: 'Vui lòng chọn ít nhất một hình ảnh để xử lý.' });
      return;
    }
    if (!config || config.phanI.answers.length === 0) {
      setStatusMessage({ type: 'error', text: 'Vui lòng cấu hình đề thi trước khi xử lý ảnh.' });
      return;
    }

    // Snapshot the queue so removing a thumbnail mid-batch (blocked while
    // processing, but defensive anyway) can never desync the loop from what's
    // actually being iterated.
    const filesSnapshot = selectedImages;
    succeededKeysRef.current = new Set();

    setProcessing(true);
    setProcessedResults([]);
    setCompletedCount(0);
    setBatchTotal(filesSnapshot.length);
    setStatusMessage({ type: 'info', text: 'Đang xử lý...' });

    for (let i = 0; i < filesSnapshot.length; i++) {
      currentFileRef.current = filesSnapshot[i];
      setCurrentIndex(i);
      const { timedOut } = await waitForSlot();
      if (timedOut) {
        const key = fileKey(filesSnapshot[i]);
        setFailedItems((fm) => {
          const next = new Map(fm);
          next.set(key, 'Quá thời gian xử lý (máy chậm hoặc ảnh quá lớn). Vui lòng thử lại.');
          return next;
        });
        setCompletedCount((c) => c + 1);
      }
    }

    // Drop successfully processed files from the pending list so pressing
    // "Xử lý ảnh" again only retries the ones that actually failed.
    setSelectedImages((prev) => prev.filter((f) => !succeededKeysRef.current.has(fileKey(f))));
    setCurrentIndex(-1);
    setProcessing(false);

    const failedCount = filesSnapshot.length - succeededKeysRef.current.size;
    if (failedCount === 0) {
      setStatusMessage({ type: 'success', text: `Xử lý hoàn tất ${filesSnapshot.length} ảnh!` });
    } else {
      setStatusMessage({
        type: 'error',
        text: `Xử lý xong: ${succeededKeysRef.current.size} thành công, ${failedCount} lỗi. Kiểm tra ảnh lỗi bên dưới rồi nhấn "Xử lý ảnh" để thử lại.`,
      });
    }
  };

  const toggleDebugPreview = (id) => {
    setExpandedDebug((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const progressPercent = processing && batchTotal > 0
    ? Math.round((Math.min(completedCount, batchTotal) / batchTotal) * 100)
    : 0;

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Tải và xử lý ảnh bài thi</h2>
        <p className="text-gray-600">
          Kéo thả hoặc chọn các file ảnh chứa phiếu trả lời của học sinh
        </p>
      </div>

      {statusMessage && (
        <div
          role={statusMessage.type === 'error' ? 'alert' : 'status'}
          className={`mb-4 p-3 rounded-lg text-sm font-medium ${
            statusMessage.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' :
            statusMessage.type === 'error' ? 'bg-red-50 text-red-800 border border-red-200' :
            'bg-blue-50 text-blue-800 border border-blue-200'
          }`}
        >
          {statusMessage.text}
        </div>
      )}

      <DropZone
        dragActive={dragActive}
        onDrag={handleDrag}
        onDrop={handleDrop}
        onFileSelect={handleFileSelect}
        fileInputRef={fileInputRef}
      />

      {selectedImages.length > 0 && (
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-3 text-gray-900">Ảnh đã chọn ({selectedImages.length})</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {selectedImages.map((file, index) => (
              <ImageThumbnail
                key={fileKey(file)}
                file={file}
                index={index}
                onRemove={removeImage}
                disabled={processing}
                isCurrent={processing && index === currentIndex}
                errorMessage={failedItems.get(fileKey(file))}
              />
            ))}
          </div>
        </div>
      )}

      <div className="mb-6">
        <button
          onClick={processImages}
          disabled={processing || selectedImages.length === 0}
          className={`px-8 py-3 rounded-lg font-semibold transition-colors ${
            processing || selectedImages.length === 0
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : 'bg-green-600 text-white hover:bg-green-700'
          }`}
        >
          {processing ? 'Đang xử lý...' : 'Xử lý ảnh'}
        </button>
      </div>

      {processing && (
        <div className="mb-6">
          <div className="flex justify-between text-sm text-gray-600 mb-1">
            <span>Đang xử lý ảnh {Math.min(completedCount + 1, batchTotal)}/{batchTotal}</span>
            <span>{progressPercent}%</span>
          </div>
          <div className="bg-gray-200 rounded-full h-2.5">
            <div className="bg-blue-600 h-2.5 rounded-full transition-all duration-300" style={{ width: `${progressPercent}%` }} />
          </div>
          {currentIndex >= 0 && currentIndex < selectedImages.length && (
            <p className="text-xs text-gray-500 mt-1">{selectedImages[currentIndex]?.name}</p>
          )}
        </div>
      )}

      {currentIndex >= 0 && currentIndex < selectedImages.length && (
        <ImageProcessorErrorBoundary key={fileKey(selectedImages[currentIndex])} onError={handleBoundaryError}>
          <ImageProcessor
            imageFile={selectedImages[currentIndex]}
            testConfig={config}
            onProcessingComplete={handleProcessingComplete}
          />
        </ImageProcessorErrorBoundary>
      )}

      {processedResults.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold mb-3 text-gray-900">Kết quả xử lý</h3>
          <div className="space-y-4">
            {processedResults.map((result) => {
              const isExpanded = expandedDebug.has(result.id);
              return (
                <div key={result.id} className="border border-gray-200 rounded-lg p-4">
                  <h4 className="font-medium text-gray-900">{result.fileName}</h4>
                  <p className="text-sm text-gray-600">
                    SBD: <HighlightUnknown value={result.studentId} />
                  </p>
                  {result.examCode && (
                    <p className="text-sm text-gray-600">
                      Mã đề: <HighlightUnknown value={result.examCode} />
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2 mt-1">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                      Đã xử lý
                    </span>
                    {result.needsReview && (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                        ⚠ Cần kiểm tra
                      </span>
                    )}
                  </div>
                  {result.qualityReport && !result.qualityReport.passed && (
                    <div className="mt-2 space-y-1">
                      {result.qualityReport.issues.map((issue, i) => (
                        <p key={i} className="text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded">
                          ⚠ {issue.message}
                        </p>
                      ))}
                    </div>
                  )}
                  {result.debugImageUrl && (
                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={() => toggleDebugPreview(result.id)}
                        className="text-sm text-blue-600 hover:underline"
                      >
                        {isExpanded ? 'Ẩn ảnh debug' : 'Xem ảnh debug'}
                      </button>
                      {isExpanded && (
                        <img
                          src={result.debugImageUrl}
                          alt="Debug"
                          className="mt-2 max-w-full h-auto border border-gray-300 rounded"
                          style={{ maxHeight: '400px' }}
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function DropZone({ dragActive, onDrag, onDrop, onFileSelect, fileInputRef }) {
  return (
    <div className="mb-6">
      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          dragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
        }`}
        onDragEnter={onDrag} onDragLeave={onDrag} onDragOver={onDrag} onDrop={onDrop}
      >
        <svg className="mx-auto h-12 w-12 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48">
          <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p className="text-lg text-gray-700 mt-4 mb-2">Kéo thả ảnh vào đây hoặc</p>
        <button onClick={() => fileInputRef.current?.click()} className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors">
          Chọn file
        </button>
        <input ref={fileInputRef} type="file" multiple accept="image/*" onChange={onFileSelect} className="hidden" />
        <p className="text-sm text-gray-500 mt-2">Hỗ trợ các định dạng ảnh phổ biến (JPG, PNG, HEIC, WEBP...)</p>
      </div>
    </div>
  );
}

function ImageThumbnail({ file, index, onRemove, disabled, isCurrent, errorMessage }) {
  const [src, setSrc] = useState('');

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <div className={`border rounded-lg overflow-hidden group relative ${
      errorMessage ? 'border-red-400' : isCurrent ? 'border-blue-400' : 'border-gray-200'
    }`}>
      {src && <img src={src} alt={file.name} className="w-full h-32 object-cover" />}
      <div className="p-2">
        <p className="text-xs font-medium text-gray-700 truncate">{file.name}</p>
        <p className="text-xs text-gray-400">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
        {errorMessage && (
          <p role="alert" className="text-xs text-red-600 mt-1">⚠ {errorMessage}</p>
        )}
        {isCurrent && <p className="text-xs text-blue-600 mt-1">Đang xử lý...</p>}
      </div>
      <button
        onClick={() => onRemove(index)}
        disabled={disabled}
        aria-label={`Xóa ${file.name}`}
        className={`absolute top-1 right-1 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs transition-opacity focus-visible:opacity-100 ${
          disabled ? 'opacity-0 cursor-not-allowed' : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}
