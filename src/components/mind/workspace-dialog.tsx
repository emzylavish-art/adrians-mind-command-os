import { useEffect, useRef, type ReactNode } from "react";
import { dialogFocusableElements, dialogTabTarget } from "@/lib/mind/dialog-focus";

/** Native modal containment includes links, summaries and custom controls. */
export function WorkspaceDialog({ children, labelledBy, onDismiss }: { children: ReactNode; labelledBy?: string; onDismiss: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  // Capture before child autoFocus commits; the opener may already have lost
  // focus by the time the modal effect runs.
  const returnFocus = useRef<HTMLElement | null>(typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const previous = returnFocus.current;
    element.showModal();
    return () => {
      element.close();
      if (previous?.isConnected && previous.getClientRects().length) previous.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialog} tabIndex={-1} aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : "Workspace dialog"}
    className="workspace-dialog fixed inset-0 m-0 h-full max-h-none w-full max-w-none border-0 bg-transparent p-4 text-fg backdrop:bg-black/25 open:grid open:place-items-end md:open:place-items-center"
    onKeyDown={(event) => {
      if (event.defaultPrevented || event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
      const element = event.currentTarget;
      const target = dialogTabTarget(dialogFocusableElements(element), element.ownerDocument.activeElement as HTMLElement | null, event.shiftKey);
      if (target === undefined) return;
      event.preventDefault();
      (target ?? element).focus();
    }}
    onCancel={(event) => { event.preventDefault(); onDismiss(); }}
    onClick={(event) => { if (event.target === event.currentTarget) onDismiss(); }}>
    <div className="overlay-panel w-full max-w-md" tabIndex={-1}>{children}</div>
  </dialog>;
}
