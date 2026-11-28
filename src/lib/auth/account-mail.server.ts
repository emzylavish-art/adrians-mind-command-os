import { createHash } from "node:crypto";
import { accountMailConfiguration } from "./account-mail";

type Sender = NonNullable<ReturnType<typeof accountMailConfiguration>>;

export async function sendAccountMail(config: Sender, action: "verify" | "reset", to: string, token: string) {
  const verify = action === "verify";
  const link = new URL(verify ? "/api/auth/verify-email" : "/login", config.origin);
  if (verify) {
    link.searchParams.set("token", token);
    link.searchParams.set("callbackURL", config.origin + "/?section=settings&pane=sessions");
  } else {
    link.searchParams.set("recover", "1");
    link.hash = new URLSearchParams({ reset: token }).toString();
  }
  const idempotencyKey = createHash("sha256").update(action + ":" + token).digest("hex");
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(5000),
      headers: { authorization: "Bearer " + config.key, "content-type": "application/json", "idempotency-key": "adrian-account-" + idempotencyKey },
      body: JSON.stringify({
        from: config.from, to: [to], subject: verify ? "Verify your Adrian account email" : "Reset your Adrian account password",
        text: (verify ? "Verify your account email with this link. It expires in 30 minutes." : "Reset your password with this link. It expires in 15 minutes.")
          + "\n\n" + link.href + "\n\nIf you did not request this, you can ignore this email.",
      }),
    });
    const receipt = response.ok ? await response.json() : null;
    return typeof receipt?.id === "string" && receipt.id.length > 0;
  } catch {
    return false;
  }
}
