/**
 * Server-side store for Voice Cloning Studio profiles + consent.
 * File-backed JSON under .data/voice-cloning (no secrets, no raw API keys).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ConsentChallenge, ConsentRecord, VoiceProfile } from "./types.ts";
import { localDataPath } from "../../local-data.ts";

export type VoiceCloningStoreData = {
  profiles: VoiceProfile[];
  consents: ConsentRecord[];
  challenges: Array<ConsentChallenge & { userId: string; consumedAt: string | null }>;
};

const DEFAULT_DIR = localDataPath("voice-cloning");

function emptyData(): VoiceCloningStoreData {
  return { profiles: [], consents: [], challenges: [] };
}

export class VoiceCloningStore {
  readonly dir: string;
  private readonly dbPath: string;
  private data: VoiceCloningStoreData;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(dir: string = process.env.VCS_DATA_DIR?.trim() || DEFAULT_DIR) {
    this.dir = dir;
    this.dbPath = join(dir, "store.json");
    mkdirSync(join(dir, "samples"), { recursive: true });
    this.data = this.readDisk();
  }

  private readDisk(): VoiceCloningStoreData {
    if (!existsSync(this.dbPath)) return emptyData();
    try {
      const raw = JSON.parse(readFileSync(this.dbPath, "utf8")) as VoiceCloningStoreData;
      return {
        profiles: Array.isArray(raw.profiles) ? raw.profiles : [],
        consents: Array.isArray(raw.consents) ? raw.consents : [],
        challenges: Array.isArray(raw.challenges) ? raw.challenges : [],
      };
    } catch {
      return emptyData();
    }
  }

  private persistSync(): void {
    mkdirSync(dirname(this.dbPath), { recursive: true });
    const tmp = `${this.dbPath}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), "utf8");
    renameSync(tmp, this.dbPath);
  }

  private async withLock<T>(fn: () => T | Promise<T>): Promise<T> {
    const run = this.writeChain.then(fn, fn);
    this.writeChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  snapshot(): VoiceCloningStoreData {
    return {
      profiles: this.data.profiles.map((p) => ({ ...p })),
      consents: this.data.consents.map((c) => ({ ...c })),
      challenges: this.data.challenges.map((c) => ({ ...c })),
    };
  }

  async putChallenge(userId: string, challenge: ConsentChallenge): Promise<void> {
    await this.withLock(() => {
      this.data.challenges.push({ ...challenge, userId, consumedAt: null });
      this.persistSync();
    });
  }

  async takeChallenge(
    userId: string,
    challengeId: string,
    now = Date.now(),
  ): Promise<ConsentChallenge | null> {
    return this.withLock(() => {
      const row = this.data.challenges.find((c) => c.challengeId === challengeId && c.userId === userId);
      if (!row) return null;
      if (row.consumedAt) return null;
      if (Date.parse(row.expiresAt) < now) return null;
      row.consumedAt = new Date(now).toISOString();
      this.persistSync();
      return {
        challengeId: row.challengeId,
        code: row.code,
        phrase: row.phrase,
        expiresAt: row.expiresAt,
      };
    });
  }

  getChallenge(userId: string, challengeId: string): (ConsentChallenge & { consumedAt: string | null }) | null {
    const row = this.data.challenges.find((c) => c.challengeId === challengeId && c.userId === userId);
    return row ? { ...row } : null;
  }

  listProfiles(userId: string): VoiceProfile[] {
    return this.data.profiles.filter((p) => p.userId === userId && p.status !== "deleted");
  }

  getProfile(userId: string, profileId: string, includeDeleted = false): VoiceProfile | null {
    const p = this.data.profiles.find((x) => x.id === profileId && x.userId === userId);
    if (!p) return null;
    if (!includeDeleted && p.status === "deleted") return null;
    return { ...p };
  }

  pendingProviderDeletes(userId: string): VoiceProfile[] {
    return this.data.profiles.filter((p) => p.userId === userId && p.status === "deleted" && p.providerVoiceId);
  }

  async confirmProviderDelete(userId: string, id: string): Promise<void> {
    await this.withLock(() => {
      const row = this.data.profiles.find((p) => p.userId === userId && p.id === id && p.status === "deleted");
      if (row) {
        row.providerVoiceId = null;
        this.persistSync();
      }
    });
  }

  countActiveProfiles(userId: string): number {
    return this.listProfiles(userId).length;
  }

  samplePath(profileId: string): string {
    return join(this.dir, "samples", `${profileId}.b64`);
  }

  async saveProfile(input: {
    profile: VoiceProfile;
    consent: ConsentRecord;
    sampleBase64: string;
  }): Promise<VoiceProfile> {
    return this.withLock(() => {
      this.data.profiles.push(input.profile);
      this.data.consents.push(input.consent);
      writeFileSync(this.samplePath(input.profile.id), input.sampleBase64, "utf8");
      this.persistSync();
      return { ...input.profile };
    });
  }

  readSampleBase64(profileId: string): string | null {
    const path = this.samplePath(profileId);
    if (!existsSync(path)) return null;
    return readFileSync(path, "utf8");
  }

  getConsentForProfile(profileId: string): ConsentRecord | null {
    const c = this.data.consents.find((x) => x.profileId === profileId);
    return c ? { ...c } : null;
  }

  getConsent(consentId: string): ConsentRecord | null {
    const c = this.data.consents.find((x) => x.id === consentId);
    return c ? { ...c } : null;
  }

  async markDeleted(userId: string, profileId: string, now = Date.now()): Promise<VoiceProfile | null> {
    return this.withLock(() => {
      const p = this.data.profiles.find((x) => x.id === profileId && x.userId === userId);
      if (!p) return null;
      p.status = "deleted";
      p.deletedAt ??= new Date(now).toISOString();
      p.updatedAt = p.deletedAt;
      try {
        unlinkSync(this.samplePath(profileId));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      this.data.consents = this.data.consents.filter((c) => c.profileId !== profileId);
      this.persistSync();
      return { ...p };
    });
  }

  resetForTests(): void {
    this.data = emptyData();
    this.persistSync();
  }
}

let singleton: VoiceCloningStore | null = null;

export function getVoiceCloningStore(): VoiceCloningStore {
  if (!singleton) singleton = new VoiceCloningStore();
  return singleton;
}

export function setVoiceCloningStoreForTests(store: VoiceCloningStore | null): void {
  singleton = store;
}
