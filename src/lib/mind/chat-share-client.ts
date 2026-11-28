import { getBearerToken } from "@/lib/auth/client";

export async function shareRequest(body?: object) {
  const bearer = getBearerToken();
  const response = await fetch("/api/mind/shared-chats", {
    method: body ? "POST" : "GET", cache: "no-store", credentials: "same-origin",
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(bearer ? { authorization: "Bearer " + bearer } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || "The shared link request could not be confirmed.");
  return data;
}
