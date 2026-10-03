'use client';

import { useState, useRef } from 'react';
import { exportSession, importSession } from '@/lib/session-export-import';

/** @typedef {import('@/lib/types').Session} Session */

/** @param {unknown} err @returns {string} */
function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Session list landing page — shows all exam sessions with create/delete/export/import.
 * @param {object} props
 * @param {Session[]} props.sessions
 * @param {(session: Session) => void} props.onSelect
 * @param {(name: string) => void} props.onCreate
 * @param {(id: string) => void} props.onDelete
 */
export default function SessionList({ sessions, onSelect, onCreate, onDelete }) {
  const [newName, setNewName] = useState('');
  const [statusMsg, setStatusMsg] = useState(/** @type {{ type: 'success'|'error', text: string } | null} */ (null));
  /** @type {import('react').RefObject<HTMLInputElement | null>} */
  const importRef = useRef(null);

  const handleCreate = () => {
    const name = newName.trim() || `Phiên ${new Date().toLocaleDateString('vi-VN')}`;
    onCreate(name);
    setNewName('');
  };

  /** @param {string} id @param {import('react').MouseEvent} e */
  const handleExport = async (id, e) => {
    e.stopPropagation();
    try {
      await exportSession(id);
    } catch (err) {
      setStatusMsg({ type: 'error', text: `Lỗi xuất: ${errorMessage(err)}` });
    }
  };

  /** @param {import('react').ChangeEvent<HTMLInputElement>} e */
  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const session = await importSession(file);
      onSelect(session);
      setStatusMsg({ type: 'success', text: `Đã nhập phiên "${session.name}"` });
    } catch (err) {
      setStatusMsg({ type: 'error', text: `Lỗi nhập: ${errorMessage(err)}` });
    }
    e.target.value = '';
  };

  const sorted = [...sessions].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <h2 className="text-2xl font-bold text-gray-900 mb-4">Phiên chấm thi</h2>

      {statusMsg && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${
          statusMsg.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
        }`}>{statusMsg.text}</div>
      )}

      {/* Create / Import */}
      <div className="flex gap-2 mb-6">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Tên phiên mới..."
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={handleCreate}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
        >
          Tạo phiên mới
        </button>
        <button
          onClick={() => importRef.current?.click()}
          className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 text-sm font-medium"
        >
          Nhập phiên
        </button>
        <input ref={importRef} type="file" accept=".json,.chambai.json" onChange={handleImport} className="hidden" />
      </div>

      {sorted.length === 0 ? (
        <p className="text-center text-gray-500 py-8">
          Chưa có phiên nào. Tạo phiên mới để bắt đầu chấm thi.
        </p>
      ) : (
        <div className="grid gap-3">
          {sorted.map((session) => (
            <div
              key={session.id}
              className="flex items-center justify-between border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors"
            >
              <button
                onClick={() => onSelect(session)}
                className="flex-1 text-left"
              >
                <h3 className="font-semibold text-gray-900">{session.name}</h3>
                <p className="text-sm text-gray-500">
                  {session.date}
                  {session.createdAt !== undefined && (
                    <> &middot; Tạo lúc {new Date(session.createdAt).toLocaleString('vi-VN')}</>
                  )}
                </p>
              </button>
              <div className="flex gap-2 ml-3">
                <button
                  onClick={(e) => handleExport(session.id, e)}
                  className="text-gray-500 hover:text-gray-700 text-sm"
                >
                  Xuất
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Xóa phiên "${session.name}"?`)) onDelete(session.id);
                  }}
                  className="text-red-500 hover:text-red-700 text-sm"
                >
                  Xóa
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
