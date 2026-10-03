'use client';

import { useMemo, useState } from 'react';

/**
 * Score distribution histogram with configurable bucket count.
 * Shows mean/median lines and percentile ranks on hover.
 * @param {object} props
 * @param {import('@/lib/types').StudentResult[]} props.results
 */
export default function ScoreDistributionChart({ results }) {
  const [bucketCount, setBucketCount] = useState(10);

  const { buckets, labels, maxCount, mean, median } = useMemo(() => {
    const scores = results.map((r) => r.score?.total ?? 0);
    if (scores.length === 0) return { buckets: [], labels: [], maxCount: 0, mean: 0, median: 0 };

    const max = Math.max(...scores);
    const bucketSize = max > 0 ? max / bucketCount : 1;
    const b = Array(bucketCount).fill(0);
    /** @type {string[]} */
    const l = [];

    for (const s of scores) {
      const idx = Math.min(Math.floor(s / bucketSize), bucketCount - 1);
      b[idx]++;
    }

    for (let i = 0; i < bucketCount; i++) {
      const lo = (i * bucketSize).toFixed(1);
      const hi = ((i + 1) * bucketSize).toFixed(1);
      l.push(`${lo}-${hi}`);
    }

    const sorted = [...scores].sort((a, b2) => a - b2);
    const sum = scores.reduce((a, v) => a + v, 0);
    const m = sum / scores.length;
    const med = sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];

    return { buckets: b, labels: l, maxCount: Math.max(...b, 1), mean: m, median: med };
  }, [results, bucketCount]);

  if (results.length === 0) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold text-gray-900">Phân phối điểm</h3>
        <div className="flex items-center gap-2 text-sm">
          <label className="text-gray-600">Số khoảng:</label>
          <select
            value={bucketCount}
            onChange={(e) => setBucketCount(Number(e.target.value))}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value={5}>5</option>
            <option value={10}>10</option>
            <option value={20}>20</option>
          </select>
        </div>
      </div>

      {/* Mean/Median indicators */}
      <div className="flex gap-4 text-sm mb-3">
        <span className="flex items-center gap-1">
          <span className="w-3 h-0.5 bg-blue-500 inline-block" /> TB: {mean.toFixed(2)}
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-0.5 bg-orange-500 inline-block" /> Trung vị: {median.toFixed(2)}
        </span>
      </div>

      {/* Histogram bars */}
      <div className="flex items-end gap-1 h-32">
        {buckets.map((count, i) => (
          <div key={i} className="flex-1 flex flex-col items-center" title={`${labels[i]}: ${count} HS`}>
            <span className="text-xs font-medium text-gray-700 mb-0.5">{count || ''}</span>
            <div
              className="w-full bg-blue-500 rounded-t transition-all"
              style={{ height: `${maxCount > 0 ? (count / maxCount) * 100 : 0}px`, minHeight: count > 0 ? '4px' : '0' }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-1 mt-1">
        {labels.map((label, i) => (
          <div key={i} className="flex-1 text-center">
            <span className="text-xs text-gray-500 leading-tight block" style={{ fontSize: '9px' }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
