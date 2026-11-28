self.addEventListener("push", event => {
  event.waitUntil((async () => {
    const payload = event.data?.json();
    if (!payload || typeof payload.device !== "string" || typeof payload.hash !== "string"
      || !/^[0-9a-f-]{36}$/i.test(payload.device) || !/^[0-9a-f]{64}$/.test(payload.hash)) return;
    const query = new URLSearchParams({ device: payload.device, receipt: payload.hash });
    const destination = new URL("api/mind/notifications?" + query, self.registration.scope);
    const receipt = await fetch(destination.href, { credentials: "same-origin", cache: "no-store" });
    if (receipt.status !== 204) return;
    await self.registration.showNotification("Adrian workspace update", {
      body: "Open Alerts in Adrian to review your workspace update.",
      tag: "adrian-workspace-" + payload.hash,
    });
  })().catch(() => { /* A network failure never reveals a private notification. */ }));
});

self.addEventListener("notificationclick", event => {
  if (!/^adrian-workspace-[0-9a-f]{64}$/.test(event.notification.tag)) return;
  event.notification.close();
  event.waitUntil(self.clients.openWindow(new URL("#alerts", self.registration.scope).href));
});
