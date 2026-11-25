function clockFormat(timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hourCycle: "h23", hour: "2-digit", minute: "2-digit",
  });
}

export function zoneIsValid(timeZone: string): boolean {
  try { clockFormat(timeZone); return true; } catch { return false; }
}

/** Select a future whole minute, skipping a local date whose occurrence already ran. */
export function nextClock(nowIso: string, timeZone: string, hour: number, minute: number, previousOccurrence?: string): { at: string; zone: string } {
  const zone = zoneIsValid(timeZone) ? timeZone : "UTC";
  const format = clockFormat(zone);
  const start = Date.parse(nowIso);
  const origin = Math.floor((Number.isFinite(start) ? start : Date.now()) / 60_000) * 60_000;
  const previous = Date.parse(previousOccurrence ?? "");
  const previousDay = Number.isFinite(previous) ? format.format(previous).split(",")[0] : undefined;
  const desired = String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
  for (let step = 1; step <= 72 * 60; step += 1) {
    const candidate = new Date(origin + step * 60_000);
    const [day, time] = format.format(candidate).split(", ");
    if (day !== previousDay && time === desired) return { at: candidate.toISOString(), zone };
  }
  throw new Error("No valid occurrence for the selected time.");
}
