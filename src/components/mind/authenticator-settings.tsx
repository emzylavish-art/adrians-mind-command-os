import { useState } from "react";
import { authClient } from "@/lib/auth/client";

const control = "min-h-11 rounded-panel border border-line px-3";

export function AuthenticatorSettings({ enabled, refresh }: { enabled: boolean; refresh: () => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [secret, setSecret] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function change(action: "enable" | "disable" | "confirm") {
    if (busy) return;
    if (action === "disable" && !window.confirm("Remove the authenticator requirement for password sign-in?")) return;
    setMessage("");
    setBusy(true);
    try {
      if (action === "enable") {
        const result = await authClient.twoFactor.enable({ password, method: "totp" });
        if (result.error || result.data?.method !== "totp") {
          throw Error(result.error?.message || "Authenticator setup did not start.");
        }
        const setupKey = new URL(result.data.totpURI).searchParams.get("secret");
        if (!setupKey) throw Error("The authenticator setup key is unavailable.");
        setSecret(setupKey);
        setRecoveryCodes(result.data.backupCodes);
        return;
      }
      const result = action === "confirm"
        ? await authClient.twoFactor.verifyTotp({ code: code.trim() })
        : await authClient.twoFactor.disable({ password });
      if (result.error) throw Error(result.error.message || "The authenticator change could not be verified.");
      setSecret("");
      setCode("");
      if (action === "disable") setRecoveryCodes([]);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The authenticator change could not be verified.");
    } finally {
      setPassword("");
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-panel border border-line p-3" aria-label="Password authenticator">
      <h4 className="font-medium">Password authenticator</h4>
      <p className="text-muted" role="status">{enabled ? "Authenticator required for password sign-in." : "Authenticator is off for password sign-in."}</p>
      {secret ? <form className="space-y-2" onSubmit={event => { event.preventDefault(); void change("confirm"); }}>
        <p>Add this setup key to your authenticator app, then enter its six-digit code.</p>
        <output aria-label="Authenticator setup key" className="block select-all break-all font-mono">{secret}</output>
        <label className="grid gap-1">
          Authenticator code
          <input className={control} value={code} onChange={event => setCode(event.target.value)} required
            inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} disabled={busy} />
        </label>
        <button className={control} type="submit" disabled={busy}>Confirm authenticator</button>
      </form> : <form className="flex flex-wrap items-end gap-2" onSubmit={event => {
        event.preventDefault(); void change(enabled ? "disable" : "enable");
      }}>
        <label className="grid gap-1">
          Current password
          <input type="password" autoComplete="current-password" className={control} value={password}
            onChange={event => setPassword(event.target.value)} required disabled={busy} />
        </label>
        <button className={control} type="submit" disabled={busy}>{enabled ? "Disable authenticator" : "Set up authenticator"}</button>
      </form>}
      {recoveryCodes.length > 0 && <div className="space-y-2">
        <p>Save these one-time recovery codes somewhere secure. This is the only time they are shown.</p>
        <ul className="grid grid-cols-2 gap-1 font-mono" aria-label="Recovery codes">
          {recoveryCodes.map(item => <li key={item} className="select-all">{item}</li>)}
        </ul>
        {enabled && <button className={control} type="button" onClick={() => setRecoveryCodes([])}>Hide recovery codes</button>}
      </div>}
      {message && <p role="alert">{message}</p>}
    </section>
  );
}
