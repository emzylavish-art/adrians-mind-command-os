import { readdirSync } from "node:fs";
import { resolve, relative } from "node:path";
export function discoverTests(root = process.cwd(), directories = ["src", "scripts"]) {
  const paths = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (/\.test\.(?:ts|mjs)$/.test(entry.name)) paths.push(relative(root, full).replaceAll("\\", "/"));
    }
  }
  for (const directory of directories) visit(resolve(root, directory));
  return paths.sort();
}
