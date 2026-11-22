export type DictationFinish = {
  inserted: boolean;
  transcript: string;
  note: string;
};

export function finishDictation(input: {
  transcript: string;
  hasFocusedField: boolean;
  systemTyped?: boolean;
}): DictationFinish {
  const transcript = input.transcript.replace(/\s+/g, " ").trim();
  if (!transcript) {
    return { inserted: false, transcript: "", note: "No words were captured. Nothing was inserted." };
  }
  if (input.hasFocusedField) {
    return {
      inserted: true,
      transcript,
      note: "Inserted at the cursor. Nothing was sent.",
    };
  }
  if (input.systemTyped) {
    return {
      inserted: true,
      transcript,
      note: "Typed into the focused Windows field. Nothing was sent.",
    };
  }
  return {
    inserted: false,
    transcript,
    note: `No focused text field accepted the words. They were kept and nothing was sent: ${transcript}`,
  };
}
