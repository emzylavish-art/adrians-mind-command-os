self.addEventListener("push", event => {
  event.waitUntil((async () => {
    const payload = event.data?.json();
    if (!payload || typeof payload.device !== "string" || typeof payload.hash !== "string"
      || !/^[0-9a-f-]{36}$/i.test(payload.device) || !/^[0-9a-f]{64}$/.test(payload.hash)) return;
    const query = new URLSearchParams({ device: payload.device, receipt: payload.hash });
    const receipt = await fetch("/api/mind/notifications?" + query, { credentials: "same-origin", cache: "no-store" });
    if (receipt.status !== 204) return;
    await self.registration.showNotification("Adrian workspace update", {
      body: "Open Alerts in Adrian to review your workspace update.",
      tag: "adrian-workspace-" + payload.hash,
    });
  })().catch(() => { /* A network failure never reveals a private notification. */ }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow("/#alerts"));
});
