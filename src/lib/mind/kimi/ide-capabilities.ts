export function ideExecutionCapability(ownerId: string) {
  return ownerId === "dev-user"
    ? { debug: true, reason: "Debug runs the saved file in this local workstation runtime." }
    : { debug: false, reason: "Debug is unavailable for website account files and paired-PC files. Use the debugger on the computer that owns the file; pairing a PC does not enable this button." };
}

export function canDebugFile(input: { capability: boolean; selected: boolean; hosted: boolean; dirty: boolean; busy: boolean }): boolean {
  return input.capability && input.selected && input.hosted && !input.dirty && !input.busy;
}
