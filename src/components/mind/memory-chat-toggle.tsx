/** Per-chat "don't use memory" control. Mount pending in command-app if claimed. */
export function MemoryChatToggle({
  memory,
  onChange,
  disabled,
}: {
  memory: "off" | "on";
  onChange: (next: "off" | "on") => void;
  disabled?: boolean;
}) {
  const on = memory === "on";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={on ? "Memory on for this chat" : "Don't use memory for this chat"}
      disabled={disabled}
      data-testid="memory-chat-toggle"
      className={`inline-flex min-h-11 items-center gap-3 rounded-panel border px-3 text-sm ${
        on ? "border-line bg-surface" : "border-line bg-bg"
      }`}
      onClick={() => onChange(on ? "off" : "on")}
    >
      <span className="text-left">
        <span className="block font-semibold text-fg">{on ? "Use memory" : "Don't use memory"}</span>
        <span className="block text-xs text-muted">
          {on ? "Saved notes can be injected into this chat." : "This chat skips memory for the prompt."}
        </span>
      </span>
      <span className={`relative h-6 w-11 shrink-0 rounded-full ${on ? "bg-fg" : "bg-line"}`}>
        <span className={`absolute top-0.5 size-5 rounded-full bg-bg ${on ? "right-0.5" : "left-0.5"}`} />
      </span>
    </button>
  );
}
