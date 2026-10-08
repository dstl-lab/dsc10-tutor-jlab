// Keep this registry independent of the logger to avoid an import cycle.
const flushers = new Set<() => void>();
let flushing = false;

export function registerNotebookEditFlusher(flush: () => void): () => void {
  flushers.add(flush);
  return () => flushers.delete(flush);
}

/** Split edit bursts before another observation, without blocking student work. */
export function flushPendingNotebookEdits(): void {
  if (flushing) {
    return;
  }
  flushing = true;
  try {
    for (const flush of flushers) {
      try {
        flush();
      } catch (error) {
        console.error('Failed to flush notebook edits:', error);
      }
    }
  } finally {
    flushing = false;
  }
}
