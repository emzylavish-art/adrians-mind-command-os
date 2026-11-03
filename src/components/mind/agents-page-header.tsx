import type { ReactNode } from "react";
import { Bot, PenSquare, Search, Settings } from "lucide-react";

export type AgentsPageHeaderProps = {
  /** Focus global search / open command palette when provided. */
  onSearch?: (() => void) | null;
  /** Navigate to Settings when provided. */
  onSettings?: (() => void) | null;
  /** Jump to custom-agent form / new-bot surface when provided. */
  onNewBot?: (() => void) | null;
  /** Open a new chat (compose) when provided. */
  onCompose?: (() => void) | null;
};

/**
 * Page-local Grok Bot–style header for Bots & Agents.
 * Presentational only: wires to existing handlers when passed; otherwise
 * renders aria-disabled + Coming soon (no fake toasts).
 */
export function AgentsPageHeader({
  onSearch = null,
  onSettings = null,
  onNewBot = null,
  onCompose = null,
}: AgentsPageHeaderProps) {
  return (
    <div
      className="agents-grok-header"
      data-testid="agents-grok-header"
      role="toolbar"
      aria-label="Bots and Agents actions"
    >
      <HeaderAction
        label="Settings"
        comingSoon={!onSettings}
        onClick={onSettings}
        className="agents-grok-header__btn"
        testId="agents-header-settings"
      >
        <Settings className="size-4" aria-hidden="true" />
      </HeaderAction>

      <HeaderAction
        label="Search"
        comingSoon={!onSearch}
        onClick={onSearch}
        className="agents-grok-header__search"
        testId="agents-header-search"
      >
        <Search className="size-4" aria-hidden="true" />
        <span>Search</span>
      </HeaderAction>

      <HeaderAction
        label="New bot"
        comingSoon={!onNewBot}
        onClick={onNewBot}
        className="agents-grok-header__btn"
        testId="agents-header-new-bot"
      >
        <Bot className="size-4" aria-hidden="true" />
        <span className="sr-only">New bot</span>
      </HeaderAction>

      <HeaderAction
        label="Compose"
        comingSoon={!onCompose}
        onClick={onCompose}
        className="agents-grok-header__btn agents-grok-header__compose"
        testId="agents-header-compose"
      >
        <PenSquare className="size-4" aria-hidden="true" />
        <span className="sr-only">Compose</span>
      </HeaderAction>
    </div>
  );
}

function HeaderAction({
  label,
  comingSoon,
  onClick,
  className,
  testId,
  children,
}: {
  label: string;
  comingSoon: boolean;
  onClick: (() => void) | null | undefined;
  className: string;
  testId: string;
  children: ReactNode;
}) {
  const disabled = comingSoon || !onClick;
  return (
    <button
      type="button"
      className={className}
      data-testid={testId}
      aria-label={label}
      title={disabled ? `${label} — Coming soon` : label}
      aria-disabled={disabled ? true : undefined}
      disabled={disabled}
      onClick={() => {
        if (disabled || !onClick) return;
        onClick();
      }}
    >
      {children}
      {disabled ? <span className="agents-grok-header__soon">Coming soon</span> : null}
    </button>
  );
}
