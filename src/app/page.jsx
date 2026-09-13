'use client';

import { useState, useEffect, useCallback } from 'react';
import Navigation from '@/components/Navigation';
import ConfigurationPage from '@/components/ConfigurationPage';
import UploadPage from '@/components/UploadPage';
import ResultsPage from '@/components/ResultsPage';
import SessionList from '@/components/session-list';
import SessionHeader from '@/components/session-header';
import { clearDebugImages } from '@/lib/indexed-db-store';
import { getAllSessions, saveSession, deleteSession } from '@/lib/indexed-db-sessions';
import { getSessionResults, replaceSessionResults, deleteSessionResults } from '@/lib/indexed-db-results';
import { migrateFromLocalStorage } from '@/lib/local-storage-migration';

const DEFAULT_CONFIG = {
  phanI: { questionCount: 40, answers: [] },
  phanII: { questionCount: 8, answers: [] },
  phanIII: { questionCount: 6, answers: [] },
  scoring: {
    phanI: { pointsPerQuestion: 0.25 },
    phanII: { pointsPerQuestion: 0.25, partialCredit: true },
    phanIII: { pointsPerQuestion: 0.5 },
  },
};

// DEFAULT_CONFIG's nested objects must never be handed out by reference — a
// shared reference here previously let an in-memory "unsaved" edit on one
// session mutate the default object used to seed every other new session.
function cloneDefaultConfig() {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

export default function Home() {
  const [sessions, setSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [currentPage, setCurrentPage] = useState('config');
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [results, setResults] = useState([]);
  const [configSaved, setConfigSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [batchProcessing, setBatchProcessing] = useState(false);
  const [storageError, setStorageError] = useState(null);

  // Wraps every IndexedDB write/read used by page-level handlers: on failure
  // the app must never look like it saved when it didn't, so surface a
  // blocking Vietnamese message instead of losing the write silently.
  const runPersist = useCallback(async (fn, failureMessage) => {
    try {
      const value = await fn();
      return { ok: true, value };
    } catch (err) {
      console.error('IndexedDB operation failed:', err);
      setStorageError(failureMessage);
      return { ok: false, value: undefined };
    }
  }, []);

  // Boot: migrate localStorage, then load sessions
  useEffect(() => {
    (async () => {
      try {
        await migrateFromLocalStorage();
        const allSessions = await getAllSessions();
        setSessions(allSessions);
      } catch (err) {
        console.error('Failed to load sessions:', err);
        setStorageError('Không tải được danh sách phiên đã lưu. Vui lòng tải lại trang.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Load session data when active session changes
  const loadSession = useCallback(async (session) => {
    setActiveSession(session);
    setConfig(session.config || cloneDefaultConfig());
    setConfigSaved(true);
    setCurrentPage('config');
    try {
      const sessionResults = await getSessionResults(session.id);
      setResults(sessionResults);
    } catch (err) {
      console.error('Failed to load session results:', err);
      setResults([]);
      setStorageError('Không tải được kết quả đã lưu của phiên này.');
    }
  }, []);

  const handleCreateSession = async (name) => {
    const session = {
      id: `session_${Date.now()}`,
      name,
      date: new Date().toISOString().split('T')[0],
      config: cloneDefaultConfig(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const { ok, value: saved } = await runPersist(
      () => saveSession(session),
      'Không tạo được phiên mới trong bộ nhớ trình duyệt. Vui lòng thử lại.'
    );
    if (!ok) return;
    setSessions((prev) => [...prev, saved]);
    loadSession(saved);
  };

  const handleDeleteSession = async (id) => {
    const { ok } = await runPersist(async () => {
      await deleteSession(id);
      await deleteSessionResults(id);
    }, 'Không xóa được phiên. Vui lòng thử lại.');
    if (!ok) return;
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (activeSession?.id === id) {
      setActiveSession(null);
      setResults([]);
    }
  };

  const handleBackToList = async () => {
    setActiveSession(null);
    setResults([]);
    setConfigSaved(false);
    const { ok, value } = await runPersist(
      () => getAllSessions(),
      'Không tải được danh sách phiên. Vui lòng tải lại trang.'
    );
    if (ok) setSessions(value);
  };

  const handleConfigChange = (newConfig) => {
    setConfig(newConfig);
    // Any edit invalidates the last save — Navigation must stop showing step 1
    // as done until the teacher saves again, otherwise processing/results can
    // silently run against a key that was never persisted.
    setConfigSaved(false);
  };

  const handleConfigSave = async (newConfig) => {
    setConfig(newConfig);
    if (!activeSession) {
      setConfigSaved(true);
      return;
    }
    const { ok, value: saved } = await runPersist(
      () => saveSession({ ...activeSession, config: newConfig, updatedAt: Date.now() }),
      'Không lưu được cấu hình vào bộ nhớ trình duyệt. Vui lòng thử lại.'
    );
    if (!ok) return;
    setConfigSaved(true);
    setActiveSession(saved);
    setSessions((prev) => prev.map((s) => (s.id === saved.id ? saved : s)));
  };

  // Every write below goes through replaceSessionResults, which clears and
  // rewrites a session's results in one IndexedDB transaction — a separate
  // delete-then-save pair is not atomic and can lose or resurrect rows if a
  // batch is interrupted between the two calls.
  const persistResults = useCallback(async (list) => {
    if (!activeSession) return;
    const toSave = list.map(({ debugImageUrl, ...rest }) => rest);
    await runPersist(
      () => replaceSessionResults(activeSession.id, toSave),
      'Không lưu được kết quả vào bộ nhớ trình duyệt. Vui lòng xuất CSV ngay để tránh mất dữ liệu.'
    );
  }, [activeSession, runPersist]);

  const handleResultsAdd = async (newResults) => {
    const withSession = newResults.map((r) => ({ ...r, sessionId: activeSession?.id }));
    let merged = withSession;
    setResults((prev) => {
      merged = [...prev, ...withSession];
      return merged;
    });
    await persistResults(merged);
  };

  const handleResultsUpdate = async (updatedResults) => {
    setResults(updatedResults);
    await persistResults(updatedResults);
  };

  const handleResultsClear = async () => {
    setResults([]);
    await persistResults([]);
    clearDebugImages().catch((err) => console.error('Không xóa được ảnh debug đã lưu:', err));
  };

  const handleResetAll = async () => {
    const cleared = cloneDefaultConfig();
    setConfig(cleared);
    setResults([]);
    setConfigSaved(false);
    if (activeSession) {
      const { ok, value: saved } = await runPersist(async () => {
        await replaceSessionResults(activeSession.id, []);
        return saveSession({ ...activeSession, config: cleared, updatedAt: Date.now() });
      }, 'Không đặt lại được phiên trong bộ nhớ trình duyệt. Vui lòng thử lại.');
      if (ok) setActiveSession(saved);
    }
    clearDebugImages().catch((err) => console.error('Không xóa được ảnh debug đã lưu:', err));
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2" />
          <p className="text-gray-600">Đang tải...</p>
        </div>
      </div>
    );
  }

  const renderPage = () => {
    switch (currentPage) {
      case 'config':
        return (
          <ConfigurationPage
            config={config}
            onConfigChange={handleConfigChange}
            onSave={handleConfigSave}
            onResetAll={handleResetAll}
          />
        );
      case 'upload':
        return (
          <UploadPage
            config={config}
            onResultsAdd={handleResultsAdd}
            onProcessingStateChange={setBatchProcessing}
          />
        );
      case 'results':
        return (
          <ResultsPage
            results={results}
            config={config}
            onResultsUpdate={handleResultsUpdate}
            onResultsClear={handleResultsClear}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Hệ thống chấm điểm trắc nghiệm
          </h1>
          <p className="text-gray-600">
            Tự động nhận diện và chấm điểm bài thi trắc nghiệm tiếng Việt
          </p>
        </div>

        {storageError && (
          <div role="alert" className="no-print mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm font-medium flex items-start justify-between gap-3">
            <span>{storageError}</span>
            <button
              onClick={() => setStorageError(null)}
              aria-label="Đóng thông báo lỗi"
              className="text-red-600 hover:text-red-800 font-bold leading-none"
            >
              ×
            </button>
          </div>
        )}

        {!activeSession ? (
          <SessionList
            sessions={sessions}
            onSelect={loadSession}
            onCreate={handleCreateSession}
            onDelete={handleDeleteSession}
          />
        ) : (
          <>
            <SessionHeader session={activeSession} onBack={handleBackToList} disabled={batchProcessing} />
            <Navigation
              currentPage={currentPage}
              onPageChange={setCurrentPage}
              configSaved={configSaved}
              hasResults={results.length > 0}
              locked={batchProcessing}
            />
            <div className="mt-8">
              {renderPage()}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
