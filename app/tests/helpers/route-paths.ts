/**
 * @fileoverview `app/src/routes`のルートから、要求を送れる代表パスを導く。
 *
 * `handle`の単体試験と、稼働中のアプリへHTTPで要求するE2Eが同じ列挙を使い、
 * 新しいルートを追加すると両方の試験の対象へ自動で入るようにする。
 */

import fs from "node:fs";
import path from "node:path";

const ROUTES_DIR = path.resolve(import.meta.dirname, "../../src/routes");

/**
 * ルートを定義するファイル名。`includePages`では、サーバー側の処理を持たない画面（`+page.svelte`だけのルート）も含める。
 */
function isRouteFile(name: string, includePages: boolean): boolean {
  if (name === "+server.ts" || name === "+page.server.ts") return true;
  return includePages && name === "+page.svelte";
}

/** 全ルートの代表パスを返す。動的な引数は代表値へ置き換える。 */
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
          // 16進エスケープ（[x+2e]）は文字へ、残余引数（[...trpc]）は代表値へ置き換える
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
