import { useEffect, useRef, useState } from "react";
import { dataUrlToDownscaled } from "./downscale";
import type { DownscaleQuality } from "./downscale-quality";
import {
  applyCameraMirrorTransform,
  BURST_CANDIDATE_CAP,
  BURST_MAX,
  BURST_MIN,
  clampBurstCount,
  selectBurstAttachments,
  type BurstCandidate,
} from "./media-ui-helpers";

export { applyCameraMirrorTransform } from "./media-ui-helpers";

type Facing = "user" | "environment";

function newCandidateId(): string {
  return `burst-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function CameraCapture({
  open,
  onClose,
  onCapture,
  onCaptureMany,
  downscaleQuality = "balanced",
  remainingSlots = 4,
}: {
  open: boolean;
  onClose: () => void;
  /** Single capture still supported (Capture button). */
  onCapture: (dataUrl: string, name: string) => void;
  /** Preferred for burst attach-selected. */
  onCaptureMany?: (items: { dataUrl: string; name: string }[]) => void;
  downscaleQuality?: DownscaleQuality;
  /** How many composer chip slots remain (caps Attach selected). */
  remainingSlots?: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const burstAbortRef = useRef<{ cancelled: boolean }>({ cancelled: false });
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [facing, setFacing] = useState<Facing>("environment");
  const [mirror, setMirror] = useState(false);
  const [busySnap, setBusySnap] = useState(false);
  const [burstBusy, setBurstBusy] = useState(false);
  const [candidates, setCandidates] = useState<BurstCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [burstSize, setBurstSize] = useState(BURST_MIN);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    burstAbortRef.current = { cancelled: false };
    setError(null);
    setReady(false);
    setCandidates([]);
    setSelected(new Set());

    function stopTracks(stream: MediaStream | null) {
      if (!stream) return;
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch {
          /* ignore */
        }
      }
    }

    function onVisibility() {
      if (document.hidden) {
        videoRef.current?.pause();
      } else {
        void videoRef.current?.play().catch(() => undefined);
      }
    }

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("This browser cannot open the camera.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing } },
          audio: false,
        });
        if (cancelled) {
          stopTracks(stream);
          return;
        }
        stopTracks(streamRef.current);
        streamRef.current = stream;
        for (const track of stream.getVideoTracks()) {
          track.addEventListener("ended", () => {
            if (!cancelled) setError("The camera was disconnected. Close and try again.");
            setReady(false);
          });
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setReady(true);
      } catch (caught) {
        const name = caught instanceof DOMException ? caught.name : "";
        if (name === "NotAllowedError" || name === "PermissionDeniedError") {
          setError("Camera permission was denied. You can still attach an image file.");
        } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
          setError("No camera was found on this device.");
        } else if (name === "NotReadableError" || name === "TrackStartError") {
          setError("The camera is in use by another app or was unplugged.");
        } else if (name === "OverconstrainedError") {
          setError("That camera facing mode is not available on this device.");
        } else {
          setError("The camera could not be opened.");
        }
      }
    })();

    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      burstAbortRef.current.cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      const stream = streamRef.current;
      streamRef.current = null;
      stopTracks(stream);
      if (videoRef.current) videoRef.current.srcObject = null;
      // Drop data-URL candidates so large payloads can GC (no object URLs to revoke).
      setCandidates([]);
      setSelected(new Set());
    };
  }, [open, facing]);

  if (!open) return null;

  async function captureFrame(): Promise<BurstCandidate | null> {
    const video = videoRef.current;
    if (!video) return null;
    const canvas = document.createElement("canvas");
    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    applyCameraMirrorTransform(ctx, width, mirror);
    ctx.drawImage(video, 0, 0, width, height);
    const raw = canvas.toDataURL("image/jpeg", 0.92);
    const scaled = await dataUrlToDownscaled(raw, `camera-${Date.now()}.jpg`, { quality: downscaleQuality });
    return { id: newCandidateId(), dataUrl: scaled.dataUrl, name: scaled.name };
  }

  async function snapSingle(closeAfter: boolean) {
    if (!ready || busySnap || burstBusy) return;
    setBusySnap(true);
    try {
      const frame = await captureFrame();
      if (!frame) {
        setError("Could not capture a frame.");
        return;
      }
      onCapture(frame.dataUrl, frame.name);
      if (closeAfter) onClose();
    } catch {
      setError("Could not process the camera snapshot.");
    } finally {
      setBusySnap(false);
    }
  }

  async function runBurst(countRaw: number) {
    if (!ready || busySnap || burstBusy) return;
    const count = clampBurstCount(countRaw);
    const room = BURST_CANDIDATE_CAP - candidates.length;
    if (room <= 0) {
      setError(`Burst tray is full (${BURST_CANDIDATE_CAP}). Attach or discard some frames first.`);
      return;
    }
    const toTake = Math.min(count, room);
    setBurstBusy(true);
    setError(null);
    burstAbortRef.current = { cancelled: false };
    const taken: BurstCandidate[] = [];
    try {
      for (let i = 0; i < toTake; i++) {
        if (burstAbortRef.current.cancelled) break;
        const frame = await captureFrame();
        if (!frame) {
          setError("Burst stopped — a frame could not be captured.");
          break;
        }
        taken.push(frame);
        // Brief gap so frames differ; abort-friendly.
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      if (taken.length) {
        setCandidates((prev) => {
          const next = [...prev, ...taken].slice(0, BURST_CANDIDATE_CAP);
          return next;
        });
        // Default-select only the first two new frames (V4 INFO: easier pick-2 UX).
        setSelected((prev) => {
          const next = new Set(prev);
          for (const frame of taken.slice(0, 2)) next.add(frame.id);
          return next;
        });
      }
    } catch {
      setError("Burst failed while compressing frames.");
    } finally {
      setBurstBusy(false);
    }
  }

  function attachSelected() {
    const result = selectBurstAttachments(candidates, selected, { remainingSlots });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (onCaptureMany) onCaptureMany(result.items.map((item) => ({ dataUrl: item.dataUrl, name: item.name })));
    else {
      for (const item of result.items) onCapture(item.dataUrl, item.name);
    }
    const attached = new Set(result.items.map((item) => item.id));
    setCandidates((prev) => prev.filter((item) => !attached.has(item.id)));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of attached) next.delete(id);
      return next;
    });
  }

  function discardCandidates() {
    setCandidates([]);
    setSelected(new Set());
  }

  function closeDialog() {
    burstAbortRef.current.cancelled = true;
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Camera capture"
      data-media="camera-capture"
    >
      <div className="w-full max-w-lg rounded-panel border border-line bg-surface p-4">
        <h3 className="font-display text-xl font-bold">Camera</h3>
        <p className="mt-1 text-sm text-muted">
          Burst takes {BURST_MIN}–{BURST_MAX} EXIF-stripped frames into a tray — pick which to attach (composer max 4).
          Tracks stop when you close.
        </p>
        {error ? (
          <p className="mt-3 text-sm text-danger">{error}</p>
        ) : (
          <video
            ref={videoRef}
            className="mt-3 aspect-video w-full rounded-panel bg-bg object-cover"
            style={mirror ? { transform: "scaleX(-1)" } : undefined}
            playsInline
            muted
          />
        )}

        {candidates.length > 0 && (
          <div className="mt-3 space-y-2" data-media="camera-burst-tray">
            <p className="text-xs text-muted">
              Burst tray {candidates.length}/{BURST_CANDIDATE_CAP}. Selected {selected.size}. Slots left {Math.max(0, remainingSlots)}.
            </p>
            <ul className="flex flex-wrap gap-2">
              {candidates.map((candidate) => {
                const isOn = selected.has(candidate.id);
                return (
                  <li key={candidate.id} className="inline-flex flex-col items-center gap-1">
                    <button
                      type="button"
                      data-media="camera-burst-candidate"
                      data-selected={isOn ? "true" : "false"}
                      className={`overflow-hidden rounded-panel border border-line ${isOn ? "ring-2 ring-accent" : ""}`}
                      aria-pressed={isOn}
                      aria-label={`${isOn ? "Deselect" : "Select"} ${candidate.name}`}
                      onClick={() =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(candidate.id)) next.delete(candidate.id);
                          else next.add(candidate.id);
                          return next;
                        })
                      }
                    >
                      <img src={candidate.dataUrl} alt={candidate.name} className="size-16 object-cover" draggable={false} />
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="min-h-11 rounded-panel border border-line px-3 text-sm"
                data-media="camera-burst-attach"
                disabled={selected.size === 0 || remainingSlots <= 0}
                onClick={attachSelected}
              >
                Attach selected
              </button>
              <button
                type="button"
                className="min-h-11 rounded-panel border border-line px-3 text-sm"
                data-media="camera-burst-discard"
                onClick={discardCandidates}
              >
                Discard tray
              </button>
              {burstBusy && (
                <button
                  type="button"
                  className="min-h-11 rounded-panel border border-line px-3 text-sm"
                  data-media="camera-burst-cancel"
                  onClick={() => {
                    burstAbortRef.current.cancelled = true;
                  }}
                >
                  Stop burst
                </button>
              )}
            </div>
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="min-h-11 flex-1 rounded-panel border border-line" onClick={closeDialog}>
            Close
          </button>
          <button
            type="button"
            className="min-h-11 flex-1 rounded-panel border border-line"
            onClick={() => setFacing((current) => (current === "user" ? "environment" : "user"))}
          >
            {facing === "user" ? "Switch to back" : "Switch to front"}
          </button>
          <button
            type="button"
            className="min-h-11 flex-1 rounded-panel border border-line"
            data-testid="camera-mirror-toggle"
            data-media="camera-mirror"
            aria-pressed={mirror}
            title={mirror ? "Mirror preview and capture on" : "Mirror preview and capture off"}
            onClick={() => setMirror((current) => !current)}
          >
            {mirror ? "Mirror on" : "Mirror off"}
          </button>
          <button
            type="button"
            className="min-h-11 flex-1 rounded-panel border border-line"
            data-media="camera-burst-size"
            aria-label={`Burst size ${burstSize}`}
            disabled={burstBusy}
            onClick={() => setBurstSize((current) => (current >= BURST_MAX ? BURST_MIN : current + 1))}
          >
            Burst ×{burstSize}
          </button>
          <button
            type="button"
            className="min-h-11 flex-1 rounded-panel border border-line disabled:opacity-50"
            data-media="camera-burst-run"
            disabled={!ready || Boolean(error) || busySnap || burstBusy || candidates.length >= BURST_CANDIDATE_CAP}
            onClick={() => void runBurst(burstSize)}
          >
            {burstBusy ? "Bursting…" : "Run burst"}
          </button>
          <button
            type="button"
            className="min-h-11 flex-1 rounded-panel bg-accent font-semibold text-accent-ink disabled:opacity-50"
            disabled={!ready || Boolean(error) || busySnap || burstBusy}
            onClick={() => void snapSingle(true)}
          >
            Capture
          </button>
        </div>
      </div>
    </div>
  );
}
