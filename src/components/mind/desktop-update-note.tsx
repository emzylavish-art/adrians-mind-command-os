import { useEffect, useState } from "react";

export function DesktopUpdateNote() {
  const [text, setText] = useState("Checking the live site for a newer build.");

  useEffect(() => {
    let gone = false;
    fetch("/api/mind/desktop-update?check=cloud", { cache: "no-store" })
      .then((response) => response.json())
      .then((body: { note?: unknown }) => {
        if (!gone) setText(typeof body.note === "string" ? body.note : "The update check could not run. This PC stays on the installed copy.");
      })
      .catch(() => {
        if (!gone) setText("The update check could not run. This PC stays on the installed copy.");
      });
    return () => {
      gone = true;
    };
  }, []);

  return (
    <p className="px-3 pb-2 text-xs text-muted" data-testid="desktop-update-note">
      {text}
    </p>
  );
}
