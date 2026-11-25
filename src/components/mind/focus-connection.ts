/** Focus a dashboard deep link once its async row is mounted. React calls ref callbacks on mount. */
export function focusConnection(node: HTMLElement | null) {
  if (!node?.id || window.location.hash !== "#" + encodeURIComponent(node.id)) return;
  const details = node.closest("details");
  if (details) details.open = true;
  node.focus({ preventScroll: true });
  node.scrollIntoView({ block: "center" });
  history.replaceState(history.state, "", window.location.pathname + window.location.search);
}
