export type ReadingPosition = { top: number; following: boolean };
export function nextReadingPosition(previous: ReadingPosition, input: { top: number; height: number; viewport: number; userReading?: boolean; userInitiated?: boolean }): ReadingPosition {
  const end = Math.max(0, input.height - input.viewport);
  if (input.userReading) return { top: input.top, following: false };
  // Layout clamping/scroll anchoring can move scrollTop without any reader action.
  if (input.userInitiated === false) return { top: input.top, following: previous.following };
  return { top: input.top, following: end - input.top < 32 ? true : input.top < Math.min(previous.top, end) - 1 ? false : previous.following };
}
export function messageWindow<T>(messages: readonly T[], count = 80): readonly T[] {
  return messages.slice(-Math.max(1, count));
}
