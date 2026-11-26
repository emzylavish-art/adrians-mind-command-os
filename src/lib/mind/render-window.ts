export const INITIAL_MESSAGE_WINDOW = 100;

/** Keep the tail cheap, while ensuring an explicit search destination is mounted. */
export function messageWindow<T extends { id: string }>(messages: readonly T[], count = INITIAL_MESSAGE_WINDOW, revealId?: string) {
  const target = revealId ? messages.findIndex((message) => message.id === revealId) : -1;
  const start = Math.max(0, Math.min(messages.length - Math.max(1, count), target >= 0 ? target : messages.length));
  return { hiddenCount: start, messages: messages.slice(start) };
}
