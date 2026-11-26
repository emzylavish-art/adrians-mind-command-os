import { useState } from "react";

export function RetainedVideo({ url }: { url: string }) {
  const [unavailable, setUnavailable] = useState(false);
  return <figure className="mt-2 space-y-2">
    {unavailable ? <p role="status" className="rounded-panel border border-line p-3 text-sm">This provider video is unavailable. Its temporary link may have expired. The conversation retains its receipt, not the video bytes.</p>
      : <video className="owner-video" src={url} controls playsInline preload="metadata" onError={() => setUnavailable(true)} />}
    <figcaption className="text-xs text-muted">Temporary provider asset · expiry was not supplied. Download while available to keep your own copy.</figcaption>
    <a href={url} download target="_blank" rel="noopener noreferrer" className="text-sm text-accent underline">Open video to download</a>
    {unavailable && <button type="button" className="ml-3 text-sm text-accent underline" onClick={() => setUnavailable(false)}>Retry playback</button>}
  </figure>;
}
