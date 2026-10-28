import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// Viteプラグインが実際に解決する依存を検査し、パッチの適用漏れも検出する。
const pluginRequire = createRequire(
  import.meta.resolve("@sveltejs/vite-plugin-svelte"),
);

describe.each(["deepmerge", "deepmerge/dist/umd.js"])("%s", (entry) => {
  const merge = pluginRequire(entry);

  // GHSA-gcqx-w48m-w2h4: sourceだけでなくtargetのコピーでも汚染が起きる。
  it.each([
    [
      "null prototype",
      () => Object.create(null),
      () => JSON.parse('{"__proto__":{"injected":true},"safe":1}'),
    ],
    [
      "own target key",
      () => JSON.parse('{"__proto__":{"injected":true},"safe":1}'),
      () => ({}),
    ],
    [
      "own keys on both sides",
      () => JSON.parse('{"__proto__":{}}'),
      () => JSON.parse('{"__proto__":{"injected":true},"safe":1}'),
    ],
  ])("does not poison the returned object: %s", (_name, target, source) => {
    const result = merge(target(), source());
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(result.injected).toBeUndefined();
    expect(Object.hasOwn(result, "__proto__")).toBe(false);
    expect(result.safe).toBe(1);
    expect(Reflect.get({}, "injected")).toBeUndefined();
  });

  it.each([null, undefined, 0, false, "value"])(
    "keeps nested prototypes intact when replacing %s",
    (placeholder) => {
      const result = merge(
        { session: placeholder },
        JSON.parse('{"session":{"__proto__":{"injected":true},"safe":1}}'),
      );
      expect(Object.getPrototypeOf(result.session)).toBe(Object.prototype);
      expect(result.session.injected).toBeUndefined();
      expect(result.session.safe).toBe(1);
    },
  );

  it("preserves config merging, symbols, callbacks and array replacement", () => {
    const symbol = Symbol("config");
    const preprocess = () => "compiled";
    const initial = { compilerOptions: { dev: true }, extensions: [".old"] };
    const incoming = {
      compilerOptions: { css: "external" },
      extensions: [".svelte"],
      preprocess,
      [symbol]: { enabled: true },
    };
    const result = merge(initial, incoming, {
      /** @param {unknown[]} _target @param {unknown[]} source */
      arrayMerge: (_target, source) => source,
    });
    expect(result).toEqual({
      compilerOptions: { dev: true, css: "external" },
      extensions: [".svelte"],
      preprocess,
      [symbol]: { enabled: true },
    });
    expect(initial.extensions).toEqual([".old"]);
    expect(initial.compilerOptions).toEqual({ dev: true });
    expect(incoming.compilerOptions).toEqual({ css: "external" });
  });
});
