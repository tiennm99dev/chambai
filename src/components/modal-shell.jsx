'use client';

import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Shared dialog shell for overlay modals: role="dialog" + aria-modal, a focus
 * trap, Escape-to-close, background scroll lock, and focus restore on close.
 * Wrap modal content with this instead of a bare fixed-overlay div.
 */
export default function ModalShell({ labelledBy, onClose, children, className = '' }) {
  const containerRef = useRef(null);
  const previouslyFocusedRef = useRef(null);

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const getFocusable = () => {
      const node = containerRef.current;
      if (!node) return [];
      return Array.from(node.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
        (el) => !el.disabled && el.tabIndex !== -1
      );
    };

    const first = getFocusable()[0];
    (first || containerRef.current)?.focus();

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        const items = getFocusable();
        if (items.length === 0) return;
        const firstEl = items[0];
        const lastEl = items[items.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocusedRef.current instanceof HTMLElement) {
        previouslyFocusedRef.current.focus();
      }
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={className || 'bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto m-4 focus:outline-none'}
      >
        {children}
      </div>
    </div>
  );
}
