/** In-thread chip when a turn result reports memorySaved. Mount pending in command-app if claimed. */
export function MemorySavedIndicator({
  memorySaved,
  savedMemoryId,
}: {
  memorySaved: boolean;
  savedMemoryId?: string | null;
}) {
  if (!memorySaved) return null;
  return (
    <div
      className="inline-flex items-center gap-2 rounded-panel border border-line bg-surface px-3 py-1.5 text-xs text-muted"
      data-testid="memory-saved-indicator"
      role="status"
      aria-live="polite"
    >
      <span className="font-semibold text-fg">Memory updated</span>
      {savedMemoryId ? <span className="text-muted">· note saved</span> : null}
    </div>
  );
}
