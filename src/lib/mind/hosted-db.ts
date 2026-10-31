export function hostedDatabaseDecision(projects: { ref: string }[], forbidden: string[]) {
  const blocked = new Set(forbidden);
  const usable = projects.filter((project) => project.ref && !blocked.has(project.ref));
  if (projects.length > 0 && usable.length === 0) {
    return { connected: false, realtime: false, reason: "Every Supabase project on this account is forbidden for this app. No hosted database was used and realtime was not connected." };
  }
  if (usable.length === 0) {
    return { connected: false, realtime: false, reason: "No Supabase project is configured. The file database is local. Realtime is not connected." };
  }
  return { connected: true, realtime: false, reason: "A non-forbidden project is listed. Realtime was not opened." };
}
