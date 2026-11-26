export type PopupMessage = {
  source: "grok-auth-popup";
  transactionId: string;
  token: string | null;
  error?: string;
};

export function popupMessageToken(
  event: Pick<MessageEvent, "origin" | "source" | "data">,
  expected: { origin: string; popup: Window; transactionId: string },
): { accepted: false } | { accepted: true; token: string | null } {
  if (event.origin !== expected.origin || event.source !== expected.popup) return { accepted: false };
  const data = event.data as Partial<PopupMessage> | undefined;
  if (!data || data.source !== "grok-auth-popup" || data.transactionId !== expected.transactionId) return { accepted: false };
  if (data.token !== null && typeof data.token !== "string") return { accepted: false };
  return { accepted: true, token: data.token || null };
}

/** One window and one transaction per attempt; settled/canceled listeners are removed. */
export function waitForPopupToken(popup: Window, transactionId: string, host: Window = window): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    let closeTimer: number | undefined;
    const settle = (token: string | null) => {
      if (settled) return;
      settled = true;
      host.clearInterval(pollTimer);
      host.clearTimeout(timeout);
      if (closeTimer !== undefined) host.clearTimeout(closeTimer);
      host.removeEventListener("message", onMessage);
      resolve(token);
    };
    const onMessage = (event: MessageEvent) => {
      const message = popupMessageToken(event, { origin: host.location.origin, popup, transactionId });
      if (message.accepted) settle(message.token);
    };
    const pollTimer = host.setInterval(() => {
      if (!popup.closed) return;
      host.clearInterval(pollTimer);
      closeTimer = host.setTimeout(() => settle(null), 400);
    }, 300);
    const timeout = host.setTimeout(() => settle(null), 300_000);
    host.addEventListener("message", onMessage);
  });
}
