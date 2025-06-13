export function measure<T>(label: string, fn: () => T): T {
  const start = performance.now();
  try {
    return fn();
  } finally {
    const duration = performance.now() - start;
    console.log(`[perf] ${label}: ${duration.toFixed(2)} ms`);
  }
}

export function markStart(label: string): void {
  if (performance?.mark) {
    performance.mark(label);
  }
}

export function markEnd(label: string): void {
  if (!performance?.mark || !performance?.measure) return;
  const endLabel = `${label}-end`;

  // If the start mark is missing (e.g., because React.StrictMode caused a second invocation), bail out silently.
  if (performance.getEntriesByName(label).length === 0) return;

  performance.mark(endLabel);
  try {
    performance.measure(label, label, endLabel);
    const entries = performance.getEntriesByName(label);
    const last = entries[entries.length - 1];
    if (last) {
      console.log(`[perf] ${label}: ${last.duration.toFixed(2)} ms`);
    }
  } catch (e) {
    // Ignore measurement errors (shouldn't happen with the guard above)
  }

  // Clean up end label to avoid clutter; keep start mark so repeated measurements work.
  performance.clearMarks(endLabel);
} 