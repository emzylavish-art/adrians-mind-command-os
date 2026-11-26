export const VISUAL_DESTINATIONS = [
  { label: "Chat home", view: "command", ready: "#command-home" },
  { label: "Chat fixture", view: "chat", ready: "article.turn-assistant" },
  { label: "Build", view: "build", ready: '[aria-label="Build sections"]' },
  { label: "Intelligence", view: "code", heading: "Intelligence" },
  { label: "Research", view: "research", heading: "Research" },
  { label: "Projects", view: "projects", heading: "Projects" },
  { label: "Library", view: "files", heading: "Library" },
  { label: "Plugins", view: "connected", heading: "Connected" },
  { label: "Scheduled", view: "scheduled", heading: "Scheduled" },
  { label: "Intelligence Layer", view: "intelligence", more: true, heading: "EVE" },
  { label: "Bots", view: "agents", more: true, heading: "Bots & agents" },
  { label: "Tools", view: "tools", more: true, heading: "Tools" },
  { label: "Skills", view: "skills", more: true, heading: "Skills" },
  { label: "Runs", view: "runs", more: true, heading: "Agent runs" },
  { label: "Memory", view: "memory", more: true, heading: "Memory" },
  { label: "Activity", view: "activity", more: true, heading: "Activity" },
  { label: "Help", view: "help", more: true, heading: "Help" },
  { label: "Settings", view: "settings", heading: "Settings" },
];
/** A click never counts as proof. Both independent screen identity and ready content must appear. */
export async function verifyDestination(page, destination, timeout = 15_000) {
  if (!destination || !/^[a-z-]+$/.test(destination.view)) throw new Error("Unknown visual destination.");
  await page.locator(`#mind-workspace[data-view="${destination.view}"]`).waitFor({ state: "visible", timeout });
  if (destination.heading) await page.locator("main").getByRole("heading", { name: destination.heading, exact: true }).first().waitFor({ state: "visible", timeout });
  else await page.locator(destination.ready).first().waitFor({ state: "visible", timeout });
  await page.waitForFunction(() => !document.querySelector('main [aria-busy="true"]'), undefined, { timeout });
  return { verified: true, view: destination.view, ready: destination.heading || destination.ready, url: page.url(), scope: "screen shell and specified ready content; does not prove every asynchronous service" };
}
