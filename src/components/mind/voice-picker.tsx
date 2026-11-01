import {
  XAI_BUILTIN_VOICES,
  XAI_VOICE_DOCS_URL,
  type XaiBuiltinVoice,
  voiceDisplayName,
} from "@/lib/mind/voice/voices";

type Props = {
  value: XaiBuiltinVoice;
  onChange: (voice: XaiBuiltinVoice) => void;
  disabled?: boolean;
  className?: string;
};

/** Built-in xAI voice picker (docs: https://docs.x.ai/docs/guides/voice). */
export function VoicePicker(props: Props) {
  return (
    <label className={props.className ?? "inline-flex items-center gap-1 text-xs text-muted"} title={`Voices from ${XAI_VOICE_DOCS_URL}`}>
      <span className="sr-only">Voice</span>
      <select
        data-testid="voice-picker"
        aria-label="xAI voice"
        disabled={props.disabled}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value as XaiBuiltinVoice)}
        className="max-w-[7.5rem] rounded-panel border border-line bg-surface px-1.5 py-1 text-xs text-fg"
      >
        {XAI_BUILTIN_VOICES.map((id) => (
          <option key={id} value={id}>
            {voiceDisplayName(id)}
          </option>
        ))}
      </select>
    </label>
  );
}
