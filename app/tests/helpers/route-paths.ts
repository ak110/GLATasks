import fs from "node:fs";
import path from "node:path";

const ROUTES_DIR = path.resolve(import.meta.dirname, "../../src/routes");

function isRouteFile(name: string, includePages: boolean): boolean {
  if (name === "+server.ts" || name === "+page.server.ts") return true;
  return includePages && name === "+page.svelte";
}

export function listRoutePaths({
  includePages = false,
}: { includePages?: boolean } = {}): string[] {
  const result: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (isRouteFile(entry.name, includePages)) {
        const segments = path
          .relative(ROUTES_DIR, dir)
          .split(path.sep)
          .filter((segment) => segment !== "")
          .map((segment) =>
            segment
              .replace(/\[x\+([0-9a-f]{2})\]/g, (_, hex: string) =>
                String.fromCharCode(parseInt(hex, 16)),
              )
              .replace(/^\[\.\.\.\w+\]$/, "sample")
              .replace(/^\[\w+\]$/, "1"),
          );
        result.push(`/${segments.join("/")}`);
      }
    }
  };
  walk(ROUTES_DIR);
  return [...new Set(result)].sort();
}
