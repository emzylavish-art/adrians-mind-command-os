import type { ReactNode } from "react";
import { Zap } from "lucide-react";

/** Calm Grok/ChatGPT-like empty chat surface (presentational). */
export function ChatEmptyHero(props: { title?: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="chat-empty-hero" data-testid="chat-empty">
      <span className="mx-auto grid size-16 place-items-center rounded-full bg-accent/20 text-accent shadow-[0_0_28px_rgb(124_92_255/0.45)]">
        <Zap className="size-7" />
      </span>
      <p className="chat-empty-title">{props.title ?? "Grok 4.5"}</p>
      <p className="text-sm text-muted">{props.subtitle ?? "How can I help you today?"}</p>
      <p className="text-xs text-muted">Nothing is sent until you press Send.</p>
      {props.children}
    </div>
  );
}
