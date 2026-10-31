function zoneParts(date: Date, timeZone: string): { hour: number; minute: number } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).formatToParts(date);
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
    return { hour, minute };
  } catch {
    return null;
  }
}

export function zoneIsValid(timeZone: string): boolean {
  return zoneParts(new Date(), timeZone) !== null;
}

/** The next minute when the clock in `timeZone` shows `hour:minute`, strictly after `nowIso`. */
export function nextClock(nowIso: string, timeZone: string, hour: number, minute: number): { at: string; zone: string } {
  const zone = zoneIsValid(timeZone) ? timeZone : "UTC";
  const start = Date.parse(nowIso);
  const origin = Number.isFinite(start) ? start : Date.now();
  for (let step = 1; step <= 48 * 60; step += 1) {
    const candidate = new Date(origin + step * 60_000);
    const parts = zoneParts(candidate, zone);
    if (parts && parts.hour === hour && parts.minute === minute) return { at: candidate.toISOString(), zone };
  }
  return { at: new Date(origin + 24 * 60 * 60_000).toISOString(), zone };
}
