export const menuOpenMs = 180;
export const menuCloseMs = 150;

export function followBottom(distanceFromBottom: number): boolean {
  return distanceFromBottom <= 96;
}

export function layoutShift(entries: { value: number; hadRecentInput?: boolean }[]): number {
  return entries.reduce((sum, entry) => sum + (entry.hadRecentInput ? 0 : entry.value), 0);
}

export const iphoneStillRequired = [
  "Record Send on iPhone Safari at 60fps and confirm the header does not move.",
  "Confirm the new content does not pass under the composer.",
  "Confirm there is no second movement after the answer is shown.",
  "Confirm the More panel opens over 180ms and closes over 150ms, not in one frame.",
  "Read the layout-shift score from the performance observer. Target 0. This check has not been run on the phone.",
] as const;
