/** Shared display values used by the conversation surface and command shell. */

export const PRODUCT_LOGO: Record<string, string> = {
  grok: "/brand/logos/grok.svg",
  openai: "/brand/logos/openai.svg",
  claude: "/brand/logos/claude.svg",
  gemini: "/brand/logos/gemini.svg",
  openrouter: "/brand/logos/openrouter.svg",
  vercel: "/brand/logos/vercel.svg",
  gmail: "/brand/logos/gmail.svg",
  notion: "/brand/logos/notion.svg",
  github: "/brand/logos/github.svg",
  mcp: "/brand/logos/mcp.svg",
  supabase: "/brand/logos/supabase.svg",
  drive: "/brand/logos/drive.svg",
  calendar: "/brand/logos/calendar.svg",
  slack: "/brand/logos/slack.svg",
  youtube: "/brand/logos/youtube.svg",
  docs: "/brand/logos/docs.svg",
};

export function stamp(iso: string) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
