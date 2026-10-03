'use client';

import { useState, useMemo, useCallback } from 'react';
import { calculateScore } from '@/lib/scoring';
import { UNKNOWN_DIGIT } from '@/lib/types';
import ModalShell from './modal-shell';
import PhanIAnswerGrid from './phan-i-answer-grid';
import HighlightUnknown from './highlight-unknown';

/** @typedef {import('@/lib/types').SessionResult} SessionResult */
/** @typedef {import('@/lib/types').TrueFalseAnswer} TrueFalseAnswer */
/** @typedef {import('@/lib/types').SubOption} SubOption */

const SUB_OPTIONS = /** @type {const} */ (['a', 'b', 'c', 'd']);

/** @type {Readonly<TrueFalseAnswer>} */
const BLANK_TRUE_FALSE = { a: null, b: null, c: null, d: null };

/**
 * Modal for manually correcting detected answers.
 * Shows editable answer grid with confidence-based highlighting.
 * Low-confidence detections (0.25-0.45) are highlighted for review.
 * @param {object} props
 * @param {SessionResult} props.student
 * @param {import('@/lib/types').SessionConfig} props.testConfig
 * @param {string | null} props.debugImageUrl
 * @param {(corrected: SessionResult) => void} props.onSave
 * @param {() => void} props.onClose
 */
export default function ManualCorrectionModal({ student, testConfig, debugImageUrl, onSave, onClose }) {
  const [phanI, setPhanI] = useState([...student.phanI]);
  const [phanII, setPhanII] = useState(student.phanII.map((a) => ({ ...a })));
  const [phanIII, setPhanIII] = useState([...student.phanIII]);
  const [showOriginal, setShowOriginal] = useState(false);

  const confidenceMap = student.confidenceMap || {};

  // Only phanI/phanII/phanIII feed calculateScore — depending on the whole
  // `student` object recomputed the memo on every parent re-render since its
  // identity changes each time, even when nothing relevant changed.
  const liveScore = useMemo(
    () => calculateScore({ phanI, phanII, phanIII }, testConfig),
    [phanI, phanII, phanIII, testConfig]
  );

  const isDirty = useMemo(() => (
    JSON.stringify(phanI) !== JSON.stringify(student.phanI) ||
    JSON.stringify(phanII) !== JSON.stringify(student.phanII) ||
    JSON.stringify(phanIII) !== JSON.stringify(student.phanIII)
  ), [phanI, phanII, phanIII, student]);

  const requestClose = useCallback(() => {
    if (isDirty && !confirm('Bỏ các thay đổi chưa lưu?')) return;
    onClose();
  }, [isDirty, onClose]);

  const handlePhanIChange = useCallback((/** @type {number} */ index, /** @type {string} */ value) => {
    setPhanI((prev) => {
      const next = [...prev];
      while (next.length <= index) next.push('');
      next[index] = value;
      return next;
    });
  }, []);

  /** @param {number} questionIdx @param {SubOption} subOpt @param {boolean} targetValue */
  const handlePhanIIToggle = (questionIdx, subOpt, targetValue) => {
    setPhanII((prev) => {
      const next = prev.map((a) => ({ ...a }));
      while (next.length <= questionIdx) next.push({ ...BLANK_TRUE_FALSE });
      const current = next[questionIdx]?.[subOpt] ?? null;
      next[questionIdx] = {
        ...(next[questionIdx] || { ...BLANK_TRUE_FALSE }),
        [subOpt]: current === targetValue ? null : targetValue,
      };
      return next;
    });
  };

  /** @param {number} questionIdx @param {string} value */
  const handlePhanIIIChange = (questionIdx, value) => {
    setPhanIII((prev) => {
      const next = [...prev];
      while (next.length <= questionIdx) next.push('');
      next[questionIdx] = value;
      return next;
    });
  };

  const handleSave = () => {
    onSave({
      ...student,
      phanI,
      phanII,
      phanIII,
      corrected: true,
      needsReview: false,
      score: liveScore,
    });
  };

  const titleId = 'manual-correction-title';

  return (
    <ModalShell
      labelledBy={titleId}
      onClose={requestClose}
      className="bg-white rounded-lg max-w-5xl w-full max-h-[90vh] overflow-y-auto m-4 focus:outline-none"
    >
      <div className="p-6">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h3 id={titleId} className="text-xl font-semibold text-gray-900">
              Sửa đáp án - SBD: <HighlightUnknown value={student.studentId} />
            </h3>
            <p className="text-sm text-gray-500">
              Nhấn vào đáp án để thay đổi (bấm lại để bỏ chọn). Điểm cập nhật tự động.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold text-blue-600">
              {liveScore.total}/{liveScore.maxTotal}
            </span>
            <button onClick={requestClose} aria-label="Đóng" className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
          </div>
        </div>

        {debugImageUrl && (
          <div className="mb-4">
            <button
              type="button"
              onClick={() => setShowOriginal((v) => !v)}
              className="text-sm text-blue-600 hover:underline"
            >
              {showOriginal ? 'Ẩn ảnh gốc' : 'Xem ảnh gốc để đối chiếu'}
            </button>
            {showOriginal && (
              // eslint-disable-next-line @next/next/no-img-element -- persisted debug data URL, next/image cannot optimize it
              <img
                src={debugImageUrl}
                alt="Ảnh gốc bài thi"
                className="mt-2 max-w-full h-auto border border-gray-300 rounded"
                style={{ maxHeight: '400px' }}
              />
            )}
          </div>
        )}

        {/* Legend */}
        <div className="flex flex-wrap gap-4 text-xs mb-4 bg-gray-50 p-2 rounded">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-100 border border-amber-400" /> Độ tin cậy thấp</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-200 border border-green-400" /> Đúng</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-200 border border-red-400" /> Sai</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-gray-100 border border-gray-300" /> Trống / chưa có đáp án đúng</span>
        </div>

        <div className="mb-6">
          <h4 className="font-semibold mb-2 text-gray-900">Phần I - Trắc nghiệm</h4>
          <p className="text-xs text-gray-500 mb-2">Gõ A/B/C/D để chọn nhanh, mũi tên để di chuyển giữa các câu.</p>
          <PhanIAnswerGrid
            questionCount={testConfig.phanI.questionCount}
            answers={phanI}
            onAnswerChange={handlePhanIChange}
            correctAnswers={testConfig.phanI.answers}
            confidenceMap={confidenceMap}
          />
        </div>

        <PhanIIGrid
          answers={phanII}
          correctAnswers={testConfig.phanII.answers}
          onToggle={handlePhanIIToggle}
        />

        <PhanIIIGrid
          answers={phanIII}
          correctAnswers={testConfig.phanIII.answers}
          onChange={handlePhanIIIChange}
        />

        <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
          <button onClick={requestClose} className="px-4 py-2 text-gray-600 hover:text-gray-800">Hủy</button>
          <button onClick={handleSave} className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            Lưu thay đổi
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

/**
 * @param {object} props
 * @param {TrueFalseAnswer[]} props.answers
 * @param {TrueFalseAnswer[]} props.correctAnswers
 * @param {(questionIdx: number, subOpt: SubOption, value: boolean) => void} props.onToggle
 */
function PhanIIGrid({ answers, correctAnswers, onToggle }) {
  return (
    <div className="mb-6">
      <h4 className="font-semibold mb-2 text-gray-900">Phần II - Đúng/Sai</h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {Array.from({ length: correctAnswers.length }, (_, i) => {
          const answer = answers[i] || BLANK_TRUE_FALSE;
          return (
            <div key={i} className="border rounded p-2 text-sm">
              <span className="font-medium mr-2 text-gray-900">Câu {i + 1}:</span>
              {SUB_OPTIONS.map((opt) => {
                const keyVal = correctAnswers[i]?.[opt];
                const val = answer[opt] ?? null;
                return (
                  <span key={opt} className="inline-flex items-center gap-0.5 mr-2">
                    <span className="text-xs text-gray-500">{opt.toUpperCase()}</span>
                    {[{ v: true, label: 'Đ' }, { v: false, label: 'S' }].map(({ v, label }) => {
                      const active = val === v;
                      let cls = 'bg-gray-100 text-gray-600 border-gray-300 hover:bg-gray-200';
                      if (active) {
                        cls = keyVal === undefined
                          ? 'bg-gray-500 text-white border-gray-500'
                          : v === keyVal
                            ? 'bg-green-600 text-white border-green-600'
                            : 'bg-red-600 text-white border-red-600';
                      }
                      return (
                        <button
                          key={label}
                          type="button"
                          aria-pressed={active}
                          aria-label={`Câu ${i + 1} ý ${opt.toUpperCase()}: ${active ? `đang chọn ${label === 'Đ' ? 'đúng' : 'sai'}, bấm lại để bỏ chọn` : `chọn ${label === 'Đ' ? 'đúng' : 'sai'}`}`}
                          onClick={() => onToggle(i, opt, v)}
                          className={`px-1.5 py-0.5 text-xs rounded border transition-colors ${cls}`}
                        >
                          {label}
                        </button>
                      );
                    })}
                    {val === null && <span className="text-xs text-gray-400 italic">trống</span>}
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * @param {object} props
 * @param {string[]} props.answers
 * @param {string[]} props.correctAnswers
 * @param {(questionIdx: number, value: string) => void} props.onChange
 */
function PhanIIIGrid({ answers, correctAnswers, onChange }) {
  return (
    <div>
      <h4 className="font-semibold mb-2 text-gray-900">Phần III - Tự luận số</h4>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {Array.from({ length: correctAnswers.length }, (_, i) => {
          const answer = answers[i] ?? '';
          const correct = correctAnswers[i];
          const hasUnknown = answer.includes(UNKNOWN_DIGIT);
          const isCorrect = answer && !hasUnknown && answer === correct;
          return (
            <div key={i} className="text-center">
              <div className="text-xs font-medium text-gray-500 mb-1">Câu {i + 1}</div>
              <input
                type="text"
                value={answer}
                onChange={(e) => onChange(i, e.target.value)}
                aria-label={`Câu ${i + 1} Phần III`}
                className={`w-full px-2 py-1 text-sm text-center border rounded text-gray-900 ${
                  !answer ? 'border-gray-300' :
                  hasUnknown ? 'border-amber-400 bg-amber-50' :
                  isCorrect ? 'border-green-400 bg-green-50' : 'border-red-400 bg-red-50'
                }`}
              />
              {correct && <div className="text-xs text-gray-400 mt-0.5">ĐA: {correct}</div>}
              {hasUnknown && <div className="text-xs text-amber-600 mt-0.5">Có ký tự chưa đọc được</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
