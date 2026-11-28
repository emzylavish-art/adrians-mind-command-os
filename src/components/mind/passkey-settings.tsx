import { useState } from "react";
import { authClient } from "@/lib/auth/client";

type PasskeyLabel = { id: string; name?: string | null };
const button = "min-h-11 rounded-panel border border-line px-3";

export function PasskeySettings() {
  const [keys, setKeys] = useState<PasskeyLabel[] | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  async function change(action: "list" | "add" | "remove", id?: string) {
    if (busy) return;
    if (action === "remove" && !window.confirm("Remove this passkey from the account?")) return;
    setBusy(true);
    setStatus("");
    try {
      let addedId: string | undefined;
      if (action === "add") {
        const result = await authClient.passkey.addPasskey({ name: label.trim() || "Passkey" });
        if (result.error) throw Error(result.error.message || "Passkey enrollment did not complete.");
        addedId = result.data?.id;
      }
      if (action === "remove" && id) {
        const result = await authClient.passkey.deletePasskey({ id });
        if (result.error) throw Error(result.error.message || "Passkey removal did not complete.");
      }
      const result = await authClient.passkey.listUserPasskeys();
      if (result.error || !result.data) throw Error(result.error?.message || "The passkey list could not be verified.");
      setKeys(result.data);
      if (action === "add") {
        const verified = addedId && result.data.some(key => key.id === addedId);
        if (verified) setLabel("");
        setStatus(verified ? "Passkey enrollment confirmed." : "The passkey could not be confirmed in the refreshed list.");
      } else if (action === "remove") {
        setStatus(result.data.some(key => key.id === id) ? "The passkey still appears in the account list." : "Passkey removal confirmed.");
      }
    } catch (error) { setStatus(error instanceof Error ? error.message : "The passkey action could not be confirmed."); }
    finally { setBusy(false); }
  }

  return <section className="space-y-2 rounded-panel border border-line p-3" aria-label="Passkeys">
    <h4 className="font-medium">Passkeys</h4>
    <p className="text-muted">Use your device or security key to sign in. Sign in again if your session is too old to change passkeys.</p>
    <button className={button} type="button" disabled={busy} onClick={() => void change("list")}>Refresh passkeys</button>
    <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); void change("add"); }}>
      <input className={button} aria-label="Passkey name" value={label} maxLength={80} onChange={event => setLabel(event.target.value)} disabled={busy} />
      <button className={button} type="submit" disabled={busy}>Add passkey</button>
    </form>
    {keys?.length === 0 && <p>No passkeys are registered for this account.</p>}
    {keys?.map(key => <div className="flex flex-wrap items-center gap-2" key={key.id}>
      <span>{key.name || "Passkey"}</span>
      <button className={button} type="button" disabled={busy} onClick={() => void change("remove", key.id)}>Remove {key.name || "passkey"}</button>
    </div>)}
    {status && <p role="status">{status}</p>}
  </section>;
}
