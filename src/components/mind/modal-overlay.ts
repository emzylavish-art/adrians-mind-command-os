import { createElement, useRef, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";

/** Blocking reviews share focus containment, Escape, background isolation and focus restoration. */
export function ModalOverlay({ children, labelledBy, onDismiss, onPanel, panelClassName }: {
  children: ReactNode; labelledBy: string; onDismiss: () => void; onPanel?: (node: HTMLDivElement | null) => void; panelClassName?: string;
}) {
  const opener = useRef<HTMLElement | null>(null);
  return createElement(Dialog.Root, { open: true, onOpenChange: (open) => { if (!open) onDismiss(); } },
    createElement(Dialog.Portal, null,
      createElement(Dialog.Overlay, { className: "fixed inset-0 z-40 bg-black/40" }),
      createElement(Dialog.Content, {
        className: `overlay-panel fixed left-1/2 top-1/2 z-50 max-h-[85dvh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto ${panelClassName ?? ""}`,
        "aria-labelledby": labelledBy, "aria-describedby": undefined, ref: onPanel,
        onOpenAutoFocus: () => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; },
        onCloseAutoFocus: (event) => { event.preventDefault(); if (opener.current?.isConnected) opener.current.focus({ preventScroll: true }); },
        onPointerDownOutside: (event) => event.preventDefault(),
      }, createElement(Dialog.Title, { className: "sr-only" }, "Review action"), children),
    ),
  );
}
