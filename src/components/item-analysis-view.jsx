'use client';

import { useMemo, useState } from 'react';
import { analyzeItems } from '@/lib/item-analysis';

/** @typedef {'question'|'correctPct'|'wrongPct'|'difficulty'} SortKey */
/** @typedef {import('react').AriaAttributes['aria-sort']} AriaSort */

/**
 * Per-question analysis table with difficulty color coding and sortable columns.
 * @param {object} props
 * @param {import('@/lib/types').StudentResult[]} props.results - scored results only
 * @param {import('@/lib/types').TestConfig} props.config
 */
export default function ItemAnalysisView({ results, config }) {
  const [sortKey, setSortKey] = useState(/** @type {SortKey} */ ('question'));
  const [sortDir, setSortDir] = useState(/** @type {'asc'|'desc'} */ ('asc'));
  const [filterSection, setFilterSection] = useState('all');

  const items = useMemo(() => analyzeItems(results, config), [results, config]);

  const sorted = useMemo(() => {
    const filtered = filterSection === 'all'
      ? items
      : items.filter((i) => i.section === filterSection);
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'question') cmp = a.question - b.question;
      else if (sortKey === 'correctPct') cmp = a.correctPct - b.correctPct;
      else if (sortKey === 'wrongPct') cmp = a.wrongPct - b.wrongPct;
      else if (sortKey === 'difficulty') cmp = a.correctPct - b.correctPct;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [items, filterSection, sortKey, sortDir]);

  /** @param {SortKey} key */
  const handleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  /** @param {SortKey} key */
  const arrow = (key) => (sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '');
  /** @param {SortKey} key @returns {AriaSort} */
  const ariaSort = (key) => (sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none');

  if (items.length === 0) {
    return <p className="text-gray-500 text-center py-4">Không có dữ liệu phân tích.</p>;
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <h3 className="text-lg font-semibold text-gray-900">Phân tích theo câu hỏi</h3>
        <select
          value={filterSection}
          onChange={(e) => setFilterSection(e.target.value)}
          className="text-sm border border-gray-300 rounded px-2 py-1"
        >
          <option value="all">Tất cả</option>
          <option value="I">Phần I</option>
          <option value="II">Phần II</option>
          <option value="III">Phần III</option>
        </select>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full border border-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <Th onClick={() => handleSort('question')} ariaSort={ariaSort('question')}>Câu{arrow('question')}</Th>
              <Th>Phần</Th>
              <Th onClick={() => handleSort('correctPct')} ariaSort={ariaSort('correctPct')}>Đúng%{arrow('correctPct')}</Th>
              <Th onClick={() => handleSort('wrongPct')} ariaSort={ariaSort('wrongPct')}>Sai%{arrow('wrongPct')}</Th>
              <Th>Trống%</Th>
              <Th>Sai phổ biến</Th>
              <Th onClick={() => handleSort('difficulty')} ariaSort={ariaSort('difficulty')}>Độ khó{arrow('difficulty')}</Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((item, i) => (
              <tr key={`${item.section}-${item.question}`} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                <td className="px-3 py-1.5 font-medium">{item.question}</td>
                <td className="px-3 py-1.5">{item.section}</td>
                <td className="px-3 py-1.5">
                  <div className="flex items-center gap-2">
                    <div className="w-16 bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-green-500 h-2 rounded-full"
                        style={{ width: `${item.correctPct}%` }}
                      />
                    </div>
                    <span>{item.correctPct}%</span>
                  </div>
                </td>
                <td className="px-3 py-1.5 text-red-600">{item.wrongPct}%</td>
                <td className="px-3 py-1.5 text-gray-400">{item.blankPct}%</td>
                <td className="px-3 py-1.5">{item.commonWrong}</td>
                <td className="px-3 py-1.5">
                  <DifficultyBadge difficulty={item.difficulty} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * @param {object} props
 * @param {import('react').ReactNode} props.children
 * @param {() => void} [props.onClick] - omitted for non-sortable columns
 * @param {AriaSort} [props.ariaSort]
 */
function Th({ children, onClick, ariaSort }) {
  if (!onClick) {
    return <th className="px-3 py-2 text-left font-medium text-gray-700">{children}</th>;
  }
  return (
    <th className="px-3 py-2 text-left font-medium text-gray-700" aria-sort={ariaSort}>
      <button type="button" onClick={onClick} className="hover:text-blue-600 font-medium">
        {children}
      </button>
    </th>
  );
}

/** @param {{ difficulty: string }} props */
function DifficultyBadge({ difficulty }) {
  /** @type {Record<string, string>} */
  const colors = {
    'Dễ': 'bg-green-100 text-green-800',
    'TB': 'bg-yellow-100 text-yellow-800',
    'Khó': 'bg-red-100 text-red-800',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${colors[difficulty] || ''}`}>
      {difficulty}
    </span>
  );
}
