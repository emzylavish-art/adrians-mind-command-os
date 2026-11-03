import type { ErrorComponentProps } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";

const FALLBACK_MESSAGE = "An unexpected error occurred. Try signing in again.";

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    // Never dump raw JSON / HTTPError blobs into the page.
    const msg = error.message.trim();
    if (!msg || /^\{[\s\S]*\}$/.test(msg) || /HTTPError|unhandled/i.test(msg)) {
      return FALLBACK_MESSAGE;
    }
    return msg.length > 240 ? `${msg.slice(0, 237)}…` : msg;
  }
  if (typeof error === "string" && error) {
    if (/^\s*\{/.test(error) || /HTTPError|unhandled/i.test(error)) {
      return FALLBACK_MESSAGE;
    }
    return error.length > 240 ? `${error.slice(0, 237)}…` : error;
  }
  return FALLBACK_MESSAGE;
}

export function AppErrorComponent({ error }: ErrorComponentProps) {
  return (
    <main
      className={
        "flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center " +
        "bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50"
      }
      data-testid="app-error-page"
    >
      <span className="text-red-500" aria-hidden="true">
        <TriangleAlert className="size-10" strokeWidth={2} />
      </span>
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="max-w-md text-sm break-words text-zinc-500 dark:text-zinc-400">
        {errorMessage(error)}
      </p>
      <Link
        to="/login"
        data-testid="app-error-back-login"
        className="mt-2 inline-flex min-h-11 items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-semibold text-zinc-50 transition-opacity hover:opacity-90 dark:bg-zinc-100 dark:text-zinc-900"
      >
        Back to sign in
      </Link>
    </main>
  );
}
