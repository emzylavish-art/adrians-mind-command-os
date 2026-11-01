import { MAX_LIVE_TRANSCRIPT_CHARS, clampLiveTranscript } from "@/lib/mind/voice/live-transcript";

type Props = {
  text: string;
  className?: string;
};

/** Plain-text live transcript chip with aria-live; never renders HTML. */
export function VoiceLiveTranscript(props: Props) {
  const text = clampLiveTranscript(props.text, MAX_LIVE_TRANSCRIPT_CHARS);
  if (!text) return null;
  return (
    <p
      className={props.className ?? "max-w-[14rem] truncate text-xs text-muted"}
      data-testid="voice-live-transcript"
      title={text}
      aria-live="polite"
      aria-atomic="true"
      role="status"
    >
      Heard: {text}
    </p>
  );
}
