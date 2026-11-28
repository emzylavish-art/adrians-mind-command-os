import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { previewPathPrefix } from "@/lib/preview-path-prefix";

export default function SocialWorkspace({ onReturn, returnHref }: { onReturn: () => void; returnHref?: string }) {
  const content = useRef<HTMLDivElement>(null);
  const [attempt, retry] = useState(0);
  const [status, setStatus] = useState<"loading" | "loaded" | "failed">("loading");
  useEffect(() => {
    const outlet = content.current;
    if (!outlet) return;
    const lifetime = new AbortController();
    const directory = (previewPathPrefix(location.hostname, location.pathname) ?? "") + "/apps/social/";
    let mountedPanel: HTMLElement | null = null;
    setStatus("loading");
    void (async () => {
      const result = await fetch(directory + "index.html", { signal: lifetime.signal, mode: "same-origin" });
      if (!result.ok) throw new Error();
      const template = new DOMParser().parseFromString(await result.text(), "text/html");
      const panel = template.querySelector<HTMLElement>("[data-adrian-social]");
      if (!panel) throw new Error();
      panel.removeAttribute("data-standalone");
      for (const asset of panel.querySelectorAll("img[src], a[href]")) {
        const attribute = asset instanceof HTMLImageElement ? "src" : "href";
        const value = asset.getAttribute(attribute);
        if (value?.startsWith("assets/") || value?.startsWith("installer/")) asset.setAttribute(attribute, directory + value);
      }
      if (lifetime.signal.aborted) return;
      mountedPanel = panel;
      const script = document.createElement("script");
      script.src = directory + "app.js";
      let ready = false;
      panel.addEventListener("adrian-social:ready", () => {
        ready = true;
        setStatus("loaded");
      }, { once: true, signal: lifetime.signal });
      script.addEventListener("load", () => {
        if (!ready) setStatus("failed");
      }, { once: true, signal: lifetime.signal });
      script.addEventListener("error", () => { setStatus("failed"); }, { once: true, signal: lifetime.signal });
      outlet.replaceChildren(panel);
      panel.append(script);
    })().catch(() => {
      if (!lifetime.signal.aborted) {
        outlet.replaceChildren();
        setStatus("failed");
      }
    });
    return () => {
      lifetime.abort();
      mountedPanel?.dispatchEvent(new Event("adrian-social:dispose"));
      outlet.replaceChildren();
    };
  }, [attempt]);
  const stylesheet = (typeof location === "undefined" ? "" : previewPathPrefix(location.hostname, location.pathname) ?? "") + "/apps/social/styles.css";
  const exitClass = "inline-flex min-h-11 items-center gap-2 rounded-panel px-3 text-sm text-muted hover:text-fg";
  const exitLabel = <><ArrowLeft aria-hidden="true" size={16} /> Back to workspace</>;
  return <section data-testid="adrian-social-workspace" aria-label="Adrian Social workspace">
    <link rel="stylesheet" href={stylesheet} />
    <div className="mx-auto max-w-[79rem] px-3 pt-2 md:px-5">
      {returnHref ? <a className={exitClass} href={returnHref}>{exitLabel}</a>
        : <button type="button" className={exitClass} onClick={onReturn}>{exitLabel}</button>}
    </div>
    {status === "loading" && <p role="status" className="px-5 py-3">Loading Adrian Social…</p>}
    {status === "failed" && <div className="px-5 py-3" role="alert">
      <p>Adrian Social could not load.</p>
      <button type="button" className="min-h-11 underline" onClick={() => retry(value => value + 1)}>Retry</button>
    </div>}
    <div ref={content} />
  </section>;
}
