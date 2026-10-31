export type ServerSync = "use-server" | "upload-local" | "keep-local" | "empty";

export function chooseServerSync(localHasContent: boolean, serverHasContent: boolean): ServerSync {
  if (!localHasContent && serverHasContent) return "use-server";
  if (localHasContent && !serverHasContent) return "upload-local";
  if (localHasContent && serverHasContent) return "keep-local";
  return "empty";
}
