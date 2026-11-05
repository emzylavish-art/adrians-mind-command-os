import { test } from "node:test";
import { deepStrictEqual as eq } from "node:assert/strict";
import { decide, type Skill } from "./decision-router.ts";

const skill = (id: string, name = id, kind = "built-in",
  description = ""): Skill => ({ id, name, kind, description });
const skills = ["projects", "chats", "notes"].map(id => skill(id));
const abstain = (reason: string) => ({ type: "abstain", reason });
const suggestion = (skillId: string) => ({ type: "suggestion", skillId });

test("single suggestions for all three routes", () => {
  for (const [text, id] of [
    ["PROJECT", "projects"], ["conversation", "chats"], ["note", "notes"],
  ]) eq(decide(text!, skills, {}), suggestion(id!));
});

test("missing enabled entries mean enabled", () => {
  eq(decide("projects", skills, { notes: false }), suggestion("projects"));
});

test("explicit false disables", () => {
  eq(decide("projects", skills, { projects: false }), abstain("no_match"));
});

test("external skills are excluded", () => {
  eq(decide("projects", [skill("projects", "projects", "external")], {}),
    abstain("no_match"));
});

test("unknown identities are excluded", () => {
  eq(decide("projects", [skill("unknown")], {}), abstain("no_match"));
});

test("two project identities are ambiguous", () => {
  eq(decide("projects", [skill("projects"), skill("other", "Projects")], {}),
    abstain("ambiguous"));
});

test("multiple topics are ambiguous", () => {
  eq(decide("projects, notes and chats", skills, {}), abstain("ambiguous"));
});

test("substrings do not satisfy word boundaries", () => {
  eq(decide("microprojects chatspace noteworthy", skills, {}),
    abstain("no_match"));
});

test("empty, oversized and exact size boundary", () => {
  for (const text of ["", " \n\t"]) {
    eq(decide(text, skills, {}), abstain("empty"));
  }
  eq(decide(" ".repeat(2001), skills, {}), abstain("oversized"));
  eq(decide("projects" + " ".repeat(1992), skills, {}),
    suggestion("projects"));
});

test("identity metadata only, normalized names, deterministic output", () => {
  const metadata = [
    skill("custom", " Notes ", "built-in", "projects chats"),
    skill("unknown", "unknown", "built-in", "projects"),
  ];
  eq(decide("projects", metadata, {}), abstain("no_match"));
  const text = "private text: note";
  for (let i = 0; i < 5; i++) {
    eq(decide(text, metadata, {}), suggestion("custom"));
  }
});
