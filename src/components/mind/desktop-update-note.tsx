import { PUBLIC_INSTALLER } from "@/lib/mind/desktop-update";
import { useState } from "react";

type UpdateBody = {
  note?: unknown;
  decision?: { action?: unknown; url?: unknown };
};

export function DesktopUpdateNote() {
  const [text, setText] = useState("Check for a newer Windows release.");
  const [busy, setBusy] = useState(false);

  async function check() {
    if (busy) return;
    setBusy(true);
    setText("Checking for a newer verified installer.");
    try {
      const response = await fetch("/api/mind/desktop-update?check=cloud", { cache: "no-store" });
      const body = await response.json() as UpdateBody;
      const note = typeof body.note === "string" ? body.note : "The update check could not run. This PC stays on the installed copy.";
      const action = body.decision?.action;
      const url = typeof body.decision?.url === "string" ? body.decision.url : "";
      if (action === "install" && url === PUBLIC_INSTALLER) {
        setText(note);
        window.location.assign(PUBLIC_INSTALLER);
        return;
      }
      setText(note);
    } catch {
      setText("The update check could not run. This PC stays on the installed copy.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-3 pb-2" data-testid="desktop-update-note">
      <button type="button" className="min-h-11 rounded-panel bg-accent px-3 text-sm font-semibold text-accent-ink" onClick={() => void check()} disabled={busy}>
        {busy ? "Checking…" : "Update"}
      </button>
      <p className="mt-2 text-xs text-muted">{text}</p>
    </div>
  );
}
