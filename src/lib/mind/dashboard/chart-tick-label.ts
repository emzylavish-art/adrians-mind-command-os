/** Gap #15 — readable chart ticks: prefer hour suffix / initials over identical truncations. */
export function chartTickLabel(label: string, dense: boolean): string {
  const raw = String(label || "").trim();
  if (!raw) return "—";
  // Gap#49: labels look like "01/11 15h ·c5/r17" — match hour anywhere, not only at EOL.
  const hour = raw.match(/(?:^|\s)(\d{1,2})h(?:\b|\s|·|$)/i) || raw.match(/(\d{1,2})h/i);
  if (hour) return `${hour[1]}h`;
  if (raw.includes("-")) {
    const initials = raw
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map((s) => s[0]!)
      .join("")
      .toLowerCase();
    if (initials.length >= 2) return dense ? initials.slice(0, 4) : initials.slice(0, 6);
  }
  if (dense && raw.length > 5) return raw.slice(0, 4) + "…";
  if (raw.length > 8) return raw.slice(0, 7) + "…";
  return raw;
}
