/**
 * Composer path the mounted turn test renders. Fetch is injected. No network.
 */

import { createElement, useState, type ReactNode } from "react";
import { chatTurnBody, type LogicRouteId, type ModelTier } from "../../lib/mind/logic-routes.ts";
import { emitFailure, mountFailure } from "../../lib/mind/failure-mount.ts";

export type ComposerSelection = {
  provider: string;
  modelTier: ModelTier;
  logicRoute: LogicRouteId | null;
};

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export function ComposerTurnHost(props: { selection: ComposerSelection; fetchImpl: FetchLike; text?: string }): ReactNode {
  const [reply, setReply] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  async function send() {
    const body = chatTurnBody({
      text: props.text ?? "hello",
      memory: "off",
      halted: false,
      history: [],
      memoryContext: [],
      provider: props.selection.provider,
      modelTier: props.selection.modelTier,
      logicRoute: props.selection.logicRoute,
      images: [],
    });
    const response = await props.fetchImpl("/api/mind/turn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as { ok?: boolean; error?: string; text?: string };
    if (!response.ok || payload.ok === false) {
      const message = payload.error || "The route did not answer.";
      emitFailure(
        "modelRoute",
        mountFailure({ message, action: "chat_failed", target: "provider", provider: props.selection.provider, logicRoute: props.selection.logicRoute }, () => {
          void send();
        }),
      );
      setReply(null);
      setBanner(message);
      return;
    }
    setBanner(null);
    setReply(payload.text ?? "");
  }
  return createElement(
    "section",
    { "data-testid": "composer" },
    createElement(
      "button",
      { type: "button", "data-testid": "composer-send", onClick: () => void send() },
      "Send",
    ),
    reply != null ? createElement("p", { "data-testid": "composer-reply" }, reply) : null,
    banner ? createElement("div", { role: "alert", "data-testid": "failure-banner" }, banner) : null,
  );
}
