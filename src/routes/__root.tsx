import { createRootRoute, HeadContent, Link, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { AppleMotionHost } from "@/components/mind/apple-motion-host";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "Adrian's Mind" },
      { name: "theme-color", content: "#070b16" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap",
      },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
    ],
  }),
  notFoundComponent: () => (
    <main className="grid min-h-screen place-items-center bg-bg px-5 py-12 text-fg">
      <section className="w-full max-w-md rounded-panel border border-line bg-surface p-7 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Adrian&apos;s Mind</p>
        <h1 className="mt-3 font-display text-2xl font-bold">Page not found</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">That address does not match a page in this workspace.</p>
        <Link to="/" className="mt-5 inline-flex min-h-11 items-center justify-center rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink">Return to Adrian&apos;s Mind</Link>
      </section>
    </main>
  ),
  errorComponent: () => (
    <main className="grid min-h-screen place-items-center bg-bg px-5 py-12 text-fg">
      <section className="w-full max-w-md rounded-panel border border-line bg-surface p-7 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Adrian&apos;s Mind</p>
        <h1 className="mt-3 font-display text-2xl font-bold">This page could not finish</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">The page stopped. No internal path or stack is shown. Return home and try the action again.</p>
        <Link to="/" className="mt-5 inline-flex min-h-11 items-center justify-center rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink">Return to Adrian&apos;s Mind</Link>
      </section>
    </main>
  ),
  component: () => (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <PreviewHostBridge />
        <AppleMotionHost />
        <AuthProvider>
          <Outlet />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  ),
});
