import { join } from "node:path";

/**
 * Local product files. The preview keeps them under the working directory.
 * The Windows app sets ADRIAN_DATA_DIR to the user data folder so an
 * uninstall of the program folder does not delete chats, bots, or connectors.
 */
export function localDataPath(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): string {
  const root = env.ADRIAN_DATA_DIR?.trim();
  if (root) return join(root, name);
  return join(cwd, ".data", name);
}
