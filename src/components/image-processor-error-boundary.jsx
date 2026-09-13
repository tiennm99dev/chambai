'use client';

import { Component } from 'react';

/**
 * Error boundary for ImageProcessor — catches render/pipeline crashes
 * and shows a recoverable error UI instead of crashing the whole page.
 */
export default class ImageProcessorErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error: error.message || 'Lỗi không xác định' };
  }

  componentDidCatch(error, info) {
    console.error('ImageProcessor error:', error, info);
    // A render crash here would otherwise leave the batch-processing promise
    // pending forever (nothing left to call onProcessingComplete) — let the
    // caller settle it with an error marker.
    this.props.onError?.(error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-800 font-medium">Lỗi xử lý ảnh</p>
          <p className="text-red-600 text-sm mt-1">{this.state.error}</p>
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-2 text-sm text-blue-600 hover:underline"
          >
            Thử lại
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
