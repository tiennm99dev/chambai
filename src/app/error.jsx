'use client';

/**
 * Root error boundary (Next.js App Router convention). A crash anywhere below
 * this — e.g. a malformed result reaching a scoring calculation — previously
 * blank-screened the whole app with no way back to the other, still-valid
 * sessions saved in IndexedDB.
 */
export default function Error({ error, reset }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-lg shadow-sm border border-red-200 p-6 text-center">
        <h2 className="text-xl font-bold text-red-700 mb-2">Đã xảy ra lỗi</h2>
        <p className="text-sm text-gray-600 mb-4">
          Ứng dụng gặp lỗi không mong muốn. Dữ liệu đã lưu của các phiên khác vẫn còn nguyên trong bộ nhớ trình duyệt.
        </p>
        {error?.message && (
          <p className="text-xs text-gray-400 mb-4 break-words">{error.message}</p>
        )}
        <button
          onClick={reset}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
        >
          Thử tải lại
        </button>
      </div>
    </div>
  );
}
