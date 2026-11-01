import { useEffect, useRef, useState } from "react";
import { dataUrlToDownscaled } from "./downscale";

type Facing = "user" | "environment";

export function CameraCapture({
  open,
  onClose,
  onCapture,
}: {
  open: boolean;
  onClose: () => void;
  /** Each successful snapshot invokes this (burst keeps the dialog open). */
  onCapture: (dataUrl: string, name: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [facing, setFacing] = useState<Facing>("environment");
  const [burstCount, setBurstCount] = useState(0);
  const [busySnap, setBusySnap] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    setReady(false);
    setBurstCount(0);
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
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        const previous = streamRef.current;
        if (previous) for (const track of previous.getTracks()) track.stop();
        streamRef.current = stream;
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
        } else if (name === "OverconstrainedError") {
          setError("That camera facing mode is not available on this device.");
        } else {
          setError("The camera could not be opened.");
        }
      }
    })();
    return () => {
      cancelled = true;
      const stream = streamRef.current;
      streamRef.current = null;
      if (stream) for (const track of stream.getTracks()) track.stop();
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [open, facing]);

  if (!open) return null;

  async function snap(closeAfter: boolean) {
    const video = videoRef.current;
    if (!video || busySnap) return;
    setBusySnap(true);
    const canvas = document.createElement("canvas");
    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setError("Could not capture a frame.");
      setBusySnap(false);
      return;
    }
    ctx.drawImage(video, 0, 0, width, height);
    const raw = canvas.toDataURL("image/jpeg", 0.92);
    try {
      const scaled = await dataUrlToDownscaled(raw, `camera-${Date.now()}.jpg`);
      onCapture(scaled.dataUrl, scaled.name);
      setBurstCount((count) => count + 1);
      if (closeAfter) onClose();
    } catch {
      setError("Could not process the camera snapshot.");
    } finally {
      setBusySnap(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Camera capture">
      <div className="w-full max-w-lg rounded-panel border border-line bg-surface p-4">
        <h3 className="font-display text-xl font-bold">Camera</h3>
        <p className="mt-1 text-sm text-muted">
          Capture adds a chip. Use Burst to take several without closing. Tracks stop when you close.
          {burstCount > 0 ? ` Taken: ${burstCount}.` : ""}
        </p>
        {error ? (
          <p className="mt-3 text-sm text-danger">{error}</p>
        ) : (
          <video ref={videoRef} className="mt-3 aspect-video w-full rounded-panel bg-bg object-cover" playsInline muted />
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="min-h-11 flex-1 rounded-panel border border-line" onClick={onClose}>
            {burstCount > 0 ? "Done" : "Close"}
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
            className="min-h-11 flex-1 rounded-panel border border-line disabled:opacity-50"
            disabled={!ready || Boolean(error) || busySnap}
            onClick={() => void snap(false)}
          >
            Burst
          </button>
          <button
            type="button"
            className="min-h-11 flex-1 rounded-panel bg-accent font-semibold text-accent-ink disabled:opacity-50"
            disabled={!ready || Boolean(error) || busySnap}
            onClick={() => void snap(true)}
          >
            Capture
          </button>
        </div>
      </div>
    </div>
  );
}
