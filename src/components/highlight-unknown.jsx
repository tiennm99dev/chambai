'use client';

import { UNKNOWN_DIGIT } from '@/lib/types';

/**
 * Renders a detected string (SBD, mã đề, or Phần III answer), highlighting any
 * UNKNOWN_DIGIT position the detector could not read so it is never mistaken
 * for a confidently-read value.
 */
export default function HighlightUnknown({ value, className = '' }) {
  if (!value) return null;
  return (
    <span className={className}>
      {[...value].map((ch, i) => (
        ch === UNKNOWN_DIGIT ? (
          <span
            key={i}
            className="inline-block px-0.5 bg-amber-200 text-amber-900 rounded font-bold"
            title="Không đọc được — cần kiểm tra thủ công"
          >
            ?
          </span>
        ) : (
          <span key={i}>{ch}</span>
        )
      ))}
    </span>
  );
}
