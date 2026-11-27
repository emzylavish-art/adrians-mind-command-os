/** Discovery transport failures cannot erase known credential or billing restrictions. */
export function discoveryFailureState(previous: string, httpStatus: number): string {
  if (httpStatus === 401 || httpStatus === 403) return "credentials_rejected";
  if (previous === "credentials_rejected") return previous;
  if (httpStatus === 402 || httpStatus === 429) return "quota_or_rate_limited";
  if (previous === "quota_or_rate_limited") return previous;
  return "unavailable";
}
