import { createHash } from "node:crypto";
import { ADRIAN_OS_BUILDER_OUTPUT, ADRIAN_OS_BUILDER_VERSION } from "../../adrian-os-skill.ts";
export type BuilderInstructionReceipt = {
  id: "adrian-os-builder";
  version: string;
  sha256: string;
  characters: number;
  delivery: "attached_to_acp_prompt";
};
export function builderInstructions(prompt: string): { text: string; receipt: BuilderInstructionReceipt } {
  return {
    text: `${ADRIAN_OS_BUILDER_OUTPUT}\n\nCurrent task:\n${prompt}`,
    receipt: { id: "adrian-os-builder", version: ADRIAN_OS_BUILDER_VERSION,
      sha256: createHash("sha256").update(ADRIAN_OS_BUILDER_OUTPUT).digest("hex"),
      characters: ADRIAN_OS_BUILDER_OUTPUT.length, delivery: "attached_to_acp_prompt" },
  };
}
