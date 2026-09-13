'use client';

import { SCHEMA_VERSION } from '@/lib/types';

/**
 * Header bar showing active session name with back-to-list button.
 */
export default function SessionHeader({ session, onBack, disabled }) {
  const schemaVersion = session.config?.schemaVersion;
  const isOutdatedSchema = typeof schemaVersion === 'number' && schemaVersion < SCHEMA_VERSION;

  return (
    <div className="no-print flex flex-wrap items-center gap-3 mb-4 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2">
      <button
        onClick={onBack}
        disabled={disabled}
        title={disabled ? 'Đang xử lý ảnh, vui lòng đợi...' : undefined}
        className={`text-sm font-medium ${disabled ? 'text-blue-300 cursor-not-allowed' : 'text-blue-600 hover:text-blue-800'}`}
      >
        &larr; Danh sách phiên
      </button>
      <span className="text-gray-400">|</span>
      <h2 className="font-semibold text-blue-900">{session.name}</h2>
      <span className="text-sm text-blue-600">{session.date}</span>
      {isOutdatedSchema && (
        <span
          className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full"
          title="Phiên này được tạo bằng phiên bản chấm điểm cũ hơn. Một số quy tắc chấm điểm có thể đã thay đổi kể từ đó."
        >
          ⚠ Phiên bản chấm cũ
        </span>
      )}
    </div>
  );
}
