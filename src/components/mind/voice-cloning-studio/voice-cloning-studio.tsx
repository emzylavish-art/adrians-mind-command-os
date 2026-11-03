/**
 * Voice Cloning Studio — separate from Whisper Flow / dictation.
 * Playback reuses SharedAudioOutput (existing speaker path).
 * Scoped utility classes only — does not edit src/styles.css.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { sharedAudioOutput } from "@/lib/mind/voice/audio-output";
import {
  vcsCreateChallenge,
  vcsCreateProfile,
  vcsDeleteProfile,
  vcsExportAudio,
  vcsExportConsent,
  vcsGenerate,
  vcsListProfiles,
  vcsProviderStatus,
} from "@/lib/mind/voice-cloning/server";
import type {
  ConsentAttestation,
  ConsentChallenge,
  ProviderStatusReport,
  VoiceProfile,
} from "@/lib/mind/voice-cloning/types";

type LastAudio = { profileId: string; audioBase64: string; mime: string };

function downloadBlob(filename: string, mime: string, base64OrText: string, asText = false) {
  const blob = asText
    ? new Blob([base64OrText], { type: mime })
    : (() => {
        const bin = atob(base64OrText);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new Blob([bytes], { type: mime });
      })();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

export function VoiceCloningStudioPage() {
  const [status, setStatus] = useState<ProviderStatusReport | null>(null);
  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);

  const [name, setName] = useState("");
  const [attestation, setAttestation] = useState<ConsentAttestation | "">("");
  const [challenge, setChallenge] = useState<ConsentChallenge | null>(null);
  const [consentBlob, setConsentBlob] = useState<Blob | null>(null);
  const [sampleBlob, setSampleBlob] = useState<Blob | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [generateText, setGenerateText] = useState("Hello from Voice Cloning Studio.");
  const [lastAudio, setLastAudio] = useState<LastAudio | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [recordingTarget, setRecordingTarget] = useState<"consent" | "sample" | null>(null);

  const selected = useMemo(
    () => profiles.find((p) => p.id === selectedId) || null,
    [profiles, selectedId],
  );

  const refresh = useCallback(async () => {
    try {
      const [st, list] = await Promise.all([
        vcsProviderStatus(),
        vcsListProfiles().catch(() => ({ ok: false as const, profiles: [] as VoiceProfile[] })),
      ]);
      setStatus(st);
      if (list && "profiles" in list) setProfiles(list.profiles);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load Voice Cloning Studio.");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const stopPlayback = useCallback(() => {
    sharedAudioOutput.interrupt();
    setPlaying(false);
  }, []);

  const playAudio = useCallback(
    async (audioBase64: string) => {
      stopPlayback();
      setPlaying(true);
      try {
        await sharedAudioOutput.playMpegBase64(audioBase64);
      } finally {
        setPlaying(false);
      }
    },
    [stopPlayback],
  );

  async function startChallenge() {
    setError("");
    setBusy(true);
    try {
      const res = await vcsCreateChallenge();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setChallenge(res.challenge);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start consent challenge.");
    } finally {
      setBusy(false);
    }
  }

  async function startRecording(target: "consent" | "sample") {
    setError("");
    stopPlayback();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size) chunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mime });
        if (target === "consent") setConsentBlob(blob);
        else setSampleBlob(blob);
        setRecordingTarget(null);
        mediaRef.current = null;
      };
      mediaRef.current = recorder;
      setRecordingTarget(target);
      recorder.start();
    } catch {
      setError("Microphone permission was denied or unavailable.");
    }
  }

  function stopRecording() {
    mediaRef.current?.stop();
  }

  async function onUpload(target: "consent" | "sample", file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("audio/")) {
      setError("Upload an audio file (wav, webm, ogg, mp3, m4a).");
      return;
    }
    if (file.size > 4_000_000) {
      setError("Audio file is too large (max ~4 MB).");
      return;
    }
    if (target === "consent") setConsentBlob(file);
    else setSampleBlob(file);
  }

  async function createProfile() {
    setError("");
    if (!challenge) {
      setError("Request a consent phrase first.");
      return;
    }
    if (!attestation) {
      setError("Confirm ownership or written permission before creating a profile.");
      return;
    }
    if (!consentBlob || !sampleBlob) {
      setError("Provide both a consent recording and a voice sample.");
      return;
    }
    setBusy(true);
    try {
      const consentAudioBase64 = await blobToBase64(consentBlob);
      const sampleAudioBase64 = await blobToBase64(sampleBlob);
      const res = await vcsCreateProfile({
        data: {
          name,
          attestation,
          challengeId: challenge.challengeId,
          consentAudioBase64,
          consentMime: consentBlob.type || "audio/webm",
          sampleAudioBase64,
          sampleMime: sampleBlob.type || "audio/webm",
        },
      });
      if (!res.ok) {
        setError(res.error);
        // Challenge may be consumed — clear so user must request a new one (anti-replay).
        setChallenge(null);
        return;
      }
      setProfiles((prev) => [res.profile, ...prev]);
      setSelectedId(res.profile.id);
      setChallenge(null);
      setConsentBlob(null);
      setSampleBlob(null);
      setName("");
      setAttestation("");
      if (res.profile.providerStatus !== "ready") {
        setError(res.profile.providerMessage);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed.");
      setChallenge(null);
    } finally {
      setBusy(false);
    }
  }

  async function onGenerate() {
    if (!selected) return;
    setError("");
    setBusy(true);
    stopPlayback();
    try {
      const res = await vcsGenerate({ data: { profileId: selected.id, text: generateText } });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setLastAudio({ profileId: selected.id, audioBase64: res.audioBase64, mime: res.mime });
      await playAudio(res.audioBase64);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generate failed.");
    } finally {
      setBusy(false);
    }
  }

  async function onExportAudio(format: "mp3" | "wav") {
    if (!selected || !lastAudio || lastAudio.profileId !== selected.id) {
      setError("Generate audio first, then export.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await vcsExportAudio({
        data: {
          profileId: selected.id,
          audioBase64: lastAudio.audioBase64,
          sourceMime: lastAudio.mime,
          format,
        },
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      downloadBlob(res.filename, res.mime, res.audioBase64);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  }

  async function onExportConsent() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const res = await vcsExportConsent({ data: { profileId: selected.id } });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      downloadBlob(res.filename, res.mime, res.json, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Consent export failed.");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(profileId: string) {
    setBusy(true);
    setError("");
    try {
      const res = await vcsDeleteProfile({ data: { profileId } });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setProfiles((prev) => prev.filter((p) => p.id !== profileId));
      if (selectedId === profileId) {
        setSelectedId(null);
        setLastAudio(null);
        stopPlayback();
      }
      setConfirmDeleteId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-bg text-fg" data-testid="voice-cloning-studio">
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to="/"
            className="inline-flex min-h-11 items-center justify-center rounded-panel border border-line px-4 text-sm"
          >
            Back to Chat
          </Link>
          <h1 className="text-xl font-semibold tracking-tight">Voice Cloning Studio</h1>
        </div>
        <p className="mt-2 text-sm text-muted">
          Authorized voice profiles only. Separate from Whisper Flow / dictation. No unauthorized impersonation.
        </p>

        <section
          className="mt-4 rounded-panel border border-line bg-surface-2/40 p-4"
          data-testid="vcs-provider-banner"
          data-can-clone={status?.canClone ? "true" : "false"}
        >
          <p className="text-sm font-medium">Provider: xAI Custom Voices</p>
          <p className="mt-1 text-sm text-muted" data-testid="vcs-provider-reason">
            {status?.banner || "Checking provider…"}
          </p>
          {!status?.canClone ? (
            <p className="mt-2 text-xs uppercase tracking-wide text-amber-400/90">Provider not configured</p>
          ) : (
            <p className="mt-2 text-xs uppercase tracking-wide text-emerald-400/90">Cloning available</p>
          )}
        </section>

        {error ? (
          <div
            className="mt-4 rounded-panel border border-danger/40 bg-danger/10 px-4 py-3 text-sm"
            role="alert"
            data-testid="vcs-error"
          >
            {error}
          </div>
        ) : null}

        <section className="mt-6 space-y-4 rounded-panel border border-line p-4" data-testid="vcs-create">
          <h2 className="text-base font-semibold">Create voice profile</h2>
          <label className="block text-sm">
            Profile name
            <input
              className="mt-1 w-full rounded-panel border border-line bg-bg px-3 py-2"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={64}
              data-testid="vcs-name"
              autoComplete="off"
            />
          </label>

          <fieldset className="space-y-2 text-sm">
            <legend className="font-medium">Consent attestation (required)</legend>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="attestation"
                checked={attestation === "own_voice"}
                onChange={() => setAttestation("own_voice")}
                data-testid="vcs-attest-own"
              />
              <span>This is my own voice.</span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="attestation"
                checked={attestation === "written_permission"}
                onChange={() => setAttestation("written_permission")}
                data-testid="vcs-attest-permission"
              />
              <span>I have the speaker&apos;s written permission to clone this voice.</span>
            </label>
          </fieldset>

          <div className="rounded-panel border border-line/70 bg-bg/50 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="inline-flex min-h-11 items-center rounded-panel border border-line px-3"
                onClick={() => void startChallenge()}
                disabled={busy}
                data-testid="vcs-request-consent"
              >
                Request consent phrase
              </button>
              {challenge ? (
                <span className="font-mono text-xs text-muted" data-testid="vcs-consent-code">
                  Code {challenge.code}
                </span>
              ) : null}
            </div>
            {challenge ? (
              <p className="mt-2" data-testid="vcs-consent-phrase">
                Read aloud: <strong>{challenge.phrase}</strong>
              </p>
            ) : (
              <p className="mt-2 text-muted">A random confirmation code is required before any sample is used.</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {recordingTarget === "consent" ? (
                <button type="button" className="min-h-11 rounded-panel border border-line px-3" onClick={stopRecording} data-testid="vcs-stop-consent-rec">
                  Stop consent recording
                </button>
              ) : (
                <button type="button" className="min-h-11 rounded-panel border border-line px-3" onClick={() => void startRecording("consent")} data-testid="vcs-rec-consent">
                  Record consent
                </button>
              )}
              <label className="inline-flex min-h-11 cursor-pointer items-center rounded-panel border border-line px-3">
                Upload consent
                <input type="file" accept="audio/*" className="hidden" data-testid="vcs-upload-consent" onChange={(e) => void onUpload("consent", e.target.files?.[0] || null)} />
              </label>
              <span className="self-center text-xs text-muted" data-testid="vcs-consent-ready">
                {consentBlob ? `Consent audio ready (${Math.round(consentBlob.size / 1024)} KB)` : "No consent audio"}
              </span>
            </div>
          </div>

          <div className="rounded-panel border border-line/70 bg-bg/50 p-3 text-sm">
            <p className="font-medium">Voice sample (browser record or upload)</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {recordingTarget === "sample" ? (
                <button type="button" className="min-h-11 rounded-panel border border-line px-3" onClick={stopRecording} data-testid="vcs-stop-sample-rec">
                  Stop sample recording
                </button>
              ) : (
                <button type="button" className="min-h-11 rounded-panel border border-line px-3" onClick={() => void startRecording("sample")} data-testid="vcs-rec-sample">
                  Record sample
                </button>
              )}
              <label className="inline-flex min-h-11 cursor-pointer items-center rounded-panel border border-line px-3">
                Upload sample
                <input type="file" accept="audio/*" className="hidden" data-testid="vcs-upload-sample" onChange={(e) => void onUpload("sample", e.target.files?.[0] || null)} />
              </label>
              <span className="self-center text-xs text-muted" data-testid="vcs-sample-ready">
                {sampleBlob ? `Sample ready (${Math.round(sampleBlob.size / 1024)} KB)` : "No sample"}
              </span>
            </div>
          </div>

          <button
            type="button"
            className="inline-flex min-h-11 items-center rounded-2xl bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-50"
            disabled={busy}
            onClick={() => void createProfile()}
            data-testid="vcs-create-submit"
          >
            Create profile
          </button>
        </section>

        <section className="mt-6 space-y-3 rounded-panel border border-line p-4" data-testid="vcs-profiles">
          <h2 className="text-base font-semibold">Your profiles</h2>
          {profiles.length === 0 ? (
            <p className="text-sm text-muted">No voice profiles yet.</p>
          ) : (
            <ul className="space-y-2">
              {profiles.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className={`flex w-full min-h-11 items-center justify-between rounded-panel border px-3 text-left text-sm ${
                      selectedId === p.id ? "border-accent bg-accent/10" : "border-line"
                    }`}
                    onClick={() => setSelectedId(p.id)}
                    data-testid={`vcs-profile-${p.id}`}
                  >
                    <span>
                      <span className="font-medium">{p.name}</span>
                      <span className="ml-2 text-xs text-muted">{p.providerStatus}</span>
                    </span>
                    <span className="text-xs text-muted">{p.status}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {selected ? (
          <section className="mt-6 space-y-3 rounded-panel border border-line p-4" data-testid="vcs-generate">
            <h2 className="text-base font-semibold">Generate / preview / export</h2>
            <p className="text-xs text-muted">
              Uses the existing xAI TTS endpoint and SharedAudioOutput speaker path. Generate requires a provider-side cloned voice.
            </p>
            <textarea
              className="min-h-24 w-full rounded-panel border border-line bg-bg px-3 py-2 text-sm"
              value={generateText}
              maxLength={500}
              onChange={(e) => setGenerateText(e.target.value)}
              data-testid="vcs-generate-text"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="min-h-11 rounded-2xl bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-50"
                disabled={busy}
                onClick={() => void onGenerate()}
                data-testid="vcs-generate-submit"
              >
                Generate
              </button>
              <button
                type="button"
                className="min-h-11 rounded-panel border border-line px-3 text-sm"
                onClick={stopPlayback}
                data-testid="vcs-stop"
              >
                Stop
              </button>
              <button
                type="button"
                className="min-h-11 rounded-panel border border-line px-3 text-sm disabled:opacity-50"
                disabled={busy || !lastAudio || lastAudio.profileId !== selected.id}
                onClick={() => lastAudio && void playAudio(lastAudio.audioBase64)}
                data-testid="vcs-replay"
              >
                {playing ? "Playing…" : "Replay"}
              </button>
              <button
                type="button"
                className="min-h-11 rounded-panel border border-line px-3 text-sm disabled:opacity-50"
                disabled={busy || !lastAudio || lastAudio.profileId !== selected.id}
                onClick={() => void onExportAudio("mp3")}
                data-testid="vcs-export-mp3"
              >
                Export MP3
              </button>
              <button
                type="button"
                className="min-h-11 rounded-panel border border-line px-3 text-sm disabled:opacity-50"
                disabled={busy || !lastAudio || lastAudio.profileId !== selected.id}
                onClick={() => void onExportAudio("wav")}
                data-testid="vcs-export-wav"
              >
                Export WAV
              </button>
              <button
                type="button"
                className="min-h-11 rounded-panel border border-line px-3 text-sm disabled:opacity-50"
                disabled={busy}
                onClick={() => void onExportConsent()}
                data-testid="vcs-export-consent"
              >
                Export consent JSON
              </button>
            </div>

            <div className="border-t border-line/60 pt-3">
              {confirmDeleteId === selected.id ? (
                <div className="flex flex-wrap gap-2" data-testid="vcs-delete-confirm">
                  <button
                    type="button"
                    className="min-h-11 rounded-panel border border-danger/50 bg-danger/10 px-3 text-sm"
                    disabled={busy}
                    onClick={() => void onDelete(selected.id)}
                    data-testid="vcs-delete-yes"
                  >
                    Confirm delete profile
                  </button>
                  <button
                    type="button"
                    className="min-h-11 rounded-panel border border-line px-3 text-sm"
                    onClick={() => setConfirmDeleteId(null)}
                    data-testid="vcs-delete-no"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="min-h-11 rounded-panel border border-danger/40 px-3 text-sm text-danger"
                  onClick={() => setConfirmDeleteId(selected.id)}
                  data-testid="vcs-delete"
                >
                  Delete profile…
                </button>
              )}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
