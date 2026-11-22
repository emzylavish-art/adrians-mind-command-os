export const WEBSITE_ACTIONS = [
  "Type a coding prompt in Build and run it in the hosted workspace",
  "Read and write files in that hosted workspace",
  "Use the editor, file tree, and tabs",
  "Request a terminal command in the hosted workspace and approve that exact command",
  "Read git status and diff without committing, pushing, or deploying",
] as const;

export const APPROVABLE_TODAY = ["file_read", "file_write", "file_delete", "terminal"] as const;

export const BLOCKED_CONTROL = ["mouse", "keyboard", "browser pointer", "microphone after the browser is closed"] as const;

const PC_INTENT = /\b(mouse|cursor|keyboard|click my|type on my pc|type on my computer|control my (pc|computer|browser|windows)|move the mouse|press (the |my )?keys)\b/i;

export function spokenPcCommand(text: string): boolean {
  return /\b(my files|my desktop|read file|write file|make folder|run command|click\s+\d+|right-click\s+\d+|double-click\s+\d+|scroll\s+(?:up|down)|drag\s+\d+|type\s+"|move the mouse|control my (pc|computer)|look at my screen|drive the screen|open my browser|launch app|list windows|minimize window|maximize window|close window|list monitors|read accessibility|find button|understand (?:the )?screenshot|keep working after close)\b/i.test(text);
}

export type ComputerDecision = {
  kind: "none" | "refused" | "proposal";
  message: string;
};

export function decideComputerAction(input: {
  text: string;
  halted: boolean;
  paired: boolean;
  actor: "owner" | "eve";
}): ComputerDecision {
  const text = input.text.trim();
  if (!PC_INTENT.test(text)) return { kind: "none", message: "" };
  if (/\b(approve|clear (the )?stop|press the stop|emergency stop)\b/i.test(text) && input.actor === "eve") {
    return { kind: "refused", message: "EVE cannot approve a computer action or press the emergency stop." };
  }
  if (input.halted) {
    return { kind: "refused", message: "Emergency stop is on. Nothing moved. EVE cannot clear it." };
  }
  if (!input.paired) {
    return {
      kind: "refused",
      message: "No computer is paired. The mouse, keyboard, and browser were not touched. Build on this site still runs in the hosted workspace.",
    };
  }
  return {
    kind: "proposal",
    message: "This stays a proposal. A paired computer can only be asked for file read, file write, file delete, or a terminal command, and only after you approve that exact action. Mouse and keyboard control are not available. Nothing moved.",
  };
}
