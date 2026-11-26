import { useCallback, useLayoutEffect, useRef, type RefObject, type UIEvent } from "react";

/** Remember observed scrolling before React replaces a long view with a shorter one. */
export function useViewScrollPosition(
  scrollerRef: RefObject<HTMLElement | null>,
  owner: string | null,
  view: string,
) {
  const positions = useRef(new Map<string, number>());
  const observed = useRef<{ key: string; top: number; restoring: boolean } | null>(null);
  const key = JSON.stringify([owner, view]);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const top = positions.current.get(key) ?? 0;
    const position = { key, top, restoring: true };
    observed.current = position;
    let resize: ResizeObserver | null = null;
    let children: MutationObserver | null = null;
    const disconnect = () => { resize?.disconnect(); children?.disconnect(); };
    const restore = () => {
      if (!scroller || observed.current !== position || !position.restoring) return;
      scroller.scrollTop = top;
      // Async panels can initially be shorter than the position we are restoring.
      // Keep the requested position until their content can actually display it.
      if (top === 0 || scroller.scrollHeight - scroller.clientHeight >= top - 1) {
        position.top = scroller.scrollTop;
        position.restoring = false;
        disconnect();
      }
    };
    const userInput = () => {
      if (!scroller || !position.restoring) return;
      position.restoring = false;
      position.top = scroller.scrollTop;
      disconnect();
    };
    const keyInput = (event: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) userInput();
    };
    restore();
    if (scroller && position.restoring) {
      if (typeof ResizeObserver !== "undefined") {
        resize = new ResizeObserver(restore);
        const observeChildren = () => {
          if (!position.restoring) return;
          resize?.observe(scroller);
          for (const child of Array.from(scroller.children)) resize?.observe(child);
          restore();
        };
        if (typeof MutationObserver !== "undefined") {
          children = new MutationObserver(observeChildren);
          children.observe(scroller, { childList: true });
        }
        observeChildren();
      }
      scroller.addEventListener("wheel", userInput, { passive: true });
      scroller.addEventListener("touchstart", userInput, { passive: true });
      scroller.addEventListener("pointerdown", userInput, { passive: true });
      scroller.addEventListener("keydown", keyInput);
    }
    return () => {
      // The old DOM may already have been shortened and clamped at cleanup.
      // Use the last scroll event, never a fresh read of the replaced content.
      if (observed.current === position) positions.current.set(key, position.top);
      position.restoring = false;
      disconnect();
      scroller?.removeEventListener("wheel", userInput);
      scroller?.removeEventListener("touchstart", userInput);
      scroller?.removeEventListener("pointerdown", userInput);
      scroller?.removeEventListener("keydown", keyInput);
    };
  }, [key, scrollerRef]);

  return useCallback((event: Pick<UIEvent<HTMLElement>, "currentTarget">) => {
    if (observed.current && !observed.current.restoring) observed.current.top = event.currentTarget.scrollTop;
  }, []);
}
