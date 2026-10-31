let halted = false;

export function serverHalted(): boolean {
  return halted;
}

export function setServerHalt(on: boolean): boolean {
  halted = on;
  return halted;
}
