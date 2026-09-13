'use client';

import { useState, useEffect } from 'react';
import { getDebugImage } from '@/lib/indexed-db-store';
import ModalShell from './modal-shell';
import HighlightUnknown from './highlight-unknown';
import ManualCorrectionModal from './manual-correction-modal';

export default function StudentDetailModal({ student, testConfig, onClose, onResultUpdate }) {
  const [debugImageUrl, setDebugImageUrl] = useState(null);
  const [showCorrection, setShowCorrection] = useState(false);

  useEffect(() => {
    getDebugImage(student.id).then((url) => setDebugImageUrl(url)).catch(() => {});
  }, [student.id]);

  const handleCorrectionSave = (correctedStudent) => {
    setShowCorrection(false);
    if (onResultUpdate) onResultUpdate(correctedStudent);
  };

  if (showCorrection) {
    return (
      <ManualCorrectionModal
        student={student}
        testConfig={testConfig}
        debugImageUrl={debugImageUrl}
        onSave={handleCorrectionSave}
        onClose={() => setShowCorrection(false)}
      />
    );
  }

  const titleId = 'student-detail-title';
  const phanIQuestionCount = testConfig?.phanI?.questionCount ?? student.phanI.length;
  const phanIIQuestionCount = testConfig?.phanII?.questionCount ?? student.phanII.length;
  const phanIIIQuestionCount = testConfig?.phanIII?.questionCount ?? student.phanIII.length;

  return (
    <ModalShell labelledBy={titleId} onClose={onClose}>
      <div className="p-6">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h3 id={titleId} className="text-xl font-semibold text-gray-900">
              Chi tiết - SBD: <HighlightUnknown value={student.studentId} />
            </h3>
            {student.examCode && (
              <p className="text-sm text-gray-500">
                Mã đề: <HighlightUnknown value={student.examCode} />
              </p>
            )}
            {student.needsReview && (
              <span className="inline-flex items-center mt-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                ⚠ Cần kiểm tra thủ công
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCorrection(true)}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Sửa đáp án
            </button>
            <button onClick={onClose} aria-label="Đóng" className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
          </div>
        </div>

        {/* Score summary */}
        {student.score && (
          <div className="grid grid-cols-3 gap-4 mb-6">
            <ScoreCard label="Phần I" score={student.score.phanI} />
            <ScoreCard label="Phần II" score={student.score.phanII} />
            <ScoreCard label="Phần III" score={student.score.phanIII} />
          </div>
        )}

        <div className="space-y-6">
          {/* Phan I */}
          <div>
            <h4 className="font-semibold mb-2 text-gray-900">Phần I - Trắc nghiệm</h4>
            <div className="grid grid-cols-5 sm:grid-cols-8 gap-1.5">
              {Array.from({ length: phanIQuestionCount }, (_, i) => {
                const answer = student.phanI[i] ?? '';
                const correct = testConfig?.phanI.answers[i];
                const isCorrect = answer && answer === correct;
                return (
                  <div key={i} className={`p-1.5 rounded text-center text-xs ${
                    !answer ? 'bg-gray-100 text-gray-500' :
                    isCorrect ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                  }`}>
                    <span className="font-medium">{i + 1}:</span> {answer || '-'}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Phan II */}
          <div>
            <h4 className="font-semibold mb-2 text-gray-900">Phần II - Đúng/Sai</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {Array.from({ length: phanIIQuestionCount }, (_, i) => {
                const answer = student.phanII[i] || { a: null, b: null, c: null, d: null };
                return (
                  <div key={i} className="border rounded p-2 text-sm">
                    <span className="font-medium text-gray-900">Câu {i + 1}: </span>
                    {['a', 'b', 'c', 'd'].map((opt) => {
                      const keyVal = testConfig?.phanII.answers[i]?.[opt];
                      const val = answer[opt] ?? null;
                      const label = val === null ? '-' : val ? 'Đ' : 'S';
                      const tone = keyVal === undefined || val === null
                        ? 'bg-gray-100 text-gray-600'
                        : val === keyVal ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800';
                      return (
                        <span key={opt} className={`inline-block px-1.5 py-0.5 rounded mx-0.5 ${tone}`}>
                          {opt.toUpperCase()}: {label}
                        </span>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Phan III */}
          <div>
            <h4 className="font-semibold mb-2 text-gray-900">Phần III - Tự luận số</h4>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {Array.from({ length: phanIIIQuestionCount }, (_, i) => {
                const answer = student.phanIII[i] ?? '';
                const correct = testConfig?.phanIII.answers[i];
                const isCorrect = answer && answer === correct;
                return (
                  <div key={i} className={`p-2 rounded text-center text-sm ${
                    !answer ? 'bg-gray-100 text-gray-500' :
                    isCorrect ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                  }`}>
                    <span className="font-medium">{i + 1}:</span> {answer ? <HighlightUnknown value={answer} /> : '-'}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Debug visualization */}
          {debugImageUrl && (
            <div>
              <h4 className="font-semibold mb-2 text-gray-900">Ảnh debug</h4>
              <img src={debugImageUrl} alt="Debug visualization" className="max-w-full h-auto border border-gray-300 rounded" style={{ maxHeight: '400px' }} />
            </div>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

function ScoreCard({ label, score }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3 text-center">
      <div className="text-sm text-gray-500">{label}</div>
      <div className="text-lg font-bold text-gray-900">{score}</div>
    </div>
  );
}
