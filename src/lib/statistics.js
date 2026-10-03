// Calculate class-level summary statistics from scored student results

/**
 * @param {Array<{ score?: { total: number, percentage: number } }>} results - an unscored entry counts as 0
 * @returns {{ mean: number, median: number, min: number, max: number, count: number, distribution: Record<string, number> } | null}
 */
export function calculateClassStatistics(results) {
  const scores = results
    .map((r) => r.score?.total ?? 0)
    .sort((a, b) => a - b);

  if (scores.length === 0) return null;

  const percentages = results.map((r) => r.score?.percentage ?? 0);
  const sum = scores.reduce((a, b) => a + b, 0);
  const mean = sum / scores.length;
  const median = scores.length % 2 === 0
    ? (scores[scores.length / 2 - 1] + scores[scores.length / 2]) / 2
    : scores[Math.floor(scores.length / 2)];

  // Distribution buckets by percentage
  const distribution = { '0-20': 0, '20-40': 0, '40-60': 0, '60-80': 0, '80-100': 0 };
  for (const pct of percentages) {
    if (pct < 20) distribution['0-20']++;
    else if (pct < 40) distribution['20-40']++;
    else if (pct < 60) distribution['40-60']++;
    else if (pct < 80) distribution['60-80']++;
    else distribution['80-100']++;
  }

  return {
    mean: Math.round(mean * 100) / 100,
    median: Math.round(median * 100) / 100,
    // Rounded like mean/median: the 0,10-điểm CV1239 Phần II tier introduces
    // binary floating-point noise (e.g. 7 × 0.1 !== 0.7 exactly).
    min: Math.round(scores[0] * 100) / 100,
    max: Math.round(scores[scores.length - 1] * 100) / 100,
    count: scores.length,
    distribution,
  };
}
