import type { NotificationPreferences } from "@/lib/mind/notifications";

export function NotificationPreferenceFields({ preferences, change }: {
  preferences: NotificationPreferences; change: (value: NotificationPreferences) => void;
}) {
  const toggles = [["completedRuns", "Completed runs"], ["activity", "Activity updates"], ["research", "Research reports"], ["media", "Generated media"]] as const;
  return <>
    {toggles.map(([field, label]) => <label key={field} className="flex min-h-11 items-center gap-2">
      <input type="checkbox" checked={preferences[field] !== false} onChange={event => change({ ...preferences, [field]: event.target.checked })} />{label}
    </label>)}
    {([["quietStart", "Quiet hours start"], ["quietEnd", "Quiet hours end"]] as const).map(([field, label]) => <label key={field} className="block text-sm">
      {label}{" "}<select className="min-h-11" value={preferences[field] ?? ""} onChange={event => change({ ...preferences, [field]: event.target.value === "" ? null : Number(event.target.value) })}>
        <option value="">Off</option>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h}:00</option>)}
      </select>
    </label>)}
  </>;
}
