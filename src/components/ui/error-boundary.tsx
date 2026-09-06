"use client";

import React from "react";

type ErrorBoundaryProps = {
  children: React.ReactNode;
  /** Optional label shown in the error UI to identify which section failed */
  section?: string;
};

type ErrorBoundaryState = {
  hasError: boolean;
  error: Error | null;
};

/**
 * React Error Boundary — wraps a section so a crash in one part
 * doesn't take down the whole page. Shows a friendly fallback UI
 * with a retry button.
 */
export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Log to console for debugging (could be replaced with a logging service)
    console.error(
      `[ErrorBoundary${this.props.section ? `: ${this.props.section}` : ""}]`,
      error,
      info.componentStack,
    );
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-6 py-8 text-center"
        >
          <span className="text-3xl mb-2">⚠️</span>
          <p className="text-sm font-medium text-red-800 dark:text-red-300">
            {this.props.section
              ? `Something went wrong in "${this.props.section}"`
              : "Something went wrong"}
          </p>
          <p className="mt-1 text-xs text-red-600 dark:text-red-400 max-w-sm">
            {this.state.error?.message || "An unexpected error occurred."}
          </p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, error: null })}
            className="mt-4 rounded-md bg-red-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-red-700 transition-colors"
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
