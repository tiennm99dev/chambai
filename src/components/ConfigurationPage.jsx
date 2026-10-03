'use client';

import { useState } from 'react';
import PhanIAnswerGrid from './phan-i-answer-grid';
import { DEFAULT_SCORING } from '@/lib/scoring';

/** @typedef {import('@/lib/types').SessionConfig} SessionConfig */
/** @typedef {import('@/lib/types').SectionKey} SectionKey */
/** @typedef {import('@/lib/types').SubOption} SubOption */
/** @typedef {import('@/lib/types').TrueFalseAnswer} TrueFalseAnswer */
/** @typedef {{ type: 'success'|'error', text: string }} StatusMessage */

/**
 * @param {object} props
 * @param {SessionConfig} props.config
 * @param {(config: SessionConfig) => void} props.onConfigChange
 * @param {(config: SessionConfig) => void} props.onSave
 * @param {() => void} props.onResetAll
 */
export default function ConfigurationPage({ config, onConfigChange, onSave, onResetAll }) {
  const [statusMessage, setStatusMessage] = useState(/** @type {StatusMessage | null} */ (null));

  /** @param {StatusMessage['type']} type @param {string} text */
  const showStatus = (type, text) => {
    setStatusMessage({ type, text });
    setTimeout(() => setStatusMessage(null), 5000);
  };

  const saveConfig = () => {
    onSave(config);
    showStatus('success', 'Cấu hình đã được lưu thành công!');
  };

  const resetAllData = () => {
    if (confirm('Bạn có chắc chắn muốn xóa tất cả dữ liệu? Hành động này không thể hoàn tác.')) {
      onResetAll();
      showStatus('success', 'Đã xóa tất cả dữ liệu!');
    }
  };

  /** @param {number} index @param {string} answer */
  const updatePhanIAnswer = (index, answer) => {
    const newAnswers = [...config.phanI.answers];
    newAnswers[index] = answer;
    onConfigChange({ ...config, phanI: { ...config.phanI, answers: newAnswers } });
  };

  /** @param {number} questionIndex @param {SubOption} option @param {boolean} value */
  const updatePhanIIAnswer = (questionIndex, option, value) => {
    const newAnswers = [...config.phanII.answers];
    // Copy the sub-option object instead of mutating in place — the previous
    // code mutated a nested object shared with activeSession.config (and with
    // DEFAULT_CONFIG for brand-new sessions), so an "unsaved" edit here could
    // silently leak into the persisted session on the next unrelated save.
    /** @type {TrueFalseAnswer} */
    const existing = newAnswers[questionIndex] || { a: false, b: false, c: false, d: false };
    newAnswers[questionIndex] = { ...existing, [option]: value };
    onConfigChange({ ...config, phanII: { ...config.phanII, answers: newAnswers } });
  };

  /** @param {number} index @param {string} answer */
  const updatePhanIIIAnswer = (index, answer) => {
    const newAnswers = [...config.phanIII.answers];
    newAnswers[index] = answer;
    onConfigChange({ ...config, phanIII: { ...config.phanIII, answers: newAnswers } });
  };

  /** @param {string | TrueFalseAnswer | null | undefined} a */
  const hasEnteredAnswer = (a) => {
    if (a === undefined || a === null) return false;
    if (typeof a === 'object') return Object.values(a).some((v) => v !== null && v !== undefined && v !== false);
    return a !== '';
  };

  /** @param {SectionKey} section @param {number} count */
  const updateQuestionCount = (section, count) => {
    const current = config[section];
    const currentAnswers = current.answers || [];
    if (count < currentAnswers.length) {
      const wouldDiscard = currentAnswers.slice(count).some(hasEnteredAnswer);
      if (wouldDiscard && !confirm(
        `Giảm số câu xuống ${count} sẽ xóa đáp án đã nhập cho các câu từ ${count + 1} trở đi. Tiếp tục?`
      )) {
        return;
      }
    }
    onConfigChange({
      ...config,
      [section]: { ...current, questionCount: count, answers: currentAnswers.slice(0, count) },
    });
  };

  /** @param {SectionKey} section @param {number} value */
  const updateScoring = (section, value) => {
    // A config without a stored scoring block is scored with DEFAULT_SCORING, so
    // start from those values rather than writing a partial block.
    const current = config.scoring ?? DEFAULT_SCORING;
    onConfigChange({
      ...config,
      scoring: { ...current, [section]: { ...current[section], pointsPerQuestion: value || 0 } },
    });
  };

  // Paste A,B,C,D answers from spreadsheet
  /** @param {import('react').ClipboardEvent<HTMLInputElement>} e */
  const handlePasteAnswers = (e) => {
    const text = (e.clipboardData?.getData('text') || '').trim();
    const answers = text.split(/[,\t\n\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter((s) => ['A', 'B', 'C', 'D'].includes(s));
    if (answers.length > 0) {
      const newAnswers = answers.slice(0, config.phanI.questionCount);
      onConfigChange({ ...config, phanI: { ...config.phanI, answers: newAnswers } });
      showStatus('success', `Đã dán ${newAnswers.length} đáp án Phần I`);
      e.preventDefault();
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 pb-20">
      <h2 className="text-2xl font-bold text-gray-900 mb-4">Cấu hình đề thi</h2>

      {statusMessage && (
        <div
          role={statusMessage.type === 'error' ? 'alert' : 'status'}
          className={`mb-4 p-3 rounded-lg text-sm font-medium transition-opacity ${
            statusMessage.type === 'success'
              ? 'bg-green-50 text-green-800 border border-green-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          {statusMessage.text}
        </div>
      )}

      <div className="space-y-8">
        {/* Scoring Config */}
        <ScoringConfig config={config} onUpdate={updateScoring} />

        {/* Phần I */}
        <div className="border border-gray-200 rounded-lg p-6">
          <h3 className="text-xl font-semibold mb-4 text-gray-900">Phần I - Trắc nghiệm (A, B, C, D)</h3>
          <div className="mb-4 flex flex-wrap items-end gap-4">
            <div>
              <label htmlFor="phan-i-question-count" className="block text-sm font-medium text-gray-700 mb-2">Số câu hỏi:</label>
              <input
                id="phan-i-question-count"
                type="number"
                value={config.phanI.questionCount}
                onChange={(e) => updateQuestionCount('phanI', parseInt(e.target.value) || 0)}
                className="w-32 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                min="0" max="100"
              />
            </div>
            <div className="flex-1 min-w-48">
              <label htmlFor="phan-i-paste" className="block text-sm font-medium text-gray-700 mb-2">
                Dán đáp án từ Excel (A,B,C,D...):
              </label>
              <input
                id="phan-i-paste"
                type="text"
                placeholder="Dán danh sách đáp án tại đây"
                onPaste={handlePasteAnswers}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label htmlFor="phan-i-csv" className="block text-sm font-medium text-gray-700 mb-2">Nhập từ CSV:</label>
              <input
                id="phan-i-csv"
                type="file"
                accept=".csv,.txt"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = (ev) => {
                    const text = String(ev.target?.result || '').trim();
                    const answers = text.split(/[,\t\n\r\s]+/)
                      .map((s) => s.trim().toUpperCase())
                      .filter((s) => ['A', 'B', 'C', 'D'].includes(s));
                    if (answers.length > 0) {
                      onConfigChange({ ...config, phanI: { ...config.phanI, answers: answers.slice(0, config.phanI.questionCount) } });
                      showStatus('success', `Đã nhập ${Math.min(answers.length, config.phanI.questionCount)} đáp án từ CSV`);
                    } else {
                      showStatus('error', 'Không tìm thấy đáp án hợp lệ trong file');
                    }
                  };
                  reader.readAsText(file, 'UTF-8');
                  e.target.value = '';
                }}
                className="text-sm text-gray-500 file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
              />
            </div>
          </div>
          <p className="text-xs text-gray-500 mb-3">
            Nhấn vào câu hỏi rồi gõ A/B/C/D trên bàn phím để nhập nhanh. Mũi tên để di chuyển.
          </p>
          <PhanIAnswerGrid
            questionCount={config.phanI.questionCount}
            answers={config.phanI.answers}
            onAnswerChange={updatePhanIAnswer}
          />
        </div>

        {/* Phần II */}
        <PhanIISection config={config} onUpdate={updatePhanIIAnswer} onCountChange={updateQuestionCount} />

        {/* Phần III */}
        <PhanIIISection config={config} onUpdate={updatePhanIIIAnswer} onCountChange={updateQuestionCount} />
      </div>

      {/* Sticky bottom action bar */}
      <div className="no-print fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 shadow-lg z-10">
        <div className="container mx-auto flex gap-3">
          <button onClick={saveConfig} className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors">
            Lưu cấu hình
          </button>
          <button onClick={resetAllData} className="bg-red-600 text-white px-6 py-2 rounded-lg hover:bg-red-700 transition-colors">
            Xóa tất cả dữ liệu
          </button>
        </div>
      </div>
    </div>
  );
}

/** @type {{ key: SectionKey, label: string, defaultStored: number, isPhanII?: boolean }[]} */
const SCORING_FIELDS = [
  { key: 'phanI', label: 'Phần I (điểm/câu)', defaultStored: 0.25 },
  // Stored as pointsPerQuestion (a quarter of the max, for historical reasons —
  // scoring.js computes maxPerQuestion = pointsPerQuestion * 4), but a teacher
  // reads this as "how many points is a fully-correct question worth", so the
  // field displays and edits that per-question maximum directly.
  { key: 'phanII', label: 'Phần II (điểm tối đa/câu, khi cả 4 ý đúng)', defaultStored: 0.25, isPhanII: true },
  { key: 'phanIII', label: 'Phần III (điểm/câu)', defaultStored: 0.5 },
];

/**
 * @param {object} props
 * @param {SessionConfig} props.config
 * @param {(section: SectionKey, value: number) => void} props.onUpdate
 */
function ScoringConfig({ config, onUpdate }) {
  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
      <h3 className="text-lg font-semibold mb-3 text-gray-900">Cấu hình điểm số</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {SCORING_FIELDS.map(({ key, label, defaultStored, isPhanII }) => {
          const stored = config.scoring?.[key]?.pointsPerQuestion ?? defaultStored;
          const displayValue = isPhanII ? stored * 4 : stored;
          return (
            <div key={key}>
              <label htmlFor={`scoring-${key}`} className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
              <input
                id={`scoring-${key}`}
                type="number" step={isPhanII ? '0.05' : '0.25'} min="0"
                value={displayValue}
                onChange={(e) => {
                  const raw = parseFloat(e.target.value) || 0;
                  onUpdate(key, isPhanII ? raw / 4 : raw);
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
              {isPhanII && (
                <p className="text-xs text-gray-500 mt-1">
                  Tỉ lệ theo bậc quy định (CV1239), không tùy chỉnh được: đúng 1 ý = 10%, 2 ý = 25%, 3 ý = 50%, 4 ý = 100% điểm tối đa này.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * @param {object} props
 * @param {SessionConfig} props.config
 * @param {(questionIndex: number, option: SubOption, value: boolean) => void} props.onUpdate
 * @param {(section: SectionKey, count: number) => void} props.onCountChange
 */
function PhanIISection({ config, onUpdate, onCountChange }) {
  return (
    <div className="border border-gray-200 rounded-lg p-6">
      <h3 className="text-xl font-semibold mb-4 text-gray-900">Phần II - Đúng/Sai</h3>
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">Số câu hỏi:</label>
        <input
          type="number"
          value={config.phanII.questionCount}
          onChange={(e) => onCountChange('phanII', parseInt(e.target.value) || 0)}
          className="w-32 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          min="0" max="50"
        />
      </div>
      <div className="space-y-4">
        {Array.from({ length: config.phanII.questionCount }, (_, i) => (
          <div key={i} className="border border-gray-200 rounded-lg p-4">
            <h4 className="font-medium mb-3 text-gray-900">Câu {i + 1}:</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {/** @type {const} */ (['a', 'b', 'c', 'd']).map((option) => (
                <div key={option} className="flex items-center gap-2">
                  <span className="text-sm font-medium w-4">{option.toUpperCase()}:</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => onUpdate(i, option, true)}
                      className={`px-3 py-1 rounded text-sm transition-colors ${
                        config.phanII.answers[i]?.[option] === true
                          ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      }`}
                    >Đúng</button>
                    <button
                      onClick={() => onUpdate(i, option, false)}
                      className={`px-3 py-1 rounded text-sm transition-colors ${
                        config.phanII.answers[i]?.[option] === false
                          ? 'bg-red-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      }`}
                    >Sai</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * @param {object} props
 * @param {SessionConfig} props.config
 * @param {(index: number, answer: string) => void} props.onUpdate
 * @param {(section: SectionKey, count: number) => void} props.onCountChange
 */
function PhanIIISection({ config, onUpdate, onCountChange }) {
  return (
    <div className="border border-gray-200 rounded-lg p-6">
      <h3 className="text-xl font-semibold mb-4 text-gray-900">Phần III - Tự luận số</h3>
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">Số câu hỏi:</label>
        <input
          type="number"
          value={config.phanIII.questionCount}
          onChange={(e) => onCountChange('phanIII', parseInt(e.target.value) || 0)}
          className="w-32 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          min="0" max="20"
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: config.phanIII.questionCount }, (_, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-sm font-medium w-12">Câu {i + 1}:</span>
            <input
              type="text"
              value={config.phanIII.answers[i] || ''}
              onChange={(e) => onUpdate(i, e.target.value)}
              placeholder="Nhập đáp án số"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
