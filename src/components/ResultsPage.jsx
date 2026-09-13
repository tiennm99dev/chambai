'use client';

import { useState, useMemo } from 'react';
import { calculateScore } from '@/lib/scoring';
import { calculateClassStatistics } from '@/lib/statistics';
import StudentDetailModal from './student-detail-modal';
import ItemAnalysisView from './item-analysis-view';
import ScoreDistributionChart from './score-distribution-chart';
import HighlightUnknown from './highlight-unknown';

/** Characters Excel/Sheets would otherwise interpret as a formula prefix. */
const CSV_FORMULA_PREFIX = /^[=+\-@\t\r]/;

function escapeCsvField(value) {
  const str = String(value ?? '');
  const guarded = CSV_FORMULA_PREFIX.test(str) ? `'${str}` : str;
  // Quote (and double any embedded quote) whenever the field could otherwise
  // shift a column or row: comma, quote, or embedded newline.
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export default function ResultsPage({ results: rawResults, config, onResultsUpdate, onResultsClear }) {
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [sortKey, setSortKey] = useState('studentId');
  const [sortDir, setSortDir] = useState('asc');
  const [filterText, setFilterText] = useState('');
  const [activeTab, setActiveTab] = useState('results');

  // Score all results against current config. A result whose image processing
  // failed (`error` set) carries no reliable answer arrays — it must never
  // reach calculateScore, which would either throw or fabricate a grade for it.
  const results = useMemo(() => {
    if (!config) return rawResults;
    return rawResults.map((r) => (r.error ? r : { ...r, score: calculateScore(r, config) }));
  }, [rawResults, config]);

  const scoredResults = useMemo(() => results.filter((r) => !r.error), [results]);
  const legacyPhanII = scoredResults.some((r) => r.score?.legacyPhanII);
  const needsReviewCount = results.filter((r) => r.needsReview).length;

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sortedResults = useMemo(() => {
    let filtered = results;
    if (filterText) {
      const lower = filterText.toLowerCase();
      filtered = results.filter((r) => r.studentId?.toLowerCase().includes(lower) || r.fileName?.toLowerCase().includes(lower));
    }
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'studentId') cmp = (a.studentId || '').localeCompare(b.studentId || '');
      else if (sortKey === 'total') cmp = (a.score?.total ?? 0) - (b.score?.total ?? 0);
      else if (sortKey === 'percentage') cmp = (a.score?.percentage ?? 0) - (b.score?.percentage ?? 0);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [results, sortKey, sortDir, filterText]);

  const stats = useMemo(() => calculateClassStatistics(scoredResults), [scoredResults]);

  const clearResults = () => {
    if (confirm('Bạn có chắc chắn muốn xóa tất cả kết quả?')) {
      onResultsClear();
    }
  };

  const exportToCSV = () => {
    if (results.length === 0) return;
    const headers = ['SBD', 'Ma de', 'Phan I', 'Phan II', 'Phan III', 'Tong diem', 'Diem toi da', 'Phan tram'];
    const rows = sortedResults.map((r) => [
      r.studentId, r.examCode || '',
      r.score?.phanI ?? 0, r.score?.phanII ?? 0, r.score?.phanIII ?? 0,
      r.score?.total ?? 0, r.score?.maxTotal ?? 0, r.score?.percentage ?? 0,
    ]);
    const csvContent = [headers, ...rows]
      .map((row) => row.map(escapeCsvField).join(','))
      .join('\n');

    const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `ket_qua_thi_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const selectedData = results.find((r) => r.id === selectedStudent);
  const sortArrow = (key) => sortKey === key ? (sortDir === 'asc' ? '↑' : '↓') : '';
  const ariaSort = (key) => sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h2 className="text-2xl font-bold text-gray-900">Kết quả chấm điểm</h2>
        <div className="flex-1" />
        <button onClick={() => window.print()} disabled={results.length === 0}
          className={`no-print px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            results.length === 0 ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-gray-600 text-white hover:bg-gray-700'
          }`}>In kết quả</button>
        <button onClick={exportToCSV} disabled={results.length === 0}
          className={`no-print px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            results.length === 0 ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-green-600 text-white hover:bg-green-700'
          }`}>Xuất CSV</button>
        <button onClick={clearResults} disabled={results.length === 0}
          className={`no-print px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            results.length === 0 ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-red-600 text-white hover:bg-red-700'
          }`}>Xóa kết quả</button>
      </div>

      {results.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-500">Chưa có kết quả nào. Vui lòng xử lý ảnh trước.</p>
        </div>
      ) : (
        <div>
          {legacyPhanII && (
            <div className="no-print mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
              ⚠ Phiên này đang chấm Phần II theo công thức cũ (cộng điểm tuyến tính theo từng ý đúng), vì được tạo trước khi
              áp dụng bậc thang điểm chính thức (1 ý = 10%, 2 ý = 25%, 3 ý = 50%, 4 ý = 100% điểm tối đa). Điểm đã ghi nhận sẽ
              không tự thay đổi — muốn chấm lại theo công thức mới, hãy tạo phiên mới và xử lý lại ảnh.
            </div>
          )}
          {needsReviewCount > 0 && (
            <div className="no-print mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
              ⚠ {needsReviewCount} bài cần kiểm tra thủ công (có ô không đọc được rõ). Xem cột &quot;Cần kiểm tra&quot; bên dưới.
            </div>
          )}

          {/* Statistics */}
          {stats && <StatisticsSummary stats={stats} />}

          {/* Tabs */}
          <div className="flex gap-1 mb-4 border-b border-gray-200 no-print">
            {[
              { key: 'results', label: 'Bảng điểm' },
              { key: 'analysis', label: 'Phân tích câu hỏi' },
              { key: 'distribution', label: 'Phân phối điểm' },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.key
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Results Table */}
          {activeTab === 'results' && (
            <>
              <div className="mb-4 no-print">
                <input type="text" placeholder="Tìm theo SBD hoặc tên file..." value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  className="w-64 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <span className="text-sm text-gray-500 ml-3">{sortedResults.length} / {results.length} kết quả</span>
              </div>

              <div className="overflow-x-auto mb-8">
                <table className="min-w-full border border-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <ThBtn onClick={() => handleSort('studentId')} ariaSort={ariaSort('studentId')}>SBD{sortArrow('studentId')}</ThBtn>
                      <Th>Mã đề</Th><Th>Phần I</Th><Th>Phần II</Th><Th>Phần III</Th>
                      <ThBtn onClick={() => handleSort('total')} ariaSort={ariaSort('total')}>Tổng{sortArrow('total')}</ThBtn>
                      <ThBtn onClick={() => handleSort('percentage')} ariaSort={ariaSort('percentage')}>%{sortArrow('percentage')}</ThBtn>
                      <Th>Trạng thái</Th>
                      <Th>Chi tiết</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedResults.map((result) => (
                      result.error ? (
                        <tr key={result.id} className="border-t border-gray-200 bg-red-50">
                          <Td colSpan={7} className="text-red-700">
                            Lỗi xử lý — {result.fileName || 'không rõ file'}: {result.error}
                          </Td>
                          <Td>
                            <button onClick={() => onResultsUpdate(rawResults.filter((r) => r.id !== result.id))} className="text-red-600 hover:text-red-800 text-sm no-print">
                              Xóa
                            </button>
                          </Td>
                        </tr>
                      ) : (
                        <tr key={result.id} className={`border-t border-gray-200 hover:bg-gray-50 ${result.needsReview ? 'bg-amber-50' : ''}`}>
                          <Td><HighlightUnknown value={result.studentId} /></Td>
                          <Td>{result.examCode ? <HighlightUnknown value={result.examCode} /> : '-'}</Td>
                          <Td>{result.score?.phanI ?? 0}</Td>
                          <Td>{result.score?.phanII ?? 0}</Td>
                          <Td>{result.score?.phanIII ?? 0}</Td>
                          <Td className="font-semibold">{result.score?.total ?? 0}/{result.score?.maxTotal ?? 0}</Td>
                          <Td><ScoreBadge percentage={result.score?.percentage ?? 0} /></Td>
                          <Td>
                            {result.needsReview && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                                ⚠ Cần kiểm tra
                              </span>
                            )}
                          </Td>
                          <Td>
                            <button onClick={() => setSelectedStudent(result.id)} className="text-blue-600 hover:text-blue-800 text-sm no-print">Xem</button>
                          </Td>
                        </tr>
                      )
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Item Analysis Tab */}
          {activeTab === 'analysis' && (
            <div className="mb-8">
              <ItemAnalysisView results={scoredResults} config={config} />
            </div>
          )}

          {/* Score Distribution Tab */}
          {activeTab === 'distribution' && (
            <div className="mb-8">
              <ScoreDistributionChart results={scoredResults} />
            </div>
          )}

          {selectedStudent && selectedData && !selectedData.error && (
            <StudentDetailModal
              student={selectedData}
              testConfig={config}
              onClose={() => setSelectedStudent(null)}
              onResultUpdate={(corrected) => {
                const updated = rawResults.map((r) => r.id === corrected.id ? corrected : r);
                onResultsUpdate(updated);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

// --- Statistics ---

function StatisticsSummary({ stats }) {
  const maxBucket = Math.max(...Object.values(stats.distribution), 1);
  return (
    <div className="mb-6 border border-gray-200 rounded-lg p-4 bg-gray-50">
      <h3 className="text-lg font-semibold mb-3 text-gray-900">Thống kê lớp</h3>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
        <StatCard label="Sĩ số" value={stats.count} />
        <StatCard label="Điểm TB" value={stats.mean} />
        <StatCard label="Trung vị" value={stats.median} />
        <StatCard label="Thấp nhất" value={stats.min} />
        <StatCard label="Cao nhất" value={stats.max} />
      </div>
      <div className="flex items-end gap-2 h-16">
        {Object.entries(stats.distribution).map(([range, count]) => (
          <div key={range} className="flex-1 flex flex-col items-center">
            <div className="w-full bg-blue-500 rounded-t" style={{ height: `${(count / maxBucket) * 48}px`, minHeight: count > 0 ? '4px' : '0' }} />
            <span className="text-xs text-gray-500 mt-1">{range}%</span>
            <span className="text-xs font-medium text-gray-900">{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="bg-white rounded-lg p-2 text-center border border-gray-200">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-lg font-bold text-gray-900">{value}</div>
    </div>
  );
}

// --- Table helpers ---

function Th({ children }) {
  return <th className="px-3 py-2 text-left text-sm font-medium text-gray-700">{children}</th>;
}
function ThBtn({ children, onClick, ariaSort }) {
  return (
    <th className="px-3 py-2 text-left text-sm font-medium text-gray-700" aria-sort={ariaSort}>
      <button type="button" onClick={onClick} className="hover:text-blue-600 font-medium">
        {children}
      </button>
    </th>
  );
}
/**
 * @param {object} props
 * @param {import('react').ReactNode} props.children
 * @param {string} [props.className]
 * @param {number} [props.colSpan]
 */
function Td({ children, className = '', colSpan }) {
  return <td colSpan={colSpan} className={`px-3 py-2 text-sm text-gray-900 ${className}`}>{children}</td>;
}
function ScoreBadge({ percentage }) {
  const color = percentage >= 80 ? 'bg-green-100 text-green-800' :
    percentage >= 50 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800';
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>{percentage}%</span>;
}
