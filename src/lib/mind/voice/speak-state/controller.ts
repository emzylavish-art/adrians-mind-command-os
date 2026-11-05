import {
  decideSpeakBargeIn,
  TTS_VAD_BARGE_PROB,
  TTS_VAD_SUSTAIN_MS,
} from "../../voice-live/barge-in.ts";
import { SpeakEventBus } from "./bus.ts";
import {
  CURRENT_PIPELINE_MODE,
  type BargeInSource,
  type MicPermissionState,
  type PipelineInbound,
  type PipelineMode,
  type SessionReason,
  type SpeakEvent,
  type SpeakEventBody,
} from "./events.ts";
import {
  createMemoryStorage,
  readSpeakSession,
  resumeEligibleFor,
  writeSpeakSession,
  type SpeakSessionSnapshot,
  type SpeakSessionStorage,
} from "./persistence.ts";
import {
  LEVEL_INTERVAL_MS,
  TTS_VAD_END_PROB,
  VAD_END_HOLD_MS,
  VAD_END_PROB,
  VAD_START_HOLD_MS,
  VAD_START_PROB,
  clamp01,
  linearRmsToDb,
  vadProbFromLinearRms,
} from "./signal.ts";
import type { SpeakMicSink } from "./sink.ts";

export type SpeakStateOptions = {
  storage?: SpeakSessionStorage | null;
  now?: () => number;
  createId?: () => string;
  bus?: SpeakEventBus;
  mode?: PipelineMode;
};

const VAD_BARGE_COALESCE_MS = 300;

let idSeq = 0;

function defaultSpeakId(nowMs: number): string {
  idSeq += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `spk_${nowMs.toString(36)}_${idSeq.toString(36)}_${rand}`;
}

/**
 * Tracks mic permission, levels, local VAD, barge-in, and session continuity.
 * The pipeline subscribes to `bus` and feeds TTS/STT back through `ingest`.
 */
export class SpeakState implements SpeakMicSink {
  readonly bus: SpeakEventBus;
  private readonly storage: SpeakSessionStorage | null;
  private readonly now: () => number;
  private readonly createId: () => string;
  private lastTs = 0;
  private sessionId: string | null = null;
  private draftId: string | null = null;
  private prevSessionId: string | undefined;
  private active = false;
  private resumeArmed = false;
  private permissionState: MicPermissionState | null = null;
  private deviceState: string | null = null;
  private permissionReady = false;
  private micOpen = false;
  private mode: PipelineMode;
  private ttsPlaying = false;
  private utteranceId: string | null = null;
  private ttsStartedAt: number | null = null;
  private lastLevelEmit = -1;
  private lastRmsDb = -100;
  private lastVad = 0;
  private hasLevel = false;
  private vadPhase: "silence" | "speech" = "silence";
  private aboveSince: number | null = null;
  private belowSince: number | null = null;
  private loudSince: number | null = null;
  private speechStartedAt: number | null = null;
  private bargedThisUtterance = false;
  private lastVadBargeAt = -1;
  private lastPartial = "";
  private lastFinal = "";

  constructor(options: SpeakStateOptions = {}) {
    this.bus = options.bus ?? new SpeakEventBus();
    this.storage = options.storage === undefined ? createMemoryStorage() : options.storage;
    this.now = options.now ?? (() => Date.now());
    this.createId = options.createId ?? (() => defaultSpeakId(this.clock()));
    this.mode = options.mode ?? CURRENT_PIPELINE_MODE;
  }

  get session_id(): string | null {
    return this.sessionId;
  }

  get permission(): MicPermissionState | null {
    return this.permissionState;
  }

  get deviceId(): string | null {
    return this.deviceState;
  }

  get isActive(): boolean {
    return this.active;
  }

  get isMicOpen(): boolean {
    return this.micOpen;
  }

  get pipelineMode(): PipelineMode {
    return this.mode;
  }

  get ttsUtteranceId(): string | null {
    return this.utteranceId;
  }

  get partialTranscript(): string {
    return this.lastPartial;
  }

  get finalTranscript(): string {
    return this.lastFinal;
  }

  /** Open a session, or resume when storage / armResume says the last one was interrupted. */
  begin(reason: SessionReason = "speak_button"): void {
    const stored = readSpeakSession(this.storage);
    const prevId = this.sessionId ?? stored?.session_id ?? null;
    const resumable = Boolean((this.resumeArmed || stored?.resume_eligible) && prevId);
    if (this.active && !this.resumeArmed) return;

    let nextId = resumable ? this.createId() : (this.draftId ?? this.createId());
    if (resumable && prevId && nextId === prevId) nextId = this.createId();
    const prev = resumable && prevId ? prevId : undefined;
    this.sessionId = nextId;
    this.draftId = null;
    this.prevSessionId = prev;
    this.active = true;
    this.resumeArmed = false;
    this.publish({
      type: prev ? "session.resume" : "session.start",
      reason,
      ...(prev ? { prev_session_id: prev } : {}),
    });
    this.publish({ type: "pipeline.mode", mode: this.mode });
    this.persist(true, true, reason);
  }

  /**
   * Keep the logical session across a socket reconnect or reload.
   * The next `begin` emits session.resume with prev_session_id.
   */
  armResume(reason: "reconnect" | "reload" = "reconnect"): void {
    if (!this.sessionId && !this.active) return;
    this.resumeArmed = true;
    this.persist(true, true, reason);
  }

  end(reason: SessionReason = "user", opts?: { resumeEligible?: boolean }): void {
    if (!this.active) return;
    const resumeEligible = opts?.resumeEligible ?? resumeEligibleFor(reason);
    this.active = false;
    this.resumeArmed = false;
    if (this.micOpen) this.setMicOpen(false);
    this.ttsPlaying = false;
    this.loudSince = null;
    this.publish({
      type: "session.end",
      reason,
      ...(this.prevSessionId ? { prev_session_id: this.prevSessionId } : {}),
    });
    this.persist(false, resumeEligible, reason);
  }

  setPermission(state: MicPermissionState, deviceId: string | null): void {
    const same =
      this.permissionReady && this.permissionState === state && this.deviceState === deviceId;
    if (same) return;
    const prev = this.permissionState;
    const prevDevice = this.deviceState;
    this.permissionState = state;
    this.deviceState = deviceId;
    this.permissionReady = true;
    this.publish({ type: "mic.permission", state, device_id: deviceId });
    if (!this.active) return;
    if (prev === "granted" && state !== "granted") {
      this.setMicOpen(false);
      this.end("permission_revoked", { resumeEligible: true });
      return;
    }
    if (prev === "granted" && state === "granted" && prevDevice && !deviceId) {
      this.setMicOpen(false);
      this.end("device_change", { resumeEligible: true });
      return;
    }
    if (state === "granted" && deviceId && prevDevice && deviceId !== prevDevice) {
      this.finishSpeech(this.clock());
      this.aboveSince = null;
      this.loudSince = null;
    }
  }

  setMicOpen(open: boolean): void {
    if (this.micOpen === open) return;
    this.micOpen = open;
    if (!open) {
      this.finishSpeech(this.clock());
      this.lastLevelEmit = -1;
      this.aboveSince = null;
      this.loudSince = null;
    }
  }

  /** New mic frame. Ignored unless the mic is open and permission is granted. */
  pushLevel(linearRms: number): void {
    if (!this.micOpen || this.permissionState !== "granted") return;
    const rms = clamp01(linearRms);
    const vad = vadProbFromLinearRms(rms);
    this.lastRmsDb = linearRmsToDb(rms);
    this.lastVad = vad;
    this.hasLevel = true;
    const now = this.clock();
    if (this.lastLevelEmit < 0 || now - this.lastLevelEmit >= LEVEL_INTERVAL_MS) {
      this.lastLevelEmit = now;
      this.publishAt(now, { type: "mic.level", rms_db: this.lastRmsDb, vad_prob: vad });
    }
    this.stepVad(vad, now);
  }

  /** Repeat the latest sample so a slow audio callback still approaches 50 Hz. */
  pumpLevel(): void {
    if (!this.micOpen || this.permissionState !== "granted" || !this.hasLevel) return;
    const now = this.clock();
    if (this.lastLevelEmit >= 0 && now - this.lastLevelEmit < LEVEL_INTERVAL_MS) return;
    this.lastLevelEmit = now;
    this.publishAt(now, { type: "mic.level", rms_db: this.lastRmsDb, vad_prob: this.lastVad });
  }

  /** Manual and Esc always emit, including during the echo guard and when no TTS is playing. */
  bargeIn(source: "manual" | "esc"): void {
    const decision = decideSpeakBargeIn({
      source,
      assistantPlaying: this.ttsPlaying,
      speakingStartedAtMs: this.ttsStartedAt,
      nowMs: this.peek(),
      cancelAllowed: true,
    });
    if (!decision.fire) return;
    this.emitBarge(source);
  }

  /**
   * Server `speech_started` already passed decideBargeInCutoff (400 ms echo guard,
   * no local probability). Publish the contract event without applying the extra
   * sustain gate a second time.
   */
  noteServerBargeIn(): void {
    this.bargedThisUtterance = true;
    this.emitBarge("vad");
  }

  /** Pipeline → speak state. Fills session_id and ts_ms when the caller omits them. */
  ingest(input: PipelineInbound): void {
    const event = this.stamp(input);
    this.applyInbound(event);
    this.bus.publish(event);
  }

  private applyInbound(event: SpeakEvent): void {
    if (event.type === "tts.start") {
      this.ttsPlaying = true;
      this.utteranceId = event.utterance_id;
      this.ttsStartedAt = event.ts_ms;
      this.bargedThisUtterance = false;
      this.loudSince = null;
      if (this.vadPhase !== "speech") this.aboveSince = null;
      return;
    }
    if (event.type === "tts.end") {
      if (!this.utteranceId || this.utteranceId === event.utterance_id) {
        this.ttsPlaying = false;
        this.utteranceId = null;
        this.ttsStartedAt = null;
        this.loudSince = null;
        this.bargedThisUtterance = false;
      }
      return;
    }
    if (event.type === "stt.partial") {
      this.lastPartial = event.text;
      return;
    }
    if (event.type === "stt.final") {
      this.lastFinal = event.text;
      return;
    }
    if (event.type === "pipeline.mode") {
      this.mode = event.mode;
    }
  }

  private stepVad(vad: number, now: number): void {
    const tts = this.ttsPlaying;
    const startT = tts ? TTS_VAD_BARGE_PROB : VAD_START_PROB;
    const startHold = tts ? TTS_VAD_SUSTAIN_MS : VAD_START_HOLD_MS;
    const endT = tts ? TTS_VAD_END_PROB : VAD_END_PROB;

    if (tts && vad >= TTS_VAD_BARGE_PROB) {
      if (this.loudSince == null) this.loudSince = now;
    } else if (tts) {
      this.loudSince = null;
    }

    if (this.vadPhase === "silence") {
      if (vad >= startT) {
        if (this.aboveSince == null) this.aboveSince = now;
        const held = now - this.aboveSince;
        if (held >= startHold) {
          this.vadPhase = "speech";
          this.speechStartedAt = now;
          this.belowSince = null;
          this.publishAt(now, { type: "vad.speech_start", vad_prob: vad, duration_ms: held });
        }
      } else {
        this.aboveSince = null;
      }
    } else if (vad < endT) {
      if (this.belowSince == null) this.belowSince = now;
      const held = now - this.belowSince;
      if (held >= VAD_END_HOLD_MS) this.finishSpeech(now, vad);
    } else {
      this.belowSince = null;
    }

    if (this.vadPhase === "speech" && tts && !this.bargedThisUtterance) {
      const decision = decideSpeakBargeIn({
        source: "vad",
        assistantPlaying: true,
        speakingStartedAtMs: this.ttsStartedAt,
        nowMs: now,
        cancelAllowed: true,
        vadProb: vad,
        sustainedMs: this.loudSince == null ? 0 : now - this.loudSince,
      });
      if (decision.fire) {
        this.bargedThisUtterance = true;
        this.emitBarge("vad", now);
      }
    }
  }

  private finishSpeech(now: number, vad = this.lastVad): void {
    if (this.vadPhase !== "speech") return;
    const duration = Math.max(0, now - (this.speechStartedAt ?? now));
    this.vadPhase = "silence";
    this.aboveSince = null;
    this.belowSince = null;
    this.speechStartedAt = null;
    this.publishAt(now, { type: "vad.speech_end", vad_prob: vad, duration_ms: duration });
  }

  private emitBarge(source: BargeInSource, at?: number): void {
    const now = at ?? this.clock();
    if (
      source === "vad" &&
      this.lastVadBargeAt >= 0 &&
      now - this.lastVadBargeAt < VAD_BARGE_COALESCE_MS &&
      this.utteranceId
    ) {
      return;
    }
    if (source === "vad") this.lastVadBargeAt = now;
    this.publishAt(now, {
      type: "bargein",
      source,
      tts_utterance_id: this.utteranceId,
    });
  }

  private persist(open: boolean, resumeEligible: boolean, reason: SessionReason): void {
    if (!this.sessionId || !this.storage) return;
    const snapshot: SpeakSessionSnapshot = {
      version: 1,
      session_id: this.sessionId,
      ...(this.prevSessionId ? { prev_session_id: this.prevSessionId } : {}),
      permission: this.permissionState,
      device_id: this.deviceState,
      open,
      resume_eligible: resumeEligible,
      reason,
      updated_at_ms: this.peek(),
    };
    writeSpeakSession(this.storage, snapshot);
  }

  private ensureId(): string {
    if (this.sessionId) return this.sessionId;
    if (!this.draftId) this.draftId = this.createId();
    return this.draftId;
  }

  private peek(): number {
    const raw = this.now();
    return Number.isFinite(raw) ? Math.round(raw) : this.lastTs;
  }

  private clock(): number {
    const raw = this.peek();
    const next = raw > this.lastTs ? raw : this.lastTs + 1;
    this.lastTs = next;
    return next;
  }

  private publish(body: SpeakEventBody): void {
    const ts = this.clock();
    this.publishAt(ts, body);
  }

  private publishAt(ts: number, body: SpeakEventBody): void {
    const stamped = ts > this.lastTs ? ts : ts === this.lastTs ? ts : this.lastTs + 1;
    this.lastTs = Math.max(this.lastTs, stamped);
    this.bus.publish({ ...body, session_id: this.ensureId(), ts_ms: stamped } as SpeakEvent);
  }

  private stamp(input: PipelineInbound): SpeakEvent {
    const ts = this.clock();
    return { ...input, session_id: this.ensureId(), ts_ms: ts } as SpeakEvent;
  }
}
