import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { createLinter, loadTextlintrc } from "textlint";
import { afterEach, beforeEach, expect, it } from "vitest";

// 依存元が実際に解決する版を検査し、overrideの適用漏れも検出する。
const rootRequire = createRequire(
  new URL("../../package.json", import.meta.url),
);
const eslintRequire = createRequire(rootRequire.resolve("eslint"));
const { Minimatch } = eslintRequire("minimatch");
const textlintRequire = createRequire(rootRequire.resolve("textlint"));
const { globSync } = textlintRequire("glob");
let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "glatasks-glob-"));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

async function fixture(path: string, content = "export {};\n") {
  const destination = join(cwd, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content);
}

it("ESLint selects nested and dot files while preserving global ignores", async () => {
  for (const path of [
    "src/main.js",
    "src/nested/module.mjs",
    "src/.hidden.js",
    "src/generated/skip.js",
  ]) {
    await fixture(path);
  }
  const eslint = new ESLint({
    cwd,
    overrideConfigFile: true,
    overrideConfig: [
      { ignores: ["**/generated/**"] },
      { files: ["**/*.{js,mjs}"], rules: { "no-undef": "error" } },
    ],
  });
  const results = await eslint.lintFiles(["src/**/*.{js,mjs}"]);
  expect(
    results.map((result) => relative(cwd, result.filePath)).sort(),
  ).toEqual(["src/.hidden.js", "src/main.js", "src/nested/module.mjs"]);
  expect(results.every((result) => result.errorCount === 0)).toBe(true);
});

it("textlint finds Markdown files and respects explicit and default ignores", async () => {
  for (const path of [
    "docs/main.md",
    "docs/nested/page.md",
    "docs/.hidden.md",
    "docs/generated/skip.md",
    "node_modules/skip.md",
    ".git/skip.md",
  ]) {
    await fixture(path, "Example.\n");
  }
  await fixture(".textlintignore", "**/generated/**\n");
  const descriptor = await loadTextlintrc({
    configFilePath: fileURLToPath(
      new URL("../../.textlintrc.yaml", import.meta.url),
    ),
  });
  const linter = createLinter({
    descriptor,
    cwd,
    ignoreFilePath: ".textlintignore",
  });
  const results = await linter.lintFiles(["**/*.md"]);
  expect(
    results.map((result) => relative(cwd, result.filePath)).sort(),
  ).toEqual(["docs/.hidden.md", "docs/main.md", "docs/nested/page.md"]);
  await expect(linter.lintFiles(["docs/generated/*.md"])).resolves.toEqual([]);
});

it("bounds globstar-parent pattern expansion at optimization level two", () => {
  // GHSA-g3hv-75wg-m249: 小さな入力で上限を確かめ、時間閾値には依存しない。
  const pattern = Array(8).fill("**/../a/b").join("/");
  const matcher = new Minimatch(pattern, {
    optimizationLevel: 2,
    braceExpandMax: 64,
  });
  expect(matcher.set.length).toBeLessThanOrEqual(64);
});

it("stops directory traversal when the signal aborts during a read", async () => {
  await fixture("nested/deeper/file.md", "Example.\n");
  const controller = new AbortController();
  const reason = new Error("stop traversal");
  let reads = 0;
  expect(() =>
    globSync("**/*", {
      cwd,
      signal: controller.signal,
      fs: {
        readdirSync: (...args: Parameters<typeof readdirSync>) => {
          const entries = readdirSync(...args);
          reads++;
          controller.abort(reason);
          return entries;
        },
      },
    }),
  ).toThrow(reason);
  // GHSA-3g3m-2fjr-6pw4: abort後に子ディレクトリへ読み進まない。
  expect(reads).toBe(1);
});
