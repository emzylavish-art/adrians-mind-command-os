/** A result belongs to the buffer revision that requested it, not the current tab. */
export function editorRequestKey(id: string, text: string): string {
  return JSON.stringify([id, text]);
}

export function canApplyEditorResult(request: { key: string; generation: number }, current: { key: string; generation: number }): boolean {
  return request.key === current.key && request.generation === current.generation;
}
