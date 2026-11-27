/** Focus a dashboard destination after its panel has mounted, never before. */
export function focusDashboardPanel(
  documentLike: Pick<Document, "getElementById">,
  panelId: string,
  reducedMotion: boolean,
): boolean {
  const element = documentLike.getElementById(`panel-${panelId}`);
  if (!element) return false;
  element.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
  element.focus({ preventScroll: true });
  return true;
}
