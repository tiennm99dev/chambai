'use client';

import { useRef, useCallback } from 'react';

const LOW_CONF_MIN = 0.25;
const LOW_CONF_MAX = 0.45;

/**
 * Keyboard-navigable answer grid for Phần I multiple choice (A/B/C/D).
 * Type A/B/C/D to set answer (press the same letter again to clear) and
 * auto-advance. Backspace clears and steps back. Arrow keys move between
 * questions without leaving the keyboard.
 *
 * Shared by the configuration page (plain answer-key entry) and the manual
 * correction modal, which additionally passes `correctAnswers` (renders
 * correct/wrong/neutral instead of a plain "selected" color) and
 * `confidenceMap` (flags a faint/uncertain mark for review even when the
 * detector left the question blank).
 * @param {object} props
 * @param {number} props.questionCount
 * @param {string[]} props.answers
 * @param {(index: number, value: string) => void} props.onAnswerChange
 * @param {string[]} [props.correctAnswers] - omitted on the configuration page, which has no separate key to compare against
 * @param {Record<number, Record<string, number>>} [props.confidenceMap]
 */
export default function PhanIAnswerGrid({
  questionCount,
  answers,
  onAnswerChange,
  correctAnswers,
  confidenceMap,
}) {
  const questionRefs = useRef([]);

  const setAnswer = useCallback((index, option) => {
    onAnswerChange(index, answers[index] === option ? '' : option);
  }, [answers, onAnswerChange]);

  const handleKeyDown = useCallback((index, e) => {
    const key = e.key.toUpperCase();

    if (['A', 'B', 'C', 'D'].includes(key)) {
      e.preventDefault();
      onAnswerChange(index, key);
      if (index < questionCount - 1) {
        questionRefs.current[index + 1]?.focus();
      }
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      onAnswerChange(index, '');
      if (index > 0) {
        questionRefs.current[index - 1]?.focus();
      }
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      if (index < questionCount - 1) {
        questionRefs.current[index + 1]?.focus();
      }
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      if (index > 0) {
        questionRefs.current[index - 1]?.focus();
      }
    }
  }, [questionCount, onAnswerChange]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: questionCount }, (_, i) => {
        const answer = answers[i] ?? '';
        const qConf = confidenceMap?.[i + 1] || {};
        // A faint mark that never crossed the fill threshold shows up as a
        // blank answer, not a low-confidence selected one — check every
        // option's fill so a blank caused by a light pencil still gets flagged.
        const maxFill = answer ? (qConf[answer] || 0) : Math.max(0, ...Object.values(qConf));
        const isLowConf = maxFill > LOW_CONF_MIN && maxFill < LOW_CONF_MAX;

        return (
          <div
            key={i}
            ref={(el) => { questionRefs.current[i] = el; }}
            tabIndex={0}
            role="group"
            aria-label={`Câu ${i + 1}${isLowConf ? ', độ tin cậy thấp, cần kiểm tra lại' : ''}`}
            onKeyDown={(e) => handleKeyDown(i, e)}
            className={`flex items-center gap-2 rounded p-1 focus:outline-none focus:ring-2 focus:ring-blue-400 ${
              isLowConf ? 'ring-1 ring-amber-400 bg-amber-50' : ''
            }`}
          >
            <span className="text-sm font-medium w-12 text-gray-900">
              Câu {i + 1}:
              {isLowConf && (
                <span title="Độ tin cậy thấp, cần kiểm tra lại" aria-hidden="true"> ⚠</span>
              )}
            </span>
            <div className="flex gap-1">
              {['A', 'B', 'C', 'D'].map((option) => {
                const selected = answer === option;
                const correct = correctAnswers?.[i];
                let colorClass = 'bg-white text-gray-700 border-gray-300 hover:border-blue-400';
                if (selected) {
                  if (correctAnswers) {
                    if (correct === undefined) {
                      colorClass = 'bg-gray-400 text-white border-gray-400';
                    } else if (option === correct) {
                      colorClass = 'bg-green-600 text-white border-green-600';
                    } else {
                      colorClass = 'bg-red-600 text-white border-red-600';
                    }
                  } else {
                    colorClass = 'bg-blue-600 text-white border-blue-600';
                  }
                }
                return (
                  <button
                    key={option}
                    type="button"
                    tabIndex={-1}
                    aria-pressed={selected}
                    onClick={() => setAnswer(i, option)}
                    className={`w-9 h-9 rounded border-2 text-sm font-medium transition-colors ${colorClass}`}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
