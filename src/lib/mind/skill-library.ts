/** Inert authoring data only; this module never executes or activates skills. */
export const STORAGE_KEY = "amcos.skill-drafts.v1";

export type DraftContent = Readonly<{
  title: string;
  summary: string;
  body: string;
}>;
export type DraftVersion = Readonly<{
  version: number;
  status: "draft" | "reviewed-inactive";
  content: DraftContent;
}>;
export type SkillDraft = Readonly<{
  id: string;
  versions: readonly DraftVersion[];
}>;
export type SkillLibrary = Readonly<{
  schemaVersion: 1;
  drafts: readonly SkillDraft[];
}>;
export type LoadResult =
  | { ok: true; library: SkillLibrary }
  | { ok: false; error: string };

export const LIMITS = Object.freeze({
  serializedLength: 1_000_000, // UTF-16 code units
  drafts: 256,
  versions: 128,
  title: 160,
  summary: 2_000,
  body: 20_000,
  idIndex: 1_000_000_000,
});

function fail(message: string): never {
  throw new Error(message);
}
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail("Expected an object");
  const object = value as Record<string, unknown>;
  const actual = Reflect.ownKeys(object);
  if (actual.length !== keys.length ||
      actual.some(key => typeof key !== "string" || !keys.includes(key)))
    return fail("Unexpected or missing fields");
  return object;
}
function text(value: unknown, max: number, required = false): void {
  if (typeof value !== "string" || value.length > max ||
      (required && !value.trim()))
    fail("Invalid text length or type");
}
function checkContent(value: unknown): void {
  const c = record(value, ["title", "summary", "body"]);
  text(c.title, LIMITS.title, true);
  text(c.summary, LIMITS.summary);
  text(c.body, LIMITS.body);
}
function sameContent(a: DraftContent, b: DraftContent): boolean {
  return a.title === b.title && a.summary === b.summary && a.body === b.body;
}
function checkLibrary(value: unknown): asserts value is SkillLibrary {
  const l = record(value, ["schemaVersion", "drafts"]);
  if (l.schemaVersion !== 1 || !Array.isArray(l.drafts) ||
      l.drafts.length > LIMITS.drafts)
    fail("Invalid library schema or draft count");
  const ids = new Set<string>();
  for (const item of l.drafts) {
    const d = record(item, ["id", "versions"]);
    if (typeof d.id !== "string" || !/^draft-[1-9]\d{0,9}$/.test(d.id) ||
        Number(d.id.slice(6)) > LIMITS.idIndex || ids.has(d.id))
      fail("Invalid or duplicate draft id");
    ids.add(d.id);
    if (!Array.isArray(d.versions) || !d.versions.length ||
        d.versions.length > LIMITS.versions)
      fail("Invalid version count");
    let previous: DraftContent | undefined;
    for (let i = 0; i < d.versions.length; i++) {
      const v = record(d.versions[i], ["version", "status", "content"]);
      if (v.version !== i + 1 ||
          (v.status !== "draft" && v.status !== "reviewed-inactive"))
        fail("Invalid version or status");
      checkContent(v.content);
      const content = v.content as DraftContent;
      if (v.status === "reviewed-inactive" &&
          (!previous || !sameContent(previous, content)))
        fail("A review must preserve the preceding content");
      previous = content;
    }
  }
}
function freeze(library: SkillLibrary): SkillLibrary {
  for (const draft of library.drafts) {
    for (const version of draft.versions) {
      Object.freeze(version.content);
      Object.freeze(version);
    }
    Object.freeze(draft.versions);
    Object.freeze(draft);
  }
  Object.freeze(library.drafts);
  return Object.freeze(library);
}
export function emptyLibrary(): SkillLibrary {
  return freeze({ schemaVersion: 1, drafts: [] });
}
export function loadLibrary(serialized: string | null): LoadResult {
  if (serialized === null) return { ok: true, library: emptyLibrary() };
  if (typeof serialized !== "string" ||
      serialized.length > LIMITS.serializedLength)
    return { ok: false, error: "Serialized library exceeds the size limit" };
  try {
    const parsed: unknown = JSON.parse(serialized);
    checkLibrary(parsed);
    return { ok: true, library: freeze(parsed) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid library",
    };
  }
}
export function serializeLibrary(library: SkillLibrary): string {
  checkLibrary(library);
  const serialized = JSON.stringify(library);
  if (serialized.length > LIMITS.serializedLength)
    fail("Serialized library exceeds the size limit");
  return serialized;
}
/** Copies inputs so returned state never aliases mutable caller content. */
function snapshot(library: SkillLibrary): SkillLibrary {
  const result = loadLibrary(serializeLibrary(library));
  if (!result.ok) return fail(result.error);
  return result.library;
}
export function latestVersion(draft: SkillDraft): DraftVersion {
  const library = snapshot({ schemaVersion: 1, drafts: [draft] });
  const versions = library.drafts[0].versions;
  return versions[versions.length - 1];
}
export function createDraft(
  library: SkillLibrary,
  content: DraftContent,
): SkillLibrary {
  checkLibrary(library);
  checkContent(content);
  const index = library.drafts.reduce(
    (max, draft) => Math.max(max, Number(draft.id.slice(6))), 0,
  ) + 1;
  if (index > LIMITS.idIndex) fail("Draft ids exhausted");
  return snapshot({
    schemaVersion: 1,
    drafts: [...library.drafts, {
      id: `draft-${index}`,
      versions: [{ version: 1, status: "draft", content }],
    }],
  });
}
function append(
  library: SkillLibrary,
  id: string,
  status: DraftVersion["status"],
  content?: DraftContent,
): SkillLibrary {
  checkLibrary(library);
  const target = library.drafts.find(draft => draft.id === id);
  if (!target) return fail("Unknown draft id");
  const previous = target.versions[target.versions.length - 1];
  const next = content === undefined ? previous.content : content;
  checkContent(next);
  return snapshot({
    schemaVersion: 1,
    drafts: library.drafts.map(draft => draft.id !== id ? draft : {
      id,
      versions: [...draft.versions, {
        version: draft.versions.length + 1,
        status,
        content: next,
      }],
    }),
  });
}
export function reviseDraft(
  library: SkillLibrary,
  id: string,
  content: DraftContent,
): SkillLibrary {
  checkContent(content);
  return append(library, id, "draft", content);
}
export function reviewDraft(library: SkillLibrary, id: string): SkillLibrary {
  return append(library, id, "reviewed-inactive");
}
export type CurationSuggestion = Readonly<{
  draftId: string;
  version: number;
  action: "review";
}>;
/** Pure, deterministic, on-demand suggestions; does not change any status. */
export function suggestCuration(
  library: SkillLibrary,
): readonly CurationSuggestion[] {
  checkLibrary(library);
  const suggestions: CurationSuggestion[] = [];
  for (const draft of library.drafts) {
    const latest = draft.versions[draft.versions.length - 1];
    if (latest.status === "draft") {
      suggestions.push(Object.freeze({
        draftId: draft.id,
        version: latest.version,
        action: "review" as const,
      }));
    }
  }
  return Object.freeze(suggestions);
}
